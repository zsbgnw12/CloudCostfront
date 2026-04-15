"use client"

import { useState } from "react"
import { Copy, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { azureConsentApi, type AzureConsentStart, type AzureVerifyResult, type AzureCloudAccount } from "@/lib/api"

export default function AzureOnboardPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [consentInfo, setConsentInfo] = useState<AzureConsentStart | null>(null)
  const [name, setName] = useState("")
  const [tenantId, setTenantId] = useState("")
  const [account, setAccount] = useState<AzureCloudAccount | null>(null)
  const [verify, setVerify] = useState<AzureVerifyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConsent = async () => {
    setLoading(true); setError(null)
    try {
      const info = await azureConsentApi.start()
      setConsentInfo(info)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const doRegister = async () => {
    if (!name.trim() || !tenantId.trim()) {
      setError("请填写账号名称和客户 Tenant ID"); return
    }
    setLoading(true); setError(null)
    try {
      const acc = await azureConsentApi.register({
        name: name.trim(),
        tenant_id: tenantId.trim(),
        subscription_ids: [],
      })
      setAccount(acc)
      setStep(3)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const doVerify = async () => {
    if (!account) return
    setLoading(true); setError(null)
    try {
      const r = await azureConsentApi.verify(account.id)
      setVerify(r)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Azure 成本接入向导</h1>
        <p className="text-sm text-muted-foreground mt-1">
          使用多租户应用 + Service Principal 授权，让客户无需在自己租户部署任何应用。
        </p>
      </div>

      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <Badge key={s} variant={step === s ? "default" : step > s ? "secondary" : "outline"}>
            步骤 {s}
          </Badge>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded border border-red-500/50 bg-red-500/10 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>1. 生成客户授权链接</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!consentInfo ? (
              <Button onClick={fetchConsent} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                生成授权链接
              </Button>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>客户全局管理员访问链接（点击 / 复制发给客户）</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={consentInfo.consent_url} />
                    <Button variant="outline" onClick={() => navigator.clipboard.writeText(consentInfo.consent_url)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" onClick={() => window.open(consentInfo.consent_url, "_blank")}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded">{consentInfo.instructions}</pre>
                <Button onClick={() => setStep(2)}>客户已完成同意，下一步</Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>2. 登记客户信息</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>账号名称（内部标识）</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：ACME-生产" />
            </div>
            <div className="space-y-2">
              <Label>客户 Tenant ID</Label>
              <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
              <p className="text-xs text-muted-foreground">
                可让客户在 Azure 门户 → Microsoft Entra ID 首页复制"租户 ID"。
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>上一步</Button>
              <Button onClick={doRegister} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                创建并下一步
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && account && (
        <Card>
          <CardHeader><CardTitle>3. 验证授权并发现订阅</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              已创建账号：<span className="font-mono">{account.name}</span>
              <Badge variant="outline" className="ml-2">{account.consent_status}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              确保客户已在订阅的 <b>访问控制 (IAM)</b> 中给我方应用分配 <b>Cost Management Reader</b> 角色，
              然后点击下方按钮检测。
            </div>
            <Button onClick={doVerify} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              检测授权
            </Button>
            {verify && (
              <div className={`p-3 rounded text-sm ${verify.ok ? "bg-green-500/10 text-green-400 border border-green-500/50" : "bg-amber-500/10 text-amber-400 border border-amber-500/50"}`}>
                <div className="flex items-center gap-2">
                  {verify.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {verify.message}
                </div>
                {verify.discovered_subscriptions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {verify.discovered_subscriptions.map((s) => (
                      <li key={s.subscription_id} className="font-mono text-xs">
                        {s.display_name} · {s.subscription_id} · {s.state}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
