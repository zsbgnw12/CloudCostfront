import useSWR from "swr"
import {
  accountsApi,
  suppliersApi,
  dashboardApi,
  alertsApi,
  meteringApi,
  type ServiceAccount,
  type SupplySourceItem,
  type DashboardBundle,
  type MeteringUsageSummary,
  type MeteringDailyUsage,
  type MeteringServiceUsage,
  type MeteringUsageDetail,
  type MeteringProductOption,
  type MeteringFilters,
  type SupplierRow,
} from "@/lib/api"

// ─── Suppliers（列表页与筛选共用）────────────────────────────
export function useSuppliers() {
  return useSWR<SupplierRow[]>("suppliers-list", () => suppliersApi.list(), {
    dedupingInterval: 60000,
  })
}

// ─── Accounts (shared across many pages) ────────────────────
export function useAccounts(params?: { provider?: string; status?: string }) {
  const key = params?.provider || params?.status
    ? `accounts:${params.provider ?? ""}:${params.status ?? ""}`
    : "accounts"
  return useSWR<ServiceAccount[]>(key, () => accountsApi.list(params), {
    dedupingInterval: 30000,  // 30s — account list rarely changes
  })
}

/** 全部货源（含供应商名、云类型），用于树与筛选 */
export function useSupplySourcesAll() {
  return useSWR<SupplySourceItem[]>("supply-sources-all", () => suppliersApi.listAllSupplySources(), {
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

// ─── Metering（billing_data，与 /api/metering 一致）────────────────

function meterKey(base: string, f?: MeteringFilters) {
  const aids = (f?.account_ids ?? []).join(",")
  const prods = (f?.products ?? []).join(",")
  return `${base}:${f?.date_start ?? ""}:${f?.date_end ?? ""}:${f?.provider ?? ""}:${f?.product ?? ""}:[${prods}]:${f?.account_id ?? ""}:[${aids}]:${f?.supply_source_id ?? ""}:${f?.supplier_name ?? ""}:${f?.data_source_id ?? ""}`
}

export function useMeteringSummary(filters?: MeteringFilters) {
  return useSWR<MeteringUsageSummary>(meterKey("meter-summary", filters), () => meteringApi.summary(filters))
}

export function useMeteringDaily(filters?: MeteringFilters) {
  return useSWR<MeteringDailyUsage[]>(meterKey("meter-daily", filters), () => meteringApi.daily(filters))
}

/** 按服务(product)聚合用量 — 计量页主用 */
export function useMeteringByService(filters?: MeteringFilters) {
  return useSWR<MeteringServiceUsage[]>(meterKey("meter-bysvc", filters), () => meteringApi.byService(filters))
}

/** 服务下拉选项（可带与列表相同的渠道/货源/账号筛选） */
export function useMeteringProducts(provider?: string, scope?: Pick<MeteringFilters, "account_id" | "account_ids" | "supply_source_id" | "supplier_name" | "data_source_id">) {
  const aids = (scope?.account_ids ?? []).join(",")
  const sk = scope ? `${scope.account_id ?? ""}:[${aids}]:${scope.supply_source_id ?? ""}:${scope.supplier_name ?? ""}:${scope.data_source_id ?? ""}` : ""
  return useSWR<MeteringProductOption[]>(
    `meter-products:${provider ?? ""}:${sk}`,
    () => meteringApi.products(provider, scope),
  )
}

export function useMeteringDetail(
  filters?: MeteringFilters & { page?: number; page_size?: number },
) {
  const aids = (filters?.account_ids ?? []).join(",")
  const prods = (filters?.products ?? []).join(",")
  const key = `meter-detail:${filters?.date_start ?? ""}:${filters?.date_end ?? ""}:${filters?.provider ?? ""}:${filters?.product ?? ""}:[${prods}]:${filters?.account_id ?? ""}:[${aids}]:${filters?.supply_source_id ?? ""}:${filters?.supplier_name ?? ""}:${filters?.data_source_id ?? ""}:${filters?.page ?? 1}:${filters?.page_size ?? 50}`
  return useSWR<MeteringUsageDetail[]>(key, () => meteringApi.detail(filters))
}

export function useMeteringDetailCount(filters?: MeteringFilters) {
  return useSWR<{ total: number }>(meterKey("meter-count", filters), () => meteringApi.detailCount(filters))
}

// 旧名/缓存页面若仍引用下列名字，与上面为同一实现（数据均为 billing_data 按服务聚合）
export const useMeteringByModel = useMeteringByService
export const useMeteringModels = useMeteringProducts
