# 前端 API 对接说明

本文档根据 `front/` 下代码整理：**实际发起请求的入口**以 `lib/api.ts` 为主，并标注各页面 / 组件中的使用位置。后端完整路由见 `cloudcost/docs/API.md`。

---

## 1. 基址与代理

| 机制 | 说明 |
|------|------|
| `NEXT_PUBLIC_API_BASE` | 生产或静态导出时指向真实 API（如 `https://api.example.com`）；**开发环境**在 `lib/api.ts` 中默认为空字符串，使用**相对路径** `/api/...`。 |
| `next.config.mjs` `rewrites` | 将浏览器请求的 `/api/:path*` 转发到 `BACKEND_PROXY_URL`（默认 `http://127.0.0.1:8000`）的同名路径，实现开发时同源访问。 |
| 导出类 URL | `accountsApi.costsExportUrl`、`dailyReportExportUrl`、`meteringApi.exportUrl` 使用 `API_BASE` 拼出绝对地址，供 `<a download>` 或 `window.open` 触发浏览器下载（不走 `fetch`）。 |

**请求封装**（`lib/api.ts` 内 `request`）：

- 使用 `fetch`，默认 **30s** 超时（`AbortController`）。
- 有 `body` 时设置 `Content-Type: application/json`。
- **204 No Content** 时返回 `undefined`。

---

## 2. 按页面 / 模块：实际调用的接口

### 2.1 仪表盘 `/`（`app/(dashboard)/page.tsx`）

| 后端路径 | 方法 | 前端封装 | 说明 |
|----------|------|----------|------|
| `/api/dashboard/bundle` | GET | `dashboardApi.bundle` → `useDashboardBundle` | `month`、`granularity`、`service_limit` |
| `/api/service-accounts/` | GET | `accountsApi.list` → `useAccounts` | 首页统计服务账号状态分布 |

### 2.2 顶栏 `components/layout/header.tsx`

| 后端路径 | 方法 | 前端封装 | 说明 |
|----------|------|----------|------|
| `/api/sync/last` | GET | `syncApi.lastSync` | 展示最近同步时间 |
| `/api/sync/all` | POST | `syncApi.triggerAll` | 同步全部数据源（本月或自定义区间 + 可选 `provider`） |
| `/api/alerts/notifications` | GET | `alertsApi.notifications` → `useNotifications` | 下拉通知列表 |
| `/api/alerts/notifications/unread-count` | GET | `alertsApi.unreadCount` → `useUnreadCount` | 未读角标 |
| `/api/alerts/notifications/{id}/read` | POST | `alertsApi.markRead` | 单条已读 |
| `/api/alerts/notifications/read-all` | POST | `alertsApi.markAllRead` | 全部已读 |
| `/api/service-accounts/discover-gcp-projects` | POST | `accountsApi.discoverGcpProjects` | 从账单发现未建档 GCP 项目 |

### 2.3 供应商 `/suppliers`（`app/(dashboard)/suppliers/page.tsx`）

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/suppliers/` | GET | `suppliersApi.list` |
| `/api/suppliers/supply-sources/all` | GET | `suppliersApi.listAllSupplySources` |
| `/api/suppliers/` | POST | `suppliersApi.create` |
| `/api/suppliers/{id}` | PATCH | `suppliersApi.update` |
| `/api/suppliers/{id}` | DELETE | `suppliersApi.remove` |
| `/api/suppliers/{supplierId}/supply-sources` | POST | `suppliersApi.createSupplySource` |
| `/api/suppliers/supply-sources/{supplySourceId}` | DELETE | `suppliersApi.deleteSupplySource` |

### 2.4 服务账号（货源）`/accounts`（`app/(dashboard)/accounts/page.tsx`）

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/service-accounts/{id}` | GET | `accountsApi.get` |
| `/api/service-accounts/` | POST | `accountsApi.create` |
| `/api/service-accounts/{id}` | PUT | `accountsApi.update` |
| `/api/service-accounts/{id}/suspend` | POST | `accountsApi.suspend` |
| `/api/service-accounts/{id}/activate` | POST | `accountsApi.activate` |
| `/api/service-accounts/hard/{id}` | DELETE | `accountsApi.hardDelete`（页面删除走硬删） |
| `/api/service-accounts/{id}/credentials` | GET | `accountsApi.credentials` |

### 2.5 统计 `/daily-report`（`app/(dashboard)/daily-report/page.tsx`）

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/service-accounts/daily-report` | GET | `accountsApi.dailyReport` |
| `/api/service-accounts/{id}/costs` | GET | `accountsApi.costs` |
| `/api/service-accounts/daily-report/export` | GET | `accountsApi.dailyReportExportUrl`（浏览器打开下载 xlsx） |
| `/api/service-accounts/{id}/costs/export` | GET | `accountsApi.costsExportUrl`（浏览器打开下载 xlsx） |

### 2.6 计量 `/metering`（`app/(dashboard)/metering/page.tsx` + `hooks/use-data.ts`）

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/metering/summary` | GET | `meteringApi.summary` → `useMeteringSummary` |
| `/api/metering/daily` | GET | `meteringApi.daily` → `useMeteringDaily` |
| `/api/metering/by-service` | GET | `meteringApi.byService` → `useMeteringByService` |
| `/api/metering/products` | GET | `meteringApi.products` → `useMeteringProducts` |
| `/api/metering/detail` | GET | `meteringApi.detail` → `useMeteringDetail` |
| `/api/metering/detail/count` | GET | `meteringApi.detailCount` → `useMeteringDetailCount` |
| `/api/metering/export` | GET | `meteringApi.exportUrl`（导出 CSV 下载链接） |

