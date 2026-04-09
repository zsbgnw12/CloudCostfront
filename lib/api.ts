const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
      ...init,
    })
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
  provider: string
  group_label: string | null
  external_project_id: string
  status: string
  created_at: string
}

export interface GroupItem {
  provider: string
  label: string
  count: number
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
  notes: string | null
  secret_fields: string[]
  history: HistoryItem[]
}

export interface CostByService {
  service: string
  cost: number
}

export interface DailyCost {
  date: string
  cost: number
}

export interface DailyServiceCost {
  date: string
  service: string
  cost: number
}

export interface CostSummary {
  total_cost: number
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

export const accountsApi = {
  list: (params?: { provider?: string; status?: string }) => {
    const qs = new URLSearchParams()
    if (params?.provider) qs.set("provider", params.provider)
    if (params?.status) qs.set("status", params.status)
    const q = qs.toString()
    return request<ServiceAccount[]>(`/api/service-accounts/${q ? `?${q}` : ""}`)
  },
  get: (id: number) => request<ServiceAccountDetail>(`/api/service-accounts/${id}`),
  create: (data: { name: string; provider: string; group_label?: string; external_project_id: string; secret_data?: Record<string, unknown>; notes?: string }) =>
    request<ServiceAccount>("/api/service-accounts/", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: { name?: string; group_label?: string; external_project_id?: string; secret_data?: Record<string, unknown>; notes?: string }) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  suspend: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/suspend`, { method: "POST" }),
  activate: (id: number) =>
    request<ServiceAccountDetail>(`/api/service-accounts/${id}/activate`, { method: "POST" }),
  delete: (id: number) =>
    request<void>(`/api/service-accounts/${id}`, { method: "DELETE" }),
  hardDelete: (id: number) =>
    request<void>(`/api/service-accounts/hard/${id}`, { method: "DELETE" }),
  renameGroup: (provider: string, old_label: string, new_label: string) =>
    request<{ updated: number }>("/api/service-accounts/groups/rename", {
      method: "PUT", body: JSON.stringify({ provider, old_label, new_label }),
    }),
  listGroups: () => request<GroupItem[]>("/api/service-accounts/groups"),
  createGroup: (provider: string, label: string) =>
    request<GroupItem>("/api/service-accounts/groups", { method: "POST", body: JSON.stringify({ provider, label }) }),
  deleteGroup: (provider: string, label: string) =>
    request<void>(`/api/service-accounts/groups?provider=${encodeURIComponent(provider)}&label=${encodeURIComponent(label)}`, { method: "DELETE" }),
  costs: (id: number, start_date: string, end_date: string) =>
    request<CostSummary>(`/api/service-accounts/${id}/costs?start_date=${start_date}&end_date=${end_date}`),
  costsExportUrl: (id: number, start_date: string, end_date: string) =>
    `${API_BASE}/api/service-accounts/${id}/costs/export?start_date=${start_date}&end_date=${end_date}`,
  credentials: (id: number) =>
    request<Record<string, unknown>>(`/api/service-accounts/${id}/credentials`),
  dailyReport: (start_date: string, end_date: string, provider?: string) => {
    const qs = new URLSearchParams({ start_date, end_date })
    if (provider) qs.set("provider", provider)
    return request<DailyReportRow[]>(`/api/service-accounts/daily-report?${qs}`)
  },
  dailyReportExportUrl: (start_date: string, end_date: string, provider?: string) => {
    const qs = new URLSearchParams({ start_date, end_date })
    if (provider) qs.set("provider", provider)
    return `${API_BASE}/api/service-accounts/daily-report/export?${qs}`
  },
  discoverGcpProjects: () =>
    request<{ created: number; projects: string[] }>("/api/service-accounts/discover-gcp-projects", { method: "POST" }),
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
  provider: string
  external_project_id: string
  data_source_id: number | null
  category_id: number | null
  group_label: string | null
  status: string
  recycled_at: string | null
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
    return request<Project[]>(`/api/projects/${q ? `?${q}` : ""}`)
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
