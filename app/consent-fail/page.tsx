"use client"

import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

const REASON_MAP: Record<string, { title: string; detail: string }> = {
  invalid_state: {
    title: "链接无效",
    detail: "授权链接中的验证参数无效，可能链接已被篡改或复制不完整。请联系运营获取新的授权链接。",
  },
  already_used: {
    title: "链接已使用",
    detail: "该授权链接已经被使用过，每个链接仅能使用一次。如需重新授权，请联系运营生成新的链接。",
  },
  expired: {
    title: "链接已过期",
    detail: "该授权链接已超过 24 小时有效期。请联系运营重新生成链接。",
  },
  denied: {
    title: "授权被拒绝",
    detail: "Azure 管理员选择了拒绝授权。如果这是误操作，请联系运营获取新的授权链接后重试。",
  },
}

const DEFAULT_REASON = {
  title: "授权失败",
  detail: "Azure 授权过程中出现了问题。请联系运营团队获取帮助。",
}

function ConsentFailContent() {
  const params = useSearchParams()
  const reason = params.get("reason") || ""
  const info = REASON_MAP[reason] || DEFAULT_REASON

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 text-red-400 text-3xl">
          &#10007;
        </div>
        <h1 className="text-2xl font-bold text-white">{info.title}</h1>
        <p className="text-gray-400 text-sm leading-relaxed">{info.detail}</p>
        {reason && (
          <p className="text-xs text-gray-600">错误代码: {reason}</p>
        )}
        <div className="pt-4">
          <a
            href="mailto:support@example.com"
            className="inline-flex items-center px-4 py-2 rounded bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
          >
            联系运营团队
          </a>
        </div>
      </div>
    </div>
  )
}

export default function ConsentFailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <p className="text-gray-400">加载中...</p>
      </div>
    }>
      <ConsentFailContent />
    </Suspense>
  )
}
