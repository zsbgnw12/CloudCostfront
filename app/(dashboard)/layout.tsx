"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { PageTransition } from "@/components/page-transition"
import { NeonBackdrop } from "@/components/neon-backdrop"
import { authApi } from "@/lib/api"
import { Cloud } from "lucide-react"

// 会话有效性检查频率：每 2 分钟一次。配合 visibilitychange，用户切回标签
// 时立刻 ping 一次，避免长时间 idle 后 cookie 过期但 UI 不自知。
const _AUTH_HEARTBEAT_MS = 2 * 60 * 1000

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  // 未确认登录前显示加载占位,避免未登录用户先看到一闪 dashboard 再跳走
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    const checkAuth = async (): Promise<boolean> => {
      try {
        await authApi.me()
        return true
      } catch {
        // me 失败 = 未登录或 token 过期。lib/api.ts 的 redirectToLogin 已会跳 /login,
        // 这里 router.replace 兜底（确保跳）。
        if (alive) {
          setAuthed(false)
          router.replace("/login")
        }
        return false
      }
    }

    // 首次检查
    ;(async () => {
      const ok = await checkAuth()
      if (alive && ok) setAuthed(true)
    })()

    // 心跳：每 2 分钟轮询 /api/auth/me，发现 cookie 失效立即跳 /login
    heartbeatTimer = setInterval(() => {
      if (!alive) return
      void checkAuth()
    }, _AUTH_HEARTBEAT_MS)

    // 用户从其他标签切回 → 立即检查（不用等到下一个心跳）
    const onVisibility = () => {
      if (!alive) return
      if (document.visibilityState === "visible") void checkAuth()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      alive = false
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [router])

  if (authed !== true) {
    // 加载/未授权占位 — 跟登录页同色调,避免视觉撕裂
    return (
      <div className="fixed inset-0 bg-[#080c18] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 flex items-center justify-center">
            <Cloud className="w-8 h-8 text-white animate-pulse" strokeWidth={2.4} />
          </div>
          <p className="text-zinc-400 text-sm tracking-wider">CloudCost · 加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <NeonBackdrop />
      <div className="flex h-screen overflow-hidden relative z-10">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden relative">
          <Header />
          <main className="flex-1 overflow-y-auto p-4 md:p-8 z-10 scroll-smooth">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    </>
  )
}
