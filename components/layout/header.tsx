"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Search, Bell, RefreshCw, Check, AlertTriangle, Info, Loader2, ChevronDown, LogOut,
  MailPlus, CheckCircle2, Ban, Clock,
} from "lucide-react"
import useSWR from "swr"
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
import {
  alertsApi, accountsApi, syncApi, authApi, azureConsentApi,
  type AzureConsentInvite, type AzureVerifyResult,
} from "@/lib/api"
import { useUnreadCount, useNotifications } from "@/hooks/use-data"
import { ThemeToggle } from "@/components/theme-toggle"

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

  const handleSync = async (provider?: string) => {
    const m = monthStr(new Date())
    await runSync(m, m, provider)
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
    <header className="flex items-center justify-between h-16 px-6 border-b border-foreground/5 bg-background/60 backdrop-blur-xl z-20 sticky top-0 shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
      {/* Global Search */}
      <div className="relative w-96 group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-foreground" />
        <Input
          type="search"
          placeholder="搜索项目、资源..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-foreground/5 border-foreground/10 rounded-full transition-all focus:bg-foreground/10 focus:border-foreground/20 focus:ring-4 focus:ring-foreground/5"
        />
      </div>

      <div className="flex items-center gap-4">
        {/* Theme toggle (日/夜) */}
        <ThemeToggle />

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
            <DropdownMenuItem onClick={() => handleSync()} disabled={syncStatus.status === "syncing"}>
              <RefreshCw className={cn("w-4 h-4 mr-2", syncStatus.status === "syncing" && "animate-spin")} />
              同步当月数据(全部)
            </DropdownMenuItem>
            {(["aws", "gcp", "azure", "taiji"] as const).map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => handleSync(p)}
                disabled={syncStatus.status === "syncing"}
                className="pl-9 text-xs text-muted-foreground"
              >
                <span className="mr-2 opacity-50">└</span>
                仅 {p === "aws" ? "AWS" : p === "gcp" ? "GCP" : p === "azure" ? "Azure" : "Taiji"}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
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

        {/* Azure 邀请记录（仅 cloud_admin/cloud_ops 可见） */}
        <InvitationsMenu />

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

        <UserMenu />
      </div>
    </header>
  )
}

