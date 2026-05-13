/**
 * - 开发环境默认走相对路径 `/api/...`，由 next.config 的 rewrites 转发到后端，避免直连 :8000 时的 Failed to fetch（未启动/CORS/IPv6 等）。
 * - 生产静态导出请在构建环境设置 NEXT_PUBLIC_API_BASE 指向真实 API（见 .env.production）。
 * - 若仍要开发时直连后端，可设 NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
 */
function getApiBase(): string {
  const v = process.env.NEXT_PUBLIC_API_BASE
  if (v !== undefined && v !== "") return v.replace(/\/$/, "")
  if (process.env.NODE_ENV === "development") return ""
  return "http://127.0.0.1:8000"
}

const API_BASE = getApiBase()

function redirectToLogin(force = false) {
  if (typeof window === "undefined") return
  // 已经在登录页就不跳(避免反复刷新)
  if (window.location.pathname === "/login") return
  // 跳前端炫酷登录页;force 透传(到 /login 后用户主动点按钮才会去 Casdoor)
  // /login 内部按 force 决定调 ?force=true 还是普通 /api/auth/login
  window.location.href = force ? "/login?force=true" : "/login"
}

/**
 * 并发请求共享同一次 refresh —— 避免多个 API 同时 401 时重复调 /auth/refresh。
 * 注意：refresh 无副作用（幂等），即使并发多次也不会把会话搞坏，
 * 但单例仍能减少 1 次往返 + 避免 refresh-session 表瞬时多行。
 */
let _refreshingPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (_refreshingPromise) return _refreshingPromise
  _refreshingPromise = (async () => {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        signal: ctrl.signal,
      })
      clearTimeout(to)
      return res.ok
    } catch {
      return false
    } finally {
      // 释放单例，下一次 401 如果再过期还能触发新的 refresh
      setTimeout(() => { _refreshingPromise = null }, 0)
    }
  })()
  return _refreshingPromise
}

/** 全局 fetch 超时；批量类长操作（如 Taiji 批量建几百账号）走更长的超时阈值。 */
const _DEFAULT_FETCH_TIMEOUT_MS = 30_000
const _LONG_FETCH_PATTERNS = [
  /\/api\/service-accounts\/taiji-from-blob$/,
  /\/api\/service-accounts\/taiji-cleanup-duplicates$/,
  /\/api\/service-accounts\/taiji-ingest-day$/,
  /\/api\/service-accounts\/bulk-/,
  /\/api\/service-accounts\/hard\//,  // 删除大批账号
  /\/api\/sync\/refresh-summary/,  // billing_daily_summary 重算可能 1~5min
]

function _timeoutFor(url: string): number {
  for (const re of _LONG_FETCH_PATTERNS) if (re.test(url)) return 300_000  // 5 min for heavy ops
  return _DEFAULT_FETCH_TIMEOUT_MS
}

async function doFetch(url: string, restInit: RequestInit, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), _timeoutFor(url))
  try {
    return await fetch(url, {
      ...restInit,
      headers,
      credentials: "include",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await requestRaw(path, init)
  if (r.status === 204) return undefined as T
  return r.json()
}

/** 同 request,但返回原始 Response,供需要读 header(如 X-Total-Count)的调用方用。 */
async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  const { headers: extraHeaders, ...restInit } = init ?? {}
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const headers: Record<string, string> = {
    ...(extraHeaders as Record<string, string>),
  }
  if (restInit.body != null) {
    headers["Content-Type"] = "application/json"
  }
  const isRefreshCall = path === "/api/auth/refresh"
  let res = await doFetch(url, restInit, headers)
  if (res.status === 401 && !isRefreshCall) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      res = await doFetch(url, restInit, headers)
    }
    if (res.status === 401) {
      redirectToLogin()
      throw new Error("API 401 after refresh attempt: redirecting to login")
    }
  } else if (res.status === 401) {
    redirectToLogin()
    throw new Error("API 401: redirecting to login")
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    // 特殊 403:"cloud role required" 表示当前账号在 Casdoor 没分配任何 cloud_*
    // 角色 — 一直 403 用户卡住没出口。弹对话框让用户主动选"重新登录"(force=true
    // 让 Casdoor 重选账号),取消则保持现状由 UI 自行展示。
    if (res.status === 403 && /cloud role required/i.test(body) && typeof window !== "undefined") {
      // 跨多个并发请求只弹一次:用 sessionStorage 节流
      const KEY = "_no_cloud_role_alerted"
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1")
        const ok = window.confirm(
          "你的账号没有 CloudCost 访问权限。\n\n" +
          "可能原因:Casdoor 后台未给当前账号分配 cloud_admin / cloud_ops / cloud_<provider>(aws/gcp/azure/taiji) 角色。\n\n" +
          "点击「确定」用其他账号重新登录,或联系管理员。"
        )
        if (ok) {
          redirectToLogin(true)  // force=true 强制重选账号
          throw new Error("redirecting to re-login (no cloud role)")
        }
        // 取消则解除节流,下次还能弹
        setTimeout(() => sessionStorage.removeItem(KEY), 5000)
      }
    }
    throw new Error(`API ${res.status}: ${body}`)
  }
  return res
}

/** 通用分页响应:items 是当前页数据,total 是过滤后总数(读自 X-Total-Count header)。 */
export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

