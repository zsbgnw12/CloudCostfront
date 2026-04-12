"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ChevronRight, ChevronDown, FolderOpen, Plus, MoreHorizontal,
  KeyRound, Pause, Play, Trash2, Eye, EyeOff, Pencil,
  Loader2, ArrowLeft, Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { accountsApi, type ServiceAccount, type ServiceAccountDetail, type HistoryItem, type SupplySourceItem } from "@/lib/api"
import { useAccounts, useSupplySourcesAll } from "@/hooks/use-data"
import { cn } from "@/lib/utils"

/* ─── Status helpers ─────────────────────────────────────── */
const STATUS_MAP: Record<string, { label: string; class: string }> = {
  active: { label: "使用中", class: "bg-green-500/20 text-green-400" },
  inactive: { label: "已停用", class: "bg-red-500/20 text-red-400" },
  standby: { label: "备用", class: "bg-blue-500/20 text-blue-400" },
  suspended: { label: "已停用", class: "bg-red-500/20 text-red-400" },
  deleted: { label: "已删除", class: "bg-neutral-500/20 text-neutral-400" },
}
const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure" }
const ACTION_LABELS: Record<string, string> = {
  created: "创建账号",
  suspended: "停用", activated: "启用", deleted: "删除",
}

/** 与后端 suspend/activate 允许的状态一致 */
function canSuspendStatus(s: string) {
  return s === "active" || s === "standby"
}
function canActivateStatus(s: string) {
  return s === "inactive" || s === "standby"
}

/* ─── Tree: 供应商 → 货源(云) → 账号 ───────────────────────── */
interface SupplierTreeNode {
  supplierName: string
  sources: { supplySourceId: number; provider: string; accounts: ServiceAccount[] }[]
}

function buildTree(accounts: ServiceAccount[], sources: SupplySourceItem[]): SupplierTreeNode[] {
  const srcById = new Map(sources.map((s) => [s.id, s]))
  const bySup = new Map<string, Map<number, ServiceAccount[]>>()
  for (const s of sources) {
    const name = s.supplier_name ?? "未知"
    if (!bySup.has(name)) bySup.set(name, new Map())
    if (!bySup.get(name)!.has(s.id)) bySup.get(name)!.set(s.id, [])
  }
  for (const a of accounts) {
    const name = srcById.get(a.supply_source_id)?.supplier_name ?? "未知"
    if (!bySup.has(name)) bySup.set(name, new Map())
    const m = bySup.get(name)!
    if (!m.has(a.supply_source_id)) m.set(a.supply_source_id, [])
    m.get(a.supply_source_id)!.push(a)
  }
  return Array.from(bySup.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplierName, idMap]) => ({
      supplierName,
      sources: Array.from(idMap.entries())
        .map(([supplySourceId, accts]) => ({
          supplySourceId,
          provider: srcById.get(supplySourceId)?.provider ?? "?",
          accounts: accts,
        }))
        .sort((x, y) => x.provider.localeCompare(y.provider)),
    }))
}

