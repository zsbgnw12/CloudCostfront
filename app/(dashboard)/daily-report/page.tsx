"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts"
import { accountsApi, type DailyReportRow, type ServiceAccount } from "@/lib/api"
import { useAccounts } from "@/hooks/use-data"
import { cn } from "@/lib/utils"

const LINE_COLORS = ["#e8854a", "#5b8def", "#4ade80", "#eab308", "#d946ef", "#14b8a6", "#ef4444", "#818cf8", "#84cc16", "#38bdf8"]

function fmt(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
  const [rows, setRows] = useState<DailyReportRow[]>([])
  const { data: accounts = [] } = useAccounts()
  const [dateRange, setDateRange] = useState(getDefaultRange)
  const [provider, setProvider] = useState("aws")
  const [groupFilter, setGroupFilter] = useState("__all__")
  const [accountFilter, setAccountFilter] = useState("__all__")
  const [loading, setLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await accountsApi.dailyReport(dateRange.start, dateRange.end, provider)
      setRows(data)
    } catch (e) {
      console.error(e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [dateRange, provider])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Reset group/account filter when provider changes
  useEffect(() => {
    setGroupFilter("__all__")
    setAccountFilter("__all__")
  }, [provider])

  // Available groups for the selected provider
  const groups = useMemo(() => {
    const set = new Set<string>()
    accounts
      .filter((a) => a.provider === provider)
      .forEach((a) => set.add(a.group_label ?? "(未分组)"))
    return Array.from(set).sort()
  }, [accounts, provider])

  // Available accounts for the selected provider + group
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (a.provider !== provider) return false
      if (groupFilter !== "__all__") {
        const label = a.group_label ?? "(未分组)"
        if (label !== groupFilter) return false
      }
      return true
    })
  }, [accounts, provider, groupFilter])

  // Filter rows by group + account
  const filteredRows = useMemo(() => {
    const validIds = new Set<number>()
    for (const a of filteredAccounts) {
      if (accountFilter === "__all__" || String(a.id) === accountFilter) {
        validIds.add(a.id)
      }
    }
    return rows.filter((r) => validIds.has(r.account_id))
  }, [rows, filteredAccounts, accountFilter])

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

    const groupMap = new Map<string, AcctRow[]>()
    for (const a of filteredAccounts) {
      if (accountFilter !== "__all__" && String(a.id) !== accountFilter) continue
      const label = a.group_label ?? "(未分组)"
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
  }, [filteredRows, filteredAccounts, accountFilter])

  // Line chart: daily total per account
  const lineChartData = useMemo(() => {
    if (pivot.dates.length === 0) return { data: [], accountNames: [] }
    const allAccounts = pivot.groups.flatMap((g) => g.accounts)
    const accountNames = allAccounts.map((a) => a.name)
    const data = pivot.dates.map((d) => {
      const row: Record<string, unknown> = { date: d.slice(5) }
      for (const a of allAccounts) {
        row[a.name] = a.dailyCosts.get(d) ?? 0
      }
      // total
      row["合计"] = pivot.dateTotals.get(d) ?? 0
      return row
    })
    return { data, accountNames }
  }, [pivot])

  const handleExportAll = () => {
    const url = accountsApi.dailyReportExportUrl(dateRange.start, dateRange.end, provider)
    window.open(url, "_blank")
  }

  const handleExportAccount = (accountId: number) => {
    const url = accountsApi.costsExportUrl(accountId, dateRange.start, dateRange.end)
    window.open(url, "_blank")
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">日报表</h1>
          <p className="text-sm text-muted-foreground mt-1">
            各服务账号每日费用，支持按分组/账号筛选与导出
          </p>
        </div>
        <Button onClick={handleExportAll} disabled={filteredRows.length === 0 || loading} className="gap-2">
          <Download className="w-4 h-4" />导出 Excel
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">云厂商</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aws">AWS</SelectItem>
                  <SelectItem value="gcp">GCP</SelectItem>
                  <SelectItem value="azure">Azure</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">分组</Label>
              <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setAccountFilter("__all__") }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部分组</SelectItem>
                  {groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">服务账号</Label>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部账号</SelectItem>
                  {filteredAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} <span className="text-xs text-muted-foreground ml-1">({a.external_project_id})</span>
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
            <Button onClick={loadData} disabled={loading} size="sm">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}查询
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">加载中...</div>
      ) : pivot.dates.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <div className="text-center"><FileSpreadsheet className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>暂无数据</p></div>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">总费用</p>
                <p className="text-2xl font-semibold mt-1">{fmt(pivot.grandTotal)}</p>
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

          {/* Pivot Table */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">每日服务明细（{provider.toUpperCase()}）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[calc(100vh-360px)]">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#252535]">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-b border-border sticky left-0 bg-[#252535] z-20 min-w-[200px]">
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
                        onExport={handleExportAccount}
                      />
                    ))}
                    {/* Grand total */}
                    <tr className="bg-primary/10 font-semibold">
                      <td className="px-3 py-2 text-foreground border-t-2 border-border sticky left-0 bg-[#1e2a3a] z-10">合计</td>
                      <td className="text-right px-3 py-2 text-foreground border-t-2 border-border font-mono text-xs">{fmt(pivot.grandTotal)}</td>
                      {pivot.dates.map((d) => (
                        <td key={d} className="text-right px-3 py-2 text-foreground border-t-2 border-border font-mono text-xs">
                          {fmt(pivot.dateTotals.get(d) ?? 0)}
                        </td>
                      ))}
                      <td className="border-t-2 border-border" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Daily Cost Line Chart */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">每日费用趋势（{provider.toUpperCase()}）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                {lineChartData.data.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lineChartData.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#3a3a4a" vertical={false} />
                      <XAxis dataKey="date" stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e1e2e", border: "1px solid #3a3a4a", borderRadius: "8px", color: "#e5e5e5" }}
                        formatter={(v: number, name: string) => [fmt(v), name]}
                        labelFormatter={(l) => `日期: ${l}`}
                      />
                      <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 11 }} />
                      {lineChartData.accountNames.length > 1 && (
                        <Line
                          type="monotone"
                          dataKey="合计"
                          stroke="#ffffff"
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
        </>
      )}
    </div>
  )
}

