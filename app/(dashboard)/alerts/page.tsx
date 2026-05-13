"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Plus, MoreHorizontal, Bell, History, BarChart3, Loader2, CheckCircle2, AlertTriangle, Layers } from "lucide-react"
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
import { useAccounts, useSuppliers, useSupplySourcesAll, useEntitiesAll } from "@/hooks/use-data"

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure", taiji: "Taiji" }

const THRESHOLD_LABELS: Record<string, string> = {
  daily_absolute: "日费用超限",
  monthly_budget: "月预算超限",
  daily_increase_pct: "日增长率超限",
  monthly_minimum_commitment: "月最低承诺用量",
  account_lifetime_quota: "账号总配额(达 90% 触发)",
  monthly_budget_multi: "多项目月预算合计",
  yearly_budget_multi: "多项目年预算合计",
}

/** 多 project 类型的 threshold_type 集合(同一个判断点用)。 */
const MULTI_PROJECT_TYPES = new Set(["monthly_budget_multi", "yearly_budget_multi"])

/** 账号总配额告警 — 触发百分比硬编码 90%(后端 alert_service.py 也用同一常量)。 */
const ACCOUNT_QUOTA_TRIGGER_PCT = 90

/** Select 不接受空字符串作为 value，下面是不同维度的"全部"哨兵。 */
const ENTITY_FILTER_ALL = "__all_entities__"
const SUPPLY_SOURCE_ALL = "__all_supply_sources__"
const ACCOUNT_ALL = "__all_accounts__"

