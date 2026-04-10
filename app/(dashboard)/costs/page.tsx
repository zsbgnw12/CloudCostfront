"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { BarChart3, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts"
import { accountsApi, type ServiceAccount, type CostSummary, type GroupItem } from "@/lib/api"
import { useAccounts, useGroups } from "@/hooks/use-data"

const COLORS = ["#e8854a", "#5b8def", "#4ade80", "#eab308", "#d946ef", "#14b8a6", "#ef4444", "#818cf8", "#84cc16", "#38bdf8"]

function fmt(v: number) { return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
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

export default function CostsPage() {
  const { data: accounts = [] } = useAccounts()
  const { data: groups = [] } = useGroups()
  const [provider, setProvider] = useState("__all__")
  const [groupFilter, setGroupFilter] = useState("__all__")
  const [selectedId, setSelectedId] = useState<string>("")
  const [dateRange, setDateRange] = useState(getDefaultRange)
  const [costs, setCosts] = useState<CostSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Set default selection once accounts load
  useEffect(() => {
    if (initialized || accounts.length === 0) return
    setInitialized(true)
    const awsAccounts = accounts.filter((x) => x.provider === "aws")
    if (awsAccounts.length > 0) {
      const first = awsAccounts[0]
      setProvider("aws")
      if (first.group_label) setGroupFilter(first.group_label)
      setSelectedId(String(first.id))
    } else if (accounts.length > 0) {
      const first = accounts[0]
      setProvider(first.provider)
      if (first.group_label) setGroupFilter(first.group_label)
      setSelectedId(String(first.id))
    }
  }, [accounts, initialized])

  // Cascading: available providers
  const providers = useMemo(() => {
    const set = new Set(accounts.map((a) => a.provider))
    return Array.from(set).sort()
  }, [accounts])

  // Cascading: available groups for selected provider
  const availableGroups = useMemo(() => {
    const filtered = provider === "__all__" ? accounts : accounts.filter((a) => a.provider === provider)
    const set = new Set<string>()
    filtered.forEach((a) => set.add(a.group_label ?? "(未分组)"))
    // Also include empty groups from API
    if (provider !== "__all__") {
      groups.filter((g) => g.provider === provider).forEach((g) => set.add(g.label))
    }
    return Array.from(set).sort()
  }, [accounts, groups, provider])

  // Cascading: available accounts for selected provider + group
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (provider !== "__all__" && a.provider !== provider) return false
      if (groupFilter !== "__all__") {
        const label = a.group_label ?? "(未分组)"
        if (label !== groupFilter) return false
      }
      return true
    })
  }, [accounts, provider, groupFilter])

  // Reset downstream when upstream changes
  const handleProviderChange = (v: string) => {
    setProvider(v); setGroupFilter("__all__"); setSelectedId(""); setCosts(null)
  }
  const handleGroupChange = (v: string) => {
    setGroupFilter(v); setSelectedId(""); setCosts(null)
  }

  const loadCosts = useCallback(async () => {
    if (!selectedId) return
    try {
      setLoading(true)
      const data = await accountsApi.costs(Number(selectedId), dateRange.start, dateRange.end)
      setCosts(data)
    } catch (e) { console.error(e); setCosts(null) }
    finally { setLoading(false) }
  }, [selectedId, dateRange])

  useEffect(() => { if (selectedId) loadCosts() }, [selectedId, loadCosts])

  const selected = accounts.find((a) => String(a.id) === selectedId)

  // Build stacked bar data: each day has service-level breakdown
  const stackedData = useMemo(() => {
    if (!costs) return { data: [], serviceNames: [] }
    // Get top N services by total cost, group rest as "其他"
    const topN = 8
    const topServices = costs.services.slice(0, topN).map((s) => s.service)
    const topSet = new Set(topServices)

    const dateMap = new Map<string, Record<string, number>>()
    for (const r of costs.daily_by_service) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, {})
      const m = dateMap.get(r.date)!
      const key = topSet.has(r.service) ? r.service : "其他"
      m[key] = (m[key] ?? 0) + r.cost
    }

    const serviceNames = [...topServices]
    // Check if "其他" exists
    const hasOther = Array.from(dateMap.values()).some((m) => m["其他"])
    if (hasOther) serviceNames.push("其他")

    const data = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date: date.slice(5), ...vals }))

    return { data, serviceNames }
  }, [costs])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">服务明细</h1>
        <p className="text-sm text-muted-foreground mt-1">查看服务账号的每日花费和服务使用情况</p>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">云厂商</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">分组</Label>
              <Select value={groupFilter} onValueChange={handleGroupChange}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部分组</SelectItem>
                  {availableGroups.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[250px]">
              <Label className="text-xs">服务账号</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger><SelectValue placeholder="选择账号" /></SelectTrigger>
                <SelectContent>
                  {filteredAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="text-xs text-muted-foreground mr-1">[{a.provider.toUpperCase()}]</span>
                      {a.name}
                      <span className="text-xs text-muted-foreground ml-1">({a.external_project_id})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">开始日期</Label>
              <Input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">结束日期</Label>
              <Input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="w-40" />
            </div>
            <Button onClick={loadCosts} disabled={!selectedId || loading} size="sm">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}查询
            </Button>
            {costs && selectedId && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => {
                const url = accountsApi.costsExportUrl(Number(selectedId), dateRange.start, dateRange.end)
                window.open(url, "_blank")
              }}>
                <Download className="w-3.5 h-3.5" />导出 Excel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedId ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <div className="text-center"><BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>选择一个服务账号查看费用</p></div>
        </div>
      ) : loading ? (
        <div className="text-center py-20 text-muted-foreground">加载中...</div>
      ) : costs ? (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">总费用</p>
                <p className="text-2xl font-semibold mt-1">{fmt(costs.total_cost)}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">总用量</p>
                <p className="text-2xl font-semibold mt-1">{fmtUsage(costs.total_usage)}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">服务数</p>
                <p className="text-2xl font-semibold mt-1">{costs.services.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">日均费用</p>
                <p className="text-2xl font-semibold mt-1">{costs.daily.length > 0 ? fmt(costs.total_cost / costs.daily.length) : "$0.00"}</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Daily Cost Stacked Bar Chart (by service) */}
            <Card className="bg-card border-border col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">每日服务费用构成</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  {stackedData.data.length === 0 ? <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stackedData.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#3a3a4a" vertical={false} />
                        <XAxis dataKey="date" stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e1e2e", border: "1px solid #3a3a4a", borderRadius: "8px", color: "#e5e5e5" }}
                          formatter={(v: number, name: string) => [fmt(v), name]}
                          labelFormatter={(l) => `日期: ${l}`}
                        />
                        <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 11 }} />
                        {stackedData.serviceNames.map((name, i) => (
                          <Bar key={name} dataKey={name} stackId="svc" fill={COLORS[i % COLORS.length]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Service Pie Chart */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">服务费用占比</CardTitle></CardHeader>
              <CardContent>
                {costs.services.length === 0 ? <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">暂无数据</div> : (
                  <div>
                    <div className="h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={costs.services} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="cost" nameKey="service">
                            {costs.services.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: "#1e1e2e", border: "1px solid #3a3a4a", borderRadius: "8px", color: "#e5e5e5" }}
                            formatter={(v: number) => [fmt(v), "费用"]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1 mt-2 max-h-[100px] overflow-y-auto">
                      {costs.services.slice(0, 8).map((s, i) => (
                        <div key={s.service} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="truncate text-muted-foreground">{s.service}</span>
                          <span className="ml-auto font-mono shrink-0">{fmt(s.cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Service Detail Table */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">服务使用明细</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>服务名称</TableHead>
                    <TableHead className="text-right">费用 (USD)</TableHead>
                    <TableHead className="text-right">用量</TableHead>
                    <TableHead>单位</TableHead>
                    <TableHead className="text-right">占比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costs.services.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无数据</TableCell></TableRow>
                  ) : costs.services.map((s, i) => (
                    <TableRow key={s.service} className="border-border">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="font-medium text-foreground">{s.service}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt(s.cost)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{s.usage_quantity > 0 ? fmtUsage(s.usage_quantity) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{s.usage_unit || "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{costs.total_cost > 0 ? `${(s.cost / costs.total_cost * 100).toFixed(1)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
