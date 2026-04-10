import useSWR from "swr"
import {
  accountsApi,
  dashboardApi,
  alertsApi,
  meteringApi,
  type ServiceAccount,
  type GroupItem,
  type DashboardBundle,
  type MeteringUsageSummary,
  type MeteringDailyUsage,
  type MeteringServiceUsage,
  type MeteringUsageDetail,
  type MeteringProductOption,
  type MeteringFilters,
} from "@/lib/api"

// ─── Accounts (shared across many pages) ────────────────────
export function useAccounts(params?: { provider?: string; status?: string }) {
  const key = params?.provider || params?.status
    ? `accounts:${params.provider ?? ""}:${params.status ?? ""}`
    : "accounts"
  return useSWR<ServiceAccount[]>(key, () => accountsApi.list(params), {
    dedupingInterval: 30000,  // 30s — account list rarely changes
  })
}

export function useGroups() {
  return useSWR<GroupItem[]>("groups", () => accountsApi.listGroups(), {
    dedupingInterval: 60000,
  })
}

// ─── Dashboard (single request for home page) ───────────────
export function useDashboardBundle(
  month: string,
  options?: { service_limit?: number },
) {
  const limit = options?.service_limit ?? 10
  const key = `dashboard:bundle:${month}:daily:${limit}`
  return useSWR<DashboardBundle>(key, () =>
    dashboardApi.bundle(month, { granularity: "daily", service_limit: limit }),
  )
}

// ─── Notifications ──────────────────────────────────────────
export function useUnreadCount() {
  return useSWR("unread-count", () => alertsApi.unreadCount(), {
    refreshInterval: 120000,  // auto-refresh every 2 min
    dedupingInterval: 30000,
  })
}

export function useNotifications(limit = 10) {
  return useSWR(`notifications:${limit}`, () => alertsApi.notifications({ limit }), {
    refreshInterval: 120000,
    dedupingInterval: 30000,
  })
}

// ─── Metering (billing_data) ─────────────────────────────────

function meterKey(base: string, f?: MeteringFilters) {
  return `${base}:${f?.date_start ?? ""}:${f?.date_end ?? ""}:${f?.provider ?? ""}:${f?.product ?? ""}`
}

export function useMeteringSummary(filters?: MeteringFilters) {
  return useSWR<MeteringUsageSummary>(meterKey("meter-summary", filters), () => meteringApi.summary(filters))
}

export function useMeteringDaily(filters?: MeteringFilters) {
  return useSWR<MeteringDailyUsage[]>(meterKey("meter-daily", filters), () => meteringApi.daily(filters))
}

export function useMeteringByService(filters?: MeteringFilters) {
  return useSWR<MeteringServiceUsage[]>(meterKey("meter-bysvc", filters), () => meteringApi.byService(filters))
}

export function useMeteringProducts(provider?: string) {
  return useSWR<MeteringProductOption[]>(`meter-products:${provider ?? ""}`, () => meteringApi.products(provider))
}

export function useMeteringDetail(
  filters?: MeteringFilters & { page?: number; page_size?: number },
) {
  const key = `meter-detail:${filters?.date_start ?? ""}:${filters?.date_end ?? ""}:${filters?.provider ?? ""}:${filters?.product ?? ""}:${filters?.page ?? 1}:${filters?.page_size ?? 50}`
  return useSWR<MeteringUsageDetail[]>(key, () => meteringApi.detail(filters))
}

export function useMeteringDetailCount(filters?: MeteringFilters) {
  return useSWR<{ total: number }>(meterKey("meter-count", filters), () => meteringApi.detailCount(filters))
}
