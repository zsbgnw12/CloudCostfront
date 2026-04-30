"use client"

import { useState, useMemo, useEffect } from "react"
import { format, subDays, startOfMonth } from "date-fns"
import {
  Activity, Download, ChevronLeft, ChevronRight,
  Database, Layers, Hash,
} from "lucide-react"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { meteringApi } from "@/lib/api"
import {
  useMeteringSummary, useMeteringDaily, useMeteringByService,
  useMeteringProducts, useMeteringDetail, useMeteringDetailCount,
  useAccounts, useSuppliers, useSupplySourcesAll,
} from "@/hooks/use-data"
import { cn } from "@/lib/utils"

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure", taiji: "Taiji" }

const COLORS = [
  "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
]

/** Recharts 默认图例/Tooltip 为黑字，深色背景下需显式指定浅色 */
const CHART_TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: "rgba(20,20,20,0.94)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  },
  labelStyle: { color: "#fafafa" },
  itemStyle: { color: "#e4e4e7" },
} as const

const CHART_LEGEND_PROPS = {
  wrapperStyle: { color: "rgba(255,255,255,0.88)", fontSize: 12 },
  iconType: "circle" as const,
}

/** 坐标轴刻度文字由 tick.fill 控制，仅设 stroke 字仍是黑色 */
const CHART_AXIS_STROKE = "rgba(255,255,255,0.2)"
const CHART_TICK = { fill: "#d4d4d8", fontSize: 11 }
const CHART_GRID = "rgba(255,255,255,0.08)"

function legendTextLight(value: string) {
  return <span className="text-foreground">{value}</span>
}

/** API 可能返回 string（Decimal 序列化），统一转成 number */
function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function fmtUsage(n: unknown): string {
  const num = toNum(n)
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(2)
}

function fmtCost(n: unknown): string {
  return `$${toNum(n).toFixed(2)}`
}

