"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ChevronRight, ChevronDown, FolderOpen, Folder, Plus, MoreHorizontal,
  KeyRound, Pause, Play, Trash2, Eye, EyeOff, Pencil,
  Check, X, Loader2, ArrowLeft,
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
import { accountsApi, type ServiceAccount, type ServiceAccountDetail, type HistoryItem, type GroupItem } from "@/lib/api"
import { useAccounts, useGroups } from "@/hooks/use-data"
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

/* ─── Tree types ─────────────────────────────────────────── */
interface TreeNode { provider: string; groups: { label: string; accounts: ServiceAccount[] }[] }

function buildTree(accounts: ServiceAccount[], groups: GroupItem[]): TreeNode[] {
  const map = new Map<string, Map<string, ServiceAccount[]>>()

  // Seed empty groups from API
  for (const g of groups) {
    const p = g.provider.toLowerCase()
    if (!map.has(p)) map.set(p, new Map())
    if (!map.get(p)!.has(g.label)) map.get(p)!.set(g.label, [])
  }

  for (const a of accounts) {
    const p = a.provider.toLowerCase()
    if (!map.has(p)) map.set(p, new Map())
    const g = a.group_label ?? "(未分组)"
    if (!map.get(p)!.has(g)) map.get(p)!.set(g, [])
    map.get(p)!.get(g)!.push(a)
  }
  const order = ["aws", "gcp", "azure"]
  return order.filter((p) => map.has(p)).map((p) => ({
    provider: p,
    groups: Array.from(map.get(p)!.entries()).map(([label, accts]) => ({ label, accounts: accts })),
  }))
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function AccountsPage() {
  const { data: accounts = [], mutate: mutateAccounts, isLoading: loading } = useAccounts()
  const { data: groups = [], mutate: mutateGroups } = useGroups()
  const [selectedGroup, setSelectedGroup] = useState<{ provider: string; label: string } | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ServiceAccountDetail | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [showCreds, setShowCreds] = useState(false)
  const [creds, setCreds] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ provider: "aws", label: "" })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // View mode: "cards" shows account cards for selected group, "detail" shows single account
  const viewMode = selectedId && detail ? "detail" : "cards"

  // Create form
  const [form, setForm] = useState({
    name: "", provider: "aws", group_label: "", external_project_id: "",
    secret_json: "", notes: "",
  })

  // Edit form
  const [editForm, setEditForm] = useState({
    name: "", group_label: "", external_project_id: "",
    secret_json: "", notes: "",
  })

  const load = useCallback(async () => {
    await Promise.all([mutateAccounts(), mutateGroups()])
  }, [mutateAccounts, mutateGroups])

  const loadDetail = useCallback(async (id: number) => {
    try { setSelectedId(id); setShowCreds(false); setCreds(null); const d = await accountsApi.get(id); setDetail(d) }
    catch (e) { console.error(e) }
  }, [])

  const tree = useMemo(() => buildTree(accounts, groups), [accounts, groups])

  // Accounts in the currently selected group
  const groupAccounts = useMemo(() => {
    if (!selectedGroup) return []
    return accounts.filter((a) => {
      const label = a.group_label ?? "(未分组)"
      return a.provider === selectedGroup.provider && label === selectedGroup.label
    })
  }, [accounts, selectedGroup])

  const handleSelectGroup = (provider: string, label: string) => {
    setSelectedGroup({ provider, label })
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
  }

  const handleBackToCards = () => {
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
  }

  // Available groups filtered by provider (for selects)
  const groupsForProvider = useCallback((provider: string) => {
    const fromAccounts = new Set(accounts.filter(a => a.provider === provider && a.group_label).map(a => a.group_label!))
    const fromApi = groups.filter(g => g.provider === provider).map(g => g.label)
    return [...new Set([...fromAccounts, ...fromApi])].sort()
  }, [accounts, groups])

  /* ─── Actions ───── */
  const handleCreate = async () => {
    try {
      setActionLoading("create")
      let secret_data = {}
      if (form.secret_json.trim()) secret_data = JSON.parse(form.secret_json)
      await accountsApi.create({
        name: form.name, provider: form.provider,
        group_label: form.group_label || undefined,
        external_project_id: form.external_project_id,
        secret_data, notes: form.notes || undefined,
      })
      setCreateOpen(false)
      setForm({ name: "", provider: "aws", group_label: "", external_project_id: "", secret_json: "", notes: "" })
      await load()
    } catch (e) { alert(`创建失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleAction = async (action: "suspend" | "activate" | "delete") => {
    if (!selectedId) return
    const labels = { suspend: "停用", activate: "启用", delete: "删除" }
    if (!confirm(`确定${labels[action]}此账号？`)) return
    try {
      setActionLoading(action)
      if (action === "suspend") await accountsApi.suspend(selectedId)
      else if (action === "activate") await accountsApi.activate(selectedId)
      else if (action === "delete") await accountsApi.delete(selectedId)
      await load(); await loadDetail(selectedId)
    } catch (e) { alert(`操作失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleHardDelete = async (id: number, name: string) => {
    if (!confirm(`确定永久删除"${name}"？此操作不可恢复，将从数据库中彻底移除！`)) return
    try {
      setActionLoading("hardDelete")
      await accountsApi.hardDelete(id)
      if (selectedId === id) { setSelectedId(null); setDetail(null) }
      await load()
    } catch (e) { alert(`删除失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleRenameGroup = async (provider: string, oldLabel: string, newLabel: string) => {
    try {
      await accountsApi.renameGroup(provider, oldLabel, newLabel)
      await load()
    } catch (e) { alert(`重命名失败: ${e instanceof Error ? e.message : e}`) }
  }

  const handleCreateGroup = async () => {
    if (!newGroup.label.trim()) return
    try {
      setActionLoading("createGroup")
      await accountsApi.createGroup(newGroup.provider, newGroup.label.trim())
      setCreateGroupOpen(false)
      setNewGroup({ provider: "aws", label: "" })
      await mutateGroups()
    } catch (e) { alert(`创建分组失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleDeleteGroup = async (provider: string, label: string) => {
    if (!confirm(`确定删除分组"${label}"？分组下不能有账号。`)) return
    try {
      await accountsApi.deleteGroup(provider, label)
      await mutateGroups()
    } catch (e) { alert(`删除分组失败: ${e instanceof Error ? e.message : e}`) }
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
      name: detail.name,
      group_label: detail.group_label ?? "",
      external_project_id: detail.external_project_id,
      secret_json: "",
      notes: detail.notes ?? "",
    })
    setEditOpen(true)
  }

  const handleEdit = async () => {
    if (!selectedId) return
    try {
      setActionLoading("edit")
      const payload: Record<string, unknown> = {
        name: editForm.name,
        group_label: editForm.group_label || null,
        external_project_id: editForm.external_project_id,
        notes: editForm.notes || null,
      }
      if (editForm.secret_json.trim()) {
        payload.secret_data = JSON.parse(editForm.secret_json)
      }
      await accountsApi.update(selectedId, payload as any)
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
          <h2 className="text-sm font-semibold text-foreground">服务账号</h2>
          <div className="flex items-center gap-1">
            {/* Create Group Dialog */}
            <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"><FolderOpen className="w-3.5 h-3.5" />新建分组</Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>新建分组（渠道/供应商）</DialogTitle><DialogDescription>先创建分组，再在分组下添加服务账号</DialogDescription></DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2"><Label>云厂商</Label>
                    <Select value={newGroup.provider} onValueChange={(v) => setNewGroup({ ...newGroup, provider: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="aws">AWS</SelectItem><SelectItem value="gcp">GCP</SelectItem><SelectItem value="azure">Azure</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>分组名称（渠道/供应商）</Label><Input placeholder="如：渠道A、合作伙伴B" value={newGroup.label} onChange={(e) => setNewGroup({ ...newGroup, label: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateGroupOpen(false)}>取消</Button>
                  <Button onClick={handleCreateGroup} disabled={!newGroup.label.trim() || actionLoading === "createGroup"}>
                    {actionLoading === "createGroup" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* Create Account Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-7 gap-1 text-xs"><Plus className="w-3.5 h-3.5" />新建账号</Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>新建服务账号</DialogTitle><DialogDescription>在对应云厂商/合作伙伴下创建服务账号</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>云厂商</Label>
                    <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="aws">AWS</SelectItem><SelectItem value="gcp">GCP</SelectItem><SelectItem value="azure">Azure</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>所属分组（渠道/供应商）</Label>
                    <Select value={form.group_label} onValueChange={(v) => setForm({ ...form, group_label: v })}>
                      <SelectTrigger><SelectValue placeholder="选择分组" /></SelectTrigger>
                      <SelectContent>
                        {groupsForProvider(form.provider).map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>账号名称</Label><Input placeholder="账号显示名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>账号ID</Label><Input placeholder={form.provider === "aws" ? "AWS Account ID" : form.provider === "gcp" ? "GCP Project ID" : "Azure Subscription ID"} value={form.external_project_id} onChange={(e) => setForm({ ...form, external_project_id: e.target.value })} /></div>
                </div>
                {/* Provider-specific secret fields */}
                <SecretFieldsInput provider={form.provider} value={form.secret_json} onChange={(v) => setForm({ ...form, secret_json: v })} />
                <div className="space-y-2"><Label>备注</Label><Input placeholder="可选" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button onClick={handleCreate} disabled={!form.name || !form.external_project_id || actionLoading === "create"}>
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
            : tree.map((node) => <ProviderNode key={node.provider} node={node} selectedGroup={selectedGroup} onSelectGroup={handleSelectGroup} onRenameGroup={handleRenameGroup} onDeleteGroup={handleDeleteGroup} />)}
          </div>
        </ScrollArea>
      </div>

      {/* ─── Right Panel ─── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedGroup ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center"><FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>选择左侧分组查看服务账号</p></div>
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
                    <p className="text-sm text-muted-foreground">{detail.external_project_id}{detail.group_label && <> · {detail.group_label}</>}</p>
                  </div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="icon"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openEdit}><Pencil className="w-4 h-4 mr-2" />编辑</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {detail.status === "active" && <DropdownMenuItem onClick={() => handleAction("suspend")}><Pause className="w-4 h-4 mr-2" />停用</DropdownMenuItem>}
                  {detail.status !== "active" && <DropdownMenuItem onClick={() => handleAction("activate")}><Play className="w-4 h-4 mr-2" />启用</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => handleAction("delete")}><Trash2 className="w-4 h-4 mr-2" />删除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">状态</p><div className="mt-2"><Badge variant="secondary" className={cn("text-sm", STATUS_MAP[detail.status]?.class ?? "")}>{STATUS_MAP[detail.status]?.label ?? detail.status}</Badge></div></CardContent></Card>
              <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">创建时间</p><p className="text-sm font-medium mt-1">{new Date(detail.created_at).toLocaleDateString("zh-CN")}</p></CardContent></Card>
              <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">分组</p><p className="text-sm font-medium mt-1">{detail.group_label ?? "—"}</p></CardContent></Card>
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
            
            <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>编辑服务账号</DialogTitle><DialogDescription>修改账号信息，留空密钥则不更新</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>账号名称</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div><div className="space-y-2"><Label>所属分组（渠道/供应商）</Label><Select value={editForm.group_label} onValueChange={(v) => setEditForm({ ...editForm, group_label: v })}><SelectTrigger><SelectValue placeholder="选择分组" /></SelectTrigger><SelectContent>{groupsForProvider(detail?.provider ?? "aws").map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></div></div><div className="space-y-2"><Label>账号ID</Label><Input value={editForm.external_project_id} onChange={(e) => setEditForm({ ...editForm, external_project_id: e.target.value })} /></div><SecretFieldsInput provider={detail?.provider ?? "aws"} value={editForm.secret_json} onChange={(v) => setEditForm({ ...editForm, secret_json: v })} label="更新密钥信息（留空不更新）" /><div className="space-y-2"><Label>备注</Label><Input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button><Button onClick={handleEdit} disabled={!editForm.name || !editForm.external_project_id || actionLoading === "edit"}>{actionLoading === "edit" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}保存</Button></DialogFooter></DialogContent></Dialog>
          </div>
        ) : (
          /* ─── Cards Grid View ─── */
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><img src={`/${selectedGroup.provider}.svg`} alt={selectedGroup.provider} className="w-6 h-6" />{PROVIDER_LABELS[selectedGroup.provider] ?? selectedGroup.provider.toUpperCase()} / {selectedGroup.label}</h2>
                <p className="text-sm text-muted-foreground mt-1">{groupAccounts.length} 个服务账号</p>
              </div>
            </div>
            {groupAccounts.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground"><div className="text-center"><KeyRound className="w-12 h-12 mx-auto mb-4 opacity-30" /><p>该分组下暂无服务账号</p></div></div>
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
  selectedGroup: { provider: string; label: string } | null
  onSelectGroup: (provider: string, label: string) => void
  onRenameGroup: (provider: string, oldLabel: string, newLabel: string) => void
  onDeleteGroup: (provider: string, label: string) => void
}

function ProviderNode({ node, selectedGroup, onSelectGroup, onRenameGroup, onDeleteGroup }: { node: TreeNode } & TreeCallbacks) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-1">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-accent text-sm font-semibold text-foreground">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <img src={`/${node.provider}.svg`} alt={node.provider} className="w-4 h-4" />
        <span>{PROVIDER_LABELS[node.provider] ?? node.provider.toUpperCase()}</span>
        <Badge variant="secondary" className="ml-auto text-xs">{node.groups.reduce((s, g) => s + g.accounts.length, 0)}</Badge>
      </button>
      {open && node.groups.map((g) => (
        <GroupNode key={g.label} group={g} provider={node.provider} selectedGroup={selectedGroup} onSelectGroup={onSelectGroup} onRenameGroup={onRenameGroup} onDeleteGroup={onDeleteGroup} />
      ))}
    </div>
  )
}

function GroupNode({ group, provider, selectedGroup, onSelectGroup, onRenameGroup, onDeleteGroup }: {
  group: { label: string; accounts: ServiceAccount[] }; provider: string
} & TreeCallbacks) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(group.label)
  const isSelected = selectedGroup?.provider === provider && selectedGroup?.label === group.label

  const handleRenameSubmit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== group.label) {
      onRenameGroup(provider, group.label, trimmed)
    }
    setEditing(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleRenameSubmit()
    if (e.key === "Escape") { setEditing(false); setEditValue(group.label) }
  }

  return (
    <div className="ml-4">
      <div className="flex items-center group">
        {editing ? (
          <div className="flex items-center gap-1 w-full px-2 py-1">
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <Input
              className="h-6 text-sm px-1 py-0 flex-1"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameSubmit}
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleRenameSubmit}><Check className="w-3 h-3" /></Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setEditing(false); setEditValue(group.label) }}><X className="w-3 h-3" /></Button>
          </div>
        ) : (
          <>
            <button onClick={() => onSelectGroup(provider, group.label)} className={cn("flex items-center gap-2 flex-1 px-2 py-1 rounded text-sm", isSelected ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-accent")}>
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{group.label}</span>
              <span className="ml-auto text-xs">{group.accounts.length}</span>
            </button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={() => { setEditValue(group.label); setEditing(true) }}
            >
              <Pencil className="w-3 h-3" />
            </Button>
            {group.accounts.length === 0 && (
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-destructive hover:text-destructive"
                onClick={() => onDeleteGroup(provider, group.label)}
                title="删除空分组"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
