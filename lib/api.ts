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

function redirectToLogin() {
  if (typeof window === "undefined") return
  if (window.location.pathname.startsWith("/api/auth")) return
  // Cross-origin in prod (static web app → container app). Use absolute URL so
  // the browser leaves the SPA origin and the cookie lands on the backend host.
  window.location.href = `${API_BASE}/api/auth/login?redirect=true`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

  const { headers: extraHeaders, ...restInit } = init ?? {}
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`
  const headers: Record<string, string> = {
    ...(extraHeaders as Record<string, string>),
  }
  // 仅在有 body 时带 application/json，避免 GET 因非简单请求触发 CORS 预检，且勿依赖 307 重定向（跨域下不稳定）
  if (restInit.body != null) {
    headers["Content-Type"] = "application/json"
  }
  try {
    const res = await fetch(url, {
      ...restInit,
      headers,
      credentials: "include",
      signal: controller.signal,
    })
    if (res.status === 401) {
      redirectToLogin()
      throw new Error("API 401: redirecting to login")
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`API ${res.status}: ${body}`)
    }
    if (res.status === 204) return undefined as T
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Service Account Types ────────────────────────────────────

export interface ServiceAccount {
  id: number
  name: string
  supply_source_id: number
  supplier_name: string
  provider: string
  external_project_id: string
  status: string
  order_method?: string | null
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
}

export const authApi = {
  me: () => request<CurrentUser>("/api/auth/me"),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  loginUrl: () => `${API_BASE}/api/auth/login?redirect=true`,
}

export const accountsApi = {
  list: (params?: { provider?: string; status?: string }) => {
    const qs = new URLSearchParams()
    if (params?.provider) qs.set("provider", params.provider)
    if (params?.status) qs.set("status", params.status)
    const q = qs.toString()
    // 与 FastAPI @router.get("/") 一致，必须带尾部斜杠，否则会 307，跨域 fetch 可能失败
    return request<ServiceAccount[]>(q ? `/api/service-accounts/?${q}` : "/api/service-accounts/")
  },
  get: (id: number) => request<ServiceAccountDetail>(`/api/service-accounts/${id}`),
  create: (data: {
    supply_source_id: number
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
    external_project_id?: string
    secret_data?: Record<string, unknown>
    notes?: string
    order_method?: string | null
  }) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  suspend: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/suspend`, { method: "POST" }),
  activate: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/activate`, { method: "POST" }),
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
  list: (params?: { status?: string; provider?: string }) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set("status", params.status)
    if (params?.provider) qs.set("provider", params.provider)
    const q = qs.toString()
    return request<Project[]>(q ? `/api/projects/?${q}` : "/api/projects/")
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
  product?: string
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
  if (filters.product) qs.set("product", filters.product)
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
    if (filters?.product) qs.set("product", filters.product)
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
  start: (body: { account_name: string }) =>
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
}