筛选参数与后端一致：`date_start`、`date_end`、`provider`、`product`、`account_id`、`supply_source_id`、`supplier_name`、`data_source_id` 等。

### 2.7 告警 `/alerts`（`app/(dashboard)/alerts/page.tsx`）

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/alerts/rules/` | GET | `alertsApi.listRules` |
| `/api/alerts/rules/` | POST | `alertsApi.createRule` |
| `/api/alerts/rules/{id}` | PUT | `alertsApi.updateRule`（含启用/禁用） |
| `/api/alerts/rules/{id}` | DELETE | `alertsApi.deleteRule` |
| `/api/alerts/history` | GET | `alertsApi.history` |
| `/api/alerts/rule-status` | GET | `alertsApi.ruleStatus` |

承诺类展示在前端通过对 `rule-status` 返回数据中 `threshold_type === "monthly_minimum_commitment"` 的项过滤得到（变量名 `commitmentStatuses`），**不**单独请求 `/api/alerts/commitment-status`。

### 2.8 项目详情 `/projects/[id]`（`app/(dashboard)/projects/[id]/page.tsx`）

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/projects/{id}` | GET | `projectsApi.get` |
| `/api/projects/{id}/assignment-logs` | GET | `projectsApi.assignmentLogs` |
| `/api/projects/{id}/activate` | POST | `projectsApi.activate` |
| `/api/projects/{id}/suspend` | POST | `projectsApi.suspend` |
| `/api/billing/detail` | GET | `billingApi.detail`（`project_id` 用项目外部 ID，`page_size` 等） |

### 2.9 Azure 模型部署 `/azure-deploy`（`app/(dashboard)/azure-deploy/page.tsx`）

除 `GET /api/azure-deploy/auth/config` 外，均需 **`Authorization: Bearer <ARM Token>`**（由 `setAzureTokenProvider` 注入 MSAL 取得的 token）。

| 后端路径 | 方法 | 前端封装 |
|----------|------|----------|
| `/api/azure-deploy/auth/config` | GET | `azureDeployApi.getMsalConfig` |
| `/api/azure-deploy/auth/validate` | POST | `azureDeployApi.validateToken` |
| `/api/azure-deploy/subscriptions` | GET | `azureDeployApi.subscriptions` |
| `/api/azure-deploy/resource-groups` | GET | `azureDeployApi.resourceGroups` |
| `/api/azure-deploy/resource-groups` | POST | `azureDeployApi.createResourceGroup` |
| `/api/azure-deploy/ai-resources` | GET | `azureDeployApi.aiResources` |
| `/api/azure-deploy/ai-resources` | POST | `azureDeployApi.createAIResource` |
| `/api/azure-deploy/account-models` | GET | `azureDeployApi.accountModels` |
| `/api/azure-deploy/plan` | POST | `azureDeployApi.plan` |
| `/api/azure-deploy/execute` | POST | `azureDeployApi.execute` |
| `/api/azure-deploy/progress/{taskId}` | GET | `azureDeployApi.progress` |
| `/api/azure-deploy/retry/{taskId}` | POST | `azureDeployApi.retryFailed` |

### 2.10 构建期：`generateStaticParams`（`app/(dashboard)/projects/[id]/layout.tsx`）

| 后端路径 | 方法 | 说明 |
|----------|------|------|
| `/api/projects/` | GET | 当设置了 `NEXT_PUBLIC_API_BASE` 时，`fetch` 拉取项目列表以生成 `[id]` 静态路径；未设置或失败时回退占位 `id: "0"`。 |

**注意**：`output: "export"` 静态导出时，开发环境的 rewrites **不会**在构建机生效，故依赖 `NEXT_PUBLIC_API_BASE` 指向可访问的后端。

---

## 3. `lib/api.ts` 已封装但当前页面未使用的接口

以下方法在仓库内 **无其它文件引用**（仅便于扩展或遗留封装）：

| 对象 | 未使用方法 / 说明 |
|------|-------------------|
| `dataSourcesApi` | 仅 `list` → `GET /api/data-sources/`，无任何页面 import |
| `dashboardApi` | `overview`、`trend`、`byProvider`、`byService`、`byProject`、`topGrowth`（首页已改用 `bundle` 单次请求） |
| `syncApi` | `status` → `GET /api/sync/status/{taskId}` |
| `projectsApi` | `list` → `GET /api/projects/`（列表由 `layout` 的 `fetch` 使用，未走 `projectsApi`） |
| `accountsApi` | `delete` → `DELETE /api/service-accounts/{id}`（页面统一使用 `hardDelete`） |
| `suppliersApi` | `listSupplySources(supplierId)` → `GET /api/suppliers/{id}/supply-sources` |
| `alertsApi` | `commitmentStatus` → `GET /api/alerts/commitment-status`：**后端当前无此路由**（若调用会 404）；业务已用 `ruleStatus` 替代 |
| `azureDeployApi` | `models`、`existingDeployments` |

---

## 4. 与后端文档的对应关系

- 前端请求的 path 均以 **`/api/`** 开头，与 FastAPI `app.include_router(..., prefix="/api/...")` 一致。
- 列表类资源在 `api.ts` 中部分 URL **带尾部斜杠**（如 `/api/service-accounts/`、`/api/projects/`），以避免 FastAPI `307` 重定向在跨域场景下出问题（见 `api.ts` 注释）。

如需核对字段级类型，以 `lib/api.ts` 中的 `interface` 与后端 Pydantic schema 为准，或直接访问后端 **`/docs`**（OpenAPI）。
