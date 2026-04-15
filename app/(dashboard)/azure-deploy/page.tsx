"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
} from "@azure/msal-browser"
import {
  Loader2,
  LogIn,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  AlertTriangle,
  SkipForward,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Shield,
  Server,
  Cpu,
  Rocket,
  Plus,
  FileDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  azureDeployApi,
  setAzureTokenProvider,
  clearAzureTokenProvider,
  type MsalConfig,
  type AzureUser,
  type AzureSubscription,
  type AzureResourceGroup,
  type AzureAIResource,
  type AzureModel,
  type DeployItem,
  type PlanResult,
  type PlanResultItem,
  type DeployProgress,
  type ProgressItem,
} from "@/lib/api"

// ─── Constants ───────────────────────────────────────────────

const STEPS = [
  { label: "登录 Azure", icon: Shield },
  { label: "部署配置", icon: Server },
  { label: "选择模型", icon: Cpu },
  { label: "部署", icon: Rocket },
]

const NAMING_RULES = [
  { value: "{model}-{region}", label: "{model}-{region}", example: "gpt-4o-eastus" },
  { value: "{model}-{version}-{region}", label: "{model}-{version}-{region}", example: "gpt-4o-2024-11-20-eastus" },
  { value: "prod-{model}-{region}", label: "prod-{model}-{region}", example: "prod-gpt-4o-eastus" },
]

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: typeof Check }> = {
  create: { label: "创建", color: "text-green-400", icon: Check },
  skip: { label: "跳过", color: "text-blue-400", icon: SkipForward },
  conflict: { label: "冲突", color: "text-orange-400", icon: AlertTriangle },
  unavailable: { label: "不可用", color: "text-red-400", icon: X },
  quota_risk: { label: "配额风险", color: "text-yellow-400", icon: AlertTriangle },
}

const STATUS_ICON: Record<string, { icon: typeof Check; color: string; animate?: string }> = {
  pending: { icon: Loader2, color: "text-muted-foreground" },
  deploying: { icon: Loader2, color: "text-blue-400", animate: "animate-spin" },
  succeeded: { icon: Check, color: "text-green-400" },
  failed: { icon: X, color: "text-red-400" },
}

// ─── Helper: generate deployment name ────────────────────────

function makeDeploymentName(
  rule: string,
  model: string,
  version: string,
  region: string
): string {
  return rule
    .replace("{model}", model)
    .replace("{version}", version)
    .replace("{region}", region)
}

// ─── Main Page ───────────────────────────────────────────────

