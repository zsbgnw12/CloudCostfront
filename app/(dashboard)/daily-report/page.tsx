"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar,
} from "recharts"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { accountsApi, billingApi, type DailyReportRow, type CostSummary } from "@/lib/api"
import { useAccounts, useSuppliers, useSupplySourcesAll } from "@/hooks/use-data"
import { cn } from "@/lib/utils"
import { format, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter, subQuarters, subDays } from "date-fns"
import { useChartTheme } from "@/lib/chart-theme"

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure", taiji: "Taiji" }

function fmtMoney(v: number, factor = 1) {
  const x = v * factor
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtUsage(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toFixed(2)
}

function getDefaultRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  return {
    start: `${y}-${String(m).padStart(2, "0")}-01`,
    end: `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`,
  }
}

export default function DailyReportPage() {
  const ct = useChartTheme()
  // 跟主题切换实时变化的图表常量
  const LINE_COLORS = ct.palette
  const SVC_COLORS = ct.palette
  const TOOLTIP_STYLE = {
    backgroundColor: ct.tooltipBg,
    backdropFilter: "blur(12px)",
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: "8px",
    color: ct.tooltipText,
    boxShadow: ct.variant === "neon"
      ? "0 8px 32px rgba(99,102,241,0.35)"
      : "0 8px 24px rgba(0,0,0,0.4)",
  }
  const LEGEND_STYLE = { color: ct.tooltipText2, fontSize: 11 }
  // 合计线在 neon/dark 用白,light 下用深灰才看得清
  const TOTAL_LINE_STROKE = ct.variant === "light" ? "#1f2937" : "#ffffff"
  const [rows, setRows] = useState<DailyReportRow[]>([])
  const { data: accounts = [] } = useAccounts()
  const { data: suppliers = [] } = useSuppliers()
  const { data: sources = [] } = useSupplySourcesAll()
  const [dateRange, setDateRange] = useState(getDefaultRange)
  /** 供应商 id，__all__ 表示不限 */
  const [supplierId, setSupplierId] = useState("__all__")
  /** 货源 supply_sources.id */
  const [supplySourceId, setSupplySourceId] = useState("__all__")
  /** 服务账号多选：空数组 = 不限（按上游货源/供应商范围） */
  const [accountIds, setAccountIds] = useState<number[]>([])
  /** Taiji 货源专属：用户(username) 筛选；"__all__" = 全部用户 */
  const [taijiUsername, setTaijiUsername] = useState<string>("__all__")
  const [loading, setLoading] = useState(false)
  /** 草稿字符串：允许空串、中间态，避免受控 number 一删就回 0 */
  const [discountInput, setDiscountInput] = useState("0")
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null)
  const [costLoading, setCostLoading] = useState(false)

  const discountPct = useMemo(() => {
    const t = discountInput.trim()
    if (t === "") return 0
    const n = parseFloat(t)
    if (!Number.isFinite(n)) return 0
    return Math.min(100, Math.max(0, n))
  }, [discountInput])

  const costFactor = useMemo(() => 1 - discountPct / 100, [discountPct])
  const formatMoney = useCallback((n: number) => fmtMoney(n, costFactor), [costFactor])

  /** 选定单一货源时用于缩小日报 API 的 provider 参数；否则拉全量再在客户端按账号筛 */
  const providerForApi = useMemo(() => {
    if (supplySourceId === "__all__") return undefined
    const src = sources.find((s) => String(s.id) === supplySourceId)
    return src?.provider
  }, [supplySourceId, sources])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await accountsApi.dailyReport(dateRange.start, dateRange.end, providerForApi)
      setRows(data)
    } catch (e) {
      console.error(e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [dateRange, providerForApi])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    setSupplySourceId("__all__")
    setAccountIds([])
  }, [supplierId])

  useEffect(() => {
    setAccountIds([])
    setTaijiUsername("__all__")
  }, [supplySourceId])

  useEffect(() => {
    // 切用户清空下游账号选择，避免残留
    setAccountIds([])
  }, [taijiUsername])

  /** 当前选中货源是否 Taiji */
  const selectedSourceIsTaiji = useMemo(() => {
    if (supplySourceId === "__all__") return false
    return sources.find((s) => String(s.id) === supplySourceId)?.provider === "taiji"
  }, [supplySourceId, sources])

  /** 从 external_project_id "user:token" 取 username */
  const _taijiUsernameOf = (extId: string | null | undefined): string => {
    if (!extId) return ""
    const i = extId.indexOf(":")
    return i < 0 ? extId : extId.slice(0, i)
  }

  /** 当前 Taiji 货源下出现的所有用户名 */
  const taijiUsernameOptions = useMemo(() => {
    if (!selectedSourceIsTaiji) return [] as string[]
    const ssid = Number(supplySourceId)
    const set = new Set<string>()
    for (const a of accounts) {
      if (a.supply_source_id !== ssid) continue
      const u = _taijiUsernameOf(a.external_project_id)
      if (u) set.add(u)
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y, "zh-CN"))
  }, [accounts, supplySourceId, selectedSourceIsTaiji])

  const sourcesInScope = useMemo(() => {
    if (supplierId === "__all__") return sources
    const sid = Number(supplierId)
    return sources.filter((s) => s.supplier_id === sid)
  }, [sources, supplierId])

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (supplierId !== "__all__") {
        const allowed = new Set(sourcesInScope.map((s) => s.id))
        if (!allowed.has(a.supply_source_id)) return false
      }
      if (supplySourceId !== "__all__" && a.supply_source_id !== Number(supplySourceId)) return false
      // Taiji 用户筛选：external_project_id 前缀过滤
      if (selectedSourceIsTaiji && taijiUsername !== "__all__") {
        if (_taijiUsernameOf(a.external_project_id) !== taijiUsername) return false
      }
      return true
    })
  }, [accounts, supplierId, supplySourceId, sourcesInScope, selectedSourceIsTaiji, taijiUsername])

  const chartScopeLabel = useMemo(() => {
    if (supplySourceId !== "__all__") {
      const src = sources.find((s) => String(s.id) === supplySourceId)
      if (!src) return "—"
      const pl = PROVIDER_LABELS[src.provider] ?? src.provider.toUpperCase()
      return `${src.supplier_name ?? "—"} · ${pl}`
    }
    if (supplierId !== "__all__") {
      const sup = suppliers.find((s) => String(s.id) === supplierId)
      return sup ? `${sup.name}（全部货源）` : "—"
    }
    return "全部"
  }, [supplySourceId, supplierId, sources, suppliers])

  /**
   * 下方「每日服务费用构成」是单账号视图，取自 /service-accounts/{id}/costs。
   * 勾选了 1≥ 个账号时取首个勾选项；未勾选时退化为列表第一个（沿用原「全部账号」语义）。
   */
  const costTargetAccountId = useMemo((): number | null => {
    if (filteredAccounts.length === 0) return null
    if (accountIds.length > 0) {
      const picked = accountIds.find((id) => filteredAccounts.some((a) => a.id === id))
      return picked ?? null
    }
    return filteredAccounts[0]!.id
  }, [filteredAccounts, accountIds])

  useEffect(() => {
    if (costTargetAccountId == null) {
      setCostSummary(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setCostLoading(true)
      try {
        const data = await accountsApi.costs(costTargetAccountId, dateRange.start, dateRange.end)
        if (!cancelled) setCostSummary(data)
      } catch (e) {
        // 接口失败时静默 setCostSummary(null) 会让 UI 一直停在"暂无数据",
        // 用户分不清"真没数据"还是"后端挂了" — 至少打到 console
        console.error("[daily-report] costs fetch failed", e)
        if (!cancelled) setCostSummary(null)
      } finally {
        if (!cancelled) setCostLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [costTargetAccountId, dateRange.start, dateRange.end])

  // Filter rows by group + account (空数组 = 不限，按上游供应商/货源筛)
  const filteredRows = useMemo(() => {
    const selected = new Set(accountIds)
    const validIds = new Set<number>()
    for (const a of filteredAccounts) {
      if (selected.size === 0 || selected.has(a.id)) {
        validIds.add(a.id)
      }
    }
    return rows.filter((r) => validIds.has(r.account_id))
  }, [rows, filteredAccounts, accountIds])

  // Build pivot: dates as columns, accounts (grouped by group_label) as rows
  const pivot = useMemo(() => {
    const dateSet = new Set<string>()
    const acctMap = new Map<number, Map<string, number>>()

    for (const r of filteredRows) {
      dateSet.add(r.date)
      if (!acctMap.has(r.account_id)) acctMap.set(r.account_id, new Map())
      const dm = acctMap.get(r.account_id)!
      dm.set(r.date, (dm.get(r.date) ?? 0) + r.cost)
    }

    const dates = Array.from(dateSet).sort()

    type AcctRow = {
      id: number
      name: string
      group: string
      extId: string
      dailyCosts: Map<string, number>
      total: number
    }
    type Group = { label: string; accounts: AcctRow[]; total: number }

    const selectedSet = new Set(accountIds)
    const groupMap = new Map<string, AcctRow[]>()
    for (const a of filteredAccounts) {
      if (selectedSet.size > 0 && !selectedSet.has(a.id)) continue
      const label = a.supplier_name ?? "(未分组)"
      if (!groupMap.has(label)) groupMap.set(label, [])
      const dailyCosts = acctMap.get(a.id) ?? new Map()
      const total = Array.from(dailyCosts.values()).reduce((s, v) => s + v, 0)
      groupMap.get(label)!.push({
        id: a.id,
        name: a.name,
        group: label,
        extId: a.external_project_id,
        dailyCosts,
        total,
      })
    }

    const groupList: Group[] = Array.from(groupMap.entries())
      .map(([label, accts]) => ({
        label,
        accounts: accts.sort((a, b) => b.total - a.total),
        total: accts.reduce((s, a) => s + a.total, 0),
      }))
      .sort((a, b) => b.total - a.total)

    const dateTotals = new Map<string, number>()
    for (const d of dates) {
      let sum = 0
      for (const [, dm] of acctMap) sum += dm.get(d) ?? 0
      dateTotals.set(d, sum)
    }

    const grandTotal = Array.from(dateTotals.values()).reduce((s, v) => s + v, 0)

    return { dates, groups: groupList, dateTotals, grandTotal }
  }, [filteredRows, filteredAccounts, accountIds])

  // Line chart: daily total per account（金额 × 折扣系数，仅展示）
  // Taiji 类聚合平台导入后单次可能 ~600+ 服务账号，直接画 600+ 条 Line 会撑爆图、卡死浏览器；
  // 这里按账号总费用降序保留 Top N，其余合并为「其他」聚合线，再加一条「合计」。
  const LINE_TOP_N = 10
  const lineChartData = useMemo(() => {
    if (pivot.dates.length === 0) return { data: [], accountNames: [], otherCount: 0 }
    const allAccounts = pivot.groups.flatMap((g) => g.accounts)
    const sorted = [...allAccounts].sort((a, b) => b.total - a.total)
    const topAccts = sorted.slice(0, LINE_TOP_N)
    const restAccts = sorted.slice(LINE_TOP_N)
    const hasOther = restAccts.length > 0
    const accountNames = topAccts.map((a) => a.name)
    if (hasOther) accountNames.push("其他")
    const f = costFactor
    const data = pivot.dates.map((d) => {
      const row: Record<string, unknown> = { date: d.slice(5) }
      for (const a of topAccts) {
        row[a.name] = ((a.dailyCosts.get(d) ?? 0) * f)
      }
      if (hasOther) {
        let sum = 0
        for (const a of restAccts) sum += (a.dailyCosts.get(d) ?? 0)
        row["其他"] = sum * f
      }
      row["合计"] = (pivot.dateTotals.get(d) ?? 0) * f
      return row
    })
    return { data, accountNames, otherCount: restAccts.length }
  }, [pivot, costFactor])

  /** 单账号：每日服务堆叠柱（来自计费汇总 API，与旧「计费」页一致） */
  const stackedByService = useMemo(() => {
    if (!costSummary) return { data: [] as Record<string, unknown>[], serviceNames: [] as string[] }
    const topN = 8
    const topServices = costSummary.services.slice(0, topN).map((s) => s.service)
    const topSet = new Set(topServices)
    const dateMap = new Map<string, Record<string, number>>()
    for (const r of costSummary.daily_by_service) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, {})
      const m = dateMap.get(r.date)!
      const key = topSet.has(r.service) ? r.service : "其他"
      m[key] = (m[key] ?? 0) + r.cost
    }
    const serviceNames = [...topServices]
    const hasOther = Array.from(dateMap.values()).some((m) => m["其他"])
    if (hasOther) serviceNames.push("其他")
    const data = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => {
        const row: Record<string, unknown> = { date: date.slice(5) }
        for (const name of serviceNames) {
          row[name] = ((vals[name] ?? 0) * costFactor)
        }
        return row
      })
    return { data, serviceNames }
  }, [costSummary, costFactor])

  const handleExportAll = () => {
    const url = accountsApi.dailyReportExportUrl(
      dateRange.start,
      dateRange.end,
      providerForApi,
      discountPct > 0 ? discountPct : undefined,
    )
    window.open(url, "_blank")
  }

  // 全量字段 CSV：直接从 billing_data 表逐行导出（29 列），用于程序对接 + 内部对账。
  // 和"导出 Excel"日报表的区别：日报表是按 (账号 × 日期 × 服务) 聚合的报表视图；
  // 这个是 SKU/region 级 raw 明细，包含 service_id/sku_id/cost_at_list/credits_breakdown/
  // billing_account_id/invoice_month/transaction_type 等所有 BQ 原始字段。
  const handleExportFullCsv = () => {
    const url = billingApi.exportFullUrl({
      date_start: dateRange.start,
      date_end: dateRange.end,
      provider: providerForApi,
    })
    window.open(url, "_blank")
  }

  const sortedSourcesInScope = useMemo(
    () =>
      [...sourcesInScope].sort((a, b) => {
        const an = a.supplier_name ?? ""
        const bn = b.supplier_name ?? ""
        if (an !== bn) return an.localeCompare(bn)
        return a.provider.localeCompare(b.provider)
      }),
    [sourcesInScope],
  )

  const handleExportAccount = (accountId: number) => {
    const url = accountsApi.costsExportUrl(
      accountId,
      dateRange.start,
      dateRange.end,
      discountPct > 0 ? discountPct : undefined,
    )
    window.open(url, "_blank")
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">统计</h1>
          <p className="text-sm text-muted-foreground mt-1">
            筛选顺序：供应商 → 货源 → 服务账号（可多选）。同一套筛选用于日报透视、费用构成与使用明细；未勾选账号时费用取当前列表第一个账号，勾选多个时取首个已选。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleExportAll} disabled={filteredRows.length === 0 || loading} className="gap-2">
            <Download className="w-4 h-4" />导出 Excel
          </Button>
          <Button
            onClick={handleExportFullCsv}
            disabled={loading}
            variant="outline"
            className="gap-2"
            title="按当前日期 + 供应商筛选导出 SKU/region 级原始明细 CSV，含 BQ 全部字段（service_id, sku_id, cost_at_list, credits_breakdown, billing_account_id, invoice_month 等共 29 列）。给程序对接 + 内部对账用。"
          >
            <FileSpreadsheet className="w-4 h-4" />全量导出 CSV
          </Button>
        </div>
      </div>

      {/* 筛选 */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">供应商</Label>
              <Select value={supplierId} onValueChange={(v) => setSupplierId(v)}>
                <SelectTrigger className="w-44"><SelectValue placeholder="选择供应商" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部供应商</SelectItem>
                  {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">货源</Label>
              <Select
                value={supplySourceId}
                onValueChange={(v) => setSupplySourceId(v)}
                disabled={supplierId !== "__all__" && sourcesInScope.length === 0}
              >
                <SelectTrigger className="w-56"><SelectValue placeholder="全部货源" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部货源</SelectItem>
                  {sortedSourcesInScope.map((src) => (
                    <SelectItem key={src.id} value={String(src.id)}>
                      {PROVIDER_LABELS[src.provider] ?? src.provider.toUpperCase()}
                      <span className="text-muted-foreground text-xs ml-1">· {src.supplier_name ?? "—"}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Taiji 货源专属：用户筛选（在货源和服务账号中间） */}
            {selectedSourceIsTaiji && (
              <div className="space-y-1">
                <Label className="text-xs">用户</Label>
                <Select
                  value={taijiUsername}
                  onValueChange={(v) => setTaijiUsername(v)}
                  disabled={taijiUsernameOptions.length === 0}
                >
                  <SelectTrigger className="w-44"><SelectValue placeholder="全部用户" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部用户 ({taijiUsernameOptions.length})</SelectItem>
                    {taijiUsernameOptions.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">服务账号</Label>
              <MultiSelect
                triggerClassName="w-52"
                placeholder="全部账号"
                searchPlaceholder="搜索账号名 / ID"
                emptyText="无可选账号"
                options={filteredAccounts.map((a) => ({
                  value: String(a.id),
                  label: a.name,
                  keywords: `${a.name} ${a.external_project_id} ${a.provider}`,
                  description: a.external_project_id,
                })) satisfies MultiSelectOption[]}
                value={accountIds.map(String)}
                onChange={(next) => setAccountIds(next.map(Number))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">开始日期</Label>
              <Input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">结束日期</Label>
              <Input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">快捷</Label>
              <div className="flex items-center gap-1 flex-wrap">
                {/* 一组快捷预设：今天 / 昨天 / 近 N 天 / 本月 / 上个月 / 本季度 / 上个季度 */}
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const t = format(new Date(), "yyyy-MM-dd")
                  setDateRange({ start: t, end: t })
                }}>今天</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const y = format(subDays(new Date(), 1), "yyyy-MM-dd")
                  setDateRange({ start: y, end: y })
                }}>昨天</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const today = new Date()
                  setDateRange({
                    start: format(subDays(today, 6), "yyyy-MM-dd"),
                    end: format(today, "yyyy-MM-dd"),
                  })
                }}>近7天</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const today = new Date()
                  setDateRange({
                    start: format(subDays(today, 29), "yyyy-MM-dd"),
                    end: format(today, "yyyy-MM-dd"),
                  })
                }}>近30天</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const today = new Date()
                  setDateRange({
                    start: format(startOfMonth(today), "yyyy-MM-dd"),
                    end: format(today, "yyyy-MM-dd"),
                  })
                }}>本月</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const lastM = subMonths(new Date(), 1)
                  setDateRange({
                    start: format(startOfMonth(lastM), "yyyy-MM-dd"),
                    end: format(endOfMonth(lastM), "yyyy-MM-dd"),
                  })
                }}>上个月</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const today = new Date()
                  setDateRange({
                    start: format(startOfQuarter(today), "yyyy-MM-dd"),
                    end: format(today, "yyyy-MM-dd"),
                  })
                }}>本季度</Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                  const lastQ = subQuarters(new Date(), 1)
                  setDateRange({
                    start: format(startOfQuarter(lastQ), "yyyy-MM-dd"),
                    end: format(endOfQuarter(lastQ), "yyyy-MM-dd"),
                  })
                }}>上个季度</Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">统一折扣（%）</Label>
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0–100"
                className="w-28 font-mono tabular-nums"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                onBlur={() => {
                  setDiscountInput((prev) => {
                    const t = prev.trim()
                    if (t === "") return "0"
                    const n = parseFloat(t)
                    if (!Number.isFinite(n)) return "0"
                    const c = Math.min(100, Math.max(0, n))
                    return Number.isInteger(c) ? String(c) : String(Math.round(c * 100) / 100)
                  })
                }}
              />
            </div>
            <Button onClick={loadData} disabled={loading} size="sm">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}查询
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">加载中...</div>
      ) : (
        <>
          {/* 1 总费用 / 账号统计 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">总费用</p>
                <p className="text-2xl font-semibold mt-1">{formatMoney(pivot.grandTotal)}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">账号数</p>
                <p className="text-2xl font-semibold mt-1">{pivot.groups.reduce((s, g) => s + g.accounts.length, 0)}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">天数</p>
                <p className="text-2xl font-semibold mt-1">{pivot.dates.length}</p>
              </CardContent>
            </Card>
          </div>

          {/* 2 每日费用趋势 */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                每日费用趋势（{chartScopeLabel}）
                {lineChartData.otherCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    · 仅展示 Top {LINE_TOP_N}，其余 {lineChartData.otherCount} 个账号合并到「其他」
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                {lineChartData.data.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lineChartData.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="date" stroke={ct.axis} fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke={ct.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v: number, name: string) => [fmtMoney(v, 1), name]}
                        labelFormatter={(l) => `日期: ${l}`}
                      />
                      <Legend wrapperStyle={LEGEND_STYLE} />
                      {lineChartData.accountNames.length > 1 && (
                        <Line
                          type="monotone"
                          dataKey="合计"
                          stroke={TOTAL_LINE_STROKE}
                          strokeWidth={2.5}
                          strokeDasharray="6 3"
                          dot={false}
                        />
                      )}
                      {lineChartData.accountNames.map((name, i) => (
                        <Line
                          key={name}
                          type="monotone"
                          dataKey={name}
                          stroke={LINE_COLORS[i % LINE_COLORS.length]}
                          strokeWidth={1.5}
                          dot={{ r: 2.5, fill: LINE_COLORS[i % LINE_COLORS.length] }}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 3 每日费用明细（按日透视） */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">每日费用明细（{chartScopeLabel}）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pivot.dates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm px-4">
                  <FileSpreadsheet className="w-10 h-10 mb-3 opacity-30" />
                  <p>暂无日报数据</p>
                </div>
              ) : (
                <div className="overflow-auto max-h-[calc(100vh-360px)]">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-muted">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-b border-border sticky left-0 bg-muted z-20 min-w-[200px]">
                          分组 / 账号
                        </th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-b border-border min-w-[100px]">
                          合计
                        </th>
                        {pivot.dates.map((d) => (
                          <th key={d} className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-b border-border min-w-[95px]">
                            {d.slice(5)}
                          </th>
                        ))}
                        <th className="text-center px-2 py-2 font-medium text-muted-foreground border-b border-border min-w-[50px]">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pivot.groups.map((group) => (
                        <GroupRows
                          key={group.label}
                          group={group}
                          dates={pivot.dates}
                          formatMoney={formatMoney}
                          onExport={handleExportAccount}
                        />
                      ))}
                      <tr className="bg-primary/10 font-semibold">
                        <td className="px-3 py-2 text-foreground border-t-2 border-border sticky left-0 bg-primary/10 z-10">合计</td>
                        <td className="text-right px-3 py-2 text-foreground border-t-2 border-border font-mono text-xs">{formatMoney(pivot.grandTotal)}</td>
                        {pivot.dates.map((d) => (
                          <td key={d} className="text-right px-3 py-2 text-foreground border-t-2 border-border font-mono text-xs">
                            {formatMoney(pivot.dateTotals.get(d) ?? 0)}
                          </td>
                        ))}
                        <td className="border-t-2 border-border" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* 4 每日服务费用构成 */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">每日服务费用构成</CardTitle>
        </CardHeader>
        <CardContent>
          {costTargetAccountId == null || costLoading ? (
            <div className="flex h-[280px] items-center justify-center text-muted-foreground text-sm rounded-md border border-dashed border-border">
              {costTargetAccountId == null ? "当前筛选下无账号" : "加载中…"}
            </div>
          ) : costSummary ? (
            <div className="h-[300px] w-full">
              {stackedByService.data.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">暂无数据</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackedByService.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="date" stroke={ct.axis} fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke={ct.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number, name: string) => [fmtMoney(v, 1), name]}
                      labelFormatter={(l) => `日期: ${l}`}
                    />
                    <Legend wrapperStyle={LEGEND_STYLE} />
                    {stackedByService.serviceNames.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="svc" fill={SVC_COLORS[i % SVC_COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-muted-foreground text-sm rounded-md border border-dashed border-border">
              暂无费用数据
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5 服务使用明细 */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium">服务使用明细</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 shrink-0"
            disabled={costTargetAccountId == null || !costSummary}
            onClick={() => {
              if (costTargetAccountId == null) return
              const url = accountsApi.costsExportUrl(
                costTargetAccountId,
                dateRange.start,
                dateRange.end,
                discountPct > 0 ? discountPct : undefined,
              )
              window.open(url, "_blank")
            }}
          >
            <Download className="w-3.5 h-3.5" />
            导出 Excel
          </Button>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 pt-0">
          {costTargetAccountId == null || costLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm rounded-md border border-dashed border-border mx-4 sm:mx-0 mb-4">
              {costTargetAccountId == null ? "当前筛选下无账号" : "加载中…"}
            </div>
          ) : costSummary ? (
            <div className="rounded-md border border-border overflow-hidden mx-4 sm:mx-0 mb-4 sm:mb-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent bg-muted/20">
                    <TableHead>服务名称</TableHead>
                    <TableHead className="text-right">费用 (USD)</TableHead>
                    <TableHead className="text-right">用量</TableHead>
                    <TableHead>单位</TableHead>
                    <TableHead className="text-right">占比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costSummary.services.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    costSummary.services.map((s, i) => (
                      <TableRow key={s.service} className="border-border">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SVC_COLORS[i % SVC_COLORS.length] }} />
                            <span className="font-medium text-foreground">{s.service}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(s.cost)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {s.usage_quantity > 0 ? fmtUsage(s.usage_quantity) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{s.usage_unit || "—"}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {costSummary.total_cost > 0
                            ? `${((s.cost / costSummary.total_cost) * 100).toFixed(1)}%`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm rounded-md border border-dashed border-border mx-4 sm:mx-0 mb-4">
              暂无费用数据
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ─── Sub-component to avoid React key issues with fragments in map ─── */
function GroupRows({
  group,
  dates,
  formatMoney,
  onExport,
}: {
  group: { label: string; accounts: { id: number; name: string; extId: string; dailyCosts: Map<string, number>; total: number }[]; total: number }
  dates: string[]
  formatMoney: (n: number) => string
  onExport: (id: number) => void
}) {
  return (
    <>
      {/* Group header */}
      <tr className="bg-accent">
        <td className="px-3 py-1.5 font-semibold text-foreground whitespace-nowrap border-b border-border sticky left-0 bg-accent z-10">
          📁 {group.label}
        </td>
        <td className="text-right px-3 py-1.5 font-semibold text-foreground border-b border-border font-mono text-xs">
          {formatMoney(group.total)}
        </td>
        {dates.map((d) => {
          const dayTotal = group.accounts.reduce((s, a) => s + (a.dailyCosts.get(d) ?? 0), 0)
          return (
            <td key={d} className="text-right px-3 py-1.5 font-semibold text-foreground border-b border-border font-mono text-xs">
              {dayTotal > 0 ? formatMoney(dayTotal) : "—"}
            </td>
          )
        })}
        <td className="border-b border-border" />
      </tr>

      {/* Account rows */}
      {group.accounts.map((acct) => (
        <tr key={acct.id} className="hover:bg-accent/20 transition-colors">
          <td className="px-3 py-1.5 pl-8 whitespace-nowrap border-b border-border sticky left-0 bg-card z-10">
            <div className="flex flex-col">
              <span className="text-foreground text-sm">{acct.name}</span>
              <span className="text-muted-foreground text-[11px]">{acct.extId}</span>
            </div>
          </td>
          <td className="text-right px-3 py-1.5 border-b border-border font-mono text-xs text-foreground font-medium">
            {formatMoney(acct.total)}
          </td>
          {dates.map((d) => {
            const cost = acct.dailyCosts.get(d) ?? 0
            return (
              <td key={d} className={cn(
                "text-right px-3 py-1.5 border-b border-border font-mono text-xs",
                cost > 0 ? "text-foreground" : "text-muted-foreground/40"
              )}>
                {cost > 0 ? formatMoney(cost) : "—"}
              </td>
            )
          })}
          <td className="text-center px-2 py-1.5 border-b border-border">
            <button onClick={() => onExport(acct.id)} className="text-muted-foreground hover:text-foreground transition-colors" title="导出此账号明细">
              <Download className="w-3.5 h-3.5 inline" />
            </button>
          </td>
        </tr>
      ))}
    </>
  )
}
