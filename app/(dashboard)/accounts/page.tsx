"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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

/** 弹窗内输入/选择：与浅色区块底区分，避免与背景糊成一片 */
const CTRL_SURFACE = "bg-background border border-input shadow-sm dark:bg-background/95"

/** 与后端 suspend/activate 允许的状态一致 */
function canSuspendStatus(s: string) {
  return s === "active" || s === "standby"
}
function canActivateStatus(s: string) {
  return s === "inactive" || s === "standby"
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

type CredUiMode = "fields" | "json"

/** 云厂商侧配置（账号/订阅/项目 ID 与密钥均在此；JSON 为整段导入） */
function CredentialSection({
  provider,
  mode,
  onModeChange,
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
}: {
  provider: string
  mode: CredUiMode
  onModeChange: (m: CredUiMode) => void
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
}) {
  const p = provider.toLowerCase()
  const showToggle = p === "aws" || p === "azure"

  return (
    <div className="rounded-xl border border-border bg-muted/25 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">云厂商账号配置</span>
        {showToggle ? (
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

      {p === "azure" &&
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
  const [createCredMode, setCreateCredMode] = useState<CredUiMode>("fields")
  const [editCredMode, setEditCredMode] = useState<CredUiMode>("fields")

  // View mode: "cards" shows account cards for selected group, "detail" shows single account
  const viewMode = selectedId && detail ? "detail" : "cards"

  // external_project_id：入库的账号/订阅/项目 ID；Azure 与订阅字段同步，AWS/GCP 由下方 JSON 解析或编辑预填
  const [form, setForm] = useState({
    supplier_id: "",
    supply_source_id: "",
    name: "", external_project_id: "",
    secret_json: "", notes: "",
    order_method: "",
    azure_tenant_id: "",
    azure_client_id: "",
    azure_client_secret: "",
    azure_json: "",
  })

  const [editForm, setEditForm] = useState({
    supplier_id: "",
    supply_source_id: "",
    name: "", external_project_id: "",
    secret_json: "", notes: "",
    order_method: "",
    azure_tenant_id: "",
    azure_client_id: "",
    azure_client_secret: "",
    azure_json: "",
  })

  /** 编辑 Azure 时拉取的凭证，用于在「应用密钥」留空时保留原值 */
  const editAzureCredsRef = useRef<Record<string, string> | null>(null)

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
  const emptyForm = () => ({
    supplier_id: "",
    supply_source_id: "",
    name: "",
    external_project_id: "",
    secret_json: "",
    notes: "",
    order_method: "",
    azure_tenant_id: "",
    azure_client_id: "",
    azure_client_secret: "",
    azure_json: "",
  })

  const handleCreate = async () => {
    try {
      setActionLoading("create")
      const ssid = Number(form.supply_source_id)
      if (!form.supplier_id || !ssid) {
        alert("请选择供应商与云（货源）")
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
      await accountsApi.create({
        supply_source_id: ssid,
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

  const openEdit = async () => {
    if (!detail) return
    const base = {
      supplier_id: String(detail.supplier_id),
      supply_source_id: String(detail.supply_source_id),
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
      <div className="w-80 border-r border-border flex flex-col bg-card/50">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">货源列表</h2>
          <div className="flex items-center gap-1">
            <Dialog open={createOpen} onOpenChange={(open) => {
              setCreateOpen(open)
              if (!open) {
                setForm(emptyForm())
                setCreateCredMode("fields")
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
                {sources.length === 0 && (
                  <p className="text-xs text-muted-foreground">请先在「供应商管理」中创建供应商并添加货源。</p>
                )}
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
                <CredentialSection
                  provider={formProvider}
                  mode={createCredMode}
                  onModeChange={setCreateCredMode}
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
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button
                  onClick={handleCreate}
                  disabled={
                    !form.supplier_id || !form.supply_source_id || !form.name?.trim() || actionLoading === "create"
                    || (formProvider === "azure" && (() => {
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
                  }
                >
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
