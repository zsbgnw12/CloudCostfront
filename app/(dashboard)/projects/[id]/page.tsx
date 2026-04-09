"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

import {
  ArrowLeft, Calendar, FolderKanban, Pause, Play, Users, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  projectsApi, billingApi,
  type Project, type BillingDetail, type ProjectAssignmentLog,
} from "@/lib/api"

const statusConfig: Record<string, { label: string; className: string }> = {
  active: { label: "已启用", className: "bg-status-active text-white" },
  inactive: { label: "已停用", className: "bg-status-suspended text-black" },
  deleted: { label: "已删除", className: "bg-muted text-muted-foreground" },
}

const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure" }

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = Number(params.id)

  const [project, setProject] = useState<Project | null>(null)
  const [logs, setLogs] = useState<ProjectAssignmentLog[]>([])
  const [billingRecords, setBillingRecords] = useState<BillingDetail[]>([])
  const [loading, setLoading] = useState(true)
  
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [p, l] = await Promise.all([
        projectsApi.get(projectId), projectsApi.assignmentLogs(projectId),
      ])
      setProject(p); setLogs(l)
      try {
        const bills = await billingApi.detail({ project_id: p.external_project_id, page_size: 20 })
        setBillingRecords(bills)
      } catch { /* ok */ }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleAction = async (action: "activate" | "suspend") => {
    try {
      setActionLoading(action)
      if (action === "activate") await projectsApi.activate(projectId)
      else if (action === "suspend") await projectsApi.suspend(projectId)
      await load()
    } catch (e) { alert(`操作失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
  if (!project) return <div className="flex items-center justify-center h-64 text-muted-foreground">项目不存在</div>

  const sCfg = statusConfig[project.status] ?? { label: project.status, className: "bg-muted text-muted-foreground" }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <img src={`/${project.provider}.svg`} alt={project.provider} className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{project.external_project_id}</h1>
              <p className="text-sm text-muted-foreground">{project.name} · {project.group_label ?? "无分组"}</p>
            </div>
          </div>
        </div>
        <Badge className={cn("text-sm px-3 py-1", sCfg.className)}>{sCfg.label}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/20"><img src={`/${project.provider}.svg`} alt={project.provider} className="w-5 h-5" /></div><div><p className="text-xs text-muted-foreground">云厂商</p><p className="font-semibold">{PROVIDER_LABELS[project.provider] ?? project.provider.toUpperCase()}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-chart-2/20"><FolderKanban className="w-5 h-5 text-chart-2" /></div><div><p className="text-xs text-muted-foreground">分组</p><p className="font-semibold">{project.group_label ?? "无"}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-chart-4/20"><Calendar className="w-5 h-5 text-chart-4" /></div><div><p className="text-xs text-muted-foreground">创建日期</p><p className="font-semibold">{new Date(project.created_at).toLocaleDateString("zh-CN")}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-status-active/20"><Users className="w-5 h-5 text-status-active" /></div><div><p className="text-xs text-muted-foreground">状态</p><p className="font-semibold">{project.status}</p></div></div></CardContent></Card>
      </div>

      {project.status !== "deleted" && (
        <div className="flex items-center gap-3">
          {project.status === "active" ? (
            <Button variant="outline" onClick={() => handleAction("suspend")} disabled={!!actionLoading}>
              {actionLoading === "suspend" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pause className="w-4 h-4 mr-2" />}停用
            </Button>
          ) : (
            <Button onClick={() => handleAction("activate")} disabled={!!actionLoading}>
              {actionLoading === "activate" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}启用
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="billing" className="space-y-4">
        <TabsList><TabsTrigger value="billing">服务明细</TabsTrigger><TabsTrigger value="logs">操作日志</TabsTrigger><TabsTrigger value="info">基本信息</TabsTrigger></TabsList>

        <TabsContent value="billing">
          <Card className="bg-card border-border overflow-hidden"><Table><TableHeader><TableRow className="border-border hover:bg-transparent"><TableHead className="text-muted-foreground">日期</TableHead><TableHead className="text-muted-foreground">服务</TableHead><TableHead className="text-muted-foreground">用量类型</TableHead><TableHead className="text-muted-foreground">区域</TableHead><TableHead className="text-muted-foreground">货币</TableHead><TableHead className="text-muted-foreground text-right">费用</TableHead></TableRow></TableHeader><TableBody>
            {billingRecords.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">暂无账单数据</TableCell></TableRow> : billingRecords.map((r) => (
              <TableRow key={r.id} className="border-border"><TableCell className="text-muted-foreground">{r.date}</TableCell><TableCell className="text-foreground">{r.product ?? "—"}</TableCell><TableCell className="text-muted-foreground text-sm">{r.usage_type ?? "—"}</TableCell><TableCell className="text-muted-foreground font-mono text-sm">{r.region ?? "—"}</TableCell><TableCell className="text-muted-foreground">{r.currency}</TableCell><TableCell className="text-right font-medium text-foreground">{Number(r.cost).toFixed(2)}</TableCell></TableRow>
            ))}
          </TableBody></Table></Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card className="bg-card border-border overflow-hidden"><Table><TableHeader><TableRow className="border-border hover:bg-transparent"><TableHead className="text-muted-foreground">时间</TableHead><TableHead className="text-muted-foreground">操作</TableHead><TableHead className="text-muted-foreground">状态变更</TableHead><TableHead className="text-muted-foreground">操作人</TableHead><TableHead className="text-muted-foreground">备注</TableHead></TableRow></TableHeader><TableBody>
            {logs.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无日志</TableCell></TableRow> : logs.map((log) => (
              <TableRow key={log.id} className="border-border"><TableCell className="text-muted-foreground text-sm">{new Date(log.created_at).toLocaleString("zh-CN")}</TableCell><TableCell><Badge variant="secondary">{log.action}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{log.from_status && log.to_status ? `${log.from_status} → ${log.to_status}` : "—"}</TableCell><TableCell className="text-muted-foreground">{log.operator ?? "系统"}</TableCell><TableCell className="text-muted-foreground text-sm">{log.notes ?? "—"}</TableCell></TableRow>
            ))}
          </TableBody></Table></Card>
        </TabsContent>

        <TabsContent value="info">
          <Card className="bg-card border-border"><CardContent className="p-6"><div className="grid grid-cols-2 gap-4">
            <div><p className="text-sm text-muted-foreground">内部ID</p><p className="font-medium">{project.id}</p></div>
            <div><p className="text-sm text-muted-foreground">外部项目ID</p><p className="font-medium font-mono">{project.external_project_id}</p></div>
            <div><p className="text-sm text-muted-foreground">名称</p><p className="font-medium">{project.name}</p></div>
            <div><p className="text-sm text-muted-foreground">云厂商</p><p className="font-medium">{project.provider.toUpperCase()}</p></div>
            <div><p className="text-sm text-muted-foreground">数据源ID</p><p className="font-medium">{project.data_source_id ?? "—"}</p></div>
            <div><p className="text-sm text-muted-foreground">业务分类ID</p><p className="font-medium">{project.category_id ?? "—"}</p></div>
            <div><p className="text-sm text-muted-foreground">分组标签</p><p className="font-medium">{project.group_label ?? "—"}</p></div>
            
            <div><p className="text-sm text-muted-foreground">回收时间</p><p className="font-medium">{project.recycled_at ? new Date(project.recycled_at).toLocaleString("zh-CN") : "—"}</p></div>
            <div><p className="text-sm text-muted-foreground">备注</p><p className="font-medium">{project.notes ?? "—"}</p></div>
          </div></CardContent></Card>
        </TabsContent>
      </Tabs>

      
    </div>
  )
}
