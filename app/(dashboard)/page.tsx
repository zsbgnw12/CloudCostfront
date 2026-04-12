"use client"

import { useState, useMemo } from "react"
import { TrendingUp, TrendingDown, FolderKanban, KeyRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts"
import { useAccounts, useDashboardBundle } from "@/hooks/use-data"
import type { DashboardTrendPoint, DashboardProviderSlice } from "@/lib/api"

const COLORS = ["#e8854a", "#5b8def", "#4ade80", "#eab308", "#d946ef", "#14b8a6", "#ef4444", "#818cf8", "#84cc16", "#38bdf8"]
function fmt(v: number) { return `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function getMonthOptions() {
  const opts: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    opts.push({ value: v, label: `${d.getFullYear()}年${d.getMonth() + 1}月` })
  }
  return opts
}

export default function DashboardPage() {
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  const [month, setMonth] = useState(defaultMonth)
  const monthOptions = getMonthOptions()

  const { data: dash, isLoading: dashLoading } = useDashboardBundle(month, { service_limit: 10 })
  const overview = dash?.overview
  const trend = dash?.trend
  const byProvider = dash?.by_provider
  const byService = dash?.by_service
  const { data: accounts } = useAccounts()

  const trendData = useMemo(() => (trend ?? []).map((r: DashboardTrendPoint) => ({
    date: String(r.date ?? "").slice(5),
    cost: Number(r.cost ?? 0),
  })), [trend])

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = { active: 0, inactive: 0 }
    ;(accounts ?? []).forEach((a) => { m[a.status] = (m[a.status] ?? 0) + 1 })
    return m
  }, [accounts])

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-bold tracking-tight text-white">仪表盘</h1><p className="text-sm text-white/50 mt-1">全景云费用总览洞察</p></div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white rounded-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-white/10">
            {monthOptions.map((o) => <SelectItem key={o.value} value={o.value} className="focus:bg-white/10">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="bg-card border-border"><CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-white/60">本月总费用</p>
              <div className="text-3xl font-bold tracking-tight text-white">{overview ? fmt(overview.total_cost) : <Skeleton className="h-9 w-32" />}</div>
              {overview && overview.mom_change_pct !== 0 && (
                <div className="flex items-center gap-1 mt-2">
                  <Badge variant="outline" className={cn("border-0 gap-1", overview.mom_change_pct > 0 ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400")}>
                    {overview.mom_change_pct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {overview.mom_change_pct > 0 ? "+" : ""}{overview.mom_change_pct}%
                  </Badge>
                  <span className="text-xs text-white/40">vs 上月</span>
                </div>
              )}
            </div>
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 ring-1 ring-white/5 shadow-inner">
              <TrendingUp className="w-5 h-5 text-white/80" />
            </div>
          </div>
        </CardContent></Card>

        <Card className="bg-card border-border"><CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-white/60">上月费用</p>
              <div className="text-3xl font-bold tracking-tight text-white/80">{overview ? fmt(overview.prev_month_cost) : <Skeleton className="h-9 w-32" />}</div>
            </div>
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 ring-1 ring-white/5 shadow-inner">
              <FolderKanban className="w-5 h-5 text-white/50" />
            </div>
          </div>
        </CardContent></Card>

        <Card className="bg-card border-border"><CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-white/60">服务账号</p>
              <div className="text-3xl font-bold tracking-tight text-white">{accounts ? accounts.length : <Skeleton className="h-9 w-16" />}</div>
              <div className="flex gap-2 text-xs pt-2">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-0 text-xs">使用中 {statusCounts.active}</Badge>
                <Badge variant="outline" className="bg-red-500/10 text-red-400 border-0 text-xs">已停用 {statusCounts.inactive}</Badge>
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 ring-1 ring-white/5 shadow-inner">
               <KeyRound className="w-5 h-5 text-white/80" />
            </div>
          </div>
        </CardContent></Card>

        {/* 活跃客户统计已移除 — 系统不再按客户维度聚合 */}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Daily Trend */}
        <Card className="col-span-1 xl:col-span-2 bg-gradient-to-br from-white/[0.04] to-card/50">
          <CardHeader className="pb-2 border-b border-white/5 mb-4">
            <CardTitle className="text-base font-semibold tracking-wide text-white">每日费用趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] px-2 w-full">
              {dashLoading || !trend ? <div className="flex items-center justify-center h-full"><Skeleton className="h-[260px] w-full rounded-xl" /></div> : trendData.length === 0 ? <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div> : (
                <ResponsiveContainer width="100%" height="80%">
                  <BarChart data={trendData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} tickMargin={10} />
                    <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} tickMargin={10} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                      contentStyle={{ backgroundColor: "rgba(20,20,20,0.92)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
                      labelStyle={{ color: "#fafafa" }}
                      itemStyle={{ color: "#e4e4e7" }}
                      formatter={(v: number) => [fmt(v), "日消费"]}
                    />
                    <Bar dataKey="cost" fill="url(#colorCost)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Provider Pie */}
        <Card className="col-span-1 bg-gradient-to-bl from-white/[0.04] to-card/50">
          <CardHeader className="pb-2 border-b border-white/5 mb-4">
            <CardTitle className="text-base font-semibold tracking-wide text-white">云厂商费用占比</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] flex flex-col justify-between">
              {dashLoading || !byProvider ? <div className="flex items-center justify-center h-full"><Skeleton className="h-48 w-48 rounded-full mx-auto" /></div> : (byProvider ?? []).length === 0 ? <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div> : (<>
                <div className="h-48 w-full flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byProvider ?? []} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="cost" nameKey="provider" stroke="none">
                        {(byProvider ?? []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "rgba(20,20,20,0.92)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
                        labelStyle={{ color: "#fafafa" }}
                        itemStyle={{ color: "#e4e4e7" }}
                        formatter={(v: number) => [fmt(v), "费用"]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3 mt-4 overflow-y-auto">
                  {(byProvider ?? []).map((r: DashboardProviderSlice, i: number) => (
                    <div key={r.provider} className="flex items-center justify-between text-sm group">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shadow-inner ring-1 ring-white/10" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-white/80 font-medium group-hover:text-white transition-colors">{r.provider}</span>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        <span className="font-mono text-white tracking-tight">{fmt(Number(r.cost))}</span>
                        <span className="text-white/40 text-xs w-8 text-right">{r.percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Services */}
      <Card className="bg-gradient-to-t from-white/[0.02] to-card/50">
        <CardHeader className="pb-2 border-b border-white/5 mb-4">
          <CardTitle className="text-base font-semibold tracking-wide text-white">Top 10 云服务费用分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[360px] pl-4 pb-4">
            {dashLoading || !byService ? <div className="flex items-center justify-center h-full"><Skeleton className="h-[300px] w-full rounded-xl" /></div> : (byService ?? []).length === 0 ? <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byService ?? []} layout="vertical" barSize={20} margin={{ top: 10, right: 30, left: 30, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorTop" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.4}/>
                        <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={1}/>
                      </linearGradient>
                    </defs>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="product" stroke="rgba(255,255,255,0.8)" fontSize={12} tickLine={false} axisLine={false} width={160} tickMargin={10} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    contentStyle={{ backgroundColor: "rgba(20,20,20,0.92)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
                    labelStyle={{ color: "#fafafa" }}
                    itemStyle={{ color: "#e4e4e7" }}
                    formatter={(v: number) => [fmt(v), "费用"]}
                  />
                  <Bar dataKey="cost" fill="url(#colorTop)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