const fmt = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [history, setHistory] = useState<AlertHistory[]>([])
  const { data: accounts = [] } = useAccounts()
  const { data: suppliers = [] } = useSuppliers()
  const { data: supplySources = [] } = useSupplySourcesAll()
  const { data: entities = [] } = useEntitiesAll()
  const [ruleStatusData, setRuleStatusData] = useState<RuleStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    name: "",
    supplier_id: "",
    supply_source_id: "",
    /** "" = 不限制(该货源下任意主体)；string(entity.id) = 锁定到该主体 */
    entity_id: "",
    account_id: "",
    threshold_type: "daily_absolute",
    threshold_value: "",
    notify_webhook: "",
    notify_email: "",
    // monthly_budget_multi / yearly_budget_multi 用：勾选的 project external_project_id 列表
    multi_account_ids: [] as number[],
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

  /** 当前选中货源下的主体下拉候选。 */
  const formEntities = useMemo(() => {
    if (!form.supply_source_id) return [] as typeof entities
    const ssid = Number(form.supply_source_id)
    return entities
      .filter((e) => e.supply_source_id === ssid)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"))
  }, [entities, form.supply_source_id])

  const formAccounts = useMemo(() => {
    if (!form.supplier_id) return []
    const allowedSourceIds = new Set(formSources.map((s) => s.id))
    return accounts.filter((a) => {
      if (!allowedSourceIds.has(a.supply_source_id)) return false
      if (form.supply_source_id && a.supply_source_id !== Number(form.supply_source_id)) return false
      // entity_id="" 表示不限制；entity_id=string(id) 表示仅本主体下账号
      if (form.entity_id) {
        const eid = Number(form.entity_id)
        if (a.entity_id !== eid) return false
      }
      return true
    })
  }, [accounts, form.supplier_id, form.supply_source_id, form.entity_id, formSources])

  const resetForm = () =>
    setForm({
      name: "",
      supplier_id: "",
      supply_source_id: "",
      entity_id: "",
      account_id: "",
      threshold_type: "daily_absolute",
      threshold_value: "",
      notify_webhook: "",
      notify_email: "",
      multi_account_ids: [],
    })

  const selectedAccountName = (targetId: string | null) => {
    if (!targetId) return "全局"
    // 多项目模式:逗号分隔的 ID 列表
    if (targetId.includes(",")) {
      const ids = targetId.split(",").map((s) => s.trim()).filter(Boolean)
      const names = ids.map((id) => {
        const a = accounts.find((x) => x.external_project_id === id)
        return a ? a.name : id
      })
      return `${ids.length} 个项目: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` 等` : ""}`
    }
    const a = accounts.find((x) => x.external_project_id === targetId)
    return a ? `${a.name} (${a.external_project_id})` : targetId
  }

  // editingId === null → 添加;否则编辑现有规则
  const [editingId, setEditingId] = useState<number | null>(null)

  const openEditDialog = (rule: AlertRule) => {
    setEditingId(rule.id)
    // 基础字段回填
    const base = {
      name: rule.name,
      threshold_type: rule.threshold_type,
      threshold_value: String(rule.threshold_value ?? ""),
      notify_webhook: rule.notify_webhook ?? "",
      notify_email: rule.notify_email ?? "",
      supplier_id: "",
      supply_source_id: "",
      entity_id: "",
      account_id: "",
      multi_account_ids: [] as number[],
    }
    // 多项目类型(月/年):把逗号分隔的 external_project_id 反查回 account.id 列表
    if (MULTI_PROJECT_TYPES.has(rule.threshold_type) && rule.target_id) {
      const ids = rule.target_id.split(",").map((s) => s.trim()).filter(Boolean)
      base.multi_account_ids = accounts
        .filter((a) => ids.includes(a.external_project_id))
        .map((a) => a.id)
    } else if (rule.target_id) {
      // 单 project:回填四级选择器(供应商 / 货源 / 主体 / 账号)
      const acc = accounts.find((a) => a.external_project_id === rule.target_id)
      if (acc) {
        const ss = supplySources.find((s) => s.id === acc.supply_source_id)
        base.supplier_id = String(ss?.supplier_id ?? "")
        base.supply_source_id = String(acc.supply_source_id)
        base.entity_id = acc.entity_id != null ? String(acc.entity_id) : ""
        base.account_id = String(acc.id)
      }
    }
    setForm(base)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    try {
      setActionLoading("save")
      let target_type = "project"
      let target_id: string | undefined
      if (MULTI_PROJECT_TYPES.has(form.threshold_type)) {
        // 多项目月/年预算合计:target_id = 逗号分隔的 external_project_id
        const picked = accounts.filter((a) => form.multi_account_ids.includes(a.id))
        target_type = "project_group"
        target_id = picked.map((a) => a.external_project_id).join(",") || undefined
      } else if (form.account_id) {
        // 用户明确选了某个账号
        const account = accounts.find((a) => String(a.id) === form.account_id)
        target_id = account?.external_project_id ?? undefined
      } else {
        // 用户未选具体账号 → 用上方"供应商/货源/主体"过滤出的账号集合
        // 1 个 = 等价单账号；多个 = 单类型告警不支持，提示换多项目类型
        if (formAccounts.length === 0) {
          alert("没有匹配的服务账号，请调整供应商 / 货源 / 主体过滤")
          return
        }
        if (formAccounts.length === 1) {
          target_id = formAccounts[0].external_project_id
        } else {
          alert(
            `当前过滤命中 ${formAccounts.length} 个账号；` +
            `「${THRESHOLD_LABELS[form.threshold_type] ?? form.threshold_type}」` +
            "只支持单账号告警。\n\n请：\n" +
            "1) 在「服务账号」下拉里选具体一个，或\n" +
            "2) 把告警类型换成「多项目月预算合计」/「多项目年预算合计」"
          )
          return
        }
      }
      const payload = {
        name: form.name,
        target_type,
        target_id,
        threshold_type: form.threshold_type,
        threshold_value: Number(form.threshold_value),
        notify_webhook: form.notify_webhook || undefined,
        notify_email: form.notify_email || undefined,
      }
      if (editingId === null) {
        await alertsApi.createRule(payload)
      } else {
        await alertsApi.updateRule(editingId, payload)
      }
      setDialogOpen(false)
      resetForm()
      setEditingId(null)
      await load()
    } catch (e) { alert(`${editingId === null ? "创建" : "保存"}失败: ${e instanceof Error ? e.message : e}`) }
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
        <Dialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o)
            if (!o) { resetForm(); setEditingId(null) }
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => { setEditingId(null); resetForm() }}>
              <Plus className="w-4 h-4" />添加规则
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId === null ? "添加告警规则" : "编辑告警规则"}</DialogTitle>
              <DialogDescription>
                {editingId === null
                  ? "当服务账号费用超出阈值或未达承诺用量时触发告警"
                  : "修改后保存,改动立即生效。多项目类型可在「账号选择」勾选/取消项目以扩缩范围。"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>规则名称</Label><Input placeholder="如：账号A日费用超限" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>

              {MULTI_PROJECT_TYPES.has(form.threshold_type) ? (
                /* 多项目模式:勾选多个账号(可跨供应商)。每行带主体名便于辨别。 */
                <div className="space-y-2">
                  <Label>服务账号(多选)</Label>
                  <div className="rounded-md border border-border max-h-56 overflow-y-auto p-2 space-y-1 bg-background/50">
                    {accounts.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-2">暂无可选账号</p>
                    ) : (
                      accounts.map((a) => {
                        const checked = form.multi_account_ids.includes(a.id)
                        return (
                          <label
                            key={a.id}
                            className="flex items-center gap-2 p-1.5 rounded hover:bg-accent/50 cursor-pointer text-sm"
                          >
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={checked}
                              onChange={() => {
                                setForm((f) => ({
                                  ...f,
                                  multi_account_ids: checked
                                    ? f.multi_account_ids.filter((x) => x !== a.id)
                                    : [...f.multi_account_ids, a.id],
                                }))
                              }}
                            />
                            <img src={`/${a.provider}.svg`} alt={a.provider} className="w-4 h-4 shrink-0" />
                            <span className="truncate">{a.name}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              ({a.external_project_id}) · {a.supplier_name}
                              <span className={cn("ml-1", a.entity_name ? "" : "italic")}>
                                · {a.entity_name ?? "未分配主体"}
                              </span>
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    已选 <span className="text-foreground font-medium">{form.multi_account_ids.length}</span> 个账号 ·
                    {form.threshold_type === "yearly_budget_multi"
                      ? "本年这些账号的费用合计 ≥ 阈值时触发告警。"
                      : "本月这些账号的费用合计 ≥ 阈值时触发告警。"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2"><Label>服务账号</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <Select
                      value={form.supplier_id}
                      onValueChange={(v) => setForm({ ...form, supplier_id: v, supply_source_id: "", entity_id: "", account_id: "" })}
                    >
                      <SelectTrigger><SelectValue placeholder="供应商" /></SelectTrigger>
                      <SelectContent>
                        {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={form.supply_source_id || SUPPLY_SOURCE_ALL}
                      onValueChange={(v) => setForm({ ...form, supply_source_id: v === SUPPLY_SOURCE_ALL ? "" : v, entity_id: "", account_id: "" })}
                      disabled={!form.supplier_id}
                    >
                      <SelectTrigger><SelectValue placeholder="货源" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SUPPLY_SOURCE_ALL}>全部货源</SelectItem>
                        {formSources.map((src) => (
                          <SelectItem key={src.id} value={String(src.id)}>
                            {PROVIDER_LABELS[src.provider] ?? src.provider.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={form.entity_id || ENTITY_FILTER_ALL}
                      onValueChange={(v) => setForm({ ...form, entity_id: v === ENTITY_FILTER_ALL ? "" : v, account_id: "" })}
                      disabled={!form.supplier_id}
                    >
                      <SelectTrigger><SelectValue placeholder="主体" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ENTITY_FILTER_ALL}>全部主体</SelectItem>
                        {formEntities.map((ent) => (
                          <SelectItem key={ent.id} value={String(ent.id)}>{ent.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={form.account_id || ACCOUNT_ALL}
                      onValueChange={(v) => setForm({ ...form, account_id: v === ACCOUNT_ALL ? "" : v })}
                      disabled={!form.supplier_id}
                    >
                      <SelectTrigger><SelectValue placeholder="服务账号" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ACCOUNT_ALL}>全部服务账号 ({formAccounts.length})</SelectItem>
                        {formAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.name}{" "}
                            <span className="text-xs text-muted-foreground">({a.external_project_id})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.threshold_type === "account_lifetime_quota" && (
                    <p className="text-xs text-muted-foreground">
                      该账号生命周期累计费用 ≥ 配额 × {ACCOUNT_QUOTA_TRIGGER_PCT}% 时触发告警(从账号创建到现在的全部费用 SUM)。
                    </p>
                  )}
                  {/* 当未指定具体账号时，提示用户匹配到几个账号；超过 1 时只有多项目类告警可保存 */}
                  {form.supplier_id && !form.account_id && (
                    <p className="text-xs text-muted-foreground">
                      未指定服务账号，将命中{" "}
                      <span className="text-foreground font-medium">{formAccounts.length}</span>{" "}
                      个匹配账号（按上方供应商 / 货源 / 主体过滤）。
                      {formAccounts.length > 1 && (
                        <span className="ml-1 text-amber-400/80">
                          请把告警类型换成「多项目月/年预算合计」，或在「服务账号」里选具体一个。
                        </span>
                      )}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>告警类型</Label>
                  <Select value={form.threshold_type} onValueChange={(v) => setForm({ ...form, threshold_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily_absolute">日费用超限 (USD)</SelectItem>
                      <SelectItem value="monthly_budget">月预算超限 (USD)</SelectItem>
                      <SelectItem value="daily_increase_pct">日增长率超限 (%)</SelectItem>
                      <SelectItem value="monthly_minimum_commitment">月最低承诺用量 (USD)</SelectItem>
                      <SelectItem value="account_lifetime_quota">账号总配额(达 90% 触发)</SelectItem>
                      <SelectItem value="monthly_budget_multi">多项目月预算合计 (USD)</SelectItem>
                      <SelectItem value="yearly_budget_multi">多项目年预算合计 (USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{
                    form.threshold_type === "monthly_minimum_commitment" ? "承诺最低金额" :
                    form.threshold_type === "account_lifetime_quota" ? "总配额上限 (USD)" :
                    form.threshold_type === "monthly_budget_multi" ? "月预算合计 (USD)" :
                    form.threshold_type === "yearly_budget_multi" ? "年预算合计 (USD)" :
                    "阈值"
                  }</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={
                      form.threshold_type === "monthly_minimum_commitment" ? "月最低消费额 (USD)" :
                      form.threshold_type === "account_lifetime_quota" ? "如 1000,累计达 900 美元时告警" :
                      form.threshold_type === "monthly_budget_multi" ? "如 40000,4 个 project 合计月预算" :
                      form.threshold_type === "yearly_budget_multi" ? "如 480000,4 个 project 合计年预算" :
                      ""
                    }
                    value={form.threshold_value}
                    onChange={(e) => setForm({ ...form, threshold_value: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2"><Label>通知邮箱（多个用逗号分隔，可选）</Label><Input placeholder="admin@example.com, ops@example.com" value={form.notify_email} onChange={(e) => setForm({ ...form, notify_email: e.target.value })} /></div>
              <div className="space-y-2"><Label>Webhook 通知地址（可选）</Label><Input placeholder="https://..." value={form.notify_webhook} onChange={(e) => setForm({ ...form, notify_webhook: e.target.value })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); setEditingId(null) }}>取消</Button><Button onClick={handleSave} disabled={
              !form.name ||
              !form.threshold_value ||
              actionLoading === "save" ||
              (MULTI_PROJECT_TYPES.has(form.threshold_type)
                ? form.multi_account_ids.length === 0
                : (
                    !form.supplier_id ||
                    // 全选(account_id == "")：必须命中至少 1 个账号；
                    // 命中 >1 时仅多项目类型可用，单类型由 handleSave 二次校验
                    (!form.account_id && formAccounts.length === 0)
                  ))
            }>
              {actionLoading === "save" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{editingId === null ? "添加" : "保存"}
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
                              {s.provider === "multi"
                                ? <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-foreground/10 text-foreground/70" title="多项目"><Layers className="w-3.5 h-3.5" /></span>
                                : <img src={`/${s.provider}.svg`} alt={s.provider} className="w-5 h-5" />}
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
                              {s.provider === "multi"
                                ? <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-foreground/10 text-foreground/70" title="多项目"><Layers className="w-3.5 h-3.5" /></span>
                                : <img src={`/${s.provider}.svg`} alt={s.provider} className="w-5 h-5" />}
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
                  <TableCell className="text-foreground font-mono">{
                    r.threshold_type === "daily_increase_pct" ? `${r.threshold_value}%` :
                    `$${r.threshold_value}`
                  }</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {[r.notify_email && "邮件", r.notify_webhook && "Webhook"].filter(Boolean).join(" + ") || "—"}
                  </TableCell>
                  <TableCell>{r.is_active ? <Badge variant="secondary" className="bg-green-500/20 text-green-400">启用</Badge> : <Badge variant="secondary">停用</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(r)}>编辑</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggle(r)}>{r.is_active ? "停用" : "启用"}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(r.id)}>删除</DropdownMenuItem>
                      </DropdownMenuContent>
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
