"use client"

import { useState, useMemo } from "react"
import {
  Plus, Pencil, Trash2, Check, X, Loader2,
  FolderOpen, Building2, Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { accountsApi, type GroupItem } from "@/lib/api"
import { useAccounts, useGroups } from "@/hooks/use-data"
import { cn } from "@/lib/utils"

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure" }
const PROVIDER_ORDER = ["aws", "gcp", "azure"]

export default function SuppliersPage() {
  const { data: groups = [], mutate: mutateGroups } = useGroups()
  const { data: accounts = [] } = useAccounts()
  const [createOpen, setCreateOpen] = useState(false)
  const [newGroup, setNewGroup] = useState({ provider: "aws", label: "" })
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const accountCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of accounts) {
      const key = `${a.provider}:${a.group_label ?? ""}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [accounts])

  const groupedByProvider = useMemo(() => {
    const map = new Map<string, GroupItem[]>()
    for (const g of groups) {
      const p = g.provider.toLowerCase()
      if (searchQuery && !g.label.toLowerCase().includes(searchQuery.toLowerCase())) continue
      if (!map.has(p)) map.set(p, [])
      map.get(p)!.push(g)
    }
    return PROVIDER_ORDER
      .filter((p) => map.has(p))
      .map((p) => ({ provider: p, groups: map.get(p)! }))
  }, [groups, searchQuery])

  const handleCreate = async () => {
    if (!newGroup.label.trim()) return
    try {
      setActionLoading("create")
      await accountsApi.createGroup(newGroup.provider, newGroup.label.trim())
      setCreateOpen(false)
      setNewGroup({ provider: "aws", label: "" })
      await mutateGroups()
    } catch (e) {
      alert(`创建失败: ${e instanceof Error ? e.message : e}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (provider: string, label: string) => {
    if (!confirm(`确定删除供应商"${label}"？该供应商下不能有货源。`)) return
    try {
      await accountsApi.deleteGroup(provider, label)
      await mutateGroups()
    } catch (e) {
      alert(`删除失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleRename = async (provider: string, oldLabel: string) => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== oldLabel) {
      try {
        await accountsApi.renameGroup(provider, oldLabel, trimmed)
        await mutateGroups()
      } catch (e) {
        alert(`重命名失败: ${e instanceof Error ? e.message : e}`)
      }
    }
    setEditingId(null)
  }

  const startEdit = (provider: string, label: string) => {
    setEditingId(`${provider}:${label}`)
    setEditValue(label)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">供应商管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理云服务供应商与渠道，先创建供应商再添加货源
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />新建供应商
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>新建供应商</DialogTitle>
              <DialogDescription>创建新的供应商/渠道分组</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>云厂商</Label>
                <Select
                  value={newGroup.provider}
                  onValueChange={(v) => setNewGroup({ ...newGroup, provider: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aws">AWS</SelectItem>
                    <SelectItem value="gcp">GCP</SelectItem>
                    <SelectItem value="azure">Azure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>供应商名称</Label>
                <Input
                  placeholder="如：渠道A、合作伙伴B"
                  value={newGroup.label}
                  onChange={(e) => setNewGroup({ ...newGroup, label: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button
                onClick={handleCreate}
                disabled={!newGroup.label.trim() || actionLoading === "create"}
              >
                {actionLoading === "create" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

      {groupedByProvider.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <div className="text-center">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>{searchQuery ? "未找到匹配的供应商" : "暂无供应商，请先创建"}</p>
          </div>
        </div>
      ) : (
        groupedByProvider.map(({ provider, groups: providerGroups }) => (
          <div key={provider} className="space-y-3">
            <div className="flex items-center gap-2">
              <img src={`/${provider}.svg`} alt={provider} className="w-5 h-5" />
              <h2 className="text-base font-semibold text-foreground">
                {PROVIDER_LABELS[provider] ?? provider.toUpperCase()}
              </h2>
              <Badge variant="secondary" className="text-xs">{providerGroups.length}</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {providerGroups.map((g) => {
                const key = `${provider}:${g.label}`
                const count = accountCountMap.get(key) ?? 0
                const isEditing = editingId === key

                return (
                  <Card
                    key={key}
                    className="bg-card border-border hover:border-primary/30 transition-colors"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
                            <FolderOpen className="w-4 h-4 text-primary" />
                          </div>
                          {isEditing ? (
                            <div className="flex items-center gap-1 flex-1">
                              <Input
                                className="h-7 text-sm flex-1"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRename(provider, g.label)
                                  if (e.key === "Escape") setEditingId(null)
                                }}
                                autoFocus
                              />
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRename(provider, g.label)}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {g.label}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {count} 个货源
                              </p>
                            </div>
                          )}
                        </div>
                        {!isEditing && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost" size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => startEdit(provider, g.label)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {count === 0 && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDelete(provider, g.label)}
                                title="删除空供应商"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
