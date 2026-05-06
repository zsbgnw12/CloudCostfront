"use client"

import { useEffect, useRef, useState } from "react"
import { Cloud, ArrowRight, Sparkles, Shield } from "lucide-react"

/** CloudCost 登录页 — 全屏粒子 + 流光网格 + 发光按钮。
 *  点击按钮 → 后端 /api/auth/login?redirect=true → Casdoor 登录页。 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || ""

export default function LoginPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [hovering, setHovering] = useState(false)
  const [loading, setLoading] = useState(false)
  const [force, setForce] = useState(false)

  // 读 URL 参数:?force=true 表示因"无云管角色"被踢回来,点击会强制 Casdoor 重选账号
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setForce(params.get("force") === "true")
  }, [])

  // 粒子系统 — 漂浮的光点 + 跟随鼠标的引力
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!

    let raf = 0
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    interface Particle {
      x: number; y: number
      vx: number; vy: number
      r: number
      hue: number
      life: number
    }
    const particles: Particle[] = []
    const N = Math.min(120, Math.floor((window.innerWidth * window.innerHeight) / 12000))
    for (let i = 0; i < N; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.6 + 0.4,
        hue: 210 + Math.random() * 80,  // 蓝紫色调
        life: Math.random(),
      })
    }

    let mx = canvas.width / 2
    let my = canvas.height / 2
    const onMove = (e: MouseEvent) => {
      mx = e.clientX
      my = e.clientY
    }
    window.addEventListener("mousemove", onMove)

    const tick = () => {
      ctx.fillStyle = "rgba(8, 12, 24, 0.18)"  // 拖尾效果
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // 连线 — 粒子之间近距离时连线(蜘蛛网)
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d = Math.hypot(dx, dy)
          if (d < 130) {
            const a = (1 - d / 130) * 0.35
            ctx.strokeStyle = `hsla(${(particles[i].hue + particles[j].hue) / 2}, 80%, 65%, ${a})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }

      // 鼠标光环
      const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 280)
      grad.addColorStop(0, "rgba(120, 180, 255, 0.18)")
      grad.addColorStop(1, "rgba(120, 180, 255, 0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // 粒子运动 + 鼠标引力
      for (const p of particles) {
        const dx = mx - p.x
        const dy = my - p.y
        const d = Math.hypot(dx, dy) || 1
        if (d < 200) {
          p.vx += (dx / d) * 0.025
          p.vy += (dy / d) * 0.025
        }
        p.vx *= 0.97
        p.vy *= 0.97
        p.x += p.vx
        p.y += p.vy
        p.life += 0.005

        // 出界包卷
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        // 绘制粒子(带光晕)
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6)
        glow.addColorStop(0, `hsla(${p.hue}, 95%, 75%, 0.95)`)
        glow.addColorStop(0.4, `hsla(${p.hue}, 95%, 65%, 0.4)`)
        glow.addColorStop(1, `hsla(${p.hue}, 95%, 60%, 0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2)
        ctx.fill()
      }

      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", onMove)
    }
  }, [])

  // 鼠标位置 — 用于按钮区域的 3D 倾斜
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY })
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [])

  const handleLogin = () => {
    setLoading(true)
    // 一点点延迟让按钮特效播完
    setTimeout(() => {
      const url = force
        ? `${API_BASE}/api/auth/login?redirect=true&force=true`
        : `${API_BASE}/api/auth/login?redirect=true`
      window.location.href = url
    }, 350)
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#080c18] text-white">
      {/* 第 1 层:粒子 canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* 第 2 层:CSS 网格透视(像 Tron / 赛博朋克) */}
      <div className="absolute inset-0 pointer-events-none" style={{ perspective: "800px" }}>
        <div
          className="absolute left-0 right-0 bottom-0 h-[60vh] grid-perspective"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(80,140,255,0.18) 1px, transparent 1px), " +
              "linear-gradient(to bottom, rgba(80,140,255,0.18) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            transform: "rotateX(60deg) translateY(20%)",
            transformOrigin: "bottom",
          }}
        />
      </div>

      {/* 第 3 层:发光大球(背景装饰) */}
      <div
        className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-3xl opacity-40 animate-pulse-slow"
        style={{ background: "radial-gradient(circle, rgba(99,102,241,0.6), transparent 70%)" }}
      />
      <div
        className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full blur-3xl opacity-30 animate-pulse-slow-2"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.5), transparent 70%)" }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-3xl opacity-20"
        style={{ background: "radial-gradient(circle, rgba(56,189,248,0.6), transparent 70%)" }}
      />

      {/* 第 4 层:扫描线(顶部到底部缓慢扫) */}
      <div className="absolute inset-0 pointer-events-none scan-line" />

      {/* 第 5 层:噪点纹理增加质感 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9' /></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }}
      />

      {/* 主内容 */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full px-6">
        {/* Logo + 标题 */}
        <div className="flex flex-col items-center gap-4 mb-12 animate-fade-up">
          <div className="relative">
            {/* Logo 外光环 */}
            <div className="absolute inset-0 rounded-3xl blur-xl bg-gradient-to-br from-blue-400 via-purple-500 to-pink-500 opacity-70 animate-spin-slow" />
            <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 flex items-center justify-center shadow-2xl">
              <Cloud className="w-10 h-10 text-white drop-shadow-lg" strokeWidth={2.4} />
            </div>
          </div>

          <h1 className="text-6xl md:text-7xl font-black tracking-tight bg-gradient-to-r from-blue-300 via-cyan-200 to-purple-300 bg-clip-text text-transparent animate-gradient-flow">
            CloudCost
          </h1>
          <p className="text-zinc-400 text-base md:text-lg tracking-wider">
            多 云 · 成 本 · 智 能 管 理 平 台
          </p>
        </div>

        {/* 主登录按钮 — 巨型发光 */}
        <div
          className="relative animate-fade-up animation-delay-300"
          style={{
            transform: hovering
              ? `perspective(1000px) rotateX(${(mousePos.y - window.innerHeight / 2) * 0.01}deg) rotateY(${(mousePos.x - window.innerWidth / 2) * 0.01}deg)`
              : undefined,
            transition: "transform 0.15s ease-out",
          }}
        >
          {/* 旋转光环 */}
          {hovering && (
            <div className="absolute inset-0 -m-6 rounded-full blur-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 opacity-80 animate-spin-slow" />
          )}
          {/* 静态发光底 */}
          <div className="absolute inset-0 rounded-full blur-2xl bg-gradient-to-r from-blue-500 to-purple-600 opacity-60" />

          <button
            onClick={handleLogin}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            disabled={loading}
            className={`
              relative group overflow-hidden
              px-12 py-5 rounded-full
              bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600
              hover:from-blue-400 hover:via-indigo-500 hover:to-purple-500
              text-white font-semibold text-lg tracking-wide
              shadow-[0_0_60px_rgba(99,102,241,0.6)]
              transition-all duration-300
              hover:scale-110 hover:shadow-[0_0_100px_rgba(168,85,247,0.8)]
              active:scale-95
              disabled:opacity-70 disabled:cursor-wait
              flex items-center gap-3
            `}
          >
            {/* 按钮内部流光 */}
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out bg-gradient-to-r from-transparent via-white/30 to-transparent" />

            <Sparkles className={`w-5 h-5 ${loading ? "animate-spin" : "animate-pulse"}`} />
            <span className="relative">{loading ? "正在跳转..." : "进入云成本中心"}</span>
            <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        {/* force 模式 — 用户因无角色被踢回,显眼提示 */}
        {force && (
          <div className="mt-8 max-w-md animate-fade-up animation-delay-400 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-sm text-center backdrop-blur-sm">
            ⚠ 当前账号未分配 CloudCost 访问权限。请使用其他账号登录,或联系管理员分配 cloud_admin / cloud_ops / cloud_aws / cloud_gcp / cloud_azure / cloud_taiji 角色。
          </div>
        )}

        {/* 副提示 */}
        <div className="mt-10 flex items-center gap-2 text-zinc-500 text-sm animate-fade-up animation-delay-500">
          <Shield className="w-4 h-4" />
          <span>由 Casdoor 提供统一身份认证 · 安全单点登录</span>
        </div>

        {/* 底部说明 */}
        <div className="absolute bottom-8 left-0 right-0 text-center text-xs text-zinc-600 animate-fade-up animation-delay-700">
          <p>CloudCost © {new Date().getFullYear()} · 跨云费用对账 / 实时计量 / 智能告警</p>
        </div>
      </div>

      {/* 内联 keyframes(避免改 globals.css) */}
      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.08); }
        }
        @keyframes pulse-slow-2 {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.12); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes gradient-flow {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scan {
          0%   { transform: translateY(-100%); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes grid-shift {
          from { background-position: 0 0; }
          to   { background-position: 60px 60px; }
        }

        .animate-pulse-slow   { animation: pulse-slow 6s ease-in-out infinite; }
        .animate-pulse-slow-2 { animation: pulse-slow-2 8s ease-in-out infinite; }
        .animate-spin-slow    { animation: spin-slow 12s linear infinite; }
        .animate-gradient-flow {
          background-size: 200% 200%;
          animation: gradient-flow 4s ease-in-out infinite;
        }
        .animate-fade-up {
          opacity: 0;
          animation: fade-up 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animation-delay-300 { animation-delay: 0.3s; }
        .animation-delay-400 { animation-delay: 0.4s; }
        .animation-delay-500 { animation-delay: 0.5s; }
        .animation-delay-700 { animation-delay: 0.7s; }

        .scan-line::before {
          content: "";
          position: absolute;
          left: 0; right: 0;
          height: 2px;
          background: linear-gradient(to right,
            transparent 0%,
            rgba(99,179,237,0.6) 20%,
            rgba(167,139,250,0.8) 50%,
            rgba(99,179,237,0.6) 80%,
            transparent 100%);
          box-shadow: 0 0 20px rgba(99,179,237,0.6);
          animation: scan 6s linear infinite;
        }

        .grid-perspective {
          animation: grid-shift 5s linear infinite;
        }
      `}</style>
    </div>
  )
}
