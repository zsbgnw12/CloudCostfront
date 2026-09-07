"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { PageTransition } from "@/components/page-transition"
import { NeonBackdrop } from "@/components/neon-backdrop"
import { API_BASE_URL } from "@/lib/api"
import { Cloud } from "lucide-react"

// 会话有效性检查频率：每 60 秒一次（比之前的 120s 短，发现 cookie 过期更快）。
// 配合 visibilitychange，用户切回标签时立刻 ping 一次。
const _AUTH_HEARTBEAT_MS = 60 * 1000

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

    // 用 raw fetch 而不是 authApi.me() —— authApi.me() 会经过 lib/api.ts 的 401
    // 自动 refresh 逻辑，可能把"真过期"伪装成"还在登录"。这里要的是**真实**
    // 的会话状态：cookie 没了 / 过期了 → 401 → 立刻强跳，不要 refresh。
    // 业务 API 调用仍然走 authApi（保留 refresh 滚动续期），不冲突。
    const rawCheckMe = async () => {
      if (!alive) return
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        })
        if (!alive) return
        if (res.status === 401) {
          // 显式硬跳，绕过 router.replace 可能保留的 React 状态/SWR cache
          if (typeof window !== "undefined" && window.location.pathname !== "/login") {
            window.location.replace("/login")
          }
          setAuthed(false)
          return
        }
        if (res.ok) {
          setAuthed(true)
        }
      } catch {
        // 网络错误等：下一次心跳再试，不强跳避免误杀
      }
    }

    // 首次检查
    void rawCheckMe()

    // 心跳：每 60 秒检查一次 /api/auth/me；401 立即跳 /login
    heartbeatTimer = setInterval(() => {
      if (!alive) return
      void rawCheckMe()
    }, _AUTH_HEARTBEAT_MS)

    // 用户从其他标签切回 → 立即检查（不用等到下一个心跳）
    const onVisibility = () => {
      if (!alive) return
      if (document.visibilityState === "visible") void rawCheckMe()
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