export default function MeteringPage() {
  const today = new Date()
  const { data: accounts = [] } = useAccounts()
  const { data: suppliers = [] } = useSuppliers()
  const { data: sources = [] } = useSupplySourcesAll()
  const [dateStart, setDateStart] = useState(format(startOfMonth(today), "yyyy-MM-dd"))
  const [dateEnd, setDateEnd] = useState(format(today, "yyyy-MM-dd"))
  const [supplierId, setSupplierId] = useState("__all__")
  const [supplySourceId, setSupplySourceId] = useState("__all__")
  /** 服务账号多选：空数组 = 不限（按上游供应商/货源范围） */
  const [accountIds, setAccountIds] = useState<number[]>([])
  /** 服务多选：空数组 = 不限 */
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const pageSize = 20

  useEffect(() => {
    setSupplySourceId("__all__")
    setAccountIds([])
    setSelectedProducts([])
    setPage(1)
  }, [supplierId])

  useEffect(() => {
    setAccountIds([])
    setSelectedProducts([])
    setPage(1)
  }, [supplySourceId])

  const sourcesInScope = useMemo(() => {
    if (supplierId === "__all__") return sources
    return sources.filter((s) => String(s.supplier_id) === supplierId)
  }, [sources, supplierId])

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

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (supplierId !== "__all__") {
        const allowed = new Set(sourcesInScope.map((s) => s.id))
        if (!allowed.has(a.supply_source_id)) return false
      }
      if (supplySourceId !== "__all__" && a.supply_source_id !== Number(supplySourceId)) return false
      return true
    })
  }, [accounts, supplierId, supplySourceId, sourcesInScope])

  const supplierNameForApi = useMemo(() => {
    if (supplierId === "__all__") return undefined
    return suppliers.find((s) => String(s.id) === supplierId)?.name
  }, [supplierId, suppliers])

  const providerForMetering = useMemo(() => {
    if (supplySourceId !== "__all__") {
      return sources.find((s) => String(s.id) === supplySourceId)?.provider
    }
    return undefined
  }, [supplySourceId, sources])

  const scopeExtra = useMemo(
    () => ({
      account_ids: accountIds.length > 0 ? accountIds : undefined,
      supply_source_id:
        accountIds.length === 0 && supplySourceId !== "__all__" ? Number(supplySourceId) : undefined,
      supplier_name:
        accountIds.length === 0 && supplySourceId === "__all__" && supplierId !== "__all__"
          ? supplierNameForApi
          : undefined,
    }),
    [accountIds, supplySourceId, supplierId, supplierNameForApi],
  )

  const filters = useMemo(
    () => ({
      date_start: dateStart || undefined,
      date_end: dateEnd || undefined,
      provider: providerForMetering,
      products: selectedProducts.length > 0 ? selectedProducts : undefined,
      ...scopeExtra,
    }),
    [dateStart, dateEnd, providerForMetering, selectedProducts, scopeExtra],
  )

  const { data: summary, isLoading: summaryLoading } = useMeteringSummary(filters)
  const { data: daily = [] } = useMeteringDaily(filters)
  const { data: byService = [] } = useMeteringByService(filters)
  const { data: productOptions = [] } = useMeteringProducts(providerForMetering || undefined, scopeExtra)
  const { data: detail = [] } = useMeteringDetail({ ...filters, page, page_size: pageSize })
  const { data: countData } = useMeteringDetailCount(filters)
  const totalCount = countData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const handleExport = () => {
    const url = meteringApi.exportUrl(filters)
    window.open(url, "_blank")
  }

  const quickRange = (days: number) => {
    setDateEnd(format(today, "yyyy-MM-dd"))
    setDateStart(format(subDays(today, days - 1), "yyyy-MM-dd"))
    setPage(1)
  }

  const dailyChartData = useMemo(() =>
    daily.map((d) => ({
      ...d,
      date: d.date.slice(5),
      usage_quantity: toNum(d.usage_quantity),
      cost: toNum(d.cost),
      record_count: toNum(d.record_count),
    })),
  [daily])

  const pieData = useMemo(() =>
    byService.map((s) => ({
      name: s.product,
      value: toNum(s.usage_quantity),
      cost: toNum(s.cost),
    })),
  [byService])

  /** 用量为 0 的项不参与饼图，避免扇区异常或「空一块」观感 */
  const pieDataPositive = useMemo(
    () => pieData.filter((d) => d.value > 0),
    [pieData],
  )

  /** 扇区上不打标签，列表按用量排序；颜色仍与饼图扇区一一对应 */
  const pieLegendRows = useMemo(
    () =>
      [...pieDataPositive]
        .map((row, colorIndex) => ({ ...row, colorIndex }))
        .sort((a, b) => b.value - a.value),
    [pieDataPositive],
  )

  const pieTotalUsage = useMemo(
    () => pieDataPositive.reduce((sum, x) => sum + x.value, 0),
    [pieDataPositive],
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">计量</h1>
          <p className="text-sm text-muted-foreground mt-1">
            云账单用量（billing_data，三云同步数据）
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />导出 CSV
        </Button>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">开始日期</Label>
              <Input
                type="date" className="h-8 w-36 text-sm"
                value={dateStart}
                onChange={(e) => { setDateStart(e.target.value); setPage(1) }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">结束日期</Label>
              <Input
                type="date" className="h-8 w-36 text-sm"
                value={dateEnd}
                onChange={(e) => { setDateEnd(e.target.value); setPage(1) }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">供应商</Label>
              <Select
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-8 w-40 text-sm"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部供应商</SelectItem>
                  {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">货源</Label>
              <Select
                value={supplySourceId}
                onValueChange={(v) => {
                  setSupplySourceId(v)
                  setPage(1)
                }}
                disabled={supplierId !== "__all__" && sourcesInScope.length === 0}
              >
                <SelectTrigger className="h-8 w-52 text-sm"><SelectValue placeholder="全部货源" /></SelectTrigger>
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
            <div className="space-y-1.5 min-w-[220px]">
              <Label className="text-xs">服务账号</Label>
              <MultiSelect
                triggerClassName="h-8 text-sm w-full"
                placeholder="全部账号"
                searchPlaceholder="搜索账号名 / ID"
                emptyText="无可选账号"
                options={filteredAccounts.map((a) => ({
                  value: String(a.id),
                  label: a.name,
                  keywords: `${a.name} ${a.external_project_id} ${a.provider}`,
                  description: `${a.provider.toUpperCase()} · ${a.external_project_id}`,
                })) satisfies MultiSelectOption[]}
                value={accountIds.map(String)}
                onChange={(next) => {
                  setAccountIds(next.map(Number))
                  setSelectedProducts([])
                  setPage(1)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">服务</Label>
              <MultiSelect
                triggerClassName="h-8 w-52 text-sm"
                placeholder="全部服务"
                searchPlaceholder="搜索服务"
                emptyText="无可选服务"
                options={productOptions.map((p) => ({
                  value: p.product,
                  label: p.product,
                })) satisfies MultiSelectOption[]}
                value={selectedProducts}
                onChange={(next) => {
                  setSelectedProducts(next)
                  setPage(1)
                }}
              />
            </div>
            <div className="flex items-center gap-1 pb-0.5">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => quickRange(7)}>近7天</Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => quickRange(30)}>近30天</Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setDateStart(format(startOfMonth(today), "yyyy-MM-dd")); setDateEnd(format(today, "yyyy-MM-dd")); setPage(1) }}>本月</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="总用量" icon={Activity}
          value={summaryLoading ? "—" : fmtUsage(summary?.total_usage ?? 0)}
          color="text-violet-400"
        />
        <SummaryCard
          title="总费用" icon={Layers}
          value={summaryLoading ? "—" : fmtCost(summary?.total_cost ?? 0)}
          color="text-amber-400"
        />
        <SummaryCard
          title="服务数" icon={Database}
          value={summaryLoading ? "—" : String(summary?.service_count ?? 0)}
          color="text-cyan-400"
        />
        <SummaryCard
          title="记录数" icon={Hash}
          value={summaryLoading ? "—" : (summary?.record_count ?? 0).toLocaleString()}
          color="text-emerald-400"
        />
      </div>

      <Tabs defaultValue="trend" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trend">用量趋势</TabsTrigger>
          <TabsTrigger value="service">服务分布</TabsTrigger>
        </TabsList>

        <TabsContent value="trend">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-foreground">每日用量与费用</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyChartData.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">暂无数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={dailyChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="gUsage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="date" tick={CHART_TICK} stroke={CHART_AXIS_STROKE} tickLine={false} axisLine={{ stroke: CHART_AXIS_STROKE }} />
                    <YAxis yAxisId="usage" tickFormatter={fmtUsage} tick={CHART_TICK} stroke={CHART_AXIS_STROKE} tickLine={false} axisLine={{ stroke: CHART_AXIS_STROKE }} />
                    <YAxis yAxisId="cost" orientation="right" tickFormatter={(v) => `$${v}`} tick={CHART_TICK} stroke={CHART_AXIS_STROKE} tickLine={false} axisLine={{ stroke: CHART_AXIS_STROKE }} />
                    <Tooltip
                      {...CHART_TOOLTIP_PROPS}
                      formatter={(value: number, name: string) => [
                        name === "费用" ? fmtCost(value) : fmtUsage(value),
                        name,
                      ]}
                    />
                    <Legend {...CHART_LEGEND_PROPS} formatter={legendTextLight} />
                    <Area yAxisId="usage" type="monotone" dataKey="usage_quantity" name="用量" stroke="#8b5cf6" fill="url(#gUsage)" strokeWidth={2} />
                    <Area yAxisId="cost" type="monotone" dataKey="cost" name="费用" stroke="#f59e0b" fill="url(#gCost)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="service">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-foreground">服务用量占比</CardTitle>
              </CardHeader>
              <CardContent>
                {pieDataPositive.length === 0 ? (
                  <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                    {pieData.length === 0 ? "暂无数据" : "所选范围内用量均为 0，无法绘制占比"}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
                    <div className="mx-auto flex w-full max-w-[280px] shrink-0 justify-center lg:mx-0">
                      <div className="aspect-square h-[min(260px,70vw)] w-[min(260px,70vw)] max-h-[280px] max-w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                            <Pie
                              data={pieDataPositive}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={0}
                              outerRadius="88%"
                              paddingAngle={pieDataPositive.length > 1 ? 0.8 : 0}
                              stroke="rgba(255,255,255,0.12)"
                              strokeWidth={1}
                              isAnimationActive={pieDataPositive.length <= 24}
                            >
                              {pieDataPositive.map((_, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              {...CHART_TOOLTIP_PROPS}
                              contentStyle={{
                                ...CHART_TOOLTIP_PROPS.contentStyle,
                                maxWidth: 320,
                              }}
                              formatter={(value: number, _n: string, item: { payload?: { name?: string; cost?: number } }) => {
                                const row = item?.payload
                                const lines = [`用量: ${fmtUsage(value)}`]
                                if (row && typeof row.cost === "number") lines.push(`费用: ${fmtCost(row.cost)}`)
                                return [lines.join(" · "), row?.name ?? "服务"]
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 space-y-1.5 overflow-y-auto lg:max-h-[280px] pr-1 text-sm">
                      {pieLegendRows.map((row) => {
                        const pct = pieTotalUsage > 0 ? (row.value / pieTotalUsage) * 100 : 0
                        return (
                          <div
                            key={`${row.name}-${row.colorIndex}`}
                            className="flex items-start justify-between gap-2 border-b border-white/10 pb-1.5 last:border-0 last:pb-0"
                          >
                            <div className="flex min-w-0 items-start gap-2">
                              <span
                                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                                style={{ backgroundColor: COLORS[row.colorIndex % COLORS.length] }}
                              />
                              <span className="break-words text-foreground" title={row.name}>
                                {row.name}
                              </span>
                            </div>
                            <div className="shrink-0 text-right text-xs tabular-nums">
                              <div className="text-foreground">{fmtUsage(row.value)}</div>
                              <div className="text-muted-foreground">
                                {pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-foreground">服务费用（Top10）</CardTitle>
              </CardHeader>
              <CardContent>
                {byService.length === 0 ? (
                  <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">暂无数据</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={byService.slice(0, 10).map((s) => ({
                        name: s.product.length > 16 ? s.product.slice(0, 16) + "…" : s.product,
                        cost: toNum(s.cost),
                      }))}
                      margin={{ top: 8, right: 12, left: 8, bottom: 64 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ ...CHART_TICK, fontSize: 10 }}
                        stroke={CHART_AXIS_STROKE}
                        tickLine={false}
                        axisLine={{ stroke: CHART_AXIS_STROKE }}
                        interval={0}
                        angle={-32}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tickFormatter={(v) => `$${v}`}
                        tick={CHART_TICK}
                        stroke={CHART_AXIS_STROKE}
                        tickLine={false}
                        axisLine={{ stroke: CHART_AXIS_STROKE }}
                        width={56}
                      />
                      <Tooltip
                        {...CHART_TOOLTIP_PROPS}
                        formatter={(value: number) => [fmtCost(value), "费用"]}
                      />
                      <Legend {...CHART_LEGEND_PROPS} formatter={legendTextLight} />
                      <Bar dataKey="cost" name="费用" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-foreground">用量明细</CardTitle>
            <Badge variant="secondary" className="text-xs">{totalCount.toLocaleString()} 条</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">日期</TableHead>
                  <TableHead className="text-xs">供应商</TableHead>
                  <TableHead className="text-xs">服务</TableHead>
                  <TableHead className="text-xs">用量类型</TableHead>
                  <TableHead className="text-xs">区域</TableHead>
                  <TableHead className="text-xs text-right">用量</TableHead>
                  <TableHead className="text-xs">单位</TableHead>
                  <TableHead className="text-xs text-right">费用</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.date}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px]">{r.provider.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium max-w-[180px] truncate" title={r.product || ""}>
                        {r.product || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" title={r.usage_type || ""}>
                        {r.usage_type || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.region || "—"}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmtUsage(r.usage_quantity)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.usage_unit || "—"}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{fmtCost(r.cost)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                第 {page}/{totalPages} 页，共 {totalCount.toLocaleString()} 条
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="icon" className="h-7 w-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline" size="icon" className="h-7 w-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  title, icon: Icon, value, sub, color,
}: {
  title: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  value: string
  sub?: string
  color: string
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10",
              color,
            )}
            aria-hidden
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
          </div>
          <span className="text-xs text-muted-foreground">{title}</span>
        </div>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}