/* ─── Sub-component to avoid React key issues with fragments in map ─── */
function GroupRows({
  group,
  dates,
  onExport,
}: {
  group: { label: string; accounts: { id: number; name: string; extId: string; dailyCosts: Map<string, number>; total: number }[]; total: number }
  dates: string[]
  onExport: (id: number) => void
}) {
  return (
    <>
      {/* Group header */}
      <tr className="bg-[#2a2a3a]">
        <td className="px-3 py-1.5 font-semibold text-foreground whitespace-nowrap border-b border-border sticky left-0 bg-[#2a2a3a] z-10">
          📁 {group.label}
        </td>
        <td className="text-right px-3 py-1.5 font-semibold text-foreground border-b border-border font-mono text-xs">
          {fmt(group.total)}
        </td>
        {dates.map((d) => {
          const dayTotal = group.accounts.reduce((s, a) => s + (a.dailyCosts.get(d) ?? 0), 0)
          return (
            <td key={d} className="text-right px-3 py-1.5 font-semibold text-foreground border-b border-border font-mono text-xs">
              {dayTotal > 0 ? fmt(dayTotal) : "—"}
            </td>
          )
        })}
        <td className="border-b border-border" />
      </tr>

      {/* Account rows */}
      {group.accounts.map((acct) => (
        <tr key={acct.id} className="hover:bg-accent/20 transition-colors">
          <td className="px-3 py-1.5 pl-8 whitespace-nowrap border-b border-border sticky left-0 bg-[#1e1e2e] z-10">
            <div className="flex flex-col">
              <span className="text-foreground text-sm">{acct.name}</span>
              <span className="text-muted-foreground text-[11px]">{acct.extId}</span>
            </div>
          </td>
          <td className="text-right px-3 py-1.5 border-b border-border font-mono text-xs text-foreground font-medium">
            {fmt(acct.total)}
          </td>
          {dates.map((d) => {
            const cost = acct.dailyCosts.get(d) ?? 0
            return (
              <td key={d} className={cn(
                "text-right px-3 py-1.5 border-b border-border font-mono text-xs",
                cost > 0 ? "text-foreground" : "text-muted-foreground/40"
              )}>
                {cost > 0 ? fmt(cost) : "—"}
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