async function requestPaged<T>(path: string, init?: RequestInit): Promise<PagedResult<T>> {
  const r = await requestRaw(path, init)
  const items = (r.status === 204 ? [] : await r.json()) as T[]
  const total = Number(r.headers.get("x-total-count") ?? items.length)
  const page = Number(r.headers.get("x-page") ?? 1)
  const page_size = Number(r.headers.get("x-page-size") ?? (items.length || 100))
  return { items, total, page, page_size }
}

/** 自动循环拉完所有页,合并成单一数组返回。给"我就想要全量"的旧调用方用。 */
async function fetchAllPaged<T>(buildPath: (page: number, pageSize: number) => string,
                                 pageSize = 200): Promise<T[]> {
  const out: T[] = []
  let page = 1
  while (true) {
    const r = await requestPaged<T>(buildPath(page, pageSize))
    out.push(...r.items)
    if (out.length >= r.total || r.items.length === 0) break
    page += 1
    if (page > 100) {
      // 安全阀:理论上不会过 100 页(每页 200 = 2 万条)
      console.warn("fetchAllPaged: hit 100-page safety cap")
      break
    }
  }
  return out
}

// ─── Service Account Types ────────────────────────────────────

export interface ServiceAccount {
  id: number
  name: string
  supply_source_id: number
  supplier_name: string
  provider: string
  /** 主体 id（供应商→货源→主体→服务账号 这一层）；null 表示未分配主体。 */
  entity_id?: number | null
  /** 主体名称；entity_id 为 null 时也为 null。 */
  entity_name?: string | null
  external_project_id: string
  status: string
  order_method?: string | null
  /** 销售系统分配的客户编号，可能多个；空数组即 "未分配"。 */
  customer_codes: string[]
  created_at: string
}

/** 货源（供应商 + 云），来自 /api/suppliers/supply-sources/all */
export interface SupplySourceItem {
  id: number
  supplier_id: number
  supplier_name: string | null
  provider: string
  account_count: number
}

/** 主体（供应商 → 货源 → 主体）。来自 /api/suppliers/entities/all 或 /supply-sources/{id}/entities */
export interface EntityItem {
  id: number
  supply_source_id: number
  supplier_id?: number | null
  supplier_name?: string | null
  provider?: string | null
  name: string
  note?: string | null
  account_count: number
}

export interface SupplierRow {
  id: number
  name: string
}

export interface HistoryItem {
  id: number
  action: string
  from_status: string | null
  to_status: string | null
  operator: string | null
  /** customer_bound / customer_unbound 日志条目上的客户编号。 */
  customer_code?: string | null
  notes: string | null
  created_at: string
}

export interface ServiceAccountDetail extends ServiceAccount {
  supplier_id: number
  notes: string | null
  secret_fields: string[]
  history: HistoryItem[]
}

export interface CostByService {
  service: string
  cost: number
  usage_quantity: number
  usage_unit: string | null
}

export interface DailyCost {
  date: string
  cost: number
  usage_quantity: number
}

export interface DailyServiceCost {
  date: string
  service: string
  cost: number
  usage_quantity: number
  usage_unit: string | null
}

export interface CostSummary {
  total_cost: number
  total_usage: number
  services: CostByService[]
  daily: DailyCost[]
  daily_by_service: DailyServiceCost[]
}

export interface DailyReportRow {
  account_id: number
  account_name: string
  provider: string
  external_project_id: string
  date: string
  product: string | null
  cost: number
}

// ─── Alert Types ──────────────────────────────────────────────

export interface AlertRule {
  id: number
  name: string
  target_type: string
  target_id: string | null
  threshold_type: string
  threshold_value: number
  notify_webhook: string | null
  notify_email: string | null
  is_active: boolean
  created_at: string
}

export interface AlertHistory {
  id: number
  rule_id: number
  triggered_at: string
  actual_value: number | null
  threshold_value: number | null
  message: string | null
  notified: boolean
}

export interface AppNotification {
  id: number
  title: string
  message: string
  type: string
  is_read: boolean
  alert_history_id: number | null
  created_at: string
}

export interface CommitmentStatus {
  account_id: number
  account_name: string
  provider: string
  external_project_id: string
  commitment: number
  actual: number
  gap: number
  met: boolean
}

export interface RuleStatus {
  rule_id: number
  rule_name: string
  threshold_type: string
  threshold_value: number
  actual: number
  pct: number
  triggered: boolean
  account_name: string
  provider: string
  external_project_id: string
}

// ─── Dashboard Types ──────────────────────────────────────────

export interface DashboardOverview {
  total_cost: number
  prev_month_cost: number
  mom_change_pct: number
  active_projects: number
}

/** One row from GET /dashboard/trend or bundle `trend` — Recharts uses `date` + `cost`. */
export interface DashboardTrendPoint {
  date: string
  cost: number
  cost_by_provider?: Record<string, number>
}

export interface DashboardProviderSlice {
  provider: string
  cost: number
  percentage: number
}

export interface DashboardServiceSlice {
  product: string
  cost: number
  percentage: number
}

/** GET /api/dashboard/bundle */
export interface DashboardBundle {
  overview: DashboardOverview
  trend: DashboardTrendPoint[]
  by_provider: DashboardProviderSlice[]
  by_service: DashboardServiceSlice[]
}

// ─── Service Accounts API ─────────────────────────────────────

export interface CurrentUser {
  id: number
  username: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  roles: string[]
  visible_cloud_account_ids: number[] | null
  /** null = 全量(admin/ops);[] = 无范围;["aws","gcp"] = 限定到这些 provider */
  visible_providers: string[] | null
}

export const authApi = {
  me: () => request<CurrentUser>("/api/auth/me"),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  loginUrl: (force = false) =>
    `${API_BASE}/api/auth/login?redirect=true${force ? "&force=true" : ""}`,
}

