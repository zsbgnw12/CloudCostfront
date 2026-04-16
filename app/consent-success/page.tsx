"use client"

import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function ConsentSuccessContent() {
  const params = useSearchParams()
  const accountId = params.get("account_id")

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full space-y-8">
        {/* Success banner */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20 text-green-400 text-3xl">
            &#10003;
          </div>
          <h1 className="text-2xl font-bold text-white">Azure 租户已授权成功</h1>
          <p className="text-gray-400">
            您的 Azure AD 管理员同意已完成，租户信息已自动记录到我们的平台。
          </p>
          {accountId && (
            <p className="text-xs text-gray-500">账号 ID: {accountId}</p>
          )}
        </div>

        {/* Next steps */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">
            还差最后一步：分配订阅角色
          </h2>
          <p className="text-sm text-gray-400">
            请对每个需要监控成本的 Azure 订阅，按以下步骤操作：
          </p>

          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <p className="text-gray-200 font-medium">打开 Azure 门户 &rarr; 订阅</p>
                <p className="text-gray-500">
                  访问{" "}
                  <a
                    href="https://portal.azure.com/#blade/Microsoft_Azure_Billing/SubscriptionsBlade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline"
                  >
                    portal.azure.com &rarr; 订阅
                  </a>
                  ，选择要监控的订阅。
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <p className="text-gray-200 font-medium">访问控制 (IAM) &rarr; 添加角色分配</p>
                <p className="text-gray-500">在左侧菜单点击"访问控制(IAM)"，然后点击"添加" &rarr; "添加角色分配"。</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <p className="text-gray-200 font-medium">角色选择 Cost Management Reader</p>
                <p className="text-gray-500">在搜索框中输入"Cost Management Reader"，选中后点击"下一步"。</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">4</span>
              <div>
                <p className="text-gray-200 font-medium">选择成员 &rarr; 搜索我方应用名</p>
                <p className="text-gray-500">点击"选择成员"，在搜索框中输入我方应用名称，选中后点击"选择"。</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">5</span>
              <div>
                <p className="text-gray-200 font-medium">审核 + 分配</p>
                <p className="text-gray-500">确认信息无误后，点击"审核 + 分配"完成。对每个需要监控的订阅重复此操作。</p>
              </div>
            </li>
          </ol>
        </div>

        {/* Tips */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-300">提示：</strong>
            如果是大客户，可在<strong>管理组</strong>层级一次性分配角色，所有下级订阅会自动继承权限。
          </p>
          <p>
            分配完成后，我们的运营人员会自动检测到已授权的订阅并开始同步成本数据。
            如有问题请联系运营团队。
          </p>
        </div>
      </div>
    </div>
  )
}

export default function ConsentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <p className="text-gray-400">加载中...</p>
      </div>
    }>
      <ConsentSuccessContent />
    </Suspense>
  )
}
