"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  ChevronRight, ChevronDown, FolderOpen, Plus, MoreHorizontal,
  KeyRound, Pause, Play, Trash2, Eye, EyeOff, Pencil,
  Loader2, ArrowLeft, Building2,
  Link2, Copy, CheckCircle2, AlertTriangle, Clock, ExternalLink,
  Search, X,
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  accountsApi, azureConsentApi, authApi, suppliersApi,
  type ServiceAccount, type ServiceAccountDetail, type HistoryItem, type SupplySourceItem, type EntityItem,
  type AzureConsentInvite, type AzureConsentStartResponse, type AzureDiscoveredSubscription,
} from "@/lib/api"
import { useAccounts, useSupplySourcesAll, useEntitiesAll } from "@/hooks/use-data"
import useSWR from "swr"
import { cn } from "@/lib/utils"

/* ─── Status helpers ─────────────────────────────────────── */
const STATUS_MAP: Record<string, { label: string; class: string }> = {
  active: { label: "使用中", class: "bg-green-500/20 text-green-400" },
  inactive: { label: "已停用", class: "bg-red-500/20 text-red-400" },
  standby: { label: "备用", class: "bg-blue-500/20 text-blue-400" },
  suspended: { label: "已停用", class: "bg-red-500/20 text-red-400" },
  deleted: { label: "已删除", class: "bg-muted/30 text-muted-foreground" },
}
const PROVIDER_LABELS: Record<string, string> = { aws: "AWS", gcp: "GCP", azure: "Azure", taiji: "Taiji" }
const ACTION_LABELS: Record<string, string> = {
  created: "创建账号",
  suspended: "停用", activated: "启用", deleted: "删除",
  standby: "置为备用",
  customer_bound: "绑定客户编号",
  customer_unbound: "解绑客户编号",
  customer_batch_synced: "销售系统同步",
}

/** Azure 下单方式（仅 Azure 货源展示与提交） */
const ORDER_METHOD_OPTIONS = [
  "MCCL-EA",
  "MCCL-SA",
  "GLOBA-EA",
  "HK CSP",
  "MCA",
  "MC-E",
] as const

const ORDER_METHOD_SELECT_SENTINEL = "__none__"

/** 主体下拉框中代表「未分配主体」的哨兵值（Select 不能用空字符串作 value）。 */
const ENTITY_SELECT_UNASSIGNED = "__unassigned__"

/** 弹窗内输入/选择：与浅色区块底区分，避免与背景糊成一片 */
const CTRL_SURFACE = "bg-background border border-input shadow-sm dark:bg-background/95"

/** 按钮可见性（业务语义）
 * 状态是纯人工切换，和客户编号无关。只隐藏"当前已经是这个状态"的按钮：
 * - 使用中：可"停用"、"置为备用"
 * - 备用：可"启用"(→使用中)、"停用"
 * - 已停用：可"启用"(→使用中)、"置为备用"
 */
function canSuspendStatus(s: string) {
  return s !== "inactive"
}
function canActivateStatus(s: string) {
  return s !== "active"
}
function canStandbyStatus(s: string) {
  return s !== "standby"
}

const AZURE_CRED_JSON_PLACEHOLDER = `{
  "tenant_id": "",
  "subscription_id": "",
  "client_id": "",
  "client_secret": ""
}`

const AWS_CRED_JSON_PLACEHOLDER = `{
  "account_id": "",
  "aws_access_key_id": "",
  "aws_secret_access_key": ""
}`

const TAIJI_CRED_JSON_PLACEHOLDER = `{
  "api_base": "https://api.taijiaicloud.com",
  "access_token": "sk-...",
  "admin_user_id": "1"
}`

/** 解析 AWS 配置 JSON（字段或整段 JSON），得到入库所需 external_id 与 secret_data */
function parseAwsCredentialJson(raw: string): { external_id: string; secret_data: Record<string, string> } {
  if (!raw.trim()) throw new Error("请填写 AWS 配置")
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error("AWS 配置不是合法 JSON")
  }
  const account =
    String(o.account_id ?? o.aws_account_id ?? "").trim()
  const ak = String(o.aws_access_key_id ?? o.access_key_id ?? "").trim()
  const sk = String(o.aws_secret_access_key ?? o.secret_access_key ?? "").trim()
  if (!account || !ak || !sk) throw new Error("JSON 中需包含 account_id、aws_access_key_id、aws_secret_access_key")
  return {
    external_id: account,
    secret_data: {
      aws_access_key_id: ak,
      aws_secret_access_key: sk,
    },
  }
}

/** Taiji：JSON 一键粘贴，含 api_base/access_token/admin_user_id；external_id 取 admin_user_id */
function parseTaijiCredentialJson(raw: string): { external_id: string; secret_data: { api_base: string; access_token: string; admin_user_id: string } } {
  if (!raw.trim()) throw new Error("请填写 Taiji 配置")
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error("Taiji 配置不是合法 JSON")
  }
  const api_base = String(o.api_base ?? "").trim().replace(/\/+$/, "")
  const access_token = String(o.access_token ?? "").trim()
  const admin_user_id = String(o.admin_user_id ?? "").trim()
  if (!api_base || !access_token || !admin_user_id) {
    throw new Error("JSON 中需包含 api_base、access_token、admin_user_id")
  }
  return {
    external_id: admin_user_id,
    secret_data: { api_base, access_token, admin_user_id },
  }
}

/** GCP：整段 Service Account JSON，project_id 须在 JSON 内；入库 secret_data 格式 */
function parseGcpCredentialJson(raw: string): { external_id: string; secret_data: { service_account_json: Record<string, unknown> } } {
  if (!raw.trim()) throw new Error("请粘贴 GCP Service Account JSON")
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error("GCP 配置不是合法 JSON")
  }
  if (o.service_account_json && typeof o.service_account_json === "object" && o.service_account_json !== null) {
    const inner = o.service_account_json as Record<string, unknown>
    const pid = String(o.project_id ?? inner.project_id ?? "").trim()
    if (!pid) throw new Error("JSON 中需包含 project_id（或顶层 project_id）")
    return { external_id: pid, secret_data: { service_account_json: inner } }
  }
  const pid = String(o.project_id ?? "").trim()
  if (!pid) throw new Error("JSON 中需包含 project_id")
  return { external_id: pid, secret_data: { service_account_json: o } }
}

