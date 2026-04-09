import useSWR from "swr"
import {
  accountsApi,
  dashboardApi,
  alertsApi,
  type ServiceAccount,
  type GroupItem,
  type DashboardBundle,
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