export const accountsApi = {
  /** 全量列表:自动循环翻页拿全。给"想看完整列表"的简单调用方用。
   *  返回 ServiceAccount[](保持向后兼容)。如要分页 UI,请用 listPaged。 */
  list: (params?: { provider?: string; status?: string; customer_code?: string }) =>
    fetchAllPaged<ServiceAccount>((page, pageSize) => {
      const qs = new URLSearchParams()
      if (params?.provider) qs.set("provider", params.provider)
      if (params?.status) qs.set("status", params.status)
      if (params?.customer_code) qs.set("customer_code", params.customer_code)
      qs.set("page", String(page))
      qs.set("page_size", String(pageSize))
      return `/api/service-accounts/?${qs.toString()}`
    }),

  /** 单页列表,返回 { items, total, page, page_size }。给分页 UI 用。 */
  listPaged: (params?: {
    provider?: string; status?: string; customer_code?: string;
    page?: number; page_size?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.provider) qs.set("provider", params.provider)
    if (params?.status) qs.set("status", params.status)
    if (params?.customer_code) qs.set("customer_code", params.customer_code)
    qs.set("page", String(params?.page ?? 1))
    qs.set("page_size", String(params?.page_size ?? 50))
    return requestPaged<ServiceAccount>(`/api/service-accounts/?${qs.toString()}`)
  },
  get: (id: number) => request<ServiceAccountDetail>(`/api/service-accounts/${id}`),
  create: (data: {
    supply_source_id: number
    entity_id?: number | null
    name: string
    external_project_id: string
    secret_data?: Record<string, unknown>
    notes?: string
    order_method?: string | null
  }) =>
    request<ServiceAccount>("/api/service-accounts/", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: {
    name?: string
    supply_source_id?: number
    /** 主体 id；undefined=不动，具体 id=切换。清主体走 clear_entity=true。 */
    entity_id?: number
    /** 显式清空主体，与 entity_id 互斥。后端切换 supply_source 时自动清空。 */
    clear_entity?: boolean
    external_project_id?: string
    secret_data?: Record<string, unknown>
    notes?: string
    order_method?: string | null
    /** 全量覆盖语义：undefined 不动；[] 清空；[...] 替换。空集合会自动把状态派生为 "备用"。 */
    customer_codes?: string[]
  }) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  /**
   * 批量把服务账号迁到另一个货源下。
   * 规则：跨 provider 禁止；已在目标货源下的账号跳过。
   * 返回 { moved: 成功数, skipped: [{account_id, reason}], target_* }
   */
  bulkAssign: (data: { account_ids: number[]; target_supply_source_id: number }) =>
    request<{
      moved: number
      skipped: { account_id: number; reason: string }[]
      target_supply_source_id: number
      target_provider: string
      target_supplier_name: string
    }>("/api/service-accounts/bulk-assign", { method: "POST", body: JSON.stringify(data) }),
  /**
   * 批量分配服务账号到主体（或清空主体）。
   * 规则：target_entity_id=null 表示「未分配主体」；非空时账号必须与目标主体在同一货源下，
   *       跨货源一律跳过。返回 { moved: 成功数, skipped: [{account_id, reason}], target_* }。
   */
  bulkAssignEntity: (data: { account_ids: number[]; target_entity_id: number | null }) =>
    request<{
      moved: number
      skipped: { account_id: number; reason: string }[]
      target_entity_id: number | null
      target_entity_name: string | null
    }>("/api/service-accounts/bulk-assign-entity", { method: "POST", body: JSON.stringify(data) }),

  /**
   * Taiji 货源专用：前端零输入，由后端从 settings.TAIJI_BLOB_SAS_URL 自动拉最新
   * 一天的快照 JSON，发现所有 (username, token) 对并批量建账号。后续按日由后台
   * collector 自动按日拉 {date}_UTC+0.json 落库。
   * - 服务端从环境变量读取 SAS（前端不传 URL，不需粘贴 JSON）
   * - 仅读 JSON 顶层 "taiji" section
   * - external_project_id = "<username>:<token_name>"
   * - 已存在的跳过（幂等可重试）
   */
  /**
   * Taiji 一天的 JSON 快照直接落库（绕过 Blob）。前端读本地文件 → POST 此接口。
   * 共享 CA/DS，幂等（重复上传同一天唯一约束去重）。
   * 全月上传后前端应再调一次 syncApi.refreshSummary() 刷预聚合。
   */
  taijiIngestDay: (data: {
    supply_source_id: number
    snapshot_json: Record<string, unknown>
  }) =>
    request<{
      snapshot_date: string
      projects_created: number
      projects_existing: number
      billing_rows_inserted: number
    }>("/api/service-accounts/taiji-ingest-day", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  taijiFromBlob: (data: {
    supply_source_id: number
    entity_id?: number | null
  }) =>
    request<{
      created: number
      skipped: { external_project_id: string; reason: string }[]
      total_parsed: number
      snapshot_date: string | null
      section_used: string
    }>("/api/service-accounts/taiji-from-blob", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Taiji 货源专用：把"每账号一个独立 CA/DS"的历史脏数据合并为
   * supply_source 级共享 CA/DS，并去重 billing_summary 中被 N 次复制的费用行。
   * - dry_run=true 只统计、不动数据
   * - dry_run=false 落地
   * 权限要求：cloud_admin。仅在历史导入数据被 N× 放大时调用一次。
   */
  taijiCleanupDuplicates: (data: { supply_source_id: number; dry_run: boolean }) =>
    request<{
      dry_run: boolean
      total_data_sources_before: number
      kept_data_source_id: number | null
      orphan_data_sources_removed: number
      orphan_cloud_accounts_removed: number
      billing_rows_deleted_as_dup: number
      billing_rows_reassigned_to_kept: number
      projects_repointed: number
    }>("/api/service-accounts/taiji-cleanup-duplicates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  suspend: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/suspend`, { method: "POST" }),
  activate: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/activate`, { method: "POST" }),
  standby: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/standby`, { method: "POST" }),
  delete: (id: number) =>
    request<void>(`/api/service-accounts/${id}`, { method: "DELETE" }),
  hardDelete: (id: number) =>
    request<void>(`/api/service-accounts/hard/${id}`, { method: "DELETE" }),
  costs: (id: number, start_date: string, end_date: string) =>
    request<CostSummary>(`/api/service-accounts/${id}/costs?start_date=${start_date}&end_date=${end_date}`),
  costsExportUrl: (id: number, start_date: string, end_date: string, discount_pct?: number) => {
    const qs = new URLSearchParams({ start_date, end_date })
    if (discount_pct != null && discount_pct > 0) qs.set("discount_pct", String(discount_pct))
    return `${API_BASE}/api/service-accounts/${id}/costs/export?${qs}`
  },
  credentials: (id: number) =>
    request<Record<string, unknown>>(`/api/service-accounts/${id}/credentials`),
  dailyReport: (start_date: string, end_date: string, provider?: string) => {
    const qs = new URLSearchParams({ start_date, end_date })
    if (provider) qs.set("provider", provider)
    return request<DailyReportRow[]>(`/api/service-accounts/daily-report?${qs}`)
  },
  dailyReportExportUrl: (start_date: string, end_date: string, provider?: string, discount_pct?: number) => {
    const qs = new URLSearchParams({ start_date, end_date })
    if (provider) qs.set("provider", provider)
    if (discount_pct != null && discount_pct > 0) qs.set("discount_pct", String(discount_pct))
    return `${API_BASE}/api/service-accounts/daily-report/export?${qs}`
  },
  discoverGcpProjects: () =>
    request<{ created: number; projects: string[] }>("/api/service-accounts/discover-gcp-projects", { method: "POST" }),
}

// ─── Suppliers / 货源 API ───────────────────────────────────

export const suppliersApi = {
  list: () => request<SupplierRow[]>("/api/suppliers/"),
  create: (name: string) =>
    request<SupplierRow>("/api/suppliers/", { method: "POST", body: JSON.stringify({ name }) }),
  update: (id: number, name: string) =>
    request<SupplierRow>(`/api/suppliers/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  remove: (id: number) => request<void>(`/api/suppliers/${id}`, { method: "DELETE" }),
  listSupplySources: (supplierId: number) =>
    request<SupplySourceItem[]>(`/api/suppliers/${supplierId}/supply-sources`),
  createSupplySource: (supplierId: number, provider: string) =>
    request<SupplySourceItem>(`/api/suppliers/${supplierId}/supply-sources`, {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
  deleteSupplySource: (supplySourceId: number) =>
    request<void>(`/api/suppliers/supply-sources/${supplySourceId}`, { method: "DELETE" }),
  listAllSupplySources: (supplierId?: number) => {
    const qs = supplierId != null ? `?supplier_id=${supplierId}` : ""
    return request<SupplySourceItem[]>(`/api/suppliers/supply-sources/all${qs}`)
  },

  // ─── 主体（Entity）：suppliers → supply_sources → entities → projects ───
  listEntities: (supplySourceId: number) =>
    request<EntityItem[]>(`/api/suppliers/supply-sources/${supplySourceId}/entities`),
  listAllEntities: (params?: { supply_source_id?: number; supplier_id?: number }) => {
    const qs = new URLSearchParams()
    if (params?.supply_source_id != null) qs.set("supply_source_id", String(params.supply_source_id))
    if (params?.supplier_id != null) qs.set("supplier_id", String(params.supplier_id))
    const s = qs.toString()
    return request<EntityItem[]>(`/api/suppliers/entities/all${s ? `?${s}` : ""}`)
  },
  createEntity: (supplySourceId: number, data: { name: string; note?: string | null }) =>
    request<EntityItem>(`/api/suppliers/supply-sources/${supplySourceId}/entities`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEntity: (entityId: number, data: { name?: string; note?: string | null }) =>
    request<EntityItem>(`/api/suppliers/entities/${entityId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteEntity: (entityId: number) =>
    request<void>(`/api/suppliers/entities/${entityId}`, { method: "DELETE" }),
}

// ─── Alerts API ───────────────────────────────────────────────

export const alertsApi = {
  listRules: () => request<AlertRule[]>("/api/alerts/rules/"),
  createRule: (data: { name: string; target_type: string; target_id?: string; threshold_type: string; threshold_value: number; notify_webhook?: string; notify_email?: string }) =>
    request<AlertRule>("/api/alerts/rules/", { method: "POST", body: JSON.stringify(data) }),
  updateRule: (id: number, data: Partial<{ name: string; target_type: string; target_id: string; threshold_type: string; threshold_value: number; notify_webhook: string; notify_email: string; is_active: boolean }>) =>
    request<AlertRule>(`/api/alerts/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRule: (id: number) =>
    request<void>(`/api/alerts/rules/${id}`, { method: "DELETE" }),
  history: (params?: { rule_id?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.rule_id) qs.set("rule_id", String(params.rule_id))
    if (params?.limit) qs.set("limit", String(params.limit))
    const q = qs.toString()
    return request<AlertHistory[]>(`/api/alerts/history${q ? `?${q}` : ""}`)
  },
  notifications: (params?: { unread_only?: boolean; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.unread_only) qs.set("unread_only", "true")
    if (params?.limit) qs.set("limit", String(params.limit))
    const q = qs.toString()
    return request<AppNotification[]>(`/api/alerts/notifications${q ? `?${q}` : ""}`)
  },
  unreadCount: () => request<{ count: number }>("/api/alerts/notifications/unread-count"),
  markRead: (id: number) => request<void>(`/api/alerts/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => request<void>("/api/alerts/notifications/read-all", { method: "POST" }),
  deleteNotification: (id: number) =>
    request<void>(`/api/alerts/notifications/${id}`, { method: "DELETE" }),
  deleteAllNotifications: (onlyRead = false) =>
    request<void>(`/api/alerts/notifications${onlyRead ? "?only_read=true" : ""}`, { method: "DELETE" }),
  commitmentStatus: (month?: string) => {
    const qs = month ? `?month=${month}` : ""
    return request<CommitmentStatus[]>(`/api/alerts/commitment-status${qs}`)
  },
  ruleStatus: (month?: string) => {
    const qs = month ? `?month=${month}` : ""
    return request<RuleStatus[]>(`/api/alerts/rule-status${qs}`)
  },
}

// ─── Dashboard API ────────────────────────────────────────────

export const syncApi = {
  lastSync: () => request<{ last_sync: string | null }>("/api/sync/last"),
  triggerAll: (start_month: string, end_month: string, provider?: string) =>
    request<{ task_id: string; status: string }>("/api/sync/all", {
      method: "POST",
      body: JSON.stringify({ start_month, end_month, provider }),
    }),
  status: (taskId: string) => request<{ task_id: string; status: string; result: unknown }>(`/api/sync/status/${taskId}`),
  /**
   * 重建 billing_daily_summary 预聚合表（dashboard 读这张）。
   * 不传日期 = 按 billing_summary 全量范围重算。
   * 权限：cloud_admin / cloud_ops。
   */
  refreshSummary: (start_date?: string, end_date?: string) => {
    const qs = new URLSearchParams()
    if (start_date) qs.set("start_date", start_date)
    if (end_date) qs.set("end_date", end_date)
    const s = qs.toString()
    return request<{ status: string; refreshed_range?: string; reason?: string }>(
      `/api/sync/refresh-summary${s ? `?${s}` : ""}`,
      { method: "POST" },
    )
  },
}

export const dashboardApi = {
  bundle: (
    month: string,
    params?: { granularity?: "daily" | "weekly" | "monthly"; service_limit?: number },
  ) => {
    const qs = new URLSearchParams({ month })
    if (params?.granularity) qs.set("granularity", params.granularity)
    if (params?.service_limit != null) qs.set("service_limit", String(params.service_limit))
    return request<DashboardBundle>(`/api/dashboard/bundle?${qs}`)
  },
  overview: (month: string) =>
    request<DashboardOverview>(`/api/dashboard/overview?month=${month}`),
  trend: (start: string, end: string, granularity?: string) => {
    const qs = new URLSearchParams({ start, end })
    if (granularity) qs.set("granularity", granularity)
    return request<DashboardTrendPoint[]>(`/api/dashboard/trend?${qs}`)
  },
  byProvider: (month: string) =>
    request<DashboardProviderSlice[]>(`/api/dashboard/by-provider?month=${month}`),
  byService: (month: string, provider?: string, limit?: number) => {
    const qs = new URLSearchParams({ month })
    if (provider) qs.set("provider", provider)
    if (limit) qs.set("limit", String(limit))
    return request<DashboardServiceSlice[]>(`/api/dashboard/by-service?${qs}`)
  },
  byProject: (month: string, limit?: number) => {
    const qs = new URLSearchParams({ month })
    if (limit) qs.set("limit", String(limit))
    return request<unknown[]>(`/api/dashboard/by-project?${qs}`)
  },
  topGrowth: (period?: string, limit?: number) => {
    const qs = new URLSearchParams()
    if (period) qs.set("period", period)
    if (limit) qs.set("limit", String(limit))
    const q = qs.toString()
    return request<unknown[]>(`/api/dashboard/top-growth${q ? `?${q}` : ""}`)
  },
}

// ─── Project Types ────────────────────────────────────────────

export interface Project {
  id: number
  name: string
  supply_source_id: number
  provider: string
  supplier_name: string
  external_project_id: string
  data_source_id: number | null
  category_id: number | null
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface BillingDetail {
  id: number
  date: string
  provider: string
  project_id: string | null
  project_name: string | null
  product: string | null
  usage_type: string | null
  region: string | null
  cost: number
  usage_quantity: number
  usage_unit: string | null
  currency: string
}

export interface ProjectAssignmentLog {
  id: number
  project_id: number
  action: string
  from_status: string | null
  to_status: string | null
  operator: string | null
  notes: string | null
  created_at: string
}

// ─── Projects API ─────────────────────────────────────────────

export const projectsApi = {
  /** 全量列表:自动循环翻页拿全。 */
  list: (params?: { status?: string; provider?: string }) =>
    fetchAllPaged<Project>((page, pageSize) => {
      const qs = new URLSearchParams()
      if (params?.status) qs.set("status", params.status)
      if (params?.provider) qs.set("provider", params.provider)
      qs.set("page", String(page))
      qs.set("page_size", String(pageSize))
      return `/api/projects/?${qs.toString()}`
    }),

  /** 单页列表,返回 { items, total, page, page_size }。给分页 UI 用。 */
  listPaged: (params?: {
    status?: string; provider?: string; page?: number; page_size?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set("status", params.status)
    if (params?.provider) qs.set("provider", params.provider)
    qs.set("page", String(params?.page ?? 1))
    qs.set("page_size", String(params?.page_size ?? 50))
    return requestPaged<Project>(`/api/projects/?${qs.toString()}`)
  },
  get: (id: number) => request<Project>(`/api/projects/${id}`),
  activate: (id: number) => request<Project>(`/api/projects/${id}/activate`, { method: "POST" }),
  suspend: (id: number) => request<Project>(`/api/projects/${id}/suspend`, { method: "POST" }),
  assignmentLogs: (id: number) => request<ProjectAssignmentLog[]>(`/api/projects/${id}/assignment-logs`),
}

// ─── Billing Detail API ───────────────────────────────────────

export const billingApi = {
  detail: (params?: { project_id?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params?.project_id) qs.set("project_id", params.project_id)
    if (params?.page) qs.set("page", String(params.page))
    if (params?.page_size) qs.set("page_size", String(params.page_size))
    const q = qs.toString()
    return request<BillingDetail[]>(`/api/billing/detail${q ? `?${q}` : ""}`)
  },
  /**
   * 全量字段 CSV 导出（29 列），用于程序对接 + 内部对账。
   * 列对照见后端 app/api/billing.py 的 _CSV_HEADER_FULL。
   * 浏览器导航直接触发文件下载，认证走 cookie。
   */
  exportFullUrl: (params: {
    date_start: string
    date_end: string
    provider?: string
    project_id?: string
    product?: string
  }) => {
    const qs = new URLSearchParams({
      date_start: params.date_start,
      date_end: params.date_end,
    })
    if (params.provider) qs.set("provider", params.provider)
    if (params.project_id) qs.set("project_id", params.project_id)
    if (params.product) qs.set("product", params.product)
    return `${API_BASE}/api/billing/export-full?${qs}`
  },
}

// ─── Azure Deploy Types ──────────────────────────────────────

export interface MsalConfig {
  client_id: string
  authority: string
  redirect_uri: string
  scopes: string[]
}

export interface AzureUser {
  name: string
  email: string
  tenant_id: string
}

export interface AzureSubscription {
  subscription_id: string
  display_name: string
  state: string
}

export interface AzureResourceGroup {
  name: string
  location: string
}

export interface AzureAIResource {
  name: string
  location: string
  resource_group: string
  endpoint: string
  existing_deployments: number
}

export interface AzureModel {
  model_name: string
  model_version: string
  model_format: string
  capabilities: string[]
  available_skus: string[]
  max_capacity: number
  lifecycle_status: string
  is_deprecated: boolean
}

export interface AzureExistingDeployment {
  deployment_name: string
  model_name: string
  model_version: string
  sku_name: string
  sku_capacity: number
  provisioning_state: string
}

export interface DeployItem {
  resource_group: string
  account_name: string
  region: string
  model_name: string
  model_version: string
  model_format: string
  deployment_name: string
  sku_name: string
  sku_capacity: number
}

export interface PlanResultItem {
  index: number
  action: "create" | "skip" | "conflict" | "unavailable" | "quota_risk"
  message: string | null
}

export interface PlanResult {
  total: number
  can_create: number
  will_skip: number
  has_conflict: number
  unavailable: number
  quota_risk: number
  items: PlanResultItem[]
}

export interface ExecuteResult {
  task_id: string
  total: number
  message: string
}

export interface ProgressItem {
  index: number
  model_name: string
  region: string
  account_name: string
  deployment_name: string
  status: "pending" | "deploying" | "succeeded" | "failed"
  error?: string | null
}

export interface DeployProgress {
  task_id: string
  status: "pending" | "running" | "completed"
  total: number
  succeeded: number
  failed: number
  deploying: number
  pending: number
  items: ProgressItem[]
}

// ─── Azure Deploy API (Bearer token) ────────────────────────

let _getAzureToken: (() => Promise<string>) | null = null

export function setAzureTokenProvider(fn: () => Promise<string>) {
  _getAzureToken = fn
}

export function clearAzureTokenProvider() {
  _getAzureToken = null
}

async function azureRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!_getAzureToken) {
    throw new Error("Azure 未登录，请先登录 Azure 账号")
  }
  const token = await _getAzureToken()
  return request<T>(path, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

/** Download Excel from GET /api/azure-deploy/export/{taskId} (blob, not JSON). */
export async function downloadAzureDeployExcel(taskId: string): Promise<void> {
  if (!_getAzureToken) {
    throw new Error("Azure 未登录，请先登录 Azure 账号")
  }
  const token = await _getAzureToken()
  const url = `${API_BASE}/api/azure-deploy/export/${encodeURIComponent(taskId)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`导出失败 ${res.status}: ${body}`)
  }
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = blobUrl
  let name = `azure-deploy-${taskId}.xlsx`
  const cd = res.headers.get("Content-Disposition")
  if (cd) {
    const m =
      /filename\*=(?:UTF-8''|)([^;\n]+)|filename="([^"]+)"/i.exec(cd)
    const raw = (m?.[1] || m?.[2] || "").trim()
    if (raw) {
      try {
        name = decodeURIComponent(raw.replace(/^["']|["']$/g, ""))
      } catch {
        name = raw.replace(/^["']|["']$/g, "")
      }
    }
  }
  a.download = name
  a.click()
  URL.revokeObjectURL(blobUrl)
}

export const azureDeployApi = {
  getMsalConfig: () =>
    request<MsalConfig>("/api/azure-deploy/auth/config"),

  validateToken: () =>
    azureRequest<AzureUser>("/api/azure-deploy/auth/validate", { method: "POST" }),

  subscriptions: () =>
    azureRequest<AzureSubscription[]>("/api/azure-deploy/subscriptions"),

  resourceGroups: (subId: string) =>
    azureRequest<AzureResourceGroup[]>(
      `/api/azure-deploy/resource-groups?subscription_id=${subId}`
    ),

  createResourceGroup: (data: { subscription_id: string; name: string; location: string }) =>
    azureRequest<AzureResourceGroup>(
      "/api/azure-deploy/resource-groups",
      { method: "POST", body: JSON.stringify(data) }
    ),

  aiResources: (subId: string, rg: string) =>
    azureRequest<AzureAIResource[]>(
      `/api/azure-deploy/ai-resources?subscription_id=${subId}&resource_group=${rg}`
    ),

  createAIResource: (data: {
    subscription_id: string; resource_group: string;
    name: string; location: string;
    kind?: string; sku_name?: string;
  }) =>
    azureRequest<AzureAIResource>(
      "/api/azure-deploy/ai-resources",
      { method: "POST", body: JSON.stringify(data) }
    ),

  models: (subId: string, region: string) =>
    azureRequest<AzureModel[]>(
      `/api/azure-deploy/models?subscription_id=${subId}&region=${region}`
    ),

  accountModels: (subId: string, rg: string, accountName: string) =>
    azureRequest<AzureModel[]>(
      `/api/azure-deploy/account-models?subscription_id=${subId}&resource_group=${rg}&account_name=${accountName}`
    ),

  existingDeployments: (subId: string, rg: string, account: string) =>
    azureRequest<AzureExistingDeployment[]>(
      `/api/azure-deploy/existing-deployments?subscription_id=${subId}&resource_group=${rg}&account_name=${account}`
    ),

  plan: (data: { subscription_id: string; items: DeployItem[] }) =>
    azureRequest<PlanResult>(
      "/api/azure-deploy/plan",
      { method: "POST", body: JSON.stringify(data) }
    ),

  execute: (data: { subscription_id: string; items: (DeployItem & { action: string })[] }) =>
    azureRequest<ExecuteResult>(
      "/api/azure-deploy/execute",
      { method: "POST", body: JSON.stringify(data) }
    ),

  progress: (taskId: string) =>
    azureRequest<DeployProgress>(
      `/api/azure-deploy/progress/${taskId}`
    ),

  retryFailed: (taskId: string) =>
    azureRequest<{ task_id: string; retrying: number; message: string }>(
      `/api/azure-deploy/retry/${taskId}`,
      { method: "POST" }
    ),

  exportExcel: (taskId: string) => downloadAzureDeployExcel(taskId),
}

// ─── Metering (billing_data 云同步用量) API ─────────────────

export interface MeteringUsageSummary {
  total_cost: number
  total_usage: number
  record_count: number
  service_count: number
}

export interface MeteringDailyUsage {
  date: string
  usage_quantity: number
  cost: number
  record_count: number
}

export interface MeteringServiceUsage {
  product: string
  usage_quantity: number
  usage_unit: string | null
  cost: number
  record_count: number
}

export interface MeteringUsageDetail {
  id: number
  date: string
  provider: string
  data_source_id: number
  project_id: string | null
  product: string | null
  usage_type: string | null
  region: string | null
  cost: number
  usage_quantity: number
  usage_unit: string | null
  currency: string
}

export interface MeteringProductOption {
  product: string
}

export interface MeteringFilters {
  date_start?: string
  date_end?: string
  provider?: string
  /** 服务名（单选；与 products 二选一） */
  product?: string
  /** 服务名列表（多选；非空时优先于 product） */
  products?: string[]
  /** 服务账号 Project.id（单选；与 account_ids 二选一） */
  account_id?: number
  /** 服务账号 Project.id 列表（多选；有值时优先于 account_id） */
  account_ids?: number[]
  /** 货源 supply_sources.id */
  supply_source_id?: number
  /** 供应商名称 suppliers.name */
  supplier_name?: string
  /** 同步数据渠道 billing_data.data_source_id */
  data_source_id?: number
}

function meteringQs(filters?: MeteringFilters): string {
  if (!filters) return ""
  const qs = new URLSearchParams()
  if (filters.date_start) qs.set("date_start", filters.date_start)
  if (filters.date_end) qs.set("date_end", filters.date_end)
  if (filters.provider) qs.set("provider", filters.provider)
  if (filters.products && filters.products.length > 0) {
    for (const p of filters.products) qs.append("products", p)
  } else if (filters.product) {
    qs.set("product", filters.product)
  }
  if (filters.account_ids && filters.account_ids.length > 0) {
    for (const id of filters.account_ids) qs.append("account_ids", String(id))
  } else if (filters.account_id != null) {
    qs.set("account_id", String(filters.account_id))
  }
  if (filters.supply_source_id != null) qs.set("supply_source_id", String(filters.supply_source_id))
  if (filters.supplier_name) qs.set("supplier_name", filters.supplier_name)
  if (filters.data_source_id != null) qs.set("data_source_id", String(filters.data_source_id))
  const s = qs.toString()
  return s ? `?${s}` : ""
}

export interface DataSourceRow {
  id: number
  name: string
  cloud_account_id: number
  category_id: number | null
  config: Record<string, unknown>
  last_sync_at: string | null
  sync_status: string
  is_active: boolean
  created_at: string
}

export const dataSourcesApi = {
  list: () => request<DataSourceRow[]>("/api/data-sources/"),
}

export const meteringApi = {
  summary: (filters?: MeteringFilters) =>
    request<MeteringUsageSummary>(`/api/metering/summary${meteringQs(filters)}`),

  daily: (filters?: MeteringFilters) =>
    request<MeteringDailyUsage[]>(`/api/metering/daily${meteringQs(filters)}`),

  byService: (filters?: MeteringFilters) =>
    request<MeteringServiceUsage[]>(`/api/metering/by-service${meteringQs(filters)}`),

  products: (provider?: string, extra?: Pick<MeteringFilters, "account_id" | "account_ids" | "supply_source_id" | "supplier_name" | "data_source_id">) => {
    const qs = new URLSearchParams()
    if (provider) qs.set("provider", provider)
    if (extra?.account_ids && extra.account_ids.length > 0) {
      for (const id of extra.account_ids) qs.append("account_ids", String(id))
    } else if (extra?.account_id != null) {
      qs.set("account_id", String(extra.account_id))
    }
    if (extra?.supply_source_id != null) qs.set("supply_source_id", String(extra.supply_source_id))
    if (extra?.supplier_name) qs.set("supplier_name", extra.supplier_name)
    if (extra?.data_source_id != null) qs.set("data_source_id", String(extra.data_source_id))
    const s = qs.toString()
    return request<MeteringProductOption[]>(`/api/metering/products${s ? `?${s}` : ""}`)
  },

  detail: (filters?: MeteringFilters & { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (filters?.date_start) qs.set("date_start", filters.date_start)
    if (filters?.date_end) qs.set("date_end", filters.date_end)
    if (filters?.provider) qs.set("provider", filters.provider)
    if (filters?.products && filters.products.length > 0) {
      for (const p of filters.products) qs.append("products", p)
    } else if (filters?.product) {
      qs.set("product", filters.product)
    }
    if (filters?.account_ids && filters.account_ids.length > 0) {
      for (const id of filters.account_ids) qs.append("account_ids", String(id))
    } else if (filters?.account_id != null) {
      qs.set("account_id", String(filters.account_id))
    }
    if (filters?.supply_source_id != null) qs.set("supply_source_id", String(filters.supply_source_id))
    if (filters?.supplier_name) qs.set("supplier_name", filters.supplier_name)
    if (filters?.data_source_id != null) qs.set("data_source_id", String(filters.data_source_id))
    if (filters?.page) qs.set("page", String(filters.page))
    if (filters?.page_size) qs.set("page_size", String(filters.page_size))
    const s = qs.toString()
    return request<MeteringUsageDetail[]>(`/api/metering/detail${s ? `?${s}` : ""}`)
  },

  detailCount: (filters?: MeteringFilters) =>
    request<{ total: number }>(`/api/metering/detail/count${meteringQs(filters)}`),

  exportUrl: (filters?: MeteringFilters) =>
    `${API_BASE}/api/metering/export${meteringQs(filters)}`,
}

// ─── Azure Multi-tenant Consent ────────────────────────────────────────

export interface AzureConsentStartResponse {
  consent_url: string
  expires_at: string
  instructions: string
}

export interface AzureDiscoveredSubscription {
  subscription_id: string
  display_name: string
  state: string
}

export interface AzureVerifyResult {
  ok: boolean
  message: string
  discovered_subscriptions: AzureDiscoveredSubscription[]
}

export interface AzureCloudAccount {
  id: number
  name: string
  provider: string
  is_active: boolean
  auth_mode: string
  consent_status: string
  created_at: string
  updated_at: string
}

export interface AzureConsentInvite {
  id: number
  state: string
  account_name: string
  status: string
  cloud_account_id: number | null
  created_by: number | null
  created_at: string
  expires_at: string
  consumed_at: string | null
  error_reason: string | null
}

export const azureConsentApi = {
  start: (body: { account_name: string; supply_source_id?: number | null }) =>
    request<AzureConsentStartResponse>("/api/azure-consent/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  register: (body: { name: string; tenant_id: string; subscription_ids: string[] }) =>
    request<AzureCloudAccount>("/api/azure-consent/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verify: (accountId: number) =>
    request<AzureVerifyResult>(`/api/azure-consent/verify/${accountId}`, { method: "POST" }),

  listSubscriptions: (accountId: number) =>
    request<{ subscriptions: AzureDiscoveredSubscription[] }>(
      `/api/azure-consent/subscriptions/${accountId}`,
    ),

  listInvites: () =>
    request<AzureConsentInvite[]>("/api/azure-consent/invites"),

  revokeInvite: (inviteId: number) =>
    request<{ ok: boolean; message: string }>(`/api/azure-consent/invites/${inviteId}/revoke`, {
      method: "POST",
    }),

  deleteInvite: (inviteId: number) =>
    request<void>(`/api/azure-consent/invites/${inviteId}`, { method: "DELETE" }),

  deleteInvitesBulk: (onlyStatus?: "expired" | "consumed" | "pending") =>
    request<void>(
      `/api/azure-consent/invites${onlyStatus ? `?only_status=${onlyStatus}` : ""}`,
      { method: "DELETE" },
    ),
}