export type SelectedSupplySource = {
  supplySourceId: number
  supplierName: string
  provider: string
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function AccountsPage() {
  const { data: accounts = [], mutate: mutateAccounts, isLoading: loading } = useAccounts()
  const { data: sources = [], mutate: mutateSources } = useSupplySourcesAll()
  const [selectedGroup, setSelectedGroup] = useState<SelectedSupplySource | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ServiceAccountDetail | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [showCreds, setShowCreds] = useState(false)
  const [creds, setCreds] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // View mode: "cards" shows account cards for selected group, "detail" shows single account
  const viewMode = selectedId && detail ? "detail" : "cards"

  // Create / edit：供应商、云分两列选择
  const [form, setForm] = useState({
    supplier_id: "",
    supply_source_id: "",
    name: "", external_project_id: "",
    secret_json: "", notes: "",
  })

  const [editForm, setEditForm] = useState({
    supplier_id: "",
    supply_source_id: "",
    name: "", external_project_id: "",
    secret_json: "", notes: "",
  })

  const suppliersOptions = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of sources) {
      m.set(s.supplier_id, s.supplier_name ?? "")
    }
    return Array.from(m.entries()).sort((a, b) => (a[1] || "").localeCompare(b[1] || "", "zh-CN"))
  }, [sources])

  const formSourcesForSupplier = useMemo(() => {
    const arr = sources.filter((s) => String(s.supplier_id) === form.supplier_id)
    return [...arr].sort((a, b) => a.provider.localeCompare(b.provider))
  }, [sources, form.supplier_id])

  const editSourcesForSupplier = useMemo(() => {
    const arr = sources.filter((s) => String(s.supplier_id) === editForm.supplier_id)
    return [...arr].sort((a, b) => a.provider.localeCompare(b.provider))
  }, [sources, editForm.supplier_id])

  const load = useCallback(async () => {
    await Promise.all([mutateAccounts(), mutateSources()])
  }, [mutateAccounts, mutateSources])

  const loadDetail = useCallback(async (id: number) => {
    try { setSelectedId(id); setShowCreds(false); setCreds(null); const d = await accountsApi.get(id); setDetail(d) }
    catch (e) { console.error(e) }
  }, [])

  const tree = useMemo(() => buildTree(accounts, sources), [accounts, sources])

  const groupAccounts = useMemo(() => {
    if (!selectedGroup) return []
    return accounts.filter((a) => a.supply_source_id === selectedGroup.supplySourceId)
  }, [accounts, selectedGroup])

  const handleSelectGroup = (supplierName: string, supplySourceId: number, provider: string) => {
    setSelectedGroup({ supplierName, supplySourceId, provider })
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
  }

  const handleBackToCards = () => {
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
  }

  const formProvider = useMemo(() => {
    const sid = form.supply_source_id ? Number(form.supply_source_id) : null
    if (sid == null || Number.isNaN(sid)) return "aws"
    return sources.find((s) => s.id === sid)?.provider ?? "aws"
  }, [form.supply_source_id, sources])

  const editProvider = useMemo(() => {
    const sid = editForm.supply_source_id ? Number(editForm.supply_source_id) : null
    if (sid == null || Number.isNaN(sid)) return detail?.provider ?? "aws"
    return sources.find((s) => s.id === sid)?.provider ?? detail?.provider ?? "aws"
  }, [editForm.supply_source_id, sources, detail])

  /* ─── Actions ───── */
  const handleCreate = async () => {
    try {
      setActionLoading("create")
      const ssid = Number(form.supply_source_id)
      if (!form.supplier_id || !ssid) {
        alert("请选择供应商与云（货源）")
        return
      }
      let secret_data = {}
      if (form.secret_json.trim()) secret_data = JSON.parse(form.secret_json)
      await accountsApi.create({
        supply_source_id: ssid,
        name: form.name,
        external_project_id: form.external_project_id,
        secret_data, notes: form.notes || undefined,
      })
      setCreateOpen(false)
      setForm({ supplier_id: "", supply_source_id: "", name: "", external_project_id: "", secret_json: "", notes: "" })
      await load()
    } catch (e) { alert(`创建失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleAction = async (action: "suspend" | "activate") => {
    if (!selectedId) return
    const labels = { suspend: "停用", activate: "启用" }
    if (!confirm(`确定${labels[action]}此账号？`)) return
    try {
      setActionLoading(action)
      if (action === "suspend") await accountsApi.suspend(selectedId)
      else if (action === "activate") await accountsApi.activate(selectedId)
      await load(); await loadDetail(selectedId)
    } catch (e) { alert(`操作失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除"${name}"？此操作不可恢复，将从数据库中彻底移除！`)) return
    try {
      setActionLoading("delete")
      await accountsApi.hardDelete(id)
      if (selectedId === id) { setSelectedId(null); setDetail(null) }
      await load()
    } catch (e) { alert(`删除失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }



  const handleShowCreds = async () => {
    if (showCreds) { setShowCreds(false); setCreds(null); return }
    if (!selectedId) return
    try { const c = await accountsApi.credentials(selectedId); setCreds(c); setShowCreds(true) }
    catch (e) { alert(`获取凭证失败: ${e instanceof Error ? e.message : e}`) }
  }

  const openEdit = () => {
    if (!detail) return
    setEditForm({
      supplier_id: String(detail.supplier_id),
      supply_source_id: String(detail.supply_source_id),
      name: detail.name,
      external_project_id: detail.external_project_id,
      secret_json: "",
      notes: detail.notes ?? "",
    })
    setEditOpen(true)
  }

  const handleEdit = async () => {
    if (!selectedId || !detail) return
    try {
      setActionLoading("edit")
      const newSsid = Number(editForm.supply_source_id)
      if (!editForm.supplier_id || !newSsid) {
        alert("请选择供应商与云（货源）")
        return
      }
      const payload: Record<string, unknown> = {
        name: editForm.name,
        external_project_id: editForm.external_project_id,
        notes: editForm.notes || null,
      }
      if (newSsid !== detail.supply_source_id) {
        payload.supply_source_id = newSsid
      }
      if (editForm.secret_json.trim()) {
        payload.secret_data = JSON.parse(editForm.secret_json)
      }
      await accountsApi.update(selectedId, payload as Parameters<typeof accountsApi.update>[1])
      setEditOpen(false)
      await load(); await loadDetail(selectedId)
    } catch (e) { alert(`修改失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* ─── Left: Tree Panel ─── */}
      <div className="w-80 border-r border-border flex flex-col bg-card/50">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">货源列表</h2>
          <div className="flex items-center gap-1">
            <Dialog open={createOpen} onOpenChange={(open) => {
              setCreateOpen(open)
              if (!open) setForm({ supplier_id: "", supply_source_id: "", name: "", external_project_id: "", secret_json: "", notes: "" })
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-7 gap-1 text-xs"><Plus className="w-3.5 h-3.5" />新建货源</Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>新建服务账号</DialogTitle><DialogDescription>先选供应商，再选云；然后填写账号信息</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>供应商</Label>
                    <Select
                      value={form.supplier_id}
                      onValueChange={(v) => setForm({ ...form, supplier_id: v, supply_source_id: "" })}
                    >
                      <SelectTrigger><SelectValue placeholder="选择供应商" /></SelectTrigger>
                      <SelectContent>
                        {suppliersOptions.map(([id, name]) => (
                          <SelectItem key={id} value={String(id)}>{name || `供应商 #${id}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>云</Label>
                    <Select
                      value={form.supply_source_id}
                      onValueChange={(v) => setForm({ ...form, supply_source_id: v })}
                      disabled={!form.supplier_id}
                    >
                      <SelectTrigger><SelectValue placeholder={form.supplier_id ? "选择云" : "请先选供应商"} /></SelectTrigger>
                      <SelectContent>
                        {formSourcesForSupplier.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {PROVIDER_LABELS[s.provider] ?? s.provider.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {sources.length === 0 && (
                  <p className="text-xs text-muted-foreground">请先在「供应商管理」中创建供应商并添加货源。</p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>账号名称</Label><Input placeholder="账号显示名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="space-y-2">
                    <Label>账号ID</Label>
                    <Input
                      placeholder={formProvider === "aws" ? "AWS Account ID" : formProvider === "gcp" ? "GCP Project ID" : "Azure Subscription ID"}
                      value={form.external_project_id}
                      onChange={(e) => setForm({ ...form, external_project_id: e.target.value })}
                    />
                    {formProvider === "azure" && (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Azure 的<strong>订阅 ID（Subscription ID）</strong>填在本字段；下方密钥区只需租户 ID、Client ID、Client Secret，无需再填 subscription_id。
                      </p>
                    )}
                  </div>
                </div>
                <SecretFieldsInput provider={formProvider} value={form.secret_json} onChange={(v) => setForm({ ...form, secret_json: v })} />
                <div className="space-y-2"><Label>备注</Label><Input placeholder="可选" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button onClick={handleCreate} disabled={!form.supplier_id || !form.supply_source_id || !form.name || !form.external_project_id || actionLoading === "create"}>
                  {actionLoading === "create" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {loading ? <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
            : tree.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">暂无账号</p>
            : tree.map((node) => (
                <SupplierNode
                  key={node.supplierName}
                  node={node}
                  selectedGroup={selectedGroup}
                  onSelectGroup={handleSelectGroup}
                />
              ))}
          </div>
        </ScrollArea>
      </div>

      {/* ─── Right Panel ─── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedGroup ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center"><FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>选择左侧供应商查看货源</p></div>
          </div>
        ) : viewMode === "detail" && detail ? (
          /* ─── Detail View ─── */
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={handleBackToCards}><ArrowLeft className="w-5 h-5" /></Button>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <img src={`/${detail.provider}.svg`} alt={detail.provider} className="w-10 h-10" />
                  <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-xl font-semibold text-foreground">{detail.name}</h1>
                      <Badge variant="secondary" className={STATUS_MAP[detail.status]?.class ?? ""}>{STATUS_MAP[detail.status]?.label ?? detail.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{detail.external_project_id}{detail.supplier_name && <> · {detail.supplier_name}</>}</p>
                  </div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="icon"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openEdit} disabled={!!actionLoading}><Pencil className="w-4 h-4 mr-2" />编辑</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {canActivateStatus(detail.status) && (
                    <DropdownMenuItem onClick={() => handleAction("activate")} disabled={!!actionLoading}>
                      <Play className="w-4 h-4 mr-2" />启用
                    </DropdownMenuItem>
                  )}
                  {canSuspendStatus(detail.status) && (
                    <DropdownMenuItem onClick={() => handleAction("suspend")} disabled={!!actionLoading}>
                      <Pause className="w-4 h-4 mr-2" />停用
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.preventDefault()
                      handleDelete(detail.id, detail.name)
                    }}
                    disabled={!!actionLoading}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">状态</p><div className="mt-2"><Badge variant="secondary" className={cn("text-sm", STATUS_MAP[detail.status]?.class ?? "")}>{STATUS_MAP[detail.status]?.label ?? detail.status}</Badge></div></CardContent></Card>
              <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">创建时间</p><p className="text-sm font-medium mt-1">{new Date(detail.created_at).toLocaleDateString("zh-CN")}</p></CardContent></Card>
              <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">所属供应商</p><p className="text-sm font-medium mt-1">{detail.supplier_name ?? "—"}</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm font-medium">凭证信息</CardTitle><Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleShowCreds}>{showCreds ? <><EyeOff className="w-3.5 h-3.5" />隐藏</> : <><Eye className="w-3.5 h-3.5" />查看</>}</Button></div></CardHeader>
                <CardContent>{showCreds && creds ? <pre className="text-xs font-mono bg-secondary p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">{JSON.stringify(creds, null, 2)}</pre> : <div className="flex flex-wrap gap-2">{detail.secret_fields.length > 0 ? detail.secret_fields.map((f) => <Badge key={f} variant="secondary" className="font-mono text-xs">{f}</Badge>) : <span className="text-sm text-muted-foreground">未配置凭证</span>}</div>}</CardContent>
              </Card>
              <Card className="bg-card border-border"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">备注</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{detail.notes || "暂无备注"}</p></CardContent></Card>
            </div>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">状态历史</CardTitle></CardHeader>
              <CardContent>
                {detail.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无记录</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                    <div className="space-y-4">
                      {detail.history.map((h) => (
                        <div key={h.id} className="relative pl-8">
                          <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{ACTION_LABELS[h.action] ?? h.action}</span>
                              {h.to_status && <Badge variant="secondary" className={cn("text-xs", STATUS_MAP[h.to_status]?.class ?? "")}>{STATUS_MAP[h.to_status]?.label ?? h.to_status}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{new Date(h.created_at).toLocaleString("zh-CN")}</p>
                            {h.notes && <p className="text-xs text-muted-foreground mt-1">{h.notes}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>编辑服务账号</DialogTitle>
                  <DialogDescription>可更换供应商与云（货源）；留空密钥则不更新</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>供应商</Label>
                      <Select
                        value={editForm.supplier_id}
                        onValueChange={(v) => setEditForm({ ...editForm, supplier_id: v, supply_source_id: "" })}
                      >
                        <SelectTrigger><SelectValue placeholder="选择供应商" /></SelectTrigger>
                        <SelectContent>
                          {suppliersOptions.map(([id, name]) => (
                            <SelectItem key={id} value={String(id)}>{name || `供应商 #${id}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>云</Label>
                      <Select
                        value={editForm.supply_source_id}
                        onValueChange={(v) => setEditForm({ ...editForm, supply_source_id: v })}
                        disabled={!editForm.supplier_id}
                      >
                        <SelectTrigger><SelectValue placeholder={editForm.supplier_id ? "选择云" : "请先选供应商"} /></SelectTrigger>
                        <SelectContent>
                          {editSourcesForSupplier.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {PROVIDER_LABELS[s.provider] ?? s.provider.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2"><Label>账号名称</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>账号ID</Label><Input value={editForm.external_project_id} onChange={(e) => setEditForm({ ...editForm, external_project_id: e.target.value })} /></div>
                  <SecretFieldsInput provider={editProvider} value={editForm.secret_json} onChange={(v) => setEditForm({ ...editForm, secret_json: v })} label="更新密钥信息（留空不更新）" />
                  <div className="space-y-2"><Label>备注</Label><Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
                  <Button
                    onClick={handleEdit}
                    disabled={!editForm.supplier_id || !editForm.supply_source_id || !editForm.name || !editForm.external_project_id || actionLoading === "edit"}
                  >
                    {actionLoading === "edit" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}保存
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          /* ─── Cards Grid View ─── */
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="flex items-start gap-2">
                  <img src={`/${selectedGroup.provider}.svg`} alt={selectedGroup.provider} className="w-6 h-6 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-lg font-semibold text-foreground leading-tight">{selectedGroup.supplierName}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{PROVIDER_LABELS[selectedGroup.provider] ?? selectedGroup.provider.toUpperCase()}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">{groupAccounts.length} 个服务账号</p>
              </div>
            </div>
            {groupAccounts.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground"><div className="text-center"><KeyRound className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>该云货源下暂无服务账号</p></div></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {groupAccounts.map((a) => (
                  <Card key={a.id} className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => loadDetail(a.id)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <img src={`/${a.provider}.svg`} alt={a.provider} className="w-9 h-9 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{a.external_project_id}</p>
                          </div>
                        </div>
                        <Badge variant="secondary" className={cn("text-[10px] shrink-0 ml-2", STATUS_MAP[a.status]?.class ?? "")}>{STATUS_MAP[a.status]?.label ?? a.status}</Badge>
                      </div>
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between text-xs mt-1.5">
                        <span className="text-muted-foreground">创建</span>
                        <span className="text-foreground">{new Date(a.created_at).toLocaleDateString("zh-CN")}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Provider-specific Secret Fields ──────────────────────── */

const SECRET_TEMPLATES: Record<string, { label: string; key: string; placeholder: string }[]> = {
  aws: [
    { label: "Access Key ID", key: "access_key_id", placeholder: "AKIA..." },
    { label: "Secret Access Key", key: "secret_access_key", placeholder: "wJal..." },
  ],
  gcp: [
    { label: "Service Account JSON", key: "__json__", placeholder: '粘贴完整的 GCP Service Account JSON 密钥文件内容' },
  ],
  azure: [
    { label: "Tenant ID", key: "tenant_id", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    { label: "Client ID", key: "client_id", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    { label: "Client Secret", key: "client_secret", placeholder: "xxxxxxxxxxxxx" },
  ],
}

function SecretFieldsInput({ provider, value, onChange, label }: { provider: string; value: string; onChange: (v: string) => void; label?: string }) {
  const fields = SECRET_TEMPLATES[provider.toLowerCase()]
  const [mode, setMode] = useState<"fields" | "json">("fields")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  // Parse existing JSON value to field values when switching to fields mode
  useEffect(() => {
    if (value.trim()) {
      try {
        const parsed = JSON.parse(value)
        if (typeof parsed === "object") setFieldValues(parsed)
      } catch {}
    }
  }, []) // only on mount

  const updateField = (key: string, val: string) => {
    const next = { ...fieldValues, [key]: val }
    setFieldValues(next)
    // Build JSON from all non-empty fields
    const filtered = Object.fromEntries(Object.entries(next).filter(([, v]) => v.trim()))
    onChange(Object.keys(filtered).length > 0 ? JSON.stringify(filtered, null, 2) : "")
  }

  if (!fields) {
    return (
      <div className="space-y-2">
        <Label>{label ?? "密钥信息 (JSON)"}</Label>
        <Textarea placeholder="{}" rows={4} className="font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    )
  }

  // GCP special: single JSON blob field
  const isJsonBlob = fields.length === 1 && fields[0].key === "__json__"

  return (
    <div className="space-y-2">
      {provider.toLowerCase() === "azure" && !label && (
        <p className="text-[11px] text-muted-foreground">
          与「账号ID」中的订阅 ID 配合使用；若改用 JSON 模式，可将 <code className="text-xs">subscription_id</code> 一并写入（可选，与账号ID一致即可）。
        </p>
      )}
      <div className="flex items-center justify-between">
        <Label>{label ?? "密钥信息"}</Label>
        {!isJsonBlob && (
          <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setMode(mode === "fields" ? "json" : "fields")}>
            {mode === "fields" ? "切换JSON" : "切换字段"}
          </Button>
        )}
      </div>
      {isJsonBlob || mode === "json" ? (
        <Textarea
          placeholder={isJsonBlob ? fields[0].placeholder : '{"key": "value"}'}
          rows={isJsonBlob ? 6 : 4}
          className="font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="space-y-2 p-3 rounded-lg bg-secondary/50 border border-border">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <Input
                className="font-mono text-xs h-8"
                placeholder={f.placeholder}
                type={f.key.toLowerCase().includes("secret") || f.key.toLowerCase().includes("key") ? "password" : "text"}
                value={fieldValues[f.key] ?? ""}
                onChange={(e) => updateField(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Tree Components ──────────────────────────────────────── */

interface TreeCallbacks {
  selectedGroup: SelectedSupplySource | null
  onSelectGroup: (supplierName: string, supplySourceId: number, provider: string) => void
}

function SupplierNode({ node, selectedGroup, onSelectGroup }: { node: SupplierTreeNode } & TreeCallbacks) {
  const [open, setOpen] = useState(true)
  const total = node.sources.reduce((s, x) => s + x.accounts.length, 0)
  return (
    <div className="mb-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-accent text-sm font-semibold text-foreground">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Building2 className="w-4 h-4 text-muted-foreground" />
        <span className="truncate">{node.supplierName}</span>
        <Badge variant="secondary" className="ml-auto text-xs shrink-0">{total}</Badge>
      </button>
      {open && node.sources.map((src) => (
        <SourceNode
          key={src.supplySourceId}
          supplierName={node.supplierName}
          src={src}
          selectedGroup={selectedGroup}
          onSelectGroup={onSelectGroup}
        />
      ))}
    </div>
  )
}

function SourceNode({
  supplierName,
  src,
  selectedGroup,
  onSelectGroup,
}: {
  supplierName: string
  src: { supplySourceId: number; provider: string; accounts: ServiceAccount[] }
} & TreeCallbacks) {
  const isSelected = selectedGroup?.supplySourceId === src.supplySourceId
  const pl = PROVIDER_LABELS[src.provider] ?? src.provider.toUpperCase()
  return (
    <div className="ml-4">
      <button
        type="button"
        onClick={() => onSelectGroup(supplierName, src.supplySourceId, src.provider)}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1 rounded text-sm",
          isSelected ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-accent",
        )}
      >
        <img src={`/${src.provider}.svg`} alt={src.provider} className="w-3.5 h-3.5" />
        <FolderOpen className="w-3.5 h-3.5" />
        <span>{pl}</span>
        <span className="ml-auto text-xs">{src.accounts.length}</span>
      </button>
    </div>
  )
}
