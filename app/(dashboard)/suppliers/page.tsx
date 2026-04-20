"use client"

import { useState, useMemo } from "react"
import {
  Plus, Pencil, Trash2, Check, X, Loader2,
  Building2, Search, Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { suppliersApi, type SupplySourceItem, type SupplierRow } from "@/lib/api"
import useSWR from "swr"

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure", taiji: "Taiji" }
const PROVIDER_ORDER = ["aws", "gcp", "azure", "taiji"]

/** 与后端 RESERVED_UNASSIGNED_SUPPLIER_NAME 一致：GCP 未分配项目默认挂靠，不可改名/删除 */
const RESERVED_UNASSIGNED_SUPPLIER_NAME = "未分配资源组"

export default function SuppliersPage() {
  const { data: suppliers = [], mutate: mutateSuppliers } = useSWR<SupplierRow[]>(
    "suppliers-list",
    () => suppliersApi.list(),
  )
  const { data: sources = [], mutate: mutateSources } = useSWR<SupplySourceItem[]>(
    "supply-sources-all",
    () => suppliersApi.listAllSupplySources(),
  )

  const [createSupplierOpen, setCreateSupplierOpen] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState("")
  const [addSourceOpen, setAddSourceOpen] = useState<number | null>(null)
  const [newSourceProvider, setNewSourceProvider] = useState("gcp")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const sourcesBySupplier = useMemo(() => {
    const m = new Map<number, SupplySourceItem[]>()
    for (const s of sources) {
      if (!m.has(s.supplier_id)) m.set(s.supplier_id, [])
      m.get(s.supplier_id)!.push(s)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.provider.localeCompare(b.provider))
    }
    return m
  }, [sources])

  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) => s.name.toLowerCase().includes(q))
  }, [suppliers, searchQuery])

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) return
    if (newSupplierName.trim() === RESERVED_UNASSIGNED_SUPPLIER_NAME) {
      alert(`「${RESERVED_UNASSIGNED_SUPPLIER_NAME}」为系统保留名称，请使用其他名称`)
      return
    }
    try {
      setActionLoading("create-supplier")
      await suppliersApi.create(newSupplierName.trim())
      setCreateSupplierOpen(false)
      setNewSupplierName("")
      await mutateSuppliers()
    } catch (e) {
      alert(`创建失败: ${e instanceof Error ? e.message : e}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleAddSource = async (supplierId: number) => {
    try {
      setActionLoading(`source-${supplierId}`)
      await suppliersApi.createSupplySource(supplierId, newSourceProvider)
      setAddSourceOpen(null)
      setNewSourceProvider("gcp")
      await mutateSources()
    } catch (e) {
      alert(`添加货源失败: ${e instanceof Error ? e.message : e}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteSource = async (ss: SupplySourceItem) => {
    if (!confirm(`删除货源「${ss.supplier_name} · ${PROVIDER_LABELS[ss.provider] ?? ss.provider}」？仅当无服务账号时可删。`)) return
    try {
      await suppliersApi.deleteSupplySource(ss.id)
      await mutateSources()
    } catch (e) {
      alert(`删除失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleRenameSupplier = async (id: number) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      try {
        await suppliersApi.update(id, trimmed)
        await mutateSuppliers()
        await mutateSources()
      } catch (e) {
        alert(`重命名失败: ${e instanceof Error ? e.message : e}`)
      }
    }
    setEditingId(null)
  }

  const handleDeleteSupplier = async (su: SupplierRow) => {
    if (!confirm(`确定删除供应商「${su.name}」？须无服务账号且将同时删除其下空货源。`)) return
    try {
      await suppliersApi.remove(su.id)
      await mutateSuppliers()
      await mutateSources()
    } catch (e) {
      alert(`删除失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">供应商管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            先创建供应商，再为其添加 AWS/GCP/Azure 货源；随后在「服务账号」中导入账号
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={createSupplierOpen} onOpenChange={setCreateSupplierOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />新建供应商
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>新建供应商</DialogTitle>
                <DialogDescription>仅填写供应商名称</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>名称</Label>
                  <Input
                    placeholder="如：渠道 A"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateSupplierOpen(false)}>取消</Button>
                <Button
                  onClick={handleCreateSupplier}
                  disabled={!newSupplierName.trim() || actionLoading === "create-supplier"}
                >
                  {actionLoading === "create-supplier" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜索供应商..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {filteredSuppliers.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <div className="text-center">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>{searchQuery ? "未找到匹配的供应商" : "暂无供应商，请先创建"}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {filteredSuppliers.map((su) => {
            const srcs = sourcesBySupplier.get(su.id) ?? []
            const isEditing = editingId === su.id
            const isReserved = su.name === RESERVED_UNASSIGNED_SUPPLIER_NAME
            return (
              <div key={su.id} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-5 h-5 text-primary shrink-0" />
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1">
                        <Input
                          className="h-8 text-sm max-w-xs"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameSupplier(su.id)
                            if (e.key === "Escape") setEditingId(null)
                          }}
                          autoFocus
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRenameSupplier(su.id)}>
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-base font-semibold text-foreground truncate">{su.name}</h2>
                        {isReserved && (
                          <span title="系统保留，不可改名" className="inline-flex shrink-0">
                            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                          </span>
                        )}
                        {!isReserved && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingId(su.id); setEditValue(su.name) }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Dialog open={addSourceOpen === su.id} onOpenChange={(o) => !o && setAddSourceOpen(null)}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary" className="gap-1" onClick={() => setAddSourceOpen(su.id)}>
                          <Plus className="w-3.5 h-3.5" />添加货源
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle>添加货源</DialogTitle>
                          <DialogDescription>选择云类型（每供应商每朵云一条）</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="space-y-2">
                            <Label>云厂商</Label>
                            <Select value={newSourceProvider} onValueChange={setNewSourceProvider}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PROVIDER_ORDER.map((p) => (
                                  <SelectItem key={p} value={p}>{PROVIDER_LABELS[p]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setAddSourceOpen(null)}>取消</Button>
                          <Button onClick={() => handleAddSource(su.id)} disabled={actionLoading === `source-${su.id}`}>
                            {actionLoading === `source-${su.id}` && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            创建
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    {srcs.every((s) => s.account_count === 0) && !isReserved && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteSupplier(su)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pl-7">
                  {srcs.length === 0 ? (
                    <p className="text-sm text-muted-foreground col-span-full">暂无货源，请点击「添加货源」</p>
                  ) : (
                    srcs.map((g) => (
                      <Card key={g.id} className="bg-card border-border">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
                                <img src={`/${g.provider}.svg`} alt={g.provider} className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {PROVIDER_LABELS[g.provider] ?? g.provider.toUpperCase()}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">{g.account_count} 个服务账号</p>
                              </div>
                            </div>
                            {g.account_count === 0 && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDeleteSource(g)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
