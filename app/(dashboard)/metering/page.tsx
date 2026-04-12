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

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure" }

const COLORS = [
  "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
]

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
  const [accountId, setAccountId] = useState("__all__")
  const [product, setProduct] = useState<string>("")
  const [page, setPage] = useState(1)
  const pageSize = 20

  useEffect(() => {
    setSupplySourceId("__all__")
    setAccountId("__all__")
    setProduct("")
    setPage(1)
  }, [supplierId])

  useEffect(() => {
    setAccountId("__all__")
    setProduct("")
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
      account_id: accountId !== "__all__" ? Number(accountId) : undefined,
      supply_source_id:
        accountId === "__all__" && supplySourceId !== "__all__" ? Number(supplySourceId) : undefined,
      supplier_name:
        accountId === "__all__" && supplySourceId === "__all__" && supplierId !== "__all__"
          ? supplierNameForApi
          : undefined,
    }),
    [accountId, supplySourceId, supplierId, supplierNameForApi],
  )

  const filters = useMemo(
    () => ({
      date_start: dateStart || undefined,
      date_end: dateEnd || undefined,
      provider: providerForMetering,
      product: product || undefined,
      ...scopeExtra,
    }),
    [dateStart, dateEnd, providerForMetering, product, scopeExtra],
  )

  const { data: summary, isLoading: summaryLoading } = useMeteringSummary(filters)
  const { data: daily = [] } = useMeteringDaily(filters)
  const { data: byService = [] } = useMeteringByService(filters)
  const { data: products = [] } = useMeteringProducts(providerForMetering || undefined, scopeExtra)
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
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); setProduct(""); setPage(1) }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="全部账号" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部账号</SelectItem>
                  {filteredAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="text-[10px] text-muted-foreground mr-1">{a.provider.toUpperCase()}</span>
                      {a.name}
                      <span className="text-muted-foreground text-xs ml-1">({a.external_project_id})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">服务</Label>
              <Select value={product} onValueChange={(v) => { setProduct(v === "all" ? "" : v); setPage(1) }}>
                <SelectTrigger className="h-8 w-52 text-sm"><SelectValue placeholder="全部服务" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部服务</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.product} value={p.product}>
                      {p.product}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <CardTitle className="text-sm font-medium">每日用量与费用</CardTitle>
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
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="usage" tickFormatter={fmtUsage} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="cost" orientation="right" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(value: number, name: string) => [
                        name === "费用" ? fmtCost(value) : fmtUsage(value),
                        name,
                      ]}
                    />
                    <Legend />
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
                <CardTitle className="text-sm font-medium">服务用量占比</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">暂无数据</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={100}
                        label={({ name, percent }) => `${String(name).length > 12 ? String(name).slice(0, 12) + "…" : name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtUsage(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">服务费用（Top10）</CardTitle>
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
                      margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                        formatter={(value: number) => [fmtCost(value), "费用"]}
                      />
                      <Legend />
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
            <CardTitle className="text-sm font-medium">用量明细</CardTitle>
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
  icon: React.ComponentType<{ className?: string }>
  value: string
  sub?: string
  color: string
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("w-4 h-4", color)} />
          <span className="text-xs text-muted-foreground">{title}</span>
        </div>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}
