"use client"

import { useEffect, useState } from "react"
import {
  Copy, Plus, CheckCircle2, AlertCircle, Loader2, XCircle,
  Clock, ExternalLink, RefreshCw, Ban,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  azureConsentApi,
  type AzureConsentInvite,
  type AzureConsentStartResponse,
  type AzureVerifyResult,
} from "@/lib/api"

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending:  { label: "待客户同意", variant: "outline" },
  consumed: { label: "已同意",     variant: "default" },
  failed:   { label: "失败",       variant: "destructive" },
  expired:  { label: "已过期",     variant: "secondary" },
}

export default function AzureOnboardPage() {
  const [invites, setInvites] = useState<AzureConsentInvite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New invite dialog
  const [showCreate, setShowCreate] = useState(false)
  const [accountName, setAccountName] = useState("")
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<AzureConsentStartResponse | null>(null)
  const [copied, setCopied] = useState(false)

  // Verify dialog
  const [verifyAccountId, setVerifyAccountId] = useState<number | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<AzureVerifyResult | null>(null)

  const fetchInvites = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await azureConsentApi.listInvites()
      setInvites(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchInvites() }, [])

  const handleCreate = async () => {
    if (!accountName.trim()) {
      setError("请填写客户名称")
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await azureConsentApi.start({ account_name: accountName.trim() })
      setCreated(res)
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCloseCreate = () => {
    setShowCreate(false)
    setAccountName("")
    setCreated(null)
    setCopied(false)
    fetchInvites()
  }

  const handleRevoke = async (id: number) => {
    try {
      await azureConsentApi.revokeInvite(id)
      fetchInvites()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleVerify = async (accountId: number) => {
    setVerifyAccountId(accountId)
    setVerifying(true)
    setVerifyResult(null)
    try {
      const r = await azureConsentApi.verify(accountId)
      setVerifyResult(r)
    } catch (e) {
      setVerifyResult({ ok: false, message: String(e), discovered_subscriptions: [] })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Azure 成本接入管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            通过邀请链接让客户一键授权，自动完成租户接入。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchInvites} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            新建邀请
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded border border-red-500/50 bg-red-500/10 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Invite list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">邀请记录</CardTitle>
        </CardHeader>
        <CardContent>
          {invites.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无邀请记录，点击"新建邀请"开始接入客户。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-muted-foreground">
                    <th className="pb-2 pr-4">客户名称</th>
                    <th className="pb-2 pr-4">状态</th>
                    <th className="pb-2 pr-4">创建时间</th>
                    <th className="pb-2 pr-4">过期时间</th>
                    <th className="pb-2 pr-4">关联账号</th>
                    <th className="pb-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const st = STATUS_MAP[inv.status] || { label: inv.status, variant: "outline" as const }
                    return (
                      <tr key={inv.id} className="border-b border-gray-800/50">
                        <td className="py-3 pr-4 font-medium">{inv.account_name}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={st.variant}>{st.label}</Badge>
                          {inv.error_reason && (
                            <span className="ml-2 text-xs text-red-400">{inv.error_reason}</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs">
                          {inv.created_at ? new Date(inv.created_at).toLocaleString("zh-CN") : "-"}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs">
                          {inv.expires_at ? new Date(inv.expires_at).toLocaleString("zh-CN") : "-"}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">
                          {inv.cloud_account_id ?? "-"}
                        </td>
                        <td className="py-3 space-x-1">
                          {inv.status === "pending" && (
                            <Button variant="ghost" size="sm" onClick={() => handleRevoke(inv.id)}>
                              <Ban className="h-3.5 w-3.5 mr-1" /> 作废
                            </Button>
                          )}
                          {inv.status === "consumed" && inv.cloud_account_id && (
                            <Button variant="ghost" size="sm" onClick={() => handleVerify(inv.cloud_account_id!)}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> 验证订阅
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create invite dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) handleCloseCreate() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建客户邀请</DialogTitle>
          </DialogHeader>

          {!created ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>客户名称（内部标识）</Label>
                <Input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="例如：ACME 公司"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreate}>取消</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  生成邀请链接
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/50 text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4" /> 邀请链接已生成
              </div>

              <div className="space-y-2">
                <Label>授权链接（发送给客户全局管理员）</Label>
                <div className="flex gap-2">
                  <Input readOnly value={created.consent_url} className="text-xs" />
                  <Button variant="outline" size="sm" onClick={() => handleCopy(created.consent_url)}>
                    {copied ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                有效期至 {new Date(created.expires_at).toLocaleString("zh-CN")}（24 小时）
              </div>

              <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded text-muted-foreground">
                {created.instructions}
              </pre>

              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreate}>关闭</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Verify result dialog */}
      <Dialog open={verifyAccountId !== null} onOpenChange={(open) => { if (!open) { setVerifyAccountId(null); setVerifyResult(null) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>验证订阅授权</DialogTitle>
          </DialogHeader>
          {verifying ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">正在检测授权...</span>
            </div>
          ) : verifyResult ? (
            <div className="space-y-4">
              <div className={`flex items-center gap-2 p-3 rounded text-sm ${
                verifyResult.ok
                  ? "bg-green-500/10 border border-green-500/50 text-green-400"
                  : "bg-amber-500/10 border border-amber-500/50 text-amber-400"
              }`}>
                {verifyResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {verifyResult.message}
              </div>
              {verifyResult.discovered_subscriptions.length > 0 && (
                <div className="space-y-1">
                  <Label>已发现的订阅</Label>
                  <ul className="space-y-1">
                    {verifyResult.discovered_subscriptions.map((s) => (
                      <li key={s.subscription_id} className="font-mono text-xs text-muted-foreground">
                        {s.display_name} &middot; {s.subscription_id} &middot; {s.state}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setVerifyAccountId(null); setVerifyResult(null) }}>关闭</Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
