"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Plus, MoreHorizontal, Bell, History, BarChart3, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { alertsApi, accountsApi, type AlertRule, type AlertHistory, type RuleStatus } from "@/lib/api"
import { useAccounts, useSuppliers, useSupplySourcesAll } from "@/hooks/use-data"

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure" }

const THRESHOLD_LABELS: Record<string, string> = {
  daily_absolute: "日费用超限",
  monthly_budget: "月预算超限",
  daily_increase_pct: "日增长率超限",
  monthly_minimum_commitment: "月最低承诺用量",
}

const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [history, setHistory] = useState<AlertHistory[]>([])
  const { data: accounts = [] } = useAccounts()
  const { data: suppliers = [] } = useSuppliers()
  const { data: supplySources = [] } = useSupplySourcesAll()
  const [ruleStatusData, setRuleStatusData] = useState<RuleStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    name: "",
    supplier_id: "",
    supply_source_id: "",
    account_id: "",
    threshold_type: "daily_absolute",
    threshold_value: "",
    notify_webhook: "",
    notify_email: "",
  })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [r, h, rs] = await Promise.all([
        alertsApi.listRules(),
        alertsApi.history({ limit: 50 }),
        alertsApi.ruleStatus(),
      ])
      setRules(r); setHistory(h); setRuleStatusData(rs)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const formSources = useMemo(() => {
    if (!form.supplier_id) return []
    const sid = Number(form.supplier_id)
    return supplySources
      .filter((s) => s.supplier_id === sid)
      .sort((a, b) => a.provider.localeCompare(b.provider))
  }, [supplySources, form.supplier_id])

  const formAccounts = useMemo(() => {
    if (!form.supplier_id) return []
    const allowedSourceIds = new Set(formSources.map((s) => s.id))
    return accounts.filter((a) => {
      if (!allowedSourceIds.has(a.supply_source_id)) return false
      if (form.supply_source_id && a.supply_source_id !== Number(form.supply_source_id)) return false
      return true
    })
  }, [accounts, form.supplier_id, form.supply_source_id, formSources])

  const resetForm = () =>
    setForm({
      name: "",
      supplier_id: "",
      supply_source_id: "",
      account_id: "",
      threshold_type: "daily_absolute",
      threshold_value: "",
      notify_webhook: "",
      notify_email: "",
    })

  const selectedAccountName = (targetId: string | null) => {
    if (!targetId) return "全局"
    const a = accounts.find((x) => x.external_project_id === targetId)
    return a ? `${a.name} (${a.external_project_id})` : targetId
  }

  const handleSave = async () => {
    try {
      setActionLoading("save")
      const account = accounts.find((a) => String(a.id) === form.account_id)
      await alertsApi.createRule({
        name: form.name,
        target_type: "project",
        target_id: account?.external_project_id ?? undefined,
        threshold_type: form.threshold_type,
        threshold_value: Number(form.threshold_value),
        notify_webhook: form.notify_webhook || undefined,
        notify_email: form.notify_email || undefined,
      })
      setDialogOpen(false); resetForm(); await load()
    } catch (e) { alert(`创建失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除此规则？")) return
    try { setActionLoading(`delete-${id}`); await alertsApi.deleteRule(id); await load() }
    catch (e) { alert(`删除失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleToggle = async (rule: AlertRule) => {
    try { setActionLoading(`toggle-${rule.id}`); await alertsApi.updateRule(rule.id, { is_active: !rule.is_active }); await load() }
    catch (e) { alert(`操作失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  // Separate alert rules vs commitment rules for display
  const alertStatuses = useMemo(() => ruleStatusData.filter((s) => s.threshold_type !== "monthly_minimum_commitment"), [ruleStatusData])
  const commitmentStatuses = useMemo(() => ruleStatusData.filter((s) => s.threshold_type === "monthly_minimum_commitment"), [ruleStatusData])

  const triggeredCount = ruleStatusData.filter((s) => s.triggered).length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold text-foreground">告警管理</h1><p className="text-sm text-muted-foreground mt-1">配置服务账号费用告警规则，监控承诺用量达标情况</p></div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm() }}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" />添加规则</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>添加告警规则</DialogTitle><DialogDescription>当服务账号费用超出阈值或未达承诺用量时触发告警</DialogDescription></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>规则名称</Label><Input placeholder="如：账号A日费用超限" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>服务账号</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Select
                    value={form.supplier_id}
                    onValueChange={(v) => setForm({ ...form, supplier_id: v, supply_source_id: "", account_id: "" })}
                  >
                    <SelectTrigger><SelectValue placeholder="供应商" /></SelectTrigger>
                    <SelectContent>
                      {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={form.supply_source_id}
                    onValueChange={(v) => setForm({ ...form, supply_source_id: v, account_id: "" })}
                    disabled={!form.supplier_id}
                  >
                    <SelectTrigger><SelectValue placeholder="货源" /></SelectTrigger>
                    <SelectContent>
                      {formSources.map((src) => (
                        <SelectItem key={src.id} value={String(src.id)}>
                          {PROVIDER_LABELS[src.provider] ?? src.provider.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={form.account_id}
                    onValueChange={(v) => setForm({ ...form, account_id: v })}
                    disabled={!form.supplier_id}
                  >
                    <SelectTrigger><SelectValue placeholder="服务账号" /></SelectTrigger>
                    <SelectContent>
                      {formAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}{" "}
                          <span className="text-xs text-muted-foreground">({a.external_project_id})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>告警类型</Label>
                  <Select value={form.threshold_type} onValueChange={(v) => setForm({ ...form, threshold_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily_absolute">日费用超限 (USD)</SelectItem>
                      <SelectItem value="monthly_budget">月预算超限 (USD)</SelectItem>
                      <SelectItem value="daily_increase_pct">日增长率超限 (%)</SelectItem>
                      <SelectItem value="monthly_minimum_commitment">月最低承诺用量 (USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>{form.threshold_type === "monthly_minimum_commitment" ? "承诺最低金额" : "阈值"}</Label><Input type="number" step="0.01" placeholder={form.threshold_type === "monthly_minimum_commitment" ? "月最低消费额 (USD)" : ""} value={form.threshold_value} onChange={(e) => setForm({ ...form, threshold_value: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>通知邮箱（多个用逗号分隔，可选）</Label><Input placeholder="admin@example.com, ops@example.com" value={form.notify_email} onChange={(e) => setForm({ ...form, notify_email: e.target.value })} /></div>
              <div className="space-y-2"><Label>Webhook 通知地址（可选）</Label><Input placeholder="https://..." value={form.notify_webhook} onChange={(e) => setForm({ ...form, notify_webhook: e.target.value })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { setDialogOpen(false); resetForm() }}>取消</Button><Button onClick={handleSave} disabled={!form.name || !form.account_id || !form.threshold_value || actionLoading === "save"}>
              {actionLoading === "save" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}添加
            </Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/20"><Bell className="w-5 h-5 text-primary" /></div><div><p className="text-sm text-muted-foreground">规则总数</p><p className="text-2xl font-semibold">{rules.length}</p></div></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-sm text-muted-foreground">活跃规则</p><p className="text-2xl font-semibold text-green-400">{rules.filter((r) => r.is_active).length}</p></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-destructive/20"><AlertTriangle className="w-5 h-5 text-destructive" /></div><div><p className="text-sm text-muted-foreground">已触发</p><p className="text-2xl font-semibold text-red-400">{triggeredCount}<span className="text-muted-foreground text-sm font-normal ml-1">/ {ruleStatusData.length}</span></p></div></div></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-destructive/20"><History className="w-5 h-5 text-destructive" /></div><div><p className="text-sm text-muted-foreground">触发次数</p><p className="text-2xl font-semibold">{history.length}</p></div></div></CardContent></Card>
      </div>

      <Tabs defaultValue="monitor" className="space-y-4">
        <TabsList><TabsTrigger value="monitor">监控状态</TabsTrigger><TabsTrigger value="rules">告警规则</TabsTrigger><TabsTrigger value="history">触发历史</TabsTrigger></TabsList>

        {/* ── Monitor Tab: unified progress bars ── */}
        <TabsContent value="monitor">
          <div className="space-y-6">
            {/* ── Alerts Section (threshold-based, triggered = over) ── */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />费用预警
                  {alertStatuses.filter((s) => s.triggered).length > 0 && <Badge variant="destructive">{alertStatuses.filter((s) => s.triggered).length} 个已触发</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {alertStatuses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无费用预警规则</p>
                ) : (
                  <div className="space-y-4">
                    {alertStatuses.map((s) => {
                      const displayPct = Math.min(s.pct, 100)
                      const isPercent = s.threshold_type === "daily_increase_pct"
                      const fmtVal = isPercent ? `${s.actual}%` : fmt(s.actual)
                      const fmtThreshold = isPercent ? `${s.threshold_value}%` : fmt(s.threshold_value)
                      return (
                        <div key={s.rule_id} className="space-y-2 p-4 rounded-lg bg-secondary/30">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <img src={`/${s.provider}.svg`} alt={s.provider} className="w-5 h-5" />
                              <span className="text-sm font-medium text-foreground">{s.rule_name}</span>
                              <Badge variant="secondary" className="text-[10px]">{THRESHOLD_LABELS[s.threshold_type]}</Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              {s.triggered ? (
                                <><AlertTriangle className="w-4 h-4 text-red-400" /><Badge variant="secondary" className="bg-red-500/20 text-red-400">已触发</Badge></>
                              ) : (
                                <><CheckCircle2 className="w-4 h-4 text-green-400" /><Badge variant="secondary" className="bg-green-500/20 text-green-400">正常</Badge></>
                              )}
                            </div>
                          </div>
                          <div className="h-4 w-full rounded-full bg-secondary overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                s.triggered ? "bg-red-500" : s.pct >= 80 ? "bg-yellow-500" : "bg-green-500"
                              )}
                              style={{ width: `${displayPct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">实际: <span className={cn("font-mono", s.triggered ? "text-red-400" : "text-foreground")}>{fmtVal}</span> / 阈值: <span className="text-foreground font-mono">{fmtThreshold}</span></span>
                            <span className={cn("font-mono font-medium", s.triggered ? "text-red-400" : s.pct >= 80 ? "text-yellow-400" : "text-green-400")}>{Math.round(s.pct)}%</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{s.account_name} ({s.external_project_id})</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Commitments Section (minimum commitment, triggered = under) ── */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />承诺用量
                  {commitmentStatuses.filter((s) => s.triggered).length > 0 && <Badge variant="destructive">{commitmentStatuses.filter((s) => s.triggered).length} 个未达标</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {commitmentStatuses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无承诺用量规则</p>
                ) : (
                  <div className="space-y-4">
                    {commitmentStatuses.map((s) => {
                      const displayPct = Math.min(s.pct, 100)
                      return (
                        <div key={s.rule_id} className="space-y-2 p-4 rounded-lg bg-secondary/30">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <img src={`/${s.provider}.svg`} alt={s.provider} className="w-5 h-5" />
                              <span className="text-sm font-medium text-foreground">{s.rule_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {!s.triggered ? (
                                <><CheckCircle2 className="w-4 h-4 text-green-400" /><Badge variant="secondary" className="bg-green-500/20 text-green-400">达标</Badge></>
                              ) : (
                                <><AlertTriangle className="w-4 h-4 text-red-400" /><Badge variant="secondary" className="bg-red-500/20 text-red-400">未达标</Badge></>
                              )}
                            </div>
                          </div>
                          <div className="h-4 w-full rounded-full bg-secondary overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                !s.triggered ? "bg-green-500" : s.pct >= 70 ? "bg-yellow-500" : "bg-red-500"
                              )}
                              style={{ width: `${displayPct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">实际: <span className={cn("font-mono", !s.triggered ? "text-green-400" : "text-red-400")}>{fmt(s.actual)}</span> / 承诺: <span className="text-foreground font-mono">{fmt(s.threshold_value)}</span></span>
                            <span className={cn("font-mono font-medium", !s.triggered ? "text-green-400" : "text-red-400")}>{Math.round(s.pct)}%</span>
                          </div>
                          {s.triggered && (
                            <p className="text-xs text-red-400">还差 {fmt(s.threshold_value - s.actual)} 才能达标</p>
                          )}
                          <p className="text-xs text-muted-foreground">{s.account_name} ({s.external_project_id})</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Rules Tab ── */}
        <TabsContent value="rules">
          <Card className="bg-card border-border overflow-hidden"><Table><TableHeader><TableRow className="border-border hover:bg-transparent"><TableHead>名称</TableHead><TableHead>服务账号</TableHead><TableHead>告警类型</TableHead><TableHead>阈值</TableHead><TableHead>通知方式</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">加载中...</TableCell></TableRow>
              : rules.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无规则</TableCell></TableRow>
              : rules.map((r) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{selectedAccountName(r.target_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{THRESHOLD_LABELS[r.threshold_type] ?? r.threshold_type}</TableCell>
                  <TableCell className="text-foreground font-mono">{r.threshold_type === "daily_increase_pct" ? `${r.threshold_value}%` : `$${r.threshold_value}`}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {[r.notify_email && "邮件", r.notify_webhook && "Webhook"].filter(Boolean).join(" + ") || "—"}
                  </TableCell>
                  <TableCell>{r.is_active ? <Badge variant="secondary" className="bg-green-500/20 text-green-400">启用</Badge> : <Badge variant="secondary">停用</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end"><DropdownMenuItem onClick={() => handleToggle(r)}>{r.is_active ? "停用" : "启用"}</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => handleDelete(r.id)}>删除</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></Card>
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history">
          <Card className="bg-card border-border overflow-hidden"><Table><TableHeader><TableRow className="border-border hover:bg-transparent"><TableHead>触发时间</TableHead><TableHead>规则</TableHead><TableHead>实际值</TableHead><TableHead>阈值</TableHead><TableHead>消息</TableHead><TableHead>已通知</TableHead></TableRow></TableHeader>
            <TableBody>
              {history.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">暂无触发记录</TableCell></TableRow>
              : history.map((h) => {
                const rule = rules.find((r) => r.id === h.rule_id)
                return (
                  <TableRow key={h.id} className="border-border">
                    <TableCell className="text-muted-foreground">{new Date(h.triggered_at).toLocaleString("zh-CN")}</TableCell>
                    <TableCell className="text-foreground">{rule?.name ?? `#${h.rule_id}`}</TableCell>
                    <TableCell className="text-foreground font-mono">{h.actual_value != null ? `$${h.actual_value}` : "—"}</TableCell>
                    <TableCell className="text-muted-foreground font-mono">{h.threshold_value != null ? `$${h.threshold_value}` : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[300px] truncate">{h.message ?? "—"}</TableCell>
                    <TableCell>{h.notified ? <Badge variant="secondary" className="bg-green-500/20 text-green-400">是</Badge> : <Badge variant="secondary">否</Badge>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table></Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