function UserMenu() {
  const { data: me } = useSWR("auth:me", () => authApi.me(), { revalidateOnFocus: false })
  const handleLogout = async () => {
    try { await authApi.logout() } catch {}
    window.location.href = authApi.loginUrl()
  }
  const initial = (me?.display_name || me?.username || "?").charAt(0).toUpperCase()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center overflow-hidden">
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-medium text-primary-foreground">{initial}</span>
            )}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{me?.display_name || me?.username || "未登录"}</span>
          {me?.email && <span className="text-xs text-muted-foreground">{me.email}</span>}
          {me?.roles?.length ? (
            <span className="text-xs text-muted-foreground mt-1">角色: {me.roles.join(", ")}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4 mr-2" />
          注销
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ───── Azure 邀请记录下拉 ─────────────────────────────────
 * 显示条件：角色是 cloud_admin 或 cloud_ops。
 * 角标：pending 数量优先（红），无 pending 时显示 consumed 未验证数量（黄）。
 * 操作：复制链接 / 验证订阅 / 作废 / 打开完整列表。 */
const INVITE_STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:  { label: "待客户同意", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  consumed: { label: "已同意",     className: "bg-green-500/15 text-green-400 border-green-500/30" },
  failed:   { label: "失败",       className: "bg-red-500/15 text-red-400 border-red-500/30" },
  expired:  { label: "已过期",     className: "bg-gray-500/15 text-gray-400 border-gray-500/30" },
}

function timeAgoShort(dateStr: string | null | undefined) {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

function InvitationsMenu() {
  const { data: me } = useSWR("auth:me", () => authApi.me(), { revalidateOnFocus: false })
  const canSee = (me?.roles ?? []).some((r) => r === "cloud_admin" || r === "cloud_ops")

  // 仅在有权限时才轮询邀请列表（30s），避免无权限用户反复打 403
  const { data: invites, mutate } = useSWR<AzureConsentInvite[]>(
    canSee ? "azure-consent:invites" : null,
    () => azureConsentApi.listInvites(),
    { refreshInterval: 30_000, revalidateOnFocus: false },
  )

  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<AzureVerifyResult | null>(null)

  if (!canSee) return null

  const list = invites ?? []
  const pendingCount  = list.filter((i) => i.status === "pending").length
  const unverifiedCount = list.filter((i) => i.status === "consumed").length

  const badgeValue = pendingCount > 0 ? pendingCount : unverifiedCount
  const badgeTone = pendingCount > 0 ? "destructive" : "secondary"

  const handleRevoke = async (id: number) => {
    try {
      await azureConsentApi.revokeInvite(id)
      mutate()
    } catch (e) { alert(`作废失败: ${e instanceof Error ? e.message : e}`) }
  }

  const handleVerify = async (accountId: number) => {
    setVerifyOpen(true)
    setVerifying(true)
    setVerifyResult(null)
    try {
      const r = await azureConsentApi.verify(accountId)
      setVerifyResult(r)
      mutate()
    } catch (e) {
      setVerifyResult({ ok: false, message: String(e), discovered_subscriptions: [] })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" title="Azure 接入邀请">
            <MailPlus className="w-5 h-5 text-muted-foreground" />
            {badgeValue > 0 && (
              <Badge
                variant={badgeTone as "destructive" | "secondary"}
                className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              >
                {badgeValue}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-96">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Azure 接入邀请</span>
            <span className="text-xs text-muted-foreground font-normal">
              {pendingCount > 0 && <>待同意 {pendingCount}</>}
              {pendingCount > 0 && unverifiedCount > 0 && " · "}
              {unverifiedCount > 0 && <>待验证 {unverifiedCount}</>}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {list.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              暂无邀请记录
              <div className="text-xs mt-1 text-muted-foreground/70">
                在「货源管理 → 新建货源」选择 Azure 时生成
              </div>
            </div>
          ) : (
            list.slice(0, 10).map((inv) => {
              const st = INVITE_STATUS_MAP[inv.status] ?? INVITE_STATUS_MAP.pending
              return (
                <div key={inv.id} className="px-3 py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{inv.account_name}</span>
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] border shrink-0", st.className)}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{timeAgoShort(inv.created_at)}</span>
                    {inv.cloud_account_id && (
                      <span className="font-mono">· 账号 #{inv.cloud_account_id}</span>
                    )}
                  </div>
                  {inv.error_reason && (
                    <div className="mt-1 text-[11px] text-red-400 truncate" title={inv.error_reason}>
                      {inv.error_reason}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-2">
                    {inv.status === "pending" && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleRevoke(inv.id)}
                      >
                        <Ban className="w-3 h-3 mr-1" /> 作废
                      </Button>
                    )}
                    {inv.status === "consumed" && inv.cloud_account_id && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleVerify(inv.cloud_account_id!)}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" /> 验证订阅
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="justify-center text-primary text-sm"
            onClick={() => { window.location.href = "/azure-onboard" }}
          >
            查看全部邀请
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={verifyOpen} onOpenChange={(open) => { if (!open) { setVerifyOpen(false); setVerifyResult(null) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>验证订阅授权</DialogTitle>
            <DialogDescription>
              调用 ARM 探测该租户下我们 SP 可见的订阅。未看到订阅表示客户尚未在目标订阅上分配 Cost Management Reader 角色。
            </DialogDescription>
          </DialogHeader>
          {verifying ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">正在检测授权…</span>
            </div>
          ) : verifyResult ? (
            <div className="space-y-4">
              <div className={cn(
                "flex items-center gap-2 p-3 rounded text-sm border",
                verifyResult.ok
                  ? "bg-green-500/10 border-green-500/50 text-green-400"
                  : "bg-amber-500/10 border-amber-500/50 text-amber-400",
              )}>
                {verifyResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <span>{verifyResult.message}</span>
              </div>
              {verifyResult.discovered_subscriptions.length > 0 && (
                <div className="space-y-1">
                  <Label>已发现的订阅</Label>
                  <ul className="space-y-1 max-h-60 overflow-y-auto">
                    {verifyResult.discovered_subscriptions.map((s) => (
                      <li key={s.subscription_id} className="font-mono text-xs text-muted-foreground">
                        {s.display_name} · {s.subscription_id} · {s.state}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVerifyOpen(false); setVerifyResult(null) }}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