export default function AzureDeployPage() {
  const [step, setStep] = useState(0)

  // Step 1: Auth
  const [msalInstance, setMsalInstance] = useState<PublicClientApplication | null>(null)
  const [msalConfig, setMsalConfig] = useState<MsalConfig | null>(null)
  const [azureUser, setAzureUser] = useState<AzureUser | null>(null)
  const [msalAccount, setMsalAccount] = useState<AccountInfo | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  // Step 2: Config
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[]>([])
  const [selectedSub, setSelectedSub] = useState("")
  const [resourceGroups, setResourceGroups] = useState<AzureResourceGroup[]>([])
  const [selectedRG, setSelectedRG] = useState("")
  const [aiResources, setAiResources] = useState<AzureAIResource[]>([])
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set())
  const [subsLoading, setSubsLoading] = useState(false)
  const [rgLoading, setRgLoading] = useState(false)
  const [resLoading, setResLoading] = useState(false)

  // Step 3: Models — key = account_name
  const [allModels, setAllModels] = useState<Map<string, AzureModel[]>>(new Map())
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [skuName, setSkuName] = useState("GlobalStandard")
  const [skuCapacity, setSkuCapacity] = useState(10)
  const [namingRule, setNamingRule] = useState("{model}-{region}")
  const [planResult, setPlanResult] = useState<PlanResult | null>(null)
  const [planDeployItems, setPlanDeployItems] = useState<DeployItem[]>([])
  const [planLoading, setPlanLoading] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)

  // Step 4: Deploy
  const [taskId, setTaskId] = useState<string | null>(null)
  const [progress, setProgress] = useState<DeployProgress | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Step 1: Load MSAL config & init ─────────────────────

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const cfg = await azureDeployApi.getMsalConfig()
        if (cancelled) return
        setMsalConfig(cfg)

        const msalCfg: Configuration = {
          auth: {
            clientId: cfg.client_id,
            authority: cfg.authority,
            redirectUri: cfg.redirect_uri,
          },
          cache: { cacheLocation: "sessionStorage" },
        }
        const pca = new PublicClientApplication(msalCfg)
        await pca.initialize()
        setMsalInstance(pca)
      } catch (err) {
        if (!cancelled) setAuthError("无法获取 Azure 配置，请检查后端是否启动")
      } finally {
        if (!cancelled) setConfigLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // ─── Step 1: Login/Logout ────────────────────────────────

  const handleLogin = useCallback(async () => {
    if (!msalInstance || !msalConfig) return
    setAuthLoading(true)
    setAuthError(null)
    try {
      const result = await msalInstance.loginPopup({
        scopes: msalConfig.scopes,
        redirectUri: `${window.location.origin}/redirect`,
      })
      setMsalAccount(result.account)

      setAzureTokenProvider(async () => {
        const tokenResult = await msalInstance.acquireTokenSilent({
          scopes: msalConfig.scopes,
          account: result.account!,
        })
        return tokenResult.accessToken
      })

      const user = await azureDeployApi.validateToken()
      setAzureUser(user)
    } catch (err: any) {
      setAuthError(err?.message ?? "登录失败")
    } finally {
      setAuthLoading(false)
    }
  }, [msalInstance, msalConfig])

  const handleLogout = useCallback(() => {
    if (msalInstance && msalAccount) {
      msalInstance.logoutPopup({ account: msalAccount }).catch(() => {})
    }
    setAzureUser(null)
    setMsalAccount(null)
    clearAzureTokenProvider()
    setStep(0)
  }, [msalInstance, msalAccount])

  // ─── Step 2: Load subscriptions ──────────────────────────

  const loadSubscriptions = useCallback(async () => {
    setSubsLoading(true)
    try {
      const subs = await azureDeployApi.subscriptions()
      setSubscriptions(subs)
    } catch { /* toast */ } finally {
      setSubsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (step === 1 && azureUser && subscriptions.length === 0) {
      loadSubscriptions()
    }
  }, [step, azureUser, subscriptions.length, loadSubscriptions])

  // Load resource groups when subscription changes
  useEffect(() => {
    if (!selectedSub) { setResourceGroups([]); setSelectedRG(""); return }
    let cancelled = false
    async function load() {
      setRgLoading(true)
      try {
        const rgs = await azureDeployApi.resourceGroups(selectedSub)
        if (!cancelled) setResourceGroups(rgs)
      } catch { /* */ } finally {
        if (!cancelled) setRgLoading(false)
      }
    }
    setSelectedRG("")
    setAiResources([])
    setSelectedResources(new Set())
    load()
    return () => { cancelled = true }
  }, [selectedSub])

  // Load AI resources when RG changes
  useEffect(() => {
    if (!selectedSub || !selectedRG) { setAiResources([]); setSelectedResources(new Set()); return }
    let cancelled = false
    async function load() {
      setResLoading(true)
      try {
        const res = await azureDeployApi.aiResources(selectedSub, selectedRG)
        if (!cancelled) setAiResources(res)
      } catch { /* */ } finally {
        if (!cancelled) setResLoading(false)
      }
    }
    setSelectedResources(new Set())
    load()
    return () => { cancelled = true }
  }, [selectedSub, selectedRG])

  // ─── Step 3: Load models for selected AI resources (account-level) ──

  const selectedResourceObjects = aiResources.filter(r => selectedResources.has(r.name))

  const loadModels = useCallback(async () => {
    if (!selectedSub || !selectedRG || selectedResourceObjects.length === 0) return
    setModelsLoading(true)
    try {
      const accountModelsMap = new Map<string, AzureModel[]>()
      await Promise.all(
        selectedResourceObjects.map(async (res) => {
          const models = await azureDeployApi.accountModels(selectedSub, selectedRG, res.name)
          accountModelsMap.set(res.name, models)
        })
      )
      setAllModels(accountModelsMap)
    } catch { /* */ } finally {
      setModelsLoading(false)
    }
  }, [selectedSub, selectedRG, [...selectedResources].sort().join(",")])

  useEffect(() => {
    if (step === 2) {
      setSelectedModels(new Set())
      setPlanResult(null)
      setPlanDeployItems([])
      loadModels()
    }
  }, [step])

  // Get union of all available models across selected accounts
  const availableModels: AzureModel[] = (() => {
    const modelMap = new Map<string, AzureModel>()
    allModels.forEach((models) => {
      models.forEach((m) => {
        const key = `${m.model_name}@${m.model_version}`
        if (!modelMap.has(key)) modelMap.set(key, m)
      })
    })
    return Array.from(modelMap.values())
  })()

  // Check if a model is available in a specific account
  const isModelInAccount = (modelName: string, modelVersion: string, accountName: string): boolean => {
    const accountModels = allModels.get(accountName)
    if (!accountModels) return false
    return accountModels.some(m => m.model_name === modelName && m.model_version === modelVersion)
  }

  // Build deploy items from selection matrix
  const buildDeployItems = useCallback((): DeployItem[] => {
    const items: DeployItem[] = []
    selectedModels.forEach((modelKey) => {
      const [modelName, modelVersion] = modelKey.split("@")
      const modelInfo = availableModels.find(
        m => m.model_name === modelName && m.model_version === modelVersion
      )
      selectedResourceObjects.forEach((res) => {
        if (isModelInAccount(modelName, modelVersion, res.name)) {
          items.push({
            resource_group: selectedRG,
            account_name: res.name,
            region: res.location,
            model_name: modelName,
            model_version: modelVersion,
            model_format: modelInfo?.model_format || "OpenAI",
            deployment_name: makeDeploymentName(namingRule, modelName, modelVersion, res.location),
            sku_name: skuName,
            sku_capacity: skuCapacity,
          })
        }
      })
    })
    return items
  }, [selectedModels, selectedResourceObjects, selectedRG, namingRule, skuName, skuCapacity, availableModels])

  // ─── Step 3: Run Plan ────────────────────────────────────

  const runPlan = useCallback(async () => {
    const items = buildDeployItems()
    if (items.length === 0) return
    setPlanLoading(true)
    try {
      const result = await azureDeployApi.plan({
        subscription_id: selectedSub,
        items,
      })
      setPlanDeployItems(items)
      setPlanResult(result)
    } catch { /* */ } finally {
      setPlanLoading(false)
    }
  }, [buildDeployItems, selectedSub])

  // ─── Step 4: Execute ─────────────────────────────────────

  const startDeploy = useCallback(async () => {
    if (!planResult || planDeployItems.length === 0) return
    const executableItems = planResult.items
      .filter((i): i is PlanResultItem & { action: "create" | "quota_risk" } =>
        i.action === "create" || i.action === "quota_risk")
      .flatMap((planItem) => {
        const item = planDeployItems[planItem.index]
        if (!item?.resource_group) return []
        return [{ ...item, action: planItem.action }]
      })
    if (executableItems.length === 0) return

    setDeploying(true)
    console.log("[execute] payload:", JSON.stringify({ subscription_id: selectedSub, items: executableItems }, null, 2))
    setLogs([`${new Date().toLocaleTimeString()} 开始部署 ${executableItems.length} 个模型...`])

    try {
      const result = await azureDeployApi.execute({
        subscription_id: selectedSub,
        items: executableItems,
      })
      setTaskId(result.task_id)
      setStep(3)
    } catch (err: any) {
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} 启动部署失败: ${err?.message}`])
      setDeploying(false)
    }
  }, [planResult, planDeployItems, selectedSub])

  // Poll progress
  useEffect(() => {
    if (step !== 3 || !taskId) return

    const poll = async () => {
      try {
        const p = await azureDeployApi.progress(taskId)
        setProgress(p)

        // Update logs based on status changes
        p.items.forEach((item) => {
          const time = new Date().toLocaleTimeString()
          if (item.status === "deploying") {
            setLogs(prev => {
              const msg = `${time} 正在部署 ${item.model_name} → ${item.account_name}`
              if (prev[prev.length - 1]?.includes(msg.slice(9))) return prev
              return [...prev, msg]
            })
          } else if (item.status === "succeeded") {
            setLogs(prev => {
              const tag = `${item.model_name} → ${item.account_name} 成功`
              if (prev.some(l => l.includes(tag))) return prev
              return [...prev, `${time} ${tag}`]
            })
          } else if (item.status === "failed") {
            setLogs(prev => {
              const tag = `${item.model_name} → ${item.account_name} 失败`
              if (prev.some(l => l.includes(tag))) return prev
              return [...prev, `${time} ${tag}: ${item.error || "未知错误"}`]
            })
          }
        })

        if (p.status === "completed") {
          setDeploying(false)
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch { /* */ }
    }

    poll()
    pollRef.current = setInterval(poll, 3000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [step, taskId])

  // ─── Step 4: Retry ───────────────────────────────────────

  const handleRetry = useCallback(async () => {
    if (!taskId) return
    setRetrying(true)
    try {
      await azureDeployApi.retryFailed(taskId)
      setDeploying(true)
      setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} 正在重试失败项...`])

      pollRef.current = setInterval(async () => {
        try {
          const p = await azureDeployApi.progress(taskId)
          setProgress(p)
          if (p.status === "completed") {
            setDeploying(false)
            if (pollRef.current) clearInterval(pollRef.current)
          }
        } catch { /* */ }
      }, 3000)
    } catch { /* */ } finally {
      setRetrying(false)
    }
  }, [taskId])

  // ─── Reset ───────────────────────────────────────────────

  const handleReset = () => {
    setStep(1)
    setSelectedModels(new Set())
    setPlanResult(null)
    setTaskId(null)
    setProgress(null)
    setDeploying(false)
    setLogs([])
  }

  // ─── Navigation helpers ──────────────────────────────────

  const canGoNext = (): boolean => {
    switch (step) {
      case 0: return !!azureUser
      case 1: return selectedResources.size > 0
      case 2: return !!planResult && planResult.items.some(i => i.action === "create" || i.action === "quota_risk")
      default: return false
    }
  }

  const goNext = () => {
    if (step === 2 && !planResult) {
      runPlan()
      return
    }
    if (step === 2 && planResult) {
      startDeploy()
      return
    }
    setStep(s => Math.min(s + 1, 3))
  }

  const goBack = () => setStep(s => Math.max(s - 1, 0))

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          AI 模型批量部署
        </h1>
        <p className="text-muted-foreground mt-1">
          通过 Azure AI Foundry 批量部署 AI 模型到多个区域
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const isActive = step === i
          const isDone = step > i
          return (
            <div key={s.label} className="flex items-center gap-2">
              {i > 0 && (
                <div className={cn(
                  "h-px w-8 md:w-16 transition-colors",
                  isDone ? "bg-primary" : "bg-white/10"
                )} />
              )}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                  isActive && "bg-primary/20 text-primary shadow-[0_0_12px_rgba(var(--primary),0.2)]",
                  isDone && "bg-green-500/10 text-green-400",
                  !isActive && !isDone && "text-muted-foreground"
                )}
              >
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold",
                  isActive && "bg-primary text-primary-foreground",
                  isDone && "bg-green-500/20 text-green-400",
                  !isActive && !isDone && "bg-white/5 text-muted-foreground"
                )}>
                  {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className="hidden md:inline">{s.label}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <Card className="border-white/5 bg-card/50 backdrop-blur">
        <CardContent className="pt-6">
          {step === 0 && (
            <StepLogin
              configLoading={configLoading}
              authLoading={authLoading}
              authError={authError}
              azureUser={azureUser}
              msalInstance={msalInstance}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />
          )}
          {step === 1 && (
            <StepConfig
              subscriptions={subscriptions}
              selectedSub={selectedSub}
              onSelectSub={setSelectedSub}
              subsLoading={subsLoading}
              resourceGroups={resourceGroups}
              selectedRG={selectedRG}
              onSelectRG={setSelectedRG}
              rgLoading={rgLoading}
              aiResources={aiResources}
              selectedResources={selectedResources}
              onToggleResource={(name) => {
                setSelectedResources(prev => {
                  const next = new Set(prev)
                  if (next.has(name)) next.delete(name); else next.add(name)
                  return next
                })
              }}
              resLoading={resLoading}
              onResourceGroupCreated={(rg) => {
                setResourceGroups(prev => [...prev, rg])
                setSelectedRG(rg.name)
              }}
              onAIResourceCreated={(res) => {
                setAiResources(prev => [...prev, res])
                setSelectedResources(prev => new Set(prev).add(res.name))
              }}
            />
          )}
          {step === 2 && (
            <StepModels
              availableModels={availableModels}
              selectedModels={selectedModels}
              onToggleModel={(key) => {
                setSelectedModels(prev => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key); else next.add(key)
                  return next
                })
                setPlanResult(null)
              }}
              selectedResources={selectedResourceObjects}
              isModelInAccount={isModelInAccount}
              deployItems={planDeployItems.length > 0 ? planDeployItems : buildDeployItems()}
              skuName={skuName}
              onSkuChange={setSkuName}
              skuCapacity={skuCapacity}
              onCapacityChange={setSkuCapacity}
              namingRule={namingRule}
              onNamingRuleChange={(v) => { setNamingRule(v); setPlanResult(null) }}
              planResult={planResult}
              planLoading={planLoading}
              onRunPlan={runPlan}
              modelsLoading={modelsLoading}
            />
          )}
          {step === 3 && (
            <StepDeploy
              taskId={taskId}
              progress={progress}
              deploying={deploying}
              retrying={retrying}
              logs={logs}
              onRetry={handleRetry}
              onReset={handleReset}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      {step < 3 && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={goBack}
            disabled={step === 0}
            className="gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> 上一步
          </Button>
          <Button
            onClick={goNext}
            disabled={!canGoNext() || (step === 2 && (planLoading || deploying))}
            className="gap-2"
          >
            {step === 2 && !planResult && "预检"}
            {step === 2 && planResult && "开始部署"}
            {step < 2 && "下一步"}
            {step === 2 && planLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {step !== 2 && <ChevronRight className="w-4 h-4" />}
            {step === 2 && !planLoading && planResult && <Rocket className="w-4 h-4" />}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Step 1: Login ───────────────────────────────────────────

function StepLogin({
  configLoading,
  authLoading,
  authError,
  azureUser,
  msalInstance,
  onLogin,
  onLogout,
}: {
  configLoading: boolean
  authLoading: boolean
  authError: string | null
  azureUser: AzureUser | null
  msalInstance: PublicClientApplication | null
  onLogin: () => void
  onLogout: () => void
}) {
  if (configLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">正在加载 Azure 配置...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
        <Shield className="w-8 h-8 text-primary" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">连接你的 Azure 账号</h2>
        <p className="text-muted-foreground text-sm max-w-md">
          点击下方按钮，在弹窗中登录你的 Azure 账号。登录后将使用你的权限发现资源并部署模型。
        </p>
      </div>

      {!azureUser ? (
        <Button
          size="lg"
          onClick={onLogin}
          disabled={authLoading || !msalInstance}
          className="gap-2 px-8"
        >
          {authLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LogIn className="w-4 h-4" />
          )}
          {authLoading ? "登录中..." : "登录 Azure 账号"}
        </Button>
      ) : (
        <Card className="w-full max-w-md border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500/20">
                  <Check className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="font-medium">已登录</p>
                  <p className="text-sm text-muted-foreground">{azureUser.name}</p>
                  <p className="text-xs text-muted-foreground">{azureUser.email}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={onLogout} className="gap-1 text-muted-foreground">
                <LogOut className="w-3 h-3" /> 登出
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {authError && (
        <p className="text-sm text-red-400 flex items-center gap-1">
          <X className="w-4 h-4" /> {authError}
        </p>
      )}
    </div>
  )
}

// ─── Step 2: Config ──────────────────────────────────────────

function StepConfig({
  subscriptions,
  selectedSub,
  onSelectSub,
  subsLoading,
  resourceGroups,
  selectedRG,
  onSelectRG,
  rgLoading,
  aiResources,
  selectedResources,
  onToggleResource,
  resLoading,
  onResourceGroupCreated,
  onAIResourceCreated,
}: {
  subscriptions: AzureSubscription[]
  selectedSub: string
  onSelectSub: (v: string) => void
  subsLoading: boolean
  resourceGroups: AzureResourceGroup[]
  selectedRG: string
  onSelectRG: (v: string) => void
  rgLoading: boolean
  aiResources: AzureAIResource[]
  selectedResources: Set<string>
  onToggleResource: (name: string) => void
  resLoading: boolean
  onResourceGroupCreated: (rg: AzureResourceGroup) => void
  onAIResourceCreated: (res: AzureAIResource) => void
}) {
  const [showCreateRG, setShowCreateRG] = useState(false)
  const [newRGName, setNewRGName] = useState("")
  const [newRGLocation, setNewRGLocation] = useState("eastus")
  const [creatingRG, setCreatingRG] = useState(false)

  const [showCreateAI, setShowCreateAI] = useState(false)
  const [newAIName, setNewAIName] = useState("")
  const [newAILocation, setNewAILocation] = useState("eastus")
  const [creatingAI, setCreatingAI] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const AZURE_REGIONS = [
    "eastus", "eastus2", "westus", "westus2", "westus3",
    "centralus", "northcentralus", "southcentralus",
    "westeurope", "northeurope", "uksouth", "ukwest",
    "francecentral", "germanywestcentral", "switzerlandnorth",
    "southeastasia", "eastasia", "japaneast", "japanwest",
    "australiaeast", "koreacentral", "canadaeast", "canadacentral",
    "swedencentral", "norwayeast", "polandcentral",
  ]

  const handleCreateRG = async () => {
    if (!selectedSub || !newRGName.trim()) return
    setCreatingRG(true)
    setCreateError(null)
    try {
      const rg = await azureDeployApi.createResourceGroup({
        subscription_id: selectedSub,
        name: newRGName.trim(),
        location: newRGLocation,
      })
      onResourceGroupCreated(rg)
      setShowCreateRG(false)
      setNewRGName("")
    } catch (err: any) {
      setCreateError(err?.message ?? "创建失败")
    } finally {
      setCreatingRG(false)
    }
  }

  const handleCreateAI = async () => {
    if (!selectedSub || !selectedRG || !newAIName.trim()) return
    setCreatingAI(true)
    setCreateError(null)
    try {
      const res = await azureDeployApi.createAIResource({
        subscription_id: selectedSub,
        resource_group: selectedRG,
        name: newAIName.trim(),
        location: newAILocation,
      })
      onAIResourceCreated(res)
      setShowCreateAI(false)
      setNewAIName("")
    } catch (err: any) {
      setCreateError(err?.message ?? "创建失败")
    } finally {
      setCreatingAI(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Subscription */}
      <div className="space-y-2">
        <Label>订阅</Label>
        {subsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载订阅列表...
          </div>
        ) : (
          <Select value={selectedSub} onValueChange={onSelectSub}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择 Azure 订阅" />
            </SelectTrigger>
            <SelectContent>
              {subscriptions.map((sub) => (
                <SelectItem key={sub.subscription_id} value={sub.subscription_id}>
                  {sub.display_name} ({sub.subscription_id.slice(0, 8)}...)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Resource group */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>资源组</Label>
          <Button
            variant="ghost" size="sm"
            className="gap-1 h-7 text-xs"
            disabled={!selectedSub}
            onClick={() => { setShowCreateRG(true); setCreateError(null) }}
          >
            <Plus className="w-3 h-3" /> 新建资源组
          </Button>
        </div>
        {rgLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载资源组...
          </div>
        ) : (
          <Select value={selectedRG} onValueChange={onSelectRG} disabled={!selectedSub}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={selectedSub ? "选择资源组" : "请先选择订阅"} />
            </SelectTrigger>
            <SelectContent>
              {resourceGroups.map((rg) => (
                <SelectItem key={rg.name} value={rg.name}>
                  {rg.name} ({rg.location})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* AI Foundry resources */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>AI Foundry 资源（多选）</Label>
          <Button
            variant="ghost" size="sm"
            className="gap-1 h-7 text-xs"
            disabled={!selectedRG}
            onClick={() => { setShowCreateAI(true); setCreateError(null) }}
          >
            <Plus className="w-3 h-3" /> 新建 AI 资源
          </Button>
        </div>
        {resLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载 AI 资源...
          </div>
        ) : !selectedRG ? (
          <p className="text-sm text-muted-foreground">请先选择资源组</p>
        ) : aiResources.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-muted-foreground">该资源组下没有 AI Foundry 资源</p>
            <Button
              variant="outline" size="sm"
              className="gap-2"
              onClick={() => { setShowCreateAI(true); setCreateError(null) }}
            >
              <Plus className="w-4 h-4" /> 创建第一个 AI 资源
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-white/5 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-white/5">
                  <TableHead className="w-12"></TableHead>
                  <TableHead>资源名</TableHead>
                  <TableHead>区域</TableHead>
                  <TableHead className="text-right">已有部署</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aiResources.map((res) => (
                  <TableRow
                    key={res.name}
                    className="cursor-pointer border-white/5 hover:bg-white/5"
                    onClick={() => onToggleResource(res.name)}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedResources.has(res.name)}
                        onCheckedChange={() => onToggleResource(res.name)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{res.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{res.location}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {res.existing_deployments} 个
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {selectedResources.size > 0 && (
          <p className="text-sm text-muted-foreground">
            已选 <span className="text-foreground font-medium">{selectedResources.size}</span> 个资源，覆盖{" "}
            <span className="text-foreground font-medium">
              {new Set(aiResources.filter(r => selectedResources.has(r.name)).map(r => r.location)).size}
            </span> 个区域
          </p>
        )}
      </div>

      {/* Create Resource Group Dialog */}
      <Dialog open={showCreateRG} onOpenChange={setShowCreateRG}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建资源组</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>资源组名称</Label>
              <Input
                placeholder="如 my-ai-resources"
                value={newRGName}
                onChange={(e) => setNewRGName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>区域</Label>
              <Select value={newRGLocation} onValueChange={setNewRGLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AZURE_REGIONS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateRG(false)}>取消</Button>
            <Button onClick={handleCreateRG} disabled={creatingRG || !newRGName.trim()}>
              {creatingRG && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create AI Resource Dialog */}
      <Dialog open={showCreateAI} onOpenChange={setShowCreateAI}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 AI Foundry 资源</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>资源名称</Label>
              <Input
                placeholder="如 my-openai-eastus"
                value={newAIName}
                onChange={(e) => setNewAIName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>区域</Label>
              <Select value={newAILocation} onValueChange={setNewAILocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AZURE_REGIONS.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              将在资源组 <span className="font-medium text-foreground">{selectedRG}</span> 下创建 AI Foundry (AIServices S0) 资源
            </p>
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateAI(false)}>取消</Button>
            <Button onClick={handleCreateAI} disabled={creatingAI || !newAIName.trim()}>
              {creatingAI && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Step 3: Models ──────────────────────────────────────────

function StepModels({
  availableModels,
  selectedModels,
  onToggleModel,
  selectedResources,
  isModelInAccount,
  deployItems,
  skuName,
  onSkuChange,
  skuCapacity,
  onCapacityChange,
  namingRule,
  onNamingRuleChange,
  planResult,
  planLoading,
  onRunPlan,
  modelsLoading,
}: {
  availableModels: AzureModel[]
  selectedModels: Set<string>
  onToggleModel: (key: string) => void
  selectedResources: AzureAIResource[]
  isModelInAccount: (name: string, version: string, accountName: string) => boolean
  deployItems: DeployItem[]
  skuName: string
  onSkuChange: (v: string) => void
  skuCapacity: number
  onCapacityChange: (v: number) => void
  namingRule: string
  onNamingRuleChange: (v: string) => void
  planResult: PlanResult | null
  planLoading: boolean
  onRunPlan: () => void
  modelsLoading: boolean
}) {
  if (modelsLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-muted-foreground">正在加载可用模型...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Model selection */}
      <div className="space-y-3">
        <Label>选择要部署的模型</Label>
        {availableModels.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有可用的模型</p>
        ) : (
          <div className="rounded-xl border border-white/5 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-white/5">
                  <TableHead className="w-12"></TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>能力</TableHead>
                  <TableHead>可用 SKU</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availableModels.map((m) => {
                  const key = `${m.model_name}@${m.model_version}`
                  return (
                    <TableRow
                      key={key}
                      className="cursor-pointer border-white/5 hover:bg-white/5"
                      onClick={() => onToggleModel(key)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedModels.has(key)}
                          onCheckedChange={() => onToggleModel(key)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{m.model_name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{m.model_version}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {m.capabilities.map(c => (
                            <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {m.available_skus?.join(", ") || "-"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Deploy params */}
      <Separator className="bg-white/5" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>SKU 类型</Label>
          <Select value={skuName} onValueChange={onSkuChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Standard">Standard</SelectItem>
              <SelectItem value="GlobalStandard">GlobalStandard</SelectItem>
              <SelectItem value="ProvisionedManaged">ProvisionedManaged</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>默认容量 (K TPM)</Label>
          <Input
            type="number"
            value={skuCapacity}
            onChange={(e) => onCapacityChange(Number(e.target.value) || 1)}
            min={1}
            max={1000}
          />
        </div>
        <div className="space-y-2">
          <Label>命名规则</Label>
          <Select value={namingRule} onValueChange={onNamingRuleChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAMING_RULES.map(r => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            预览: {selectedModels.size > 0 && selectedResources.length > 0
              ? (() => {
                  const firstModel = [...selectedModels][0]
                  const [mn, mv] = firstModel.split("@")
                  const firstRes = selectedResources[0]
                  return makeDeploymentName(namingRule, mn, mv, firstRes.location)
                })()
              : "选择模型和资源后显示"
            }
          </p>
        </div>
      </div>

      {/* Matrix preview */}
      {selectedModels.size > 0 && selectedResources.length > 0 && (
        <>
          <Separator className="bg-white/5" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>部署预览（模型 × 资源）</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={onRunPlan}
                disabled={planLoading}
                className="gap-2"
              >
                {planLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {planResult ? "重新预检" : "预检"}
              </Button>
            </div>
            <div className="rounded-xl border border-white/5 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-white/5">
                    <TableHead className="sticky left-0 bg-card z-10">模型</TableHead>
                    {selectedResources.map(res => (
                      <TableHead key={res.name} className="text-center min-w-[140px]">
                        <div>{res.name}</div>
                        <div className="text-xs text-muted-foreground font-normal">{res.location}</div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...selectedModels].map(modelKey => {
                    const [modelName, modelVersion] = modelKey.split("@")
                    return (
                      <TableRow key={modelKey} className="border-white/5">
                        <TableCell className="sticky left-0 bg-card z-10 font-medium">
                          <div>{modelName}</div>
                          <div className="text-xs text-muted-foreground">{modelVersion}</div>
                        </TableCell>
                        {selectedResources.map(res => {
                          const available = isModelInAccount(modelName, modelVersion, res.name)
                          const deployIdx = deployItems.findIndex(
                            d => d.model_name === modelName && d.model_version === modelVersion && d.account_name === res.name
                          )
                          const planItem = deployIdx >= 0
                            ? planResult?.items.find(i => i.index === deployIdx)
                            : undefined
                          return (
                            <TableCell key={res.name} className="text-center">
                              {planItem ? (
                                <MatrixCell planItem={planItem} skuCapacity={skuCapacity} />
                              ) : available ? (
                                <span className="text-green-400 text-sm">{skuCapacity}K TPM</span>
                              ) : (
                                <span className="text-red-400 text-sm">不可用</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* Plan result summary */}
      {planResult && (
        <div className="rounded-xl border border-white/5 p-4 space-y-2">
          <p className="text-sm font-medium">预检结果</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {planResult.can_create > 0 && (
              <span className="flex items-center gap-1 text-green-400">
                <Check className="w-4 h-4" /> 可创建: {planResult.can_create}
              </span>
            )}
            {planResult.will_skip > 0 && (
              <span className="flex items-center gap-1 text-blue-400">
                <SkipForward className="w-4 h-4" /> 跳过: {planResult.will_skip}
              </span>
            )}
            {planResult.has_conflict > 0 && (
              <span className="flex items-center gap-1 text-orange-400">
                <AlertTriangle className="w-4 h-4" /> 冲突: {planResult.has_conflict}
              </span>
            )}
            {planResult.unavailable > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <X className="w-4 h-4" /> 不可用: {planResult.unavailable}
              </span>
            )}
            {planResult.quota_risk > 0 && (
              <span className="flex items-center gap-1 text-yellow-400">
                <AlertTriangle className="w-4 h-4" /> 配额风险: {planResult.quota_risk}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Matrix Cell ─────────────────────────────────────────────

function MatrixCell({ planItem, skuCapacity }: { planItem: PlanResultItem; skuCapacity: number }) {
  const cfg = ACTION_CONFIG[planItem.action]
  if (!cfg) return <span className="text-muted-foreground">-</span>

  const Icon = cfg.icon
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn("flex items-center gap-1 text-sm", cfg.color)}>
        <Icon className="w-3 h-3" />
        {planItem.action === "create" || planItem.action === "quota_risk"
          ? `${skuCapacity}K TPM`
          : cfg.label}
      </span>
      {planItem.message && (
        <span className="text-xs text-muted-foreground max-w-[120px] truncate" title={planItem.message}>
          {planItem.message}
        </span>
      )}
    </div>
  )
}

// ─── Step 4: Deploy ──────────────────────────────────────────

function StepDeploy({
  taskId,
  progress,
  deploying,
  retrying,
  logs,
  onRetry,
  onReset,
}: {
  taskId: string | null
  progress: DeployProgress | null
  deploying: boolean
  retrying: boolean
  logs: string[]
  onRetry: () => void
  onReset: () => void
}) {
  const [exporting, setExporting] = useState(false)

  const total = progress?.total ?? 0
  const succeeded = progress?.succeeded ?? 0
  const failed = progress?.failed ?? 0
  const done = succeeded + failed
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const isCompleted = progress?.status === "completed"

  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-lg font-semibold">
            {isCompleted ? "部署完成" : "部署进度"}
          </h3>
          <div className="flex items-center gap-2">
            {taskId && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-2"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true)
                  try {
                    await azureDeployApi.exportExcel(taskId)
                  } catch {
                    /* user sees network error in console; optional toast */
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                导出 Excel
              </Button>
            )}
            <span className="text-sm text-muted-foreground">{done}/{total} 完成</span>
          </div>
        </div>
        <Progress value={pct} className="h-3" />
        <div className="flex gap-4 text-sm">
          {succeeded > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <Check className="w-4 h-4" /> 成功: {succeeded}
            </span>
          )}
          {failed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <X className="w-4 h-4" /> 失败: {failed}
            </span>
          )}
          {deploying && (
            <span className="flex items-center gap-1 text-blue-400">
              <Loader2 className="w-4 h-4 animate-spin" /> 进行中...
            </span>
          )}
        </div>
      </div>

      {/* Items table */}
      {progress && progress.items.length > 0 && (
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-white/5">
                <TableHead className="w-16">状态</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>目标资源</TableHead>
                <TableHead>区域</TableHead>
                <TableHead>部署名</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progress.items.map((item, idx) => {
                const cfg = STATUS_ICON[item.status]
                const Icon = cfg?.icon ?? Loader2
                return (
                  <TableRow key={idx} className="border-white/5">
                    <TableCell>
                      <Icon className={cn("w-4 h-4", cfg?.color, cfg?.animate)} />
                    </TableCell>
                    <TableCell className="font-medium">{item.model_name}</TableCell>
                    <TableCell>{item.account_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.region}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {item.deployment_name}
                      {item.status === "failed" && item.error && (
                        <p className="text-red-400 text-xs mt-1">{item.error}</p>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Logs */}
      <div className="space-y-2">
        <Label>日志</Label>
        <ScrollArea className="h-48 rounded-xl border border-white/5 bg-black/20 p-3">
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log, i) => (
              <p key={i} className={cn(
                "text-muted-foreground",
                log.includes("成功") && "text-green-400",
                log.includes("失败") && "text-red-400",
              )}>
                {log}
              </p>
            ))}
            {logs.length === 0 && (
              <p className="text-muted-foreground">等待日志...</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Actions */}
      {isCompleted && (
        <div className="flex gap-3">
          {failed > 0 && (
            <Button onClick={onRetry} disabled={retrying} variant="outline" className="gap-2">
              {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              重试失败项 ({failed}项)
            </Button>
          )}
          <Button onClick={onReset} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" /> 重新开始
          </Button>
        </div>
      )}
    </div>
  )
}