/** AWS 分字段编辑，与 secret_json 同步（含 account_id，全部在下方区域） */
function AwsCredentialFields({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [accountId, setAccountId] = useState("")
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")

  useEffect(() => {
    if (!value.trim()) {
      setAccountId("")
      setAccessKeyId("")
      setSecretAccessKey("")
      return
    }
    try {
      const o = JSON.parse(value) as Record<string, string>
      setAccountId(String(o.account_id ?? o.aws_account_id ?? ""))
      setAccessKeyId(String(o.aws_access_key_id ?? o.access_key_id ?? ""))
      setSecretAccessKey(String(o.aws_secret_access_key ?? o.secret_access_key ?? ""))
    } catch {
      setAccountId("")
      setAccessKeyId("")
      setSecretAccessKey("")
    }
  }, [value])

  const push = (acc: string, ak: string, sk: string) => {
    const o: Record<string, string> = {}
    if (acc.trim()) o.account_id = acc.trim()
    if (ak.trim()) o.aws_access_key_id = ak.trim()
    if (sk.trim()) o.aws_secret_access_key = sk.trim()
    onChange(Object.keys(o).length ? JSON.stringify(o, null, 2) : "")
  }

  return (
    <div className="space-y-4 p-2 rounded-lg bg-background/50 border border-border/60">
      <div className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">账号</p>
        <div className="border-l-2 border-border/80 pl-2 ml-0.5">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">1 · AWS Account ID</Label>
            <Input
              className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
              placeholder="12 位账号 ID"
              value={accountId}
              onChange={(e) => {
                const v = e.target.value
                setAccountId(v)
                push(v, accessKeyId, secretAccessKey)
              }}
            />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">访问密钥</p>
        <div className="space-y-2 border-l-2 border-border/80 pl-2 ml-0.5">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">2 · Access Key ID</Label>
            <Input
              className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
              placeholder="AKIA..."
              value={accessKeyId}
              onChange={(e) => {
                const v = e.target.value
                setAccessKeyId(v)
                push(accountId, v, secretAccessKey)
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">3 · Secret Access Key</Label>
            <Input
              type="password"
              className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
              placeholder="••••••••"
              value={secretAccessKey}
              onChange={(e) => {
                const v = e.target.value
                setSecretAccessKey(v)
                push(accountId, accessKeyId, v)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

type CredUiMode = "fields" | "json" | "invite"

/** 云厂商侧配置（账号/订阅/项目 ID 与密钥均在此；JSON 为整段导入） */
function CredentialSection({
  provider,
  mode,
  onModeChange,
  allowInvite,
  secretJson,
  onSecretJsonChange,
  azureSubscriptionId,
  onAzureSubscriptionChange,
  azureTenantId,
  azureClientId,
  azureClientSecret,
  azureJson,
  onAzurePatch,
  onAzureJsonChange,
  inviteSection,
}: {
  provider: string
  mode: CredUiMode
  onModeChange: (m: CredUiMode) => void
  /** 是否显示 Tab A「链接接入」——仅在 Azure + 新建场景启用 */
  allowInvite?: boolean
  secretJson: string
  onSecretJsonChange: (v: string) => void
  azureSubscriptionId: string
  onAzureSubscriptionChange: (v: string) => void
  azureTenantId: string
  azureClientId: string
  azureClientSecret: string
  azureJson: string
  onAzurePatch: (p: {
    azure_tenant_id?: string
    azure_client_id?: string
    azure_client_secret?: string
  }) => void
  onAzureJsonChange: (v: string) => void
  /** Azure Tab A 的渲染体，由父组件提供（它持有 invite 状态） */
  inviteSection?: React.ReactNode
  /** Taiji 专用：Blob SAS URL（容器级 sr=c、只读 sp=r） */
  taijiBlobSasUrl?: string
  onTaijiBlobSasUrlChange?: (v: string) => void
}) {
  const p = provider.toLowerCase()
  const isAzure = p === "azure"
  const showAwsToggle = p === "aws"
  const showAzureToggle = isAzure

  return (
    <div className="rounded-xl border border-border bg-muted/25 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">云厂商账号配置</span>
        {showAzureToggle ? (
          <div className="flex rounded-md border border-border bg-background p-0.5 shrink-0">
            {allowInvite && (
              <button
                type="button"
                className={cn(
                  "px-2.5 py-1 text-xs rounded-sm transition-colors",
                  mode === "invite" ? "bg-primary/20 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onModeChange("invite")}
                title="通过邀请链接由客户一键授权（推荐）"
              >
                链接接入
              </button>
            )}
            <button
              type="button"
              className={cn(
                "px-2.5 py-1 text-xs rounded-sm transition-colors",
                mode === "fields" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onModeChange("fields")}
            >
              字段
            </button>
            <button
              type="button"
              className={cn(
                "px-2.5 py-1 text-xs rounded-sm transition-colors",
                mode === "json" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onModeChange("json")}
            >
              JSON
            </button>
          </div>
        ) : showAwsToggle ? (
          <div className="flex rounded-md border border-border bg-background p-0.5 shrink-0">
            <button
              type="button"
              className={cn(
                "px-2.5 py-1 text-xs rounded-sm transition-colors",
                mode === "fields" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onModeChange("fields")}
            >
              字段
            </button>
            <button
              type="button"
              className={cn(
                "px-2.5 py-1 text-xs rounded-sm transition-colors",
                mode === "json" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onModeChange("json")}
            >
              JSON
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground shrink-0">JSON 密钥</span>
        )}
      </div>

      {isAzure && mode === "invite" && inviteSection}

      {p === "gcp" && (
        <>
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">服务账号密钥</p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              粘贴从 GCP 下载的 JSON 全文（须含 <code className="text-xs">project_id</code> 等字段）。
            </p>
          </div>
          <Textarea
            rows={8}
            className={cn("font-mono text-xs min-h-[160px]", CTRL_SURFACE)}
            placeholder='{ "type": "service_account", "project_id": "...", ... }'
            value={secretJson}
            onChange={(e) => onSecretJsonChange(e.target.value)}
          />
        </>
      )}

      {p === "taiji" && (
        <>
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Taiji 自动接入（无需任何输入）</p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              点击「添加」时，后端会用服务端配置的 Blob SAS URL（
              <code className="text-xs">TAIJI_BLOB_SAS_URL</code>）自动拉最近一天的
              <code className="text-xs"> {`{date}_UTC+0.json`}</code> 快照，从顶层
              <code className="text-xs"> taiji</code> section 抽
              <code className="text-xs"> (username, token_name)</code> 对，批量建服务账号。
              后续按日由后台 collector 自动从同一 SAS URL 拉数据落库。
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              若提示「未配置 TAIJI_BLOB_SAS_URL」，请联系运维在 Container App 环境变量里加该值。
            </p>
          </div>
        </>
      )}

      {p === "aws" &&
        (mode === "json" ? (
          <>
            <p className="text-[11px] text-muted-foreground leading-snug">
              一段 JSON 包含账号与密钥，例如 <code className="text-xs">account_id</code>、
              <code className="text-xs">aws_access_key_id</code>、<code className="text-xs">aws_secret_access_key</code>。
            </p>
            <Textarea
              rows={10}
              className={cn("font-mono text-xs min-h-[180px]", CTRL_SURFACE)}
              placeholder={AWS_CRED_JSON_PLACEHOLDER}
              value={secretJson}
              onChange={(e) => onSecretJsonChange(e.target.value)}
            />
          </>
        ) : (
          <AwsCredentialFields value={secretJson} onChange={onSecretJsonChange} />
        ))}

      {p === "azure" && mode !== "invite" &&
        (mode === "json" ? (
          <>
            <p className="text-[11px] text-muted-foreground leading-snug">
              建议顺序：租户 → 订阅 → 应用；字段名
              <code className="text-xs"> tenant_id </code>、
              <code className="text-xs"> subscription_id </code>、
              <code className="text-xs"> client_id </code>、
              <code className="text-xs"> client_secret </code>。
            </p>
            <Textarea
              rows={10}
              className={cn("font-mono text-xs min-h-[180px]", CTRL_SURFACE)}
              placeholder={AZURE_CRED_JSON_PLACEHOLDER}
              value={azureJson}
              onChange={(e) => onAzureJsonChange(e.target.value)}
            />
          </>
        ) : (
          <div className="space-y-4 p-2 rounded-lg bg-background/50 border border-border/60">
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">租户与订阅</p>
              <div className="space-y-2 pl-0 sm:pl-1 border-l-2 border-border/80 ml-0.5">
                <div className="space-y-1 pl-2">
                  <Label className="text-xs text-muted-foreground">1 · 租户 ID</Label>
                  <Input
                    className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={azureTenantId}
                    onChange={(e) => onAzurePatch({ azure_tenant_id: e.target.value })}
                  />
                </div>
                <div className="space-y-1 pl-2">
                  <Label className="text-xs text-muted-foreground">2 · 订阅 ID</Label>
                  <Input
                    className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
                    placeholder="Azure Subscription ID"
                    value={azureSubscriptionId}
                    onChange={(e) => onAzureSubscriptionChange(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">应用注册（服务主体）</p>
              <div className="space-y-2 pl-0 sm:pl-1 border-l-2 border-border/80 ml-0.5">
                <div className="space-y-1 pl-2">
                  <Label className="text-xs text-muted-foreground">3 · 应用（客户端）ID</Label>
                  <Input
                    className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
                    placeholder="应用程序（客户端）ID"
                    value={azureClientId}
                    onChange={(e) => onAzurePatch({ azure_client_id: e.target.value })}
                  />
                </div>
                <div className="space-y-1 pl-2">
                  <Label className="text-xs text-muted-foreground">4 · 应用密钥</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    className={cn("font-mono text-xs h-9", CTRL_SURFACE)}
                    placeholder="Client Secret"
                    value={azureClientSecret}
                    onChange={(e) => onAzurePatch({ azure_client_secret: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  )
}

/** 供父组件持有的 Azure Tab A 状态 */
type AzureInviteState = {
  invite: {
    id: number
    consent_url: string
    expires_at: string
    status: "pending" | "consumed" | "failed" | "expired"
    cloud_account_id: number | null
    error_reason?: string | null
  } | null
  starting: boolean
  verifying: boolean
  verifyMessage: string | null
  discovered: AzureDiscoveredSubscription[]
  selectedSubscriptionId: string
}

const emptyInviteState: AzureInviteState = {
  invite: null,
  starting: false,
  verifying: false,
  verifyMessage: null,
  discovered: [],
  selectedSubscriptionId: "",
}

/** Azure Tab A「链接接入」渲染体 */
function AzureInviteSection({
  accountName,
  supplySourceId,
  state,
  onStateChange,
}: {
  accountName: string
  /** 外层已选的 Azure 货源 id（字符串，空即未选）。verify 后订阅会自动挂到此货源下 */
  supplySourceId?: string
  state: AzureInviteState
  onStateChange: (patch: Partial<AzureInviteState>) => void
}) {
  const [copied, setCopied] = useState(false)

  const ssIdNum = supplySourceId ? Number(supplySourceId) : null
  const canGenerate = accountName.trim().length > 0 && !state.starting && !state.invite && !!ssIdNum

  const handleGenerate = async () => {
    if (!canGenerate) return
    onStateChange({ starting: true })
    try {
      const resp: AzureConsentStartResponse = await azureConsentApi.start({
        account_name: accountName.trim(),
        supply_source_id: ssIdNum,
      })
      // 后端从 list 接口取回以同步 id（start 响应里没给 id）
      const all = await azureConsentApi.listInvites()
      const mine = all
        .filter((i) => i.account_name === accountName.trim() && i.status === "pending")
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0]
      onStateChange({
        starting: false,
        invite: {
          id: mine?.id ?? 0,
          consent_url: resp.consent_url,
          expires_at: resp.expires_at,
          status: "pending",
          cloud_account_id: null,
        },
      })
    } catch (e) {
      onStateChange({ starting: false })
      alert(`生成邀请链接失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  const handleCopy = () => {
    if (!state.invite) return
    navigator.clipboard.writeText(state.invite.consent_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleVerify = async () => {
    if (!state.invite?.cloud_account_id) return
    onStateChange({ verifying: true, verifyMessage: null })
    try {
      const r = await azureConsentApi.verify(state.invite.cloud_account_id)
      onStateChange({
        verifying: false,
        verifyMessage: r.message,
        discovered: r.discovered_subscriptions,
        selectedSubscriptionId:
          state.selectedSubscriptionId ||
          (r.discovered_subscriptions.length === 1 ? r.discovered_subscriptions[0].subscription_id : ""),
      })
    } catch (e) {
      onStateChange({
        verifying: false,
        verifyMessage: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const handleRevokeAndReset = async () => {
    if (state.invite && state.invite.status === "pending") {
      try { await azureConsentApi.revokeInvite(state.invite.id) } catch { /* ignore */ }
    }
    onStateChange(emptyInviteState)
  }

  const jsonPreview = useMemo(() => {
    if (!state.invite) return ""
    const obj = {
      invite_id: state.invite.id || null,
      status: state.invite.status,
      consent_url: state.invite.consent_url,
      expires_at: state.invite.expires_at,
      cloud_account_id: state.invite.cloud_account_id,
      discovered_subscriptions: state.discovered.length > 0 ? state.discovered : null,
      selected_subscription_id: state.selectedSubscriptionId || null,
    }
    return JSON.stringify(obj, null, 2)
  }, [state])

  const statusPill = (() => {
    if (!state.invite) return null
    const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
      pending:  { label: "待客户同意", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",  icon: <Clock className="w-3 h-3" /> },
      consumed: { label: "已同意",     cls: "bg-green-500/15 text-green-400 border-green-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
      failed:   { label: "失败",       cls: "bg-red-500/15 text-red-400 border-red-500/30",     icon: <AlertTriangle className="w-3 h-3" /> },
      expired:  { label: "已过期",     cls: "bg-gray-500/15 text-gray-400 border-gray-500/30",   icon: <AlertTriangle className="w-3 h-3" /> },
    }
    const info = map[state.invite.status] ?? map.pending
    return (
      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border", info.cls)}>
        {info.icon} {info.label}
      </span>
    )
  })()

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-background/50 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2">
          <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="text-foreground/90 font-medium">默认接入方式：邀请链接</p>
            <p>
              生成后发给客户 <span className="text-foreground/80">租户级管理员（Global Admin 等）</span> 一键点击，后端自动创建云账号。
              客户再去目标订阅分配 <code className="text-[10px]">Cost Management Reader</code>，回来点"验证订阅"即可。
            </p>
          </div>
        </div>
      </div>

      {!state.invite ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="gap-1.5"
          >
            {state.starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            生成接入链接
          </Button>
          {!accountName.trim() && (
            <p className="text-[11px] text-muted-foreground">请先在上方填写"显示名称"</p>
          )}
          {accountName.trim() && !ssIdNum && (
            <p className="text-[11px] text-amber-400">请先在上方选择"供应商"和"云（货源）"</p>
          )}
          {accountName.trim() && ssIdNum && (
            <p className="text-[11px] text-muted-foreground text-center">
              客户同意并分配 Cost Management Reader 后，点"验证订阅"，<br/>
              <b>该租户下所有订阅会自动建成服务账号，挂到你上面选的货源下</b>。
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {statusPill}
            <span className="text-[11px] text-muted-foreground">
              有效期至 {state.invite.expires_at ? new Date(state.invite.expires_at).toLocaleString("zh-CN") : "-"}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              授权链接（发送给客户）
              <span className="ml-2 text-[10px] text-muted-foreground/70">
                长度 {state.invite.consent_url?.length ?? 0} 字符
              </span>
            </Label>
            <div className="flex gap-2 items-start">
              <Textarea
                readOnly
                value={state.invite.consent_url}
                rows={3}
                className={cn(
                  "font-mono text-[11px] leading-snug resize-none break-all whitespace-pre-wrap",
                  CTRL_SURFACE
                )}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  onClick={handleCopy}
                  title={copied ? "已复制" : "复制链接"}
                >
                  {copied ? (
                    <><CheckCircle2 className="w-4 h-4 text-green-400 mr-1" /><span className="text-[11px]">已复制</span></>
                  ) : (
                    <><Copy className="w-4 h-4 mr-1" /><span className="text-[11px]">复制</span></>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => state.invite && window.open(state.invite.consent_url, "_blank", "noopener,noreferrer")}
                  title="在新标签打开此链接（自测用）"
                >
                  <ExternalLink className="w-4 h-4 mr-1" />
                  <span className="text-[11px]">打开</span>
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              点"复制"后直接发给客户即可；"打开"按钮仅用于自测链接是否有效。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">接入进度（JSON 只读）</Label>
            <Textarea
              readOnly
              rows={7}
              value={jsonPreview}
              className={cn("font-mono text-[11px] min-h-[140px]", CTRL_SURFACE)}
            />
          </div>

          {state.invite.status === "consumed" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleVerify} disabled={state.verifying}>
                  {state.verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                  验证订阅
                </Button>
                {state.verifyMessage && (
                  <span className="text-[11px] text-muted-foreground">{state.verifyMessage}</span>
                )}
              </div>

              {state.discovered.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">选择要绑定到本货源的订阅</Label>
                  <Select
                    value={state.selectedSubscriptionId}
                    onValueChange={(v) => onStateChange({ selectedSubscriptionId: v })}
                  >
                    <SelectTrigger className={cn("h-9 w-full font-mono text-xs", CTRL_SURFACE)}>
                      <SelectValue placeholder="从发现的订阅中选择一个" />
                    </SelectTrigger>
                    <SelectContent>
                      {state.discovered.map((s) => (
                        <SelectItem key={s.subscription_id} value={s.subscription_id}>
                          {s.display_name} · {s.subscription_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    一个租户若有多个订阅，可再次创建货源时复用同一租户（系统检测到已存在的 tenant 会复用账号）。
                  </p>
                </div>
              )}
            </div>
          )}

          {(state.invite.status === "failed" || state.invite.status === "expired") && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-400">
              {state.invite.status === "expired" ? "邀请已过期" : "客户未完成同意"}
              {state.invite.error_reason && `：${state.invite.error_reason}`}
              。请重新生成。
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={handleRevokeAndReset}>
              {state.invite.status === "pending" ? "作废并重新生成" : "重新生成"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Azure 凭证 JSON：与表单字段合并（JSON 里非空字段覆盖上方输入） */
function mergeAzureCredentialJson(
  jsonRaw: string,
  fields: {
    tenant_id: string
    client_id: string
    client_secret: string
    subscription_id: string
  },
): { tenant_id: string; client_id: string; client_secret: string; subscription_id: string } {
  if (!jsonRaw.trim()) return fields
  let j: Record<string, unknown>
  try {
    j = JSON.parse(jsonRaw) as Record<string, unknown>
  } catch {
    throw new Error("Azure JSON 不是合法 JSON")
  }
  if (!j || typeof j !== "object") throw new Error("Azure JSON 须为对象")
  const pick = (k: string, fb: string) => {
    if (!Object.prototype.hasOwnProperty.call(j, k)) return fb
    const v = j[k]
    if (v === undefined || v === null) return fb
    const s = String(v).trim()
    return s !== "" ? s : fb
  }
  return {
    tenant_id: pick("tenant_id", fields.tenant_id),
    client_id: pick("client_id", fields.client_id),
    client_secret: pick("client_secret", fields.client_secret),
    subscription_id: pick("subscription_id", fields.subscription_id),
  }
}

/* ─── Tree: 供应商 → 货源(云) → 主体 → 账号 ─────────────────── */
/** 主体桶。entityId === null 表示「未分配主体」分组（accounts.entity_id 为空）。 */
export interface EntityBucket {
  entityId: number | null
  entityName: string | null
  note: string | null
  accounts: ServiceAccount[]
}
interface SourceBucket {
  supplySourceId: number
  provider: string
  entities: EntityBucket[]
}
interface SupplierTreeNode {
  supplierName: string
  sources: SourceBucket[]
}

const UNASSIGNED_ENTITY_LABEL = "未分配主体"

function buildTree(
  accounts: ServiceAccount[],
  sources: SupplySourceItem[],
  entities: EntityItem[],
): SupplierTreeNode[] {
  const srcById = new Map(sources.map((s) => [s.id, s]))

  // sup → supplySourceId → entityId(null = 未分配) → bucket
  type EBuckets = Map<number | null, EntityBucket>
  const bySup = new Map<string, Map<number, EBuckets>>()

  const ensureSup = (name: string) => {
    if (!bySup.has(name)) bySup.set(name, new Map())
    return bySup.get(name)!
  }
  const ensureSrc = (m: Map<number, EBuckets>, ssid: number) => {
    if (!m.has(ssid)) m.set(ssid, new Map())
    return m.get(ssid)!
  }
  const ensureBucket = (
    b: EBuckets,
    entityId: number | null,
    entityName: string | null,
    note: string | null,
  ) => {
    const existing = b.get(entityId)
    if (existing) return existing
    const fresh: EntityBucket = { entityId, entityName, note, accounts: [] }
    b.set(entityId, fresh)
    return fresh
  }

  // 先建空货源 + 空主体桶（即使没有账号也展示出来）
  for (const s of sources) {
    const name = s.supplier_name ?? "未知"
    ensureSrc(ensureSup(name), s.id)
  }
  for (const e of entities) {
    const src = srcById.get(e.supply_source_id)
    const sname = src?.supplier_name ?? e.supplier_name ?? "未知"
    const b = ensureSrc(ensureSup(sname), e.supply_source_id)
    ensureBucket(b, e.id, e.name, e.note ?? null)
  }

  // 分账号到桶里。账号无 entity_id → 「未分配主体」
  for (const a of accounts) {
    const src = srcById.get(a.supply_source_id)
    const sname = src?.supplier_name ?? a.supplier_name ?? "未知"
    const b = ensureSrc(ensureSup(sname), a.supply_source_id)
    if (a.entity_id != null) {
      const bucket = ensureBucket(b, a.entity_id, a.entity_name ?? null, null)
      bucket.accounts.push(a)
    } else {
      const bucket = ensureBucket(b, null, null, null)
      bucket.accounts.push(a)
    }
  }

  return Array.from(bySup.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplierName, idMap]) => ({
      supplierName,
      sources: Array.from(idMap.entries())
        .map(([supplySourceId, bMap]) => {
          const buckets = Array.from(bMap.values())
          // 排序：未分配主体永远排最后；其余按名字
          buckets.sort((x, y) => {
            if (x.entityId === null) return 1
            if (y.entityId === null) return -1
            return (x.entityName ?? "").localeCompare(y.entityName ?? "", "zh-CN")
          })
          return {
            supplySourceId,
            provider: srcById.get(supplySourceId)?.provider ?? "?",
            entities: buckets,
          }
        })
        .sort((x, y) => x.provider.localeCompare(y.provider)),
    }))
}

/** 当前选中节点：
 *  - 只选到货源 → entityId === undefined（展示该货源下所有主体的账号）
 *  - 选到具体主体（含「未分配」）→ entityId === number | null
 */
export type SelectedSupplySource = {
  supplySourceId: number
  supplierName: string
  provider: string
  entityId?: number | null
  entityName?: string | null
}

/* ─── Main Page ──────────────────────────────────────────── */
export default function AccountsPage() {
  const { data: accounts = [], mutate: mutateAccounts, isLoading: loading } = useAccounts()
  const { data: sources = [], mutate: mutateSources } = useSupplySourcesAll()
  const { data: entities = [], mutate: mutateEntities } = useEntitiesAll()
  const [selectedGroup, setSelectedGroup] = useState<SelectedSupplySource | null>(null)

  // ─── 左侧树面板宽度（可拖拽，localStorage 持久化） ─────────────
  // 主体名长了会顶到面板右边，挡住「✏️/🗑️」按钮，所以需要可拖宽。
  // 范围 [280, 700] 是经验值：再窄货源名/账号数 badge 会换行，再宽挤压右侧账号卡片。
  const SIDEBAR_MIN = 280
  const SIDEBAR_MAX = 700
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 320
    const saved = Number(window.localStorage.getItem("accounts:sidebarWidth") ?? "")
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 320
  })
  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("accounts:sidebarWidth", String(sidebarWidth))
  }, [sidebarWidth])
  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)))
      setSidebarWidth(next)
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    // 拖动过程中防选中文字、统一光标
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [sidebarWidth])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ServiceAccountDetail | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [showCreds, setShowCreds] = useState(false)
  const [creds, setCreds] = useState<Record<string, unknown> | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [createCredMode, setCreateCredMode] = useState<CredUiMode>("fields")
  const [editCredMode, setEditCredMode] = useState<CredUiMode>("fields")
  const [inviteState, setInviteState] = useState<AzureInviteState>(emptyInviteState)
  const patchInviteState = useCallback(
    (patch: Partial<AzureInviteState>) => setInviteState((prev) => ({ ...prev, ...patch })),
    [],
  )

  // external_project_id：入库的账号/订阅/项目 ID；Azure 与订阅字段同步，AWS/GCP 由下方 JSON 解析或编辑预填
  // Taiji：不走单建路径，secret_json 复用为快照 JSON、taiji_blob_sas_url 单独存放 SAS
  const [form, setForm] = useState({
    supplier_id: "",
    supply_source_id: "",
    /** "" = 未分配主体；string(id) = 选中具体主体 */
    entity_id: "",
    name: "", external_project_id: "",
    secret_json: "", notes: "",
    order_method: "",
    azure_tenant_id: "",
    azure_client_id: "",
    azure_client_secret: "",
    azure_json: "",
    /** Taiji 专用：日快照 SAS URL（按日拉 {date}_UTC+0.json）。其他 provider 忽略 */
    taiji_blob_sas_url: "",
  })

  const [editForm, setEditForm] = useState({
    supplier_id: "",
    supply_source_id: "",
    /** "" = 未分配主体；string(id) = 选中具体主体 */
    entity_id: "",
    name: "", external_project_id: "",
    secret_json: "", notes: "",
    order_method: "",
    azure_tenant_id: "",
    azure_client_id: "",
    azure_client_secret: "",
    azure_json: "",
  })

  /** 编辑时记录原始 entity_id（数字或 null），用于 patch 决策（不动 / 切换 / 清空）。 */
  const editOriginalEntityRef = useRef<number | null>(null)

  /** 编辑 Azure 时拉取的凭证，用于在「应用密钥」留空时保留原值 */
  const editAzureCredsRef = useRef<Record<string, string> | null>(null)

  const suppliersOptions = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of sources) {
      m.set(s.supplier_id, s.supplier_name ?? "")
    }
    return Array.from(m.entries()).sort((a, b) => (a[1] || "").localeCompare(b[1] || "", "zh-CN"))
  }, [sources])

  // 当前用户的 visible_providers — null 表示全量(admin/ops)
  const { data: me } = useSWR("auth:me", () => authApi.me(), { revalidateOnFocus: false })
  const visibleProviders = me?.visible_providers  // null = 全量;["aws"] = 仅 AWS
  const isCloudAdmin = (me?.roles ?? []).includes("cloud_admin")

  // Taiji 清理重复数据的 running 状态；真正的 handler 在 load 声明之后定义
  // （deps 引用 load —— 不能放在 load 上面，否则 TDZ）。
  const [taijiCleanupRunning, setTaijiCleanupRunning] = useState(false)

  /** 当前用户能否管理某 provider 下的主体（增/改/删）。
   *  - admin/ops (visibleProviders === null) → 任意 provider
   *  - cloud_<provider> → 自己的 provider
   *  与后端 ensure_provider_visible 完全对齐。 */
  const canManageEntityProvider = useCallback(
    (provider: string) => {
      if (!visibleProviders) return true
      return visibleProviders.includes(provider)
    },
    [visibleProviders],
  )

  // ─── 主体 CRUD 对话框状态 ────────────────────────────────────
  const [entityDialogOpen, setEntityDialogOpen] = useState(false)
  const [entityDialogMode, setEntityDialogMode] = useState<"create" | "edit">("create")
  const [entityDialogTarget, setEntityDialogTarget] = useState<{
    supplySourceId: number
    supplierName: string
    provider: string
    entityId?: number
  } | null>(null)
  const [entityForm, setEntityForm] = useState<{ name: string; note: string }>({ name: "", note: "" })
  const [entitySubmitting, setEntitySubmitting] = useState(false)

  const openCreateEntity = (supplySourceId: number, supplierName: string, provider: string) => {
    setEntityDialogMode("create")
    setEntityDialogTarget({ supplySourceId, supplierName, provider })
    setEntityForm({ name: "", note: "" })
    setEntityDialogOpen(true)
  }
  const openEditEntity = (e: { id: number; name: string; note: string | null; supplySourceId: number }) => {
    setEntityDialogMode("edit")
    const src = sources.find((s) => s.id === e.supplySourceId)
    setEntityDialogTarget({
      supplySourceId: e.supplySourceId,
      supplierName: src?.supplier_name ?? "",
      provider: src?.provider ?? "",
      entityId: e.id,
    })
    setEntityForm({ name: e.name, note: e.note ?? "" })
    setEntityDialogOpen(true)
  }
  const submitEntity = async () => {
    if (!entityDialogTarget) return
    const name = entityForm.name.trim()
    if (!name) { alert("主体名称不能为空"); return }
    const note = entityForm.note.trim() || null
    setEntitySubmitting(true)
    try {
      if (entityDialogMode === "create") {
        await suppliersApi.createEntity(entityDialogTarget.supplySourceId, { name, note })
      } else if (entityDialogTarget.entityId != null) {
        await suppliersApi.updateEntity(entityDialogTarget.entityId, { name, note })
      }
      setEntityDialogOpen(false)
      await mutateEntities()
      await mutateAccounts()
    } catch (e) {
      alert(`保存失败: ${(e as Error).message}`)
    } finally {
      setEntitySubmitting(false)
    }
  }
  const handleDeleteEntity = async (e: { id: number; name: string; accountCount: number }) => {
    if (e.accountCount > 0) {
      alert(`主体「${e.name}」下还有 ${e.accountCount} 个服务账号，先把账号迁出或解绑主体再删除`)
      return
    }
    if (!confirm(`确定删除主体「${e.name}」？此操作不可撤销。`)) return
    try {
      await suppliersApi.deleteEntity(e.id)
      // 若刚刚选中的就是这个主体，回退到货源整体
      if (selectedGroup?.entityId === e.id) {
        setSelectedGroup({ ...selectedGroup, entityId: undefined, entityName: undefined })
      }
      await mutateEntities()
      await mutateAccounts()
    } catch (err) {
      alert(`删除失败: ${(err as Error).message}`)
    }
  }

  /** 按当前用户的 provider 范围过滤货源选项(添加/编辑云账号时,只能选自己能管的云)。 */
  const filterByProviderScope = (arr: SupplySourceItem[]) => {
    if (!visibleProviders) return arr  // null = 全量
    return arr.filter((s) => visibleProviders.includes(s.provider))
  }

  const formSourcesForSupplier = useMemo(() => {
    const arr = filterByProviderScope(
      sources.filter((s) => String(s.supplier_id) === form.supplier_id)
    )
    return [...arr].sort((a, b) => a.provider.localeCompare(b.provider))
  }, [sources, form.supplier_id, visibleProviders])

  const editSourcesForSupplier = useMemo(() => {
    const arr = filterByProviderScope(
      sources.filter((s) => String(s.supplier_id) === editForm.supplier_id)
    )
    return [...arr].sort((a, b) => a.provider.localeCompare(b.provider))
  }, [sources, editForm.supplier_id, visibleProviders])

  /** 编辑弹窗当前选中货源下可选主体列表（按名字排序） */
  const entitiesForEditSource = useMemo(() => {
    if (!editForm.supply_source_id) return [] as EntityItem[]
    const ssid = Number(editForm.supply_source_id)
    return entities
      .filter((e) => e.supply_source_id === ssid)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"))
  }, [entities, editForm.supply_source_id])

  /** 新建弹窗当前选中货源下可选主体列表 */
  const entitiesForCreateSource = useMemo(() => {
    if (!form.supply_source_id) return [] as EntityItem[]
    const ssid = Number(form.supply_source_id)
    return entities
      .filter((e) => e.supply_source_id === ssid)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"))
  }, [entities, form.supply_source_id])

  const load = useCallback(async () => {
    await Promise.all([mutateAccounts(), mutateSources(), mutateEntities()])
  }, [mutateAccounts, mutateSources, mutateEntities])

  const loadDetail = useCallback(async (id: number) => {
    try { setSelectedId(id); setShowCreds(false); setCreds(null); const d = await accountsApi.get(id); setDetail(d) }
    catch (e) { console.error(e) }
  }, [])

  // Taiji 清理重复数据 handler。必须在 load 声明之后定义（deps 引用 load）
  const handleTaijiCleanup = useCallback(async () => {
    if (!selectedGroup || selectedGroup.provider !== "taiji") return
    setTaijiCleanupRunning(true)
    try {
      const dry = await accountsApi.taijiCleanupDuplicates({
        supply_source_id: selectedGroup.supplySourceId,
        dry_run: true,
      })
      const lines = [
        `Taiji 重复数据清理 — 干跑结果：`,
        ``,
        `- 当前 Taiji DataSource 数: ${dry.total_data_sources_before}`,
        `- 将保留的 DS id: ${dry.kept_data_source_id}`,
        `- 将删除孤儿 DataSource: ${dry.orphan_data_sources_removed}`,
        `- 将删除孤儿 CloudAccount: ~${dry.orphan_cloud_accounts_removed}`,
        `- 将删除的重复 billing 行: ${dry.billing_rows_deleted_as_dup}`,
        `- 重定向到保留 DS 的 billing 行: ${dry.billing_rows_reassigned_to_kept}`,
        `- 需要 repoint 的 Project: ${dry.projects_repointed}`,
        ``,
        `继续执行真改库？此操作不可撤销。`,
      ]
      if (!confirm(lines.join("\n"))) return
      const real = await accountsApi.taijiCleanupDuplicates({
        supply_source_id: selectedGroup.supplySourceId,
        dry_run: false,
      })
      alert(
        `清理完成：删 ${real.billing_rows_deleted_as_dup} 行重复 billing，` +
        `${real.orphan_data_sources_removed} 个孤儿 DS / ${real.orphan_cloud_accounts_removed} 个孤儿 CA，` +
        `${real.projects_repointed} 个 Project 重定向到 DS#${real.kept_data_source_id}`,
      )
      await load()
    } catch (e) {
      alert(`清理失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTaijiCleanupRunning(false)
    }
  }, [selectedGroup, load])

  // 按 visible_providers 过滤树数据：cloud_<provider> 用户只看本云的货源/主体；
  // admin/ops (visibleProviders === null) 看全量。后端已对 /supply-sources/all 等
  // 做同样过滤，这里是 UI 防御层 + 减少老缓存/管理员模拟视图的混乱。
  const visibleSources = useMemo(() => {
    if (!visibleProviders) return sources
    return sources.filter((s) => visibleProviders.includes(s.provider))
  }, [sources, visibleProviders])
  const visibleEntities = useMemo(() => {
    if (!visibleProviders) return entities
    const provOf = new Map(sources.map((s) => [s.id, s.provider]))
    return entities.filter((e) => {
      const p = e.provider ?? provOf.get(e.supply_source_id)
      return p ? visibleProviders.includes(p) : false
    })
  }, [entities, sources, visibleProviders])

  const tree = useMemo(
    () => buildTree(accounts, visibleSources, visibleEntities),
    [accounts, visibleSources, visibleEntities],
  )

  // 选中节点的过滤：货源必匹配；如果带 entityId 则进一步过滤主体（null=未分配）
  const groupAccounts = useMemo(() => {
    if (!selectedGroup) return []
    const inSrc = accounts.filter((a) => a.supply_source_id === selectedGroup.supplySourceId)
    if (selectedGroup.entityId === undefined) return inSrc
    if (selectedGroup.entityId === null) return inSrc.filter((a) => a.entity_id == null)
    return inSrc.filter((a) => a.entity_id === selectedGroup.entityId)
  }, [accounts, selectedGroup])

  // ─── 搜索：跨字段、按 selectedGroup 自动 scope ─────────────────
  // - 输入框始终可见。无 selectedGroup 时全局搜；有 selectedGroup 时仅在该节点内搜。
  // - 命中字段：name / external_project_id / supplier_name / entity_name / customer_codes[]
  // - 命中即并集，case-insensitive。
  const [searchQuery, setSearchQuery] = useState("")
  const searchTrimmed = searchQuery.trim()
  const isSearching = searchTrimmed.length > 0
  // View mode: "cards" shows account cards for selected group, "detail" shows single account.
  // 搜索时强制走 cards：搜索结果优先于"已选某账号详情"，避免误把搜索 hit 当成详情上下文。
  const viewMode = selectedId && detail && !isSearching ? "detail" : "cards"
  /** 搜索时的"候选池"：有 selectedGroup → groupAccounts；否则 → 全部可见账号 */
  const searchScopeAccounts = useMemo(
    () => (selectedGroup ? groupAccounts : accounts),
    [selectedGroup, groupAccounts, accounts],
  )
  const searchResults = useMemo(() => {
    if (!isSearching) return searchScopeAccounts
    const q = searchTrimmed.toLowerCase()
    return searchScopeAccounts.filter((a) => {
      if ((a.name || "").toLowerCase().includes(q)) return true
      if ((a.external_project_id || "").toLowerCase().includes(q)) return true
      if ((a.supplier_name || "").toLowerCase().includes(q)) return true
      if ((a.entity_name || "").toLowerCase().includes(q)) return true
      if ((a.customer_codes || []).some((c) => (c || "").toLowerCase().includes(q))) return true
      return false
    })
  }, [searchScopeAccounts, isSearching, searchTrimmed])

  /** 右侧实际显示的账号列表：
   *  - 搜索中：searchResults（已 scope）
   *  - 否则有 selectedGroup：groupAccounts
   *  - 否则：空（左侧提示语兜底） */
  const displayedAccounts = useMemo(() => {
    if (isSearching) return searchResults
    if (selectedGroup) return groupAccounts
    return [] as ServiceAccount[]
  }, [isSearching, searchResults, selectedGroup, groupAccounts])

  // ─── 服务账号分页(client-side):每页 N 张卡片 ────────────────
  const [accountsPage, setAccountsPage] = useState(1)
  const [accountsPageSize, setAccountsPageSize] = useState(24)
  const accountsTotalPages = Math.max(1, Math.ceil(displayedAccounts.length / accountsPageSize))
  const pagedAccounts = useMemo(() => {
    const start = (accountsPage - 1) * accountsPageSize
    return displayedAccounts.slice(start, start + accountsPageSize)
  }, [displayedAccounts, accountsPage, accountsPageSize])

  // 查询/scope 改变时回到第 1 页
  useEffect(() => {
    setAccountsPage(1)
  }, [searchTrimmed, selectedGroup])

  const handleSelectGroup = (supplierName: string, supplySourceId: number, provider: string) => {
    setSelectedGroup({ supplierName, supplySourceId, provider })
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
    setBulkSelectedIds(new Set())  // 切货源时清空批量选择
    setAccountsPage(1)              // 切货源时回到第 1 页
  }

  const handleSelectEntity = (
    supplierName: string,
    supplySourceId: number,
    provider: string,
    entityId: number | null,
    entityName: string | null,
  ) => {
    setSelectedGroup({ supplierName, supplySourceId, provider, entityId, entityName })
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
    setBulkSelectedIds(new Set())
    setAccountsPage(1)
  }

  // ─── 批量分配服务账号到另一个货源 ─────────────────────
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(new Set())
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkTargetSupplierId, setBulkTargetSupplierId] = useState<string>("")
  const [bulkTargetSSId, setBulkTargetSSId] = useState<string>("")
  const [bulkSubmitting, setBulkSubmitting] = useState(false)

  const toggleBulkPick = (id: number) => {
    setBulkSelectedIds((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  // 已选账号的 provider 集合；只有单一 provider 才能分配（跨 provider 禁）
  const bulkProviders = useMemo(() => {
    const ps = new Set<string>()
    for (const id of bulkSelectedIds) {
      const a = accounts.find((x) => x.id === id)
      if (a) ps.add(a.provider)
    }
    return ps
  }, [bulkSelectedIds, accounts])

  const bulkSingleProvider = bulkProviders.size === 1 ? Array.from(bulkProviders)[0] : null

  // 弹窗里目标货源候选：按"目标供应商"+"源账号 provider"过滤
  const bulkTargetSSCandidates = useMemo(() => {
    if (!bulkTargetSupplierId || !bulkSingleProvider) return []
    const supId = Number(bulkTargetSupplierId)
    return sources.filter(
      (s) => s.supplier_id === supId
        && s.provider === bulkSingleProvider
        && s.id !== selectedGroup?.supplySourceId  // 禁选当前货源
    )
  }, [bulkTargetSupplierId, bulkSingleProvider, sources, selectedGroup])

  const openBulkDialog = () => {
    setBulkTargetSupplierId("")
    setBulkTargetSSId("")
    setBulkDialogOpen(true)
  }

  const submitBulkAssign = async () => {
    if (!bulkTargetSSId || bulkSelectedIds.size === 0) return
    setBulkSubmitting(true)
    try {
      const r = await accountsApi.bulkAssign({
        account_ids: Array.from(bulkSelectedIds),
        target_supply_source_id: Number(bulkTargetSSId),
      })
      let msg = `已迁移 ${r.moved} 个到「${r.target_supplier_name} / ${r.target_provider.toUpperCase()}」`
      if (r.skipped.length > 0) {
        msg += `；跳过 ${r.skipped.length} 个（${r.skipped.map((s) => `#${s.account_id}:${s.reason}`).join("；")}）`
      }
      alert(msg)
      setBulkDialogOpen(false)
      setBulkSelectedIds(new Set())
      // 触发账号列表刷新
      await mutateAccounts()
    } catch (e) {
      alert(`批量分配失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBulkSubmitting(false)
    }
  }

  // ─── 批量分配服务账号到主体（同一货源内） ─────────────────
  // selectedGroup 一定存在（界面才看得到批量按钮），且 bulkSelectedIds 只在切货源时清空，
  // 所以这里的目标主体下拉只列「当前货源 supply_source_id」下的主体。
  const [bulkEntityDialogOpen, setBulkEntityDialogOpen] = useState(false)
  /** "" = 未选；ENTITY_SELECT_UNASSIGNED = 清空主体；其他 = entity id */
  const [bulkTargetEntityId, setBulkTargetEntityId] = useState<string>("")
  const [bulkEntitySubmitting, setBulkEntitySubmitting] = useState(false)

  const bulkEntityCandidates = useMemo(() => {
    if (!selectedGroup) return [] as EntityItem[]
    return entities
      .filter((e) => e.supply_source_id === selectedGroup.supplySourceId)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"))
  }, [entities, selectedGroup])

  const openBulkEntityDialog = () => {
    setBulkTargetEntityId("")
    setBulkEntityDialogOpen(true)
  }

  const submitBulkAssignEntity = async () => {
    if (!bulkTargetEntityId || bulkSelectedIds.size === 0) return
    const targetEntityId =
      bulkTargetEntityId === ENTITY_SELECT_UNASSIGNED ? null : Number(bulkTargetEntityId)
    setBulkEntitySubmitting(true)
    try {
      const r = await accountsApi.bulkAssignEntity({
        account_ids: Array.from(bulkSelectedIds),
        target_entity_id: targetEntityId,
      })
      const target = r.target_entity_name ?? "未分配主体"
      let msg = `已迁移 ${r.moved} 个到「${target}」`
      if (r.skipped.length > 0) {
        msg += `；跳过 ${r.skipped.length} 个（${r.skipped.map((s) => `#${s.account_id}:${s.reason}`).join("；")}）`
      }
      alert(msg)
      setBulkEntityDialogOpen(false)
      setBulkSelectedIds(new Set())
      await Promise.all([mutateAccounts(), mutateEntities()])
    } catch (e) {
      alert(`批量分配主体失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBulkEntitySubmitting(false)
    }
  }

  // ─── 批量删除服务账号 ─────────────────────
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const submitBulkDelete = async () => {
    if (bulkSelectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = Array.from(bulkSelectedIds)
    try {
      const results = await Promise.allSettled(ids.map((id) => accountsApi.hardDelete(id)))
      const failed: { id: number; reason: string }[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === "fulfilled") ok += 1
        else failed.push({ id: ids[i], reason: r.reason instanceof Error ? r.reason.message : String(r.reason) })
      })
      let msg = `已删除 ${ok} 个`
      if (failed.length > 0) {
        msg += `；失败 ${failed.length} 个（${failed.map((f) => `#${f.id}:${f.reason}`).join("；")}）`
      }
      alert(msg)
      // 若当前详情卡片正是被删的账号，关掉
      if (selectedId && bulkSelectedIds.has(selectedId)) {
        setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
      }
      setBulkDeleteOpen(false)
      setBulkSelectedIds(new Set())
      await mutateAccounts()
    } catch (e) {
      alert(`批量删除失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleBackToCards = () => {
    setSelectedId(null); setDetail(null); setShowCreds(false); setCreds(null)
  }

  const formProvider = useMemo(() => {
    const sid = form.supply_source_id ? Number(form.supply_source_id) : null
    if (sid == null || Number.isNaN(sid)) return "aws"
    return sources.find((s) => s.id === sid)?.provider ?? "aws"
  }, [form.supply_source_id, sources])

  // 选到 Azure 时默认切到「链接接入」；离开 Azure 切回「字段」。
  // 只在 provider 变化的瞬间重置，允许用户之后手动切换。
  const prevProviderRef = useRef<string | null>(null)
  useEffect(() => {
    if (!createOpen) {
      prevProviderRef.current = null
      return
    }
    if (prevProviderRef.current === formProvider) return
    prevProviderRef.current = formProvider
    if (formProvider === "azure") {
      setCreateCredMode("invite")
    } else {
      setCreateCredMode("fields")
    }
  }, [formProvider, createOpen])

  // 轮询：邀请 pending 时每 5s 拉一次列表，发现状态变化则同步
  useEffect(() => {
    if (!createOpen) return
    const cur = inviteState.invite
    if (!cur || cur.status !== "pending") return
    const id = setInterval(async () => {
      try {
        const all = await azureConsentApi.listInvites()
        const mine = all.find((i) => i.id === cur.id)
        if (!mine || mine.status === cur.status) return
        const newStatus = mine.status as "pending" | "consumed" | "failed" | "expired"
        patchInviteState({
          invite: {
            ...cur,
            status: newStatus,
            cloud_account_id: mine.cloud_account_id ?? null,
            error_reason: mine.error_reason,
          },
        })
      } catch { /* transient, ignore */ }
    }, 5000)
    return () => clearInterval(id)
  }, [createOpen, inviteState.invite, patchInviteState])

  const editProvider = useMemo(() => {
    const sid = editForm.supply_source_id ? Number(editForm.supply_source_id) : null
    if (sid == null || Number.isNaN(sid)) return detail?.provider ?? "aws"
    return sources.find((s) => s.id === sid)?.provider ?? detail?.provider ?? "aws"
  }, [editForm.supply_source_id, sources, detail])

  /* ─── Actions ───── */
  const emptyForm = () => ({
    supplier_id: "",
    supply_source_id: "",
    entity_id: "",
    name: "",
    external_project_id: "",
    secret_json: "",
    notes: "",
    order_method: "",
    azure_tenant_id: "",
    azure_client_id: "",
    azure_client_secret: "",
    azure_json: "",
    taiji_blob_sas_url: "",
  })

  const handleCreate = async () => {
    try {
      setActionLoading("create")
      const ssid = Number(form.supply_source_id)
      if (!form.supplier_id || !ssid) {
        alert("请选择供应商与云（货源）")
        return
      }

      // Taiji 走后端自动发现路径：前端零输入，后端从 settings.TAIJI_BLOB_SAS_URL
      // 自动拉最新快照、抽 (username, token) 批量建账号；secret_data 落入 sas_url
      if (formProvider === "taiji") {
        try {
          const r = await accountsApi.taijiFromBlob({
            supply_source_id: ssid,
            entity_id: form.entity_id ? Number(form.entity_id) : null,
          })
          let msg = `Taiji 自动建账号：从 ${r.snapshot_date ?? "?"} 快照拉到 ${r.total_parsed} 个 (username:token)，新建 ${r.created} 个 / 跳过 ${r.skipped.length} 个`
          if (r.skipped.length > 0) {
            msg += `\n跳过示例：${r.skipped.slice(0, 3).map((s) => `${s.external_project_id}(${s.reason})`).join("；")}`
          }
          alert(msg)
        } catch (e) {
          alert(`Taiji 自动建账号失败：${e instanceof Error ? e.message : e}`)
          return
        }
        setCreateOpen(false)
        setCreateCredMode("fields")
        setForm(emptyForm())
        await load()
        return
      }

      // Tab A「链接接入」：邀请已被客户同意 → PUT 已有的 cloud_account 完成绑定
      if (formProvider === "azure" && createCredMode === "invite") {
        const inv = inviteState.invite
        if (!inv) {
          alert("请先点「生成接入链接」并把链接发给客户")
          return
        }
        if (inv.status !== "consumed" || !inv.cloud_account_id) {
          alert("邀请尚未完成。客户同意后再回到此处提交；也可直接关闭弹窗，在右上角「邀请记录」里查看进度。")
          return
        }
        if (!inviteState.selectedSubscriptionId) {
          alert("请先点「验证订阅」并选择要绑定的订阅")
          return
        }
        await accountsApi.update(inv.cloud_account_id, {
          supply_source_id: ssid,
          name: form.name,
          external_project_id: inviteState.selectedSubscriptionId,
          notes: form.notes || undefined,
          order_method: form.order_method.trim() || null,
        })
        setCreateOpen(false)
        setCreateCredMode("fields")
        setForm(emptyForm())
        setInviteState(emptyInviteState)
        await load()
        return
      }

      let secret_data: Record<string, unknown> = {}
      let external_id = ""
      if (formProvider === "azure") {
        let merged: { tenant_id: string; client_id: string; client_secret: string; subscription_id: string }
        try {
          merged = mergeAzureCredentialJson(form.azure_json, {
            tenant_id: form.azure_tenant_id.trim(),
            client_id: form.azure_client_id.trim(),
            client_secret: form.azure_client_secret.trim(),
            subscription_id: form.external_project_id.trim(),
          })
        } catch (e) {
          alert(e instanceof Error ? e.message : "JSON 解析失败")
          return
        }
        if (!merged.tenant_id || !merged.client_id || !merged.client_secret || !merged.subscription_id) {
          alert("请在「云厂商账号配置」中填写或通过 JSON 提供：租户 ID、订阅 ID、应用 ID、应用密钥")
          return
        }
        external_id = merged.subscription_id
        secret_data = {
          tenant_id: merged.tenant_id,
          client_id: merged.client_id,
          client_secret: merged.client_secret,
        }
      } else if (formProvider === "aws") {
        try {
          const p = parseAwsCredentialJson(form.secret_json)
          external_id = p.external_id
          secret_data = p.secret_data
        } catch (e) {
          alert(e instanceof Error ? e.message : "AWS 配置无效")
          return
        }
      } else if (formProvider === "gcp") {
        try {
          const p = parseGcpCredentialJson(form.secret_json)
          external_id = p.external_id
          secret_data = p.secret_data
        } catch (e) {
          alert(e instanceof Error ? e.message : "GCP 配置无效")
          return
        }
      }
      // Taiji 走 bulk-import 早退出，此处不会再到 taiji 分支
      await accountsApi.create({
        supply_source_id: ssid,
        entity_id: form.entity_id ? Number(form.entity_id) : null,
        name: form.name,
        external_project_id: external_id,
        secret_data,
        notes: form.notes || undefined,
        order_method: formProvider === "azure" ? (form.order_method.trim() || null) : null,
      })
      setCreateOpen(false)
      setCreateCredMode("fields")
      setForm(emptyForm())
      await load()
    } catch (e) { alert(`创建失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const handleAction = async (action: "suspend" | "activate" | "standby") => {
    if (!selectedId) return
    const labels = { suspend: "停用", activate: "启用", standby: "置为备用" }
    if (!confirm(`确定${labels[action]}此账号？`)) return
    try {
      setActionLoading(action)
      if (action === "suspend") await accountsApi.suspend(selectedId)
      else if (action === "activate") await accountsApi.activate(selectedId)
      else if (action === "standby") await accountsApi.standby(selectedId)
      await load(); await loadDetail(selectedId)
    } catch (e) { alert(`操作失败: ${e instanceof Error ? e.message : e}`) }
    finally { setActionLoading(null) }
  }

  const [customerDraft, setCustomerDraft] = useState("")
  const [customerBusy, setCustomerBusy] = useState(false)
  const handleAddCustomer = async () => {
    if (!selectedId || !detail) return
    const code = customerDraft.trim().toUpperCase()
    if (!code) return
    if ((detail.customer_codes ?? []).includes(code)) { setCustomerDraft(""); return }
    const next = [...(detail.customer_codes ?? []), code]
    try {
      setCustomerBusy(true)
      await accountsApi.update(selectedId, { customer_codes: next })
      setCustomerDraft("")
      await load(); await loadDetail(selectedId)
    } catch (e) { alert(`绑定客户编号失败: ${e instanceof Error ? e.message : e}`) }
    finally { setCustomerBusy(false) }
  }
  const handleRemoveCustomer = async (code: string) => {
    if (!selectedId || !detail) return
    if (!confirm(`解除客户编号 ${code} 与该账号的绑定？`)) return
    const next = (detail.customer_codes ?? []).filter((c) => c !== code)
    try {
      setCustomerBusy(true)
      await accountsApi.update(selectedId, { customer_codes: next })
      await load(); await loadDetail(selectedId)
    } catch (e) { alert(`解绑失败: ${e instanceof Error ? e.message : e}`) }
    finally { setCustomerBusy(false) }
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

  const openEdit = async () => {
    if (!detail) return
    const base = {
      supplier_id: String(detail.supplier_id),
      supply_source_id: String(detail.supply_source_id),
      entity_id: detail.entity_id != null ? String(detail.entity_id) : "",
      name: detail.name,
      external_project_id: detail.external_project_id,
      secret_json: "",
      notes: detail.notes ?? "",
      order_method: detail.order_method ?? "",
      azure_tenant_id: "",
      azure_client_id: "",
      azure_client_secret: "",
      azure_json: "",
    }
    editOriginalEntityRef.current = detail.entity_id ?? null
    editAzureCredsRef.current = null
    if (detail.provider === "azure") {
      try {
        const c = (await accountsApi.credentials(detail.id)) as Record<string, string>
        editAzureCredsRef.current = c
        base.azure_tenant_id = String(c.tenant_id ?? "")
        base.azure_client_id = String(c.client_id ?? "")
        base.azure_client_secret = String(c.client_secret ?? "")
        base.azure_json = JSON.stringify(
          {
            tenant_id: base.azure_tenant_id,
            subscription_id: base.external_project_id,
            client_id: base.azure_client_id,
            client_secret: base.azure_client_secret,
          },
          null,
          2,
        )
      } catch {
        base.azure_json = JSON.stringify(
          {
            tenant_id: "",
            subscription_id: base.external_project_id,
            client_id: "",
            client_secret: "",
          },
          null,
          2,
        )
      }
    } else if (detail.provider === "aws") {
      try {
        const c = (await accountsApi.credentials(detail.id)) as Record<string, string>
        base.secret_json = JSON.stringify(
          {
            account_id: detail.external_project_id,
            aws_access_key_id: String(c.aws_access_key_id ?? ""),
            aws_secret_access_key: String(c.aws_secret_access_key ?? ""),
          },
          null,
          2,
        )
      } catch { /* 留空，用户在下框填写 */ }
    } else if (detail.provider === "gcp") {
      try {
        const c = (await accountsApi.credentials(detail.id)) as Record<string, unknown>
        const sj = c.service_account_json
        if (sj && typeof sj === "object") {
          base.secret_json = JSON.stringify(sj, null, 2)
        }
      } catch { /* 留空 */ }
    } else if (detail.provider === "taiji") {
      try {
        const c = (await accountsApi.credentials(detail.id)) as Record<string, unknown>
        base.secret_json = JSON.stringify(
          {
            api_base: String(c.api_base ?? ""),
            access_token: String(c.access_token ?? ""),
            admin_user_id: String(c.admin_user_id ?? detail.external_project_id ?? ""),
          },
          null,
          2,
        )
      } catch { /* 留空 */ }
    }
    setEditCredMode("fields")
    setEditForm(base)
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
        order_method: editProvider === "azure" ? (editForm.order_method.trim() || null) : null,
      }
      if (newSsid !== detail.supply_source_id) {
        payload.supply_source_id = newSsid
        // 货源切换时后端会自动清主体，前端这一步无需再发 entity_id；
        // 如果用户在切换后又选了目标货源下的主体，下面 entity diff 逻辑会再补发。
      }
      // entity_id diff：与原始值对比；若仅切货源未变主体选择，则保留默认 = ""（与原始一致才不发）
      const origEntity = editOriginalEntityRef.current
      const formEntity = editForm.entity_id ? Number(editForm.entity_id) : null
      if (formEntity !== origEntity || newSsid !== detail.supply_source_id) {
        if (formEntity == null) {
          if (origEntity != null) payload.clear_entity = true
        } else {
          payload.entity_id = formEntity
        }
      }
      if (editProvider === "azure") {
        let merged: { tenant_id: string; client_id: string; client_secret: string; subscription_id: string }
        try {
          merged = mergeAzureCredentialJson(editForm.azure_json, {
            tenant_id: editForm.azure_tenant_id.trim(),
            client_id: editForm.azure_client_id.trim(),
            client_secret: editForm.azure_client_secret.trim(),
            subscription_id: editForm.external_project_id.trim(),
          })
        } catch (e) {
          alert(e instanceof Error ? e.message : "JSON 解析失败")
          return
        }
        payload.external_project_id = merged.subscription_id
        let csec = merged.client_secret
        if (!csec && editAzureCredsRef.current?.client_secret) {
          csec = String(editAzureCredsRef.current.client_secret)
        }
        if (merged.tenant_id && merged.client_id && csec) {
          payload.secret_data = {
            tenant_id: merged.tenant_id,
            client_id: merged.client_id,
            client_secret: csec,
          }
        }
      } else if (editForm.secret_json.trim()) {
        if (editProvider === "aws") {
          try {
            const p = parseAwsCredentialJson(editForm.secret_json)
            payload.external_project_id = p.external_id
            payload.secret_data = p.secret_data
          } catch (e) {
            alert(e instanceof Error ? e.message : "AWS 配置无效")
            return
          }
        } else if (editProvider === "gcp") {
          try {
            const p = parseGcpCredentialJson(editForm.secret_json)
            payload.external_project_id = p.external_id
            payload.secret_data = p.secret_data
          } catch (e) {
            alert(e instanceof Error ? e.message : "GCP 配置无效")
            return
          }
        } else if (editProvider === "taiji") {
          try {
            const p = parseTaijiCredentialJson(editForm.secret_json)
            payload.external_project_id = p.external_id
            payload.secret_data = p.secret_data
          } catch (e) {
            alert(e instanceof Error ? e.message : "Taiji 配置无效")
            return
          }
        } else {
          payload.secret_data = JSON.parse(editForm.secret_json)
        }
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
      <div
        className="shrink-0 flex flex-col bg-card/50"
        style={{ width: sidebarWidth }}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">货源列表</h2>
          <div className="flex items-center gap-1">
            <Dialog open={createOpen} onOpenChange={(open) => {
              setCreateOpen(open)
              if (!open) {
                setForm(emptyForm())
                setCreateCredMode("fields")
                setInviteState(emptyInviteState)
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-7 gap-1 text-xs"><Plus className="w-3.5 h-3.5" />新建货源</Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>新建服务账号</DialogTitle>
                <DialogDescription>
                  上方为云管平台信息；下方「云厂商账号配置」填写对应云的全部账号 ID 与密钥，或通过 JSON 一次性导入全部字段。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>供应商</Label>
                    <Select
                      value={form.supplier_id}
                      onValueChange={(v) => setForm({ ...form, supplier_id: v, supply_source_id: "", order_method: "" })}
                    >
                      <SelectTrigger className={cn("w-full", CTRL_SURFACE)}><SelectValue placeholder="选择供应商" /></SelectTrigger>
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
                      onValueChange={(v) => {
                        const prov = formSourcesForSupplier.find((s) => String(s.id) === v)?.provider
                        setForm((f) => ({
                          ...f,
                          supply_source_id: v,
                          // 切货源 → 主体清空（主体绑定具体货源）
                          entity_id: v !== f.supply_source_id ? "" : f.entity_id,
                          ...(prov && prov !== "azure" ? { order_method: "" } : {}),
                        }))
                      }}
                      disabled={!form.supplier_id}
                    >
                      <SelectTrigger className={cn("w-full", CTRL_SURFACE)}><SelectValue placeholder={form.supplier_id ? "选择云" : "请先选供应商"} /></SelectTrigger>
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
                <div className="space-y-2">
                  <Label className="text-xs">主体（可选）</Label>
                  <Select
                    value={form.entity_id || ENTITY_SELECT_UNASSIGNED}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, entity_id: v === ENTITY_SELECT_UNASSIGNED ? "" : v }))
                    }
                    disabled={!form.supply_source_id}
                  >
                    <SelectTrigger className={cn("h-9", CTRL_SURFACE)}>
                      <SelectValue placeholder={form.supply_source_id ? "选择主体（默认未分配）" : "请先选云"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ENTITY_SELECT_UNASSIGNED}>{UNASSIGNED_ENTITY_LABEL}</SelectItem>
                      {entitiesForCreateSource.map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.supply_source_id && canManageEntityProvider(formSourcesForSupplier.find((s) => String(s.id) === form.supply_source_id)?.provider ?? "") && (
                    <p className="text-[10px] text-muted-foreground">
                      在左侧树「{PROVIDER_LABELS[formSourcesForSupplier.find((s) => String(s.id) === form.supply_source_id)?.provider ?? ""] ?? ""}」行尾的「+」按钮可新增主体。
                    </p>
                  )}
                </div>
                {sources.length === 0 && (
                  <p className="text-xs text-muted-foreground">请先在「供应商管理」中创建供应商并添加货源。</p>
                )}
                {/* Taiji 走批量导入路径：账号名称由 token_name 自动派生，云管信息无意义；其他云保留 */}
                {formProvider !== "taiji" && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 space-y-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">云管信息</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-xs">显示名称</Label>
                        <Input
                          className={cn("h-9", CTRL_SURFACE)}
                          placeholder={formProvider === "azure" ? "租户名称或展示名称" : "在云管中展示的名称"}
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-xs text-muted-foreground">备注</Label>
                        <Input
                          className={cn("h-9", CTRL_SURFACE)}
                          placeholder="可选"
                          value={form.notes}
                          onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        />
                      </div>
                    </div>
                    {formProvider === "azure" && (
                      <div className="space-y-1.5 max-w-md">
                        <Label className="text-xs text-muted-foreground">下单方式（Azure）</Label>
                        <Select
                          value={form.order_method || ORDER_METHOD_SELECT_SENTINEL}
                          onValueChange={(v) =>
                            setForm({ ...form, order_method: v === ORDER_METHOD_SELECT_SENTINEL ? "" : v })
                          }
                        >
                          <SelectTrigger className={cn("h-9 w-full", CTRL_SURFACE)}>
                            <SelectValue placeholder="选择下单方式" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ORDER_METHOD_SELECT_SENTINEL}>未选择</SelectItem>
                            {ORDER_METHOD_OPTIONS.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
                <CredentialSection
                  provider={formProvider}
                  mode={createCredMode}
                  onModeChange={setCreateCredMode}
                  allowInvite={formProvider === "azure"}
                  secretJson={form.secret_json}
                  onSecretJsonChange={(v) => setForm({ ...form, secret_json: v })}
                  azureSubscriptionId={form.external_project_id}
                  onAzureSubscriptionChange={(v) => setForm({ ...form, external_project_id: v })}
                  azureTenantId={form.azure_tenant_id}
                  azureClientId={form.azure_client_id}
                  azureClientSecret={form.azure_client_secret}
                  azureJson={form.azure_json}
                  onAzurePatch={(p) => setForm((f) => ({ ...f, ...p }))}
                  onAzureJsonChange={(v) => setForm({ ...form, azure_json: v })}
                  taijiBlobSasUrl={form.taiji_blob_sas_url}
                  onTaijiBlobSasUrlChange={(v) => setForm({ ...form, taiji_blob_sas_url: v })}
                  inviteSection={
                    <AzureInviteSection
                      accountName={form.name}
                      supplySourceId={form.supply_source_id}
                      state={inviteState}
                      onStateChange={patchInviteState}
                    />
                  }
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button
                  onClick={handleCreate}
                  disabled={
                    !form.supplier_id || !form.supply_source_id || actionLoading === "create"
                    // Taiji 走 bulk-import 不需要 form.name；其他云仍要求 name 必填
                    || (formProvider !== "taiji" && !form.name?.trim())
                    || (formProvider === "azure" && createCredMode === "invite" && (
                      !inviteState.invite
                      || inviteState.invite.status !== "consumed"
                      || !inviteState.invite.cloud_account_id
                      || !inviteState.selectedSubscriptionId
                    ))
                    || (formProvider === "azure" && createCredMode !== "invite" && (() => {
                      try {
                        const m = mergeAzureCredentialJson(form.azure_json, {
                          tenant_id: form.azure_tenant_id.trim(),
                          client_id: form.azure_client_id.trim(),
                          client_secret: form.azure_client_secret.trim(),
                          subscription_id: form.external_project_id.trim(),
                        })
                        return !m.tenant_id || !m.client_id || !m.client_secret || !m.subscription_id
                      } catch {
                        return true
                      }
                    })())
                    || (formProvider === "aws" && (() => {
                      try {
                        parseAwsCredentialJson(form.secret_json)
                        return false
                      } catch {
                        return true
                      }
                    })())
                    || (formProvider === "gcp" && (() => {
                      try {
                        parseGcpCredentialJson(form.secret_json)
                        return false
                      } catch {
                        return true
                      }
                    })())
                    // Taiji 零输入，只需 supplier_id + supply_source_id（上面的通用条件已经覆盖）
                  }
                >
                  {actionLoading === "create" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {formProvider === "azure" && createCredMode === "invite"
                    ? "完成接入"
                    : "创建"}
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
                  onSelectEntity={handleSelectEntity}
                  canManageEntityProvider={canManageEntityProvider}
                  onCreateEntity={openCreateEntity}
                  onEditEntity={openEditEntity}
                  onDeleteEntity={handleDeleteEntity}
                />
              ))}
          </div>
        </ScrollArea>
      </div>

      {/* 拖拽手柄：替代原 border-r，鼠标 hover 高亮 + 拖动调宽度 */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="拖动调整列表宽度"
        onMouseDown={onSidebarDragStart}
        className="w-1 bg-border hover:bg-primary/60 active:bg-primary cursor-col-resize transition-colors shrink-0 select-none"
      />

      {/* ─── Right Panel ─── */}
      <div className="flex-1 overflow-y-auto">
        {/* ─── 顶部搜索栏：始终可见。selectedGroup 决定 scope（无则全局）
              主题：与左侧货源列表统一用 bg-card/50 半透明卡片色 + backdrop-blur，
              避免 bg-background/95 在暗色主题下变成"黑一坨"突兀块。 */}
        <div className="sticky top-0 z-20 bg-card/50 backdrop-blur-md px-6 pt-4 pb-3 border-b border-border">
          <div className="relative max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery("") }}
              placeholder={
                selectedGroup
                  ? `在「${selectedGroup.supplierName} / ${PROVIDER_LABELS[selectedGroup.provider] ?? selectedGroup.provider.toUpperCase()}${selectedGroup.entityId !== undefined ? ` / ${selectedGroup.entityName ?? UNASSIGNED_ENTITY_LABEL}` : ""}」内搜索服务账号...`
                  : "全局搜索：账号名 / 项目 ID / 供应商 / 主体 / 客户编号..."
              }
              // 用 Input 自身默认的 transparent + dark:bg-input/30 透明效果，
              // 不叠加 CTRL_SURFACE（那个是给弹窗用的更深底色，整块黑会跟左侧不协调）
              className="pl-9 pr-9 h-9 border-border/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                title="清空搜索 (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {(viewMode === "detail" && detail) ? (
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
                  {canStandbyStatus(detail.status) && (
                    <DropdownMenuItem onClick={() => handleAction("standby")} disabled={!!actionLoading}>
                      <Clock className="w-4 h-4 mr-2" />置为备用
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
            <div
              className={cn(
                "grid grid-cols-1 gap-4",
                detail.provider === "azure" ? "lg:grid-cols-3" : "lg:grid-cols-2",
              )}
            >
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm font-medium">凭证信息</CardTitle><Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleShowCreds}>{showCreds ? <><EyeOff className="w-3.5 h-3.5" />隐藏</> : <><Eye className="w-3.5 h-3.5" />查看</>}</Button></div></CardHeader>
                <CardContent>{showCreds && creds ? <pre className="text-xs font-mono bg-secondary p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">{JSON.stringify(creds, null, 2)}</pre> : <div className="flex flex-wrap gap-2">{detail.secret_fields.length > 0 ? detail.secret_fields.map((f) => <Badge key={f} variant="secondary" className="font-mono text-xs">{f}</Badge>) : <span className="text-sm text-muted-foreground">未配置凭证</span>}</div>}</CardContent>
              </Card>
              {detail.provider === "azure" && (
                <Card className="bg-card border-border"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">下单方式（Azure）</CardTitle></CardHeader><CardContent><p className="text-sm font-medium text-foreground">{detail.order_method ?? "—"}</p></CardContent></Card>
              )}
              <Card className="bg-card border-border"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">备注</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{detail.notes || "暂无备注"}</p></CardContent></Card>
            </div>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">关联客户编号</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-3">
                  {(detail.customer_codes ?? []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">暂未分配客户编号</span>
                  ) : (
                    (detail.customer_codes ?? []).map((c) => (
                      <Badge
                        key={c}
                        variant="secondary"
                        className="font-mono text-xs gap-1 pr-1"
                      >
                        {c}
                        <button
                          onClick={() => handleRemoveCustomer(c)}
                          disabled={customerBusy}
                          className="ml-1 rounded-sm hover:bg-muted px-1 text-muted-foreground hover:text-foreground"
                          title="解绑"
                        >
                          ×
                        </button>
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="输入客户编号后回车，例如 C001"
                    value={customerDraft}
                    onChange={(e) => setCustomerDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddCustomer() }
                    }}
                    className="h-8 text-sm"
                    disabled={customerBusy}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleAddCustomer}
                    disabled={customerBusy || !customerDraft.trim()}
                  >
                    绑定
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  绑定后状态自动变为「使用中」；全部解绑后变为「备用」；停用状态不会被覆盖。销售系统会通过接口批量下发。
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">状态历史</CardTitle></CardHeader>
              <CardContent>
                {detail.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无记录</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                    <div className="space-y-4">
                      {detail.history.map((h) => {
                        const isCustomer = h.action === "customer_bound" || h.action === "customer_unbound"
                        return (
                          <div key={h.id} className="relative pl-8">
                            <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">{ACTION_LABELS[h.action] ?? h.action}</span>
                                {isCustomer && h.customer_code && (
                                  <Badge variant="secondary" className="font-mono text-xs">{h.customer_code}</Badge>
                                )}
                                {!isCustomer && h.to_status && (
                                  <Badge variant="secondary" className={cn("text-xs", STATUS_MAP[h.to_status]?.class ?? "")}>{STATUS_MAP[h.to_status]?.label ?? h.to_status}</Badge>
                                )}
                                {h.operator && <span className="text-xs text-muted-foreground">by {h.operator}</span>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{new Date(h.created_at).toLocaleString("zh-CN")}</p>
                              {h.notes && <p className="text-xs text-muted-foreground mt-1">{h.notes}</p>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Dialog
              open={editOpen}
              onOpenChange={(open) => {
                setEditOpen(open)
                if (!open) setEditCredMode("fields")
              }}
            >
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>编辑服务账号</DialogTitle>
                  <DialogDescription>
                    上方为云管信息；下方修改对应云的全部配置。不填「云厂商账号配置」中的密钥区则保留原密钥（Azure 应用密钥可单独留空）。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>供应商</Label>
                      <Select
                        value={editForm.supplier_id}
                        onValueChange={(v) => setEditForm({ ...editForm, supplier_id: v, supply_source_id: "", order_method: "" })}
                      >
                        <SelectTrigger className={cn("w-full", CTRL_SURFACE)}><SelectValue placeholder="选择供应商" /></SelectTrigger>
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
                        onValueChange={(v) => {
                          const prov = editSourcesForSupplier.find((s) => String(s.id) === v)?.provider
                          setEditForm((f) => ({
                            ...f,
                            supply_source_id: v,
                            // 货源变了 → 主体必须清空（主体绑定具体货源）
                            entity_id: v !== f.supply_source_id ? "" : f.entity_id,
                            ...(prov && prov !== "azure" ? { order_method: "" } : {}),
                          }))
                        }}
                        disabled={!editForm.supplier_id}
                      >
                        <SelectTrigger className={cn("w-full", CTRL_SURFACE)}><SelectValue placeholder={editForm.supplier_id ? "选择云" : "请先选供应商"} /></SelectTrigger>
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
                  <div className="space-y-2">
                    <Label className="text-xs">主体（可选）</Label>
                    <Select
                      value={editForm.entity_id || ENTITY_SELECT_UNASSIGNED}
                      onValueChange={(v) =>
                        setEditForm((f) => ({ ...f, entity_id: v === ENTITY_SELECT_UNASSIGNED ? "" : v }))
                      }
                      disabled={!editForm.supply_source_id}
                    >
                      <SelectTrigger className={cn("h-9", CTRL_SURFACE)}>
                        <SelectValue placeholder={editForm.supply_source_id ? "选择主体（默认未分配）" : "请先选云"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ENTITY_SELECT_UNASSIGNED}>{UNASSIGNED_ENTITY_LABEL}</SelectItem>
                        {entitiesForEditSource.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 space-y-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">云管信息</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-xs">显示名称</Label>
                        <Input
                          className={cn("h-9", CTRL_SURFACE)}
                          placeholder={editProvider === "azure" ? "租户名称或展示名称" : "在云管中展示的名称"}
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-xs text-muted-foreground">备注</Label>
                        <Input className={cn("h-9", CTRL_SURFACE)} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
                      </div>
                    </div>
                    {editProvider === "azure" && (
                      <div className="space-y-1.5 max-w-md">
                        <Label className="text-xs text-muted-foreground">下单方式（Azure）</Label>
                        <Select
                          value={editForm.order_method || ORDER_METHOD_SELECT_SENTINEL}
                          onValueChange={(v) =>
                            setEditForm({ ...editForm, order_method: v === ORDER_METHOD_SELECT_SENTINEL ? "" : v })
                          }
                        >
                          <SelectTrigger className={cn("h-9 w-full", CTRL_SURFACE)}>
                            <SelectValue placeholder="选择下单方式" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ORDER_METHOD_SELECT_SENTINEL}>未选择</SelectItem>
                            {ORDER_METHOD_OPTIONS.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <CredentialSection
                    provider={editProvider}
                    mode={editCredMode}
                    onModeChange={setEditCredMode}
                    secretJson={editForm.secret_json}
                    onSecretJsonChange={(v) => setEditForm({ ...editForm, secret_json: v })}
                    azureSubscriptionId={editForm.external_project_id}
                    onAzureSubscriptionChange={(v) => setEditForm({ ...editForm, external_project_id: v })}
                    azureTenantId={editForm.azure_tenant_id}
                    azureClientId={editForm.azure_client_id}
                    azureClientSecret={editForm.azure_client_secret}
                    azureJson={editForm.azure_json}
                    onAzurePatch={(p) => setEditForm((f) => ({ ...f, ...p }))}
                    onAzureJsonChange={(v) => setEditForm({ ...editForm, azure_json: v })}
                  />
                  {editProvider === "azure" && (
                    <p className="text-[11px] text-muted-foreground leading-snug -mt-1">
                      应用密钥留空则保留服务器上的原密钥。
                    </p>
                  )}
                  {editProvider !== "azure" && (
                    <p className="text-[11px] text-muted-foreground leading-snug -mt-1">
                      更新云配置：在「云厂商账号配置」中修改；整段留空则不修改已存密钥与账号 ID。
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
                  <Button
                    onClick={handleEdit}
                    disabled={
                      !editForm.supplier_id || !editForm.supply_source_id || !editForm.name?.trim() || actionLoading === "edit"
                      || (editProvider !== "azure" && (() => {
                        if (editForm.secret_json.trim()) {
                          if (editProvider === "aws") {
                            try {
                              parseAwsCredentialJson(editForm.secret_json)
                              return false
                            } catch {
                              return true
                            }
                          }
                          if (editProvider === "gcp") {
                            try {
                              parseGcpCredentialJson(editForm.secret_json)
                              return false
                            } catch {
                              return true
                            }
                          }
                          return false
                        }
                        return !editForm.external_project_id.trim()
                      })())
                      || (editProvider === "azure" && (() => {
                        try {
                          const m = mergeAzureCredentialJson(editForm.azure_json, {
                            tenant_id: editForm.azure_tenant_id.trim(),
                            client_id: editForm.azure_client_id.trim(),
                            client_secret: editForm.azure_client_secret.trim(),
                            subscription_id: editForm.external_project_id.trim(),
                          })
                          const hasSecret =
                            m.client_secret.trim() || !!editAzureCredsRef.current?.client_secret
                          return !m.tenant_id || !m.client_id || !hasSecret || !m.subscription_id
                        } catch {
                          return true
                        }
                      })())
                    }
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
                  {selectedGroup ? (
                    <>
                      <img src={`/${selectedGroup.provider}.svg`} alt={selectedGroup.provider} className="w-6 h-6 shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-lg font-semibold text-foreground leading-tight">{selectedGroup.supplierName}</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {PROVIDER_LABELS[selectedGroup.provider] ?? selectedGroup.provider.toUpperCase()}
                          {selectedGroup.entityId !== undefined && (
                            <>
                              <span className="mx-1.5 text-muted-foreground/60">/</span>
                              <span className={selectedGroup.entityId === null ? "italic" : ""}>
                                {selectedGroup.entityName ?? UNASSIGNED_ENTITY_LABEL}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </>
                  ) : (
                    // 无 selectedGroup：搜索模式（isSearching=true）或初始空闲状态
                    <div className="flex items-center gap-2">
                      <Search className="w-5 h-5 text-muted-foreground" />
                      <div>
                        <h2 className="text-lg font-semibold text-foreground leading-tight">
                          {isSearching ? "全局搜索" : "请选择左侧节点"}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {isSearching ? "跨货源 / 主体匹配" : "或在上方搜索框中输入"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {(selectedGroup || isSearching) && (
                  <div className="flex items-center gap-3 mt-2">
                    <p className="text-sm text-muted-foreground">{displayedAccounts.length} 个服务账号{isSearching && ` · 匹配「${searchTrimmed}」`}</p>
                    {/* Taiji 货源 + cloud_admin 才显示「清理重复数据」按钮，用于修复
                        历史"每账号一个独立 CA/DS"导致的 billing 行 N× 放大。一次性操作。 */}
                    {selectedGroup?.provider === "taiji" && isCloudAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={handleTaijiCleanup}
                        disabled={taijiCleanupRunning}
                        title="把每账号独立 CA/DS 合并为 supply_source 级共享 CA/DS，去重 billing 行（修复历史数据被 N× 放大）"
                      >
                        {taijiCleanupRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                        清理重复数据
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {/* 批量分配工具栏：永久可见，无选中时是"提示 + 全选"，有选中时切换成"已选 N + 操作"。
                  搜索模式 + 跨货源结果时禁用批量分配/分配主体（仅批量删除允许；后端会按 scope 校验每条）。 */}
              {displayedAccounts.length > 0 && (
                bulkSelectedIds.size === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card/60 border border-dashed border-border rounded-lg px-3 py-2">
                    <span>💡 勾选左上角方框可批量操作</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setBulkSelectedIds(new Set(displayedAccounts.map((a) => a.id)))}
                    >
                      全选本页
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 bg-card border border-primary/50 rounded-lg px-3 py-2 flex-wrap">
                    <span className="text-sm text-foreground">已选 <b className="text-primary">{bulkSelectedIds.size}</b> 个</span>
                    <Button size="sm" onClick={openBulkDialog}>分配货源…</Button>
                    <Button size="sm" variant="outline" onClick={openBulkEntityDialog}>
                      <Building2 className="w-4 h-4 mr-1" />
                      分配主体…
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      批量删除
                    </Button>
                    {bulkSelectedIds.size < displayedAccounts.length && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBulkSelectedIds(new Set(displayedAccounts.map((a) => a.id)))}
                      >
                        全选本页
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setBulkSelectedIds(new Set())}>清空</Button>
                  </div>
                )
              )}
            </div>
            {displayedAccounts.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <div className="text-center">
                  {isSearching ? <Search className="w-12 h-12 mx-auto mb-4 opacity-30" /> : <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />}
                  <p>
                    {isSearching
                      ? `没有匹配「${searchTrimmed}」的服务账号`
                      : selectedGroup
                        ? "该云货源下暂无服务账号"
                        : "请在左侧选择货源 / 主体，或在上方输入搜索词"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {pagedAccounts.map((a) => (
                  <Card
                    key={a.id}
                    className={cn(
                      "bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group",
                      bulkSelectedIds.has(a.id) && "ring-2 ring-primary"
                    )}
                    onClick={() => {
                      // 搜索模式点击搜索结果：清空搜索词，否则 viewMode 还停在 cards 看不到详情
                      if (isSearching) setSearchQuery("")
                      loadDetail(a.id)
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* 批量勾选：点这个不会打开详情；加大 + 强色边框让视觉明显 */}
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleBulkPick(a.id) }}
                            className="shrink-0 flex items-center p-1 -m-1 rounded hover:bg-accent/50 cursor-pointer"
                            title="勾选以批量分配"
                          >
                            <Checkbox
                              checked={bulkSelectedIds.has(a.id)}
                              aria-label={`选择 ${a.name}`}
                              className="size-5 border-2 border-muted-foreground/60 data-[state=checked]:border-primary"
                            />
                          </div>
                          <img src={`/${a.provider}.svg`} alt={a.provider} className="w-9 h-9 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{a.external_project_id}</p>
                            <p className="text-[11px] text-muted-foreground/70 truncate">
                              {a.supplier_name}
                              <span className="mx-1 opacity-60">·</span>
                              <span className={a.entity_name ? "" : "italic"}>
                                {a.entity_name ?? UNASSIGNED_ENTITY_LABEL}
                              </span>
                            </p>
                          </div>
                        </div>
                        <Badge variant="secondary" className={cn("text-[10px] shrink-0 ml-2", STATUS_MAP[a.status]?.class ?? "")}>{STATUS_MAP[a.status]?.label ?? a.status}</Badge>
                      </div>
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between text-xs mt-1.5">
                        <span className="text-muted-foreground">客户编号</span>
                        <span className="text-foreground truncate max-w-[60%] text-right">
                          {(a.customer_codes ?? []).length === 0
                            ? "—"
                            : (a.customer_codes ?? []).slice(0, 2).join("、") +
                              ((a.customer_codes ?? []).length > 2
                                ? ` +${(a.customer_codes ?? []).length - 2}`
                                : "")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-1.5">
                        <span className="text-muted-foreground">创建</span>
                        <span className="text-foreground">{new Date(a.created_at).toLocaleDateString("zh-CN")}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* ─── 分页控件 ─── */}
            {displayedAccounts.length > accountsPageSize && (
              <div className="flex items-center justify-between gap-3 mt-4 px-1">
                <div className="text-xs text-muted-foreground">
                  共 <span className="font-medium text-foreground">{displayedAccounts.length}</span> 个 ·
                  当前 <span className="font-medium text-foreground">
                    {(accountsPage - 1) * accountsPageSize + 1}-{Math.min(accountsPage * accountsPageSize, displayedAccounts.length)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(accountsPageSize)}
                    onValueChange={(v) => { setAccountsPageSize(Number(v)); setAccountsPage(1) }}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[12, 24, 48, 96].map((n) => (
                        <SelectItem key={n} value={String(n)}>每页 {n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm" variant="outline"
                    disabled={accountsPage <= 1}
                    onClick={() => setAccountsPage((p) => Math.max(1, p - 1))}
                  >上一页</Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {accountsPage} / {accountsTotalPages}
                  </span>
                  <Button
                    size="sm" variant="outline"
                    disabled={accountsPage >= accountsTotalPages}
                    onClick={() => setAccountsPage((p) => Math.min(accountsTotalPages, p + 1))}
                  >下一页</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── 批量分配服务账号到另一个货源 ─── */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量分配服务账号</DialogTitle>
            <DialogDescription>
              已选 <b>{bulkSelectedIds.size}</b> 个账号
              {bulkSingleProvider && (
                <>
                  ，云类型 <Badge variant="secondary" className="ml-1">{PROVIDER_LABELS[bulkSingleProvider] ?? bulkSingleProvider.toUpperCase()}</Badge>
                </>
              )}
              。选择目标供应商和货源（只能选同 provider）。
            </DialogDescription>
          </DialogHeader>

          {!bulkSingleProvider ? (
            <div className="py-4 text-sm text-destructive">
              所选账号涉及多个 provider，请只选同一 provider 的账号。
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>目标供应商</Label>
                <Select value={bulkTargetSupplierId} onValueChange={(v) => { setBulkTargetSupplierId(v); setBulkTargetSSId("") }}>
                  <SelectTrigger><SelectValue placeholder="选择供应商" /></SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      sources.reduce((m, s) => m.set(s.supplier_id, s.supplier_name ?? "—"), new Map<number, string>()),
                      ([id, name]) => (
                        <SelectItem key={id} value={String(id)}>{name}</SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>目标货源（{bulkSingleProvider.toUpperCase()}）</Label>
                <Select
                  value={bulkTargetSSId}
                  onValueChange={setBulkTargetSSId}
                  disabled={!bulkTargetSupplierId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={bulkTargetSupplierId ? "选择货源" : "先选供应商"} />
                  </SelectTrigger>
                  <SelectContent>
                    {bulkTargetSSCandidates.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">该供应商下没有 {bulkSingleProvider} 货源</div>
                    ) : bulkTargetSSCandidates.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        #{s.id} · {PROVIDER_LABELS[s.provider] ?? s.provider.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)} disabled={bulkSubmitting}>取消</Button>
            <Button
              onClick={submitBulkAssign}
              disabled={!bulkSingleProvider || !bulkTargetSSId || bulkSubmitting}
            >
              {bulkSubmitting ? "分配中…" : "确认分配"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 批量分配主体（仅同一货源内有效） ─── */}
      <Dialog open={bulkEntityDialogOpen} onOpenChange={(o) => { if (!bulkEntitySubmitting) setBulkEntityDialogOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              批量分配主体
            </DialogTitle>
            <DialogDescription>
              将选中的 <b className="text-primary">{bulkSelectedIds.size}</b> 个服务账号
              {selectedGroup && (
                <> 在「{selectedGroup.supplierName} / {PROVIDER_LABELS[selectedGroup.provider] ?? selectedGroup.provider.toUpperCase()}」下 </>
              )}
              分配到指定主体；跨货源的会被自动跳过。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">目标主体</Label>
              <Select
                value={bulkTargetEntityId}
                onValueChange={(v) => setBulkTargetEntityId(v)}
              >
                <SelectTrigger className={cn("h-9", CTRL_SURFACE)}>
                  <SelectValue placeholder="选择主体或「未分配主体」" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENTITY_SELECT_UNASSIGNED}>{UNASSIGNED_ENTITY_LABEL}（清空主体）</SelectItem>
                  {bulkEntityCandidates.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bulkEntityCandidates.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  当前货源下还没有主体。先到左侧树「+」按钮新建几个主体后再来分配。
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEntityDialogOpen(false)} disabled={bulkEntitySubmitting}>取消</Button>
            <Button
              onClick={submitBulkAssignEntity}
              disabled={bulkEntitySubmitting || !bulkTargetEntityId || bulkSelectedIds.size === 0}
            >
              {bulkEntitySubmitting ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />分配中…</> : "确认分配"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 批量删除服务账号 ─── */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => { if (!bulkDeleting) setBulkDeleteOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              批量删除服务账号
            </DialogTitle>
            <DialogDescription>
              将彻底删除 <b className="text-destructive">{bulkSelectedIds.size}</b> 个服务账号，
              此操作 <b>不可恢复</b>，并会从数据库中移除相关凭证与历史记录。
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <ScrollArea className="max-h-48 rounded border border-border bg-muted/30 p-2">
              <ul className="text-xs space-y-1 font-mono">
                {Array.from(bulkSelectedIds).map((id) => {
                  const a = accounts.find((x) => x.id === id)
                  return (
                    <li key={id} className="truncate">
                      #{id} · {a?.name ?? "—"}{a?.external_project_id ? ` (${a.external_project_id})` : ""}
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>取消</Button>
            <Button
              variant="destructive"
              onClick={submitBulkDelete}
              disabled={bulkDeleting || bulkSelectedIds.size === 0}
            >
              {bulkDeleting ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" />删除中…</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-1" />确认删除 {bulkSelectedIds.size} 个</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 主体 CRUD（cloud_admin/ops 任意 provider；cloud_<provider> 限本云） ─── */}
      <Dialog open={entityDialogOpen} onOpenChange={(o) => { if (!entitySubmitting) setEntityDialogOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              {entityDialogMode === "create" ? "新增主体" : "编辑主体"}
            </DialogTitle>
            <DialogDescription>
              所属货源：{entityDialogTarget?.supplierName ?? "—"} / {(PROVIDER_LABELS[entityDialogTarget?.provider ?? ""] ?? (entityDialogTarget?.provider ?? "").toUpperCase())}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">主体名称 <span className="text-destructive">*</span></Label>
              <Input
                className={cn("h-9", CTRL_SURFACE)}
                value={entityForm.name}
                onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })}
                placeholder="如 某某科技有限公司"
                maxLength={200}
              />
            </div>
            <div>
              <Label className="text-xs">备注</Label>
              <Textarea
                className={cn(CTRL_SURFACE)}
                value={entityForm.note}
                onChange={(e) => setEntityForm({ ...entityForm, note: e.target.value })}
                placeholder="选填，最多 500 字"
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntityDialogOpen(false)} disabled={entitySubmitting}>取消</Button>
            <Button onClick={submitEntity} disabled={entitySubmitting || !entityForm.name.trim()}>
              {entitySubmitting ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中…</> : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ─── Tree Components ──────────────────────────────────────── */

interface TreeCallbacks {
  selectedGroup: SelectedSupplySource | null
  onSelectGroup: (supplierName: string, supplySourceId: number, provider: string) => void
  onSelectEntity: (
    supplierName: string,
    supplySourceId: number,
    provider: string,
    entityId: number | null,
    entityName: string | null,
  ) => void
  /** 该用户能否管理某 provider 下的主体（增/改/删）。admin/ops → 任意 provider。 */
  canManageEntityProvider: (provider: string) => boolean
  onCreateEntity: (supplySourceId: number, supplierName: string, provider: string) => void
  onEditEntity: (entity: { id: number; name: string; note: string | null; supplySourceId: number }) => void
  onDeleteEntity: (entity: { id: number; name: string; accountCount: number }) => void
}

function SupplierNode({ node, ...rest }: { node: SupplierTreeNode } & TreeCallbacks) {
  const [open, setOpen] = useState(true)
  const total = node.sources.reduce(
    (s, x) => s + x.entities.reduce((t, e) => t + e.accounts.length, 0),
    0,
  )
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
          {...rest}
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
  onSelectEntity,
  canManageEntityProvider,
  onCreateEntity,
  onEditEntity,
  onDeleteEntity,
}: {
  supplierName: string
  src: SourceBucket
} & TreeCallbacks) {
  const [open, setOpen] = useState(true)
  const isSelected =
    selectedGroup?.supplySourceId === src.supplySourceId && selectedGroup?.entityId === undefined
  const pl = PROVIDER_LABELS[src.provider] ?? src.provider.toUpperCase()
  const total = src.entities.reduce((s, e) => s + e.accounts.length, 0)
  const canManage = canManageEntityProvider(src.provider)
  return (
    <div className="ml-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-accent text-muted-foreground"
          aria-label={open ? "折叠" : "展开"}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onSelectGroup(supplierName, src.supplySourceId, src.provider)}
          className={cn(
            "flex items-center gap-2 flex-1 px-2 py-1 rounded text-sm",
            isSelected ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <img src={`/${src.provider}.svg`} alt={src.provider} className="w-3.5 h-3.5" />
          <FolderOpen className="w-3.5 h-3.5" />
          <span>{pl}</span>
          <span className="ml-auto text-xs">{total}</span>
        </button>
        {canManage && (
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onCreateEntity(src.supplySourceId, supplierName, src.provider) }}
            title="新增主体"
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && src.entities.map((bucket) => (
        <EntityNode
          key={bucket.entityId ?? "__unassigned__"}
          supplierName={supplierName}
          supplySourceId={src.supplySourceId}
          provider={src.provider}
          bucket={bucket}
          selectedGroup={selectedGroup}
          onSelectEntity={onSelectEntity}
          canManage={canManage}
          onEditEntity={onEditEntity}
          onDeleteEntity={onDeleteEntity}
        />
      ))}
    </div>
  )
}

function EntityNode({
  supplierName,
  supplySourceId,
  provider,
  bucket,
  selectedGroup,
  onSelectEntity,
  canManage,
  onEditEntity,
  onDeleteEntity,
}: {
  supplierName: string
  supplySourceId: number
  provider: string
  bucket: EntityBucket
  selectedGroup: SelectedSupplySource | null
  onSelectEntity: TreeCallbacks["onSelectEntity"]
  canManage: boolean
  onEditEntity: TreeCallbacks["onEditEntity"]
  onDeleteEntity: TreeCallbacks["onDeleteEntity"]
}) {
  const isSelected =
    selectedGroup?.supplySourceId === supplySourceId
    && selectedGroup?.entityId === bucket.entityId
  const isUnassigned = bucket.entityId === null
  const label = bucket.entityName ?? UNASSIGNED_ENTITY_LABEL
  return (
    <div className="ml-6 flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelectEntity(supplierName, supplySourceId, provider, bucket.entityId, bucket.entityName)}
        className={cn(
          "flex items-center gap-2 flex-1 px-2 py-1 rounded text-xs",
          isSelected ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-accent",
          isUnassigned && "italic",
        )}
        title={bucket.note || undefined}
      >
        <Building2 className="w-3 h-3 opacity-70" />
        <span className="truncate">{label}</span>
        <span className="ml-auto text-[10px]">{bucket.accounts.length}</span>
      </button>
      {canManage && !isUnassigned && bucket.entityId !== null && (
        <>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onEditEntity({ id: bucket.entityId!, name: bucket.entityName ?? "", note: bucket.note, supplySourceId }) }}
            title="编辑主体"
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onDeleteEntity({ id: bucket.entityId!, name: bucket.entityName ?? "", accountCount: bucket.accounts.length }) }}
            title="删除主体"
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-red-400"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  )
}
