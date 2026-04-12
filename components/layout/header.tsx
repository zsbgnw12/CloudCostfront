"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, Bell, RefreshCw, Check, AlertTriangle, X, Info, Loader2, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { alertsApi, accountsApi, syncApi, type AppNotification } from "@/lib/api"
import { useUnreadCount, useNotifications } from "@/hooks/use-data"

interface SyncStatus {
  status: "idle" | "syncing" | "success" | "error"
  lastSync?: string
}

function monthStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Compare YYYY-MM strings (same year range). */
function monthNotAfter(a: string, b: string) {
  return a <= b
}

export function Header() {
  const [searchQuery, setSearchQuery] = useState("")
  const { data: notifData, mutate: mutateNotifs } = useNotifications(10)
  const { data: countData, mutate: mutateCount } = useUnreadCount()
  const notifications = notifData ?? []
  const unreadCount = countData?.count ?? 0
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    status: "idle",
    lastSync: undefined,
  })

  // Fetch real last sync time from backend
  const loadLastSync = useCallback(async () => {
    try {
      const res = await syncApi.lastSync()
      if (res.last_sync) {
        setSyncStatus((prev) => ({
          ...prev,
          lastSync: res.last_sync!,
          status: prev.status === "syncing" ? "syncing" : prev.status,
        }))
      }
    } catch (e) { console.error("Failed to load last sync:", e) }
  }, [])

  useEffect(() => { loadLastSync() }, [loadLastSync])

  const handleMarkRead = async (id: number) => {
    try {
      await alertsApi.markRead(id)
      mutateNotifs((prev) => prev?.map((n) => n.id === id ? { ...n, is_read: true } : n), false)
      mutateCount((prev) => prev ? { count: Math.max(0, prev.count - 1) } : prev, false)
    } catch (e) { console.error(e) }
  }

  const handleMarkAllRead = async () => {
    try {
      await alertsApi.markAllRead()
      mutateNotifs((prev) => prev?.map((n) => ({ ...n, is_read: true })), false)
      mutateCount({ count: 0 }, false)
    } catch (e) { console.error(e) }
  }

  const runSync = async (startMonth: string, endMonth: string, provider?: string) => {
    try {
      setSyncStatus({ status: "syncing" })
      await syncApi.triggerAll(startMonth, endMonth, provider)
      await loadLastSync()
      setSyncStatus({ status: "success", lastSync: new Date().toISOString() })
      setTimeout(() => {
        setSyncStatus((prev) => ({ ...prev, status: "idle" }))
      }, 3000)
    } catch (e) {
      console.error("Sync failed:", e)
      setSyncStatus((prev) => ({ ...prev, status: "error" }))
      setTimeout(() => {
        setSyncStatus((prev) => ({ ...prev, status: "idle" }))
      }, 3000)
    }
  }

  const handleSync = async () => {
    const m = monthStr(new Date())
    await runSync(m, m)
  }

  const [customSyncOpen, setCustomSyncOpen] = useState(false)
  const [customStart, setCustomStart] = useState(() => monthStr(new Date()))
  const [customEnd, setCustomEnd] = useState(() => monthStr(new Date()))
  const [customProvider, setCustomProvider] = useState<string>("__all__")

  const handleCustomSyncSubmit = async () => {
    let start = customStart
    let end = customEnd
    if (!monthNotAfter(start, end)) {
      ;[start, end] = [end, start]
    }
    setCustomSyncOpen(false)
    const prov =
      customProvider === "__all__" || !customProvider ? undefined : customProvider
    await runSync(start, end, prov)
  }

  const [discoverLoading, setDiscoverLoading] = useState(false)
  const handleDiscoverGcp = async () => {
    try {
      setDiscoverLoading(true)
      const result = await accountsApi.discoverGcpProjects()
      if (result.created > 0) {
        alert(`发现并创建了 ${result.created} 个 GCP 项目：\n${result.projects.join("\n")}`)
      } else {
        alert("没有发现新的 GCP 项目")
      }
    } catch (e) { alert(`发现失败: ${e instanceof Error ? e.message : e}`) }
    finally { setDiscoverLoading(false) }
  }

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "刚刚"
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    return `${days}天前`
  }

  return (
    <header className="flex items-center justify-between h-16 px-6 border-b border-white/5 bg-background/60 backdrop-blur-xl z-20 sticky top-0 shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
      {/* Global Search */}
      <div className="relative w-96 group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-white" />
        <Input
          type="search"
          placeholder="搜索项目、资源..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-white/5 border-white/10 rounded-full transition-all focus:bg-white/10 focus:border-white/20 focus:ring-4 focus:ring-white/5"
        />
      </div>

      <div className="flex items-center gap-4">
        {/* Sync Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                className={cn(
                  "w-4 h-4",
                  syncStatus.status === "syncing" && "animate-spin"
                )}
              />
              <span className="text-sm">
                {syncStatus.status === "syncing"
                  ? "同步中..."
                  : syncStatus.status === "success"
                  ? "同步完成"
                  : syncStatus.status === "error"
                  ? "同步失败"
                  : syncStatus.lastSync
                  ? `上次同步: ${timeAgo(syncStatus.lastSync)}`
                  : "未同步"}
              </span>
              {syncStatus.status === "success" && (
                <Check className="w-4 h-4 text-status-active" />
              )}
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleSync} disabled={syncStatus.status === "syncing"}>
              <RefreshCw className={cn("w-4 h-4 mr-2", syncStatus.status === "syncing" && "animate-spin")} />
              同步当月数据
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const n = monthStr(new Date())
                setCustomStart(n)
                setCustomEnd(n)
                setCustomProvider("__all__")
                setCustomSyncOpen(true)
              }}
              disabled={syncStatus.status === "syncing"}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              自定义月份范围…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDiscoverGcp} disabled={discoverLoading}>
              {discoverLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              发现 GCP 项目
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={customSyncOpen} onOpenChange={setCustomSyncOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>自定义同步月份</DialogTitle>
              <DialogDescription>
                按自然月拉取账单（与后端 Celery 任务一致）。起止可跨多个月，用于补历史数据；数据量大时耗时较长。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">开始月份</Label>
                  <Input
                    type="month"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">结束月份</Label>
                  <Input
                    type="month"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">云厂商（可选）</Label>
                <Select value={customProvider} onValueChange={setCustomProvider}>
                  <SelectTrigger>
                    <SelectValue placeholder="全部" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部（AWS / GCP / Azure）</SelectItem>
                    <SelectItem value="aws">仅 AWS</SelectItem>
                    <SelectItem value="gcp">仅 GCP</SelectItem>
                    <SelectItem value="azure">仅 Azure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setCustomSyncOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                onClick={handleCustomSyncSubmit}
                disabled={syncStatus.status === "syncing" || !customStart || !customEnd}
              >
                {syncStatus.status === "syncing" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    同步中…
                  </>
                ) : (
                  "开始同步"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>通知中心</span>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-primary h-auto p-0" onClick={handleMarkAllRead}>
                  全部已读
                </Button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                暂无通知
              </div>
            ) : (
              notifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  className="flex flex-col items-start gap-1 p-3 cursor-pointer"
                  onClick={() => !notification.is_read && handleMarkRead(notification.id)}
                >
                  <div className="flex items-center gap-2 w-full">
                    {notification.type === "warning" ? (
                      <AlertTriangle className="w-4 h-4 text-status-suspended shrink-0" />
                    ) : notification.type === "success" ? (
                      <Check className="w-4 h-4 text-status-active shrink-0" />
                    ) : (
                      <Info className="w-4 h-4 text-blue-400 shrink-0" />
                    )}
                    <span className="font-medium text-sm flex-1">
                      {notification.title}
                    </span>
                    {!notification.is_read && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground pl-6">
                    {notification.message}
                  </p>
                  <span className="text-xs text-muted-foreground/60 pl-6">
                    {timeAgo(notification.created_at)}
                  </span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="justify-center text-primary text-sm" onClick={() => window.location.href = "/alerts"}>
              查看全部通知
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Avatar */}
        <Button variant="ghost" size="icon" className="rounded-full">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-sm font-medium text-primary-foreground">
              A
            </span>
          </div>
        </Button>
      </div>
    </header>
  )
}
