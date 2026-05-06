"use client"

import { useEffect, useRef, useState } from "react"
import { Cloud, ArrowRight, Sparkles, Shield, Zap } from "lucide-react"
import { authApi } from "@/lib/api"

/** CloudCost 登录页 — 全屏震撼特效。
 *  入场过渡 + 多层粒子 + 流光网格 + SVG 光带 + 鼠标拖尾 + 字符特效 +
 *  按钮点击爆炸 + 跳转过渡。
 *  所有 keyframes 在 globals.css 里(login- 前缀),组件内只用动态 inline style。 */

const TITLE = "CloudCost"
const SUBTITLE = "多 云 · 成 本 · 智 能 管 理 平 台"

interface BurstParticle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  hue: number
}

export default function LoginPage() {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const trailCanvasRef = useRef<HTMLCanvasElement>(null)
  const [hovering, setHovering] = useState(false)
  const [loading, setLoading] = useState(false)
  const [force, setForce] = useState(false)
  const [introDone, setIntroDone] = useState(false)
  const [titleDone, setTitleDone] = useState(false)
  const burstRef = useRef<BurstParticle[]>([])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setForce(params.get("force") === "true")
  }, [])

  useEffect(() => {
    const t1 = setTimeout(() => setIntroDone(true), 800)
    const t2 = setTimeout(() => setTitleDone(true), 800 + TITLE.length * 80 + 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // 背景:粒子 + 几何 + 鼠标光晕 + 按钮爆裂粒子
  useEffect(() => {
    const canvas = bgCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    let raf = 0
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    interface P { x: number; y: number; vx: number; vy: number; r: number; hue: number; life: number }
    const PARTS: P[] = []
    const N = Math.min(180, Math.floor((window.innerWidth * window.innerHeight) / 9000))
    for (let i = 0; i < N; i++) {
      PARTS.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 1.8 + 0.4,
        hue: 200 + Math.random() * 100,
        life: Math.random(),
      })
    }

    interface Geo { x: number; y: number; rot: number; rv: number; size: number; sides: number; hue: number; opacity: number }
    const GEOS: Geo[] = []
    for (let i = 0; i < 12; i++) {
      GEOS.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        rot: Math.random() * Math.PI * 2,
        rv: (Math.random() - 0.5) * 0.005,
        size: Math.random() * 40 + 20,
        sides: 3 + Math.floor(Math.random() * 4),
        hue: 200 + Math.random() * 80,
        opacity: 0.05 + Math.random() * 0.06,
      })
    }

    let mx = canvas.width / 2, my = canvas.height / 2
    const onMove = (e: MouseEvent) => { mx = e.clientX; my = e.clientY }
    window.addEventListener("mousemove", onMove)

    const tick = () => {
      ctx.fillStyle = "rgba(8, 12, 24, 0.16)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      for (const g of GEOS) {
        g.rot += g.rv
        g.x += Math.sin(g.rot) * 0.2
        g.y += Math.cos(g.rot) * 0.2
        if (g.x < -100) g.x = canvas.width + 50
        if (g.x > canvas.width + 100) g.x = -50
        if (g.y < -100) g.y = canvas.height + 50
        if (g.y > canvas.height + 100) g.y = -50
        ctx.save()
        ctx.translate(g.x, g.y)
        ctx.rotate(g.rot)
        ctx.strokeStyle = `hsla(${g.hue}, 90%, 70%, ${g.opacity * 6})`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i <= g.sides; i++) {
          const a = (i / g.sides) * Math.PI * 2
          const x = Math.cos(a) * g.size
          const y = Math.sin(a) * g.size
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.restore()
      }

      for (let i = 0; i < PARTS.length; i++) {
        for (let j = i + 1; j < PARTS.length; j++) {
          const dx = PARTS[i].x - PARTS[j].x
          const dy = PARTS[i].y - PARTS[j].y
          const d = Math.hypot(dx, dy)
          if (d < 130) {
            const a = (1 - d / 130) * 0.4
            ctx.strokeStyle = `hsla(${(PARTS[i].hue + PARTS[j].hue) / 2}, 85%, 70%, ${a})`
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.moveTo(PARTS[i].x, PARTS[i].y)
            ctx.lineTo(PARTS[j].x, PARTS[j].y)
            ctx.stroke()
          }
        }
      }

      const grad = ctx.createRadialGradient(mx, my, 0, mx, my, 320)
      grad.addColorStop(0, "rgba(140, 180, 255, 0.22)")
      grad.addColorStop(0.5, "rgba(168, 85, 247, 0.08)")
      grad.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      for (const p of PARTS) {
        const dx = mx - p.x, dy = my - p.y
        const d = Math.hypot(dx, dy) || 1
        if (d < 220) {
          p.vx += (dx / d) * 0.03
          p.vy += (dy / d) * 0.03
        }
        p.vx *= 0.97; p.vy *= 0.97
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7)
        glow.addColorStop(0, `hsla(${p.hue}, 95%, 78%, 1)`)
        glow.addColorStop(0.4, `hsla(${p.hue}, 95%, 65%, 0.5)`)
        glow.addColorStop(1, `hsla(${p.hue}, 95%, 60%, 0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 7, 0, Math.PI * 2)
        ctx.fill()
      }

      const burst = burstRef.current
      for (let i = burst.length - 1; i >= 0; i--) {
        const b = burst[i]
        b.x += b.vx; b.y += b.vy
        b.vx *= 0.96; b.vy *= 0.96
        b.life++
        if (b.life > b.maxLife) { burst.splice(i, 1); continue }
        const a = 1 - b.life / b.maxLife
        const r = (1 - a) * 8 + 2
        const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 2)
        glow.addColorStop(0, `hsla(${b.hue}, 95%, 75%, ${a})`)
        glow.addColorStop(1, `hsla(${b.hue}, 95%, 60%, 0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(b.x, b.y, r * 2, 0, Math.PI * 2)
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

  // 鼠标拖尾
  useEffect(() => {
    const canvas = trailCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")!
    let raf = 0
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    interface T { x: number; y: number; life: number; hue: number }
    const trail: T[] = []
    let hue = 200
    const onMove = (e: MouseEvent) => {
      hue = (hue + 2) % 360
      trail.push({ x: e.clientX, y: e.clientY, life: 0, hue: 200 + (hue % 100) })
      if (trail.length > 60) trail.shift()
    }
    window.addEventListener("mousemove", onMove)

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < trail.length; i++) {
        const t = trail[i]
        t.life++
        const a = Math.max(0, 1 - t.life / 30)
        const r = (1 - i / trail.length) * 14 + 2
        const glow = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, r)
        glow.addColorStop(0, `hsla(${t.hue}, 95%, 75%, ${a * 0.6})`)
        glow.addColorStop(1, `hsla(${t.hue}, 95%, 60%, 0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      while (trail.length > 0 && trail[0].life > 30) trail.shift()
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", onMove)
    }
  }, [])

  const handleLogin = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (loading) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    for (let i = 0; i < 200; i++) {
      const angle = (i / 200) * Math.PI * 2 + Math.random() * 0.3
      const speed = Math.random() * 14 + 4
      burstRef.current.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0, maxLife: 80 + Math.random() * 40,
        hue: 200 + Math.random() * 80,
      })
    }
    setLoading(true)
    setTimeout(() => {
      window.location.href = authApi.loginUrl(force)
    }, 1400)
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#080c18] text-white">
      {!introDone && (
        <div className="fixed inset-0 z-[100] bg-black login-intro-fade pointer-events-none" />
      )}

      <canvas ref={bgCanvasRef} className="absolute inset-0 w-full h-full" />
      <canvas ref={trailCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* 3D 透视网格 */}
      <div className="absolute inset-0 pointer-events-none" style={{ perspective: "800px" }}>
        <div
          className="absolute left-0 right-0 bottom-0 h-[60vh] login-grid-perspective"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(80,140,255,0.20) 1px, transparent 1px), " +
              "linear-gradient(to bottom, rgba(80,140,255,0.20) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            transform: "rotateX(60deg) translateY(20%)",
            transformOrigin: "bottom",
          }}
        />
      </div>

      {/* 发光大球 */}
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-3xl opacity-50 login-pulse-slow"
        style={{ background: "radial-gradient(circle, rgba(99,102,241,0.7), transparent 70%)" }} />
      <div className="absolute -bottom-40 -right-40 w-[700px] h-[700px] rounded-full blur-3xl opacity-40 login-pulse-slow-2"
        style={{ background: "radial-gradient(circle, rgba(168,85,247,0.6), transparent 70%)" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-3xl opacity-25 login-pulse-slow-3"
        style={{ background: "radial-gradient(circle, rgba(56,189,248,0.7), transparent 70%)" }} />

      {/* SVG 流光线条 */}
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <linearGradient id="flowGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0" />
            <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="flowGrad2" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M -100 200 Q 400 100, 800 400 T 1900 300"
          stroke="url(#flowGrad1)" strokeWidth="2" fill="none" className="login-flow-path-1" />
        <path d="M 0 800 Q 500 600, 1000 700 T 1920 500"
          stroke="url(#flowGrad2)" strokeWidth="1.5" fill="none" className="login-flow-path-2" />
        <path d="M -100 500 Q 600 800, 1200 600 T 2000 700"
          stroke="url(#flowGrad1)" strokeWidth="1.2" fill="none" className="login-flow-path-3" />
      </svg>

      <div className="absolute inset-0 pointer-events-none login-scan-line" />

      <div className="absolute inset-0 pointer-events-none opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9' /></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }} />

      {/* 主内容 — loading 时整体缩放+模糊+消失 */}
      <div
        className={`relative z-10 flex flex-col items-center justify-center w-full h-full px-6 transition-all duration-[1200ms] ease-in-out ${
          loading ? "scale-[0.85] opacity-0 blur-md" : "scale-100 opacity-100 blur-0"
        }`}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-5 mb-12 login-logo-in">
          <div className="relative">
            <div className="absolute inset-0 -m-3 rounded-3xl blur-xl bg-gradient-to-br from-blue-400 via-purple-500 to-pink-500 opacity-80 login-spin-slow" />
            <div className="absolute inset-0 -m-1 rounded-3xl blur-md bg-gradient-to-tr from-cyan-400 via-blue-500 to-purple-500 opacity-60 login-spin-reverse" />
            <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 flex items-center justify-center shadow-2xl">
              <Cloud className="w-12 h-12 text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]" strokeWidth={2.4} />
            </div>
            <span className="absolute top-0 left-0 w-2 h-2 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)] login-satellite-1" />
            <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-purple-300 shadow-[0_0_10px_rgba(216,180,254,0.9)] login-satellite-2" />
            <span className="absolute bottom-0 left-0 w-1.5 h-1.5 rounded-full bg-pink-300 shadow-[0_0_10px_rgba(249,168,212,0.9)] login-satellite-3" />
          </div>

          {/* 标题:每个字符依次掉落 */}
          <h1 className="text-7xl md:text-8xl font-black tracking-tight flex items-baseline">
            {TITLE.split("").map((c, i) => (
              <span
                key={i}
                className="inline-block bg-gradient-to-r from-blue-300 via-cyan-200 to-purple-300 bg-clip-text text-transparent"
                style={{
                  backgroundSize: "200% 200%",
                  animation: `login-char-drop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.8 + i * 0.08}s backwards, login-gradient-flow 4s ease-in-out infinite ${1.5 + i * 0.08}s`,
                }}
              >
                {c}
              </span>
            ))}
          </h1>

          {titleDone && (
            <div className="flex items-center gap-2 login-fade-up">
              <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
              <p className="text-zinc-400 text-base md:text-lg tracking-[0.3em]">{SUBTITLE}</p>
              <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
          )}
        </div>

        {/* 主登录按钮 */}
        <div className="relative login-button-in">
          {hovering && (
            <>
              <div className="absolute inset-0 -m-8 rounded-full blur-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 opacity-90 login-spin-slow" />
              <div className="absolute inset-0 -m-6 rounded-full blur-xl bg-gradient-to-l from-pink-400 via-purple-500 to-blue-500 opacity-70 login-spin-reverse" />
            </>
          )}
          <div className="absolute inset-0 rounded-full blur-2xl bg-gradient-to-r from-blue-500 to-purple-600 opacity-70" />

          <button
            onClick={handleLogin}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            disabled={loading}
            className="relative group overflow-hidden px-14 py-6 rounded-full bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-400 hover:via-indigo-500 hover:to-purple-500 text-white font-semibold text-xl tracking-wide shadow-[0_0_80px_rgba(99,102,241,0.7)] transition-all duration-300 hover:scale-110 hover:shadow-[0_0_120px_rgba(168,85,247,0.9)] active:scale-95 disabled:opacity-90 disabled:cursor-wait flex items-center gap-3"
          >
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <Sparkles className={`w-6 h-6 ${loading ? "animate-spin" : "animate-pulse"}`} />
            <span className="relative">{loading ? "正在跳转 ..." : "进入云成本中心"}</span>
            <ArrowRight className="w-6 h-6 transition-transform group-hover:translate-x-2" />
          </button>
        </div>

        {force && (
          <div className="mt-8 max-w-md login-fade-up login-delay-400 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-sm text-center backdrop-blur-sm">
            ⚠ 当前账号未分配 CloudCost 访问权限。请使用其他账号登录,或联系管理员分配 cloud_admin / cloud_ops / cloud_aws / cloud_gcp / cloud_azure / cloud_taiji 角色。
          </div>
        )}

        <div className="mt-10 flex items-center gap-2 text-zinc-500 text-sm login-fade-up login-delay-700">
          <Shield className="w-4 h-4" />
          <span>由 Casdoor 提供统一身份认证 · 安全单点登录</span>
        </div>

        <div className="absolute bottom-8 left-0 right-0 text-center text-xs text-zinc-600 login-fade-up login-delay-1000">
          <p>CloudCost © {new Date().getFullYear()} · 跨云费用对账 / 实时计量 / 智能告警</p>
        </div>
      </div>

      {/* 跳转过渡覆盖层 */}
      {loading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none login-redirect-overlay">
          <div className="flex flex-col items-center gap-8">
            <div className="relative w-44 h-44">
              <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 login-spin-fast" />
              <div className="absolute inset-3 rounded-full border-2 border-purple-400/30 border-r-purple-400 login-spin-reverse-fast" />
              <div className="absolute inset-7 rounded-full border-2 border-pink-400/30 border-b-pink-400 login-spin-fast" />
              <div className="absolute inset-12 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700 flex items-center justify-center shadow-2xl animate-pulse">
                <Cloud className="w-10 h-10 text-white" strokeWidth={2.4} />
              </div>
              <div className="absolute inset-0 -m-8 rounded-full blur-3xl bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 opacity-60 animate-pulse" />
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="text-2xl font-bold tracking-wider bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent login-gradient-flow">
                正在跳转 Casdoor 统一登录
              </div>
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 login-bounce-dot" />
                <span className="w-2 h-2 rounded-full bg-blue-400 login-bounce-dot login-delay-200" />
                <span className="w-2 h-2 rounded-full bg-purple-400 login-bounce-dot login-delay-400" />
                <span className="w-2 h-2 rounded-full bg-pink-400 login-bounce-dot login-delay-600" />
              </div>
              <div className="text-xs text-zinc-500 tracking-widest mt-2">
                请稍候 · 安全身份验证准备中
              </div>
            </div>
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-cyan-400/40 login-ripple" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-purple-400/40 login-ripple login-delay-400" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-pink-400/40 login-ripple login-delay-700" />

          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-80 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 login-progress" />
          </div>
        </div>
      )}

      {/* 角落装饰条 */}
      <div className="absolute top-0 left-0 w-32 h-32 pointer-events-none">
        <div className="absolute top-0 left-0 w-32 h-px bg-gradient-to-r from-cyan-400 to-transparent" />
        <div className="absolute top-0 left-0 w-px h-32 bg-gradient-to-b from-cyan-400 to-transparent" />
      </div>
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none">
        <div className="absolute top-0 right-0 w-32 h-px bg-gradient-to-l from-purple-400 to-transparent" />
        <div className="absolute top-0 right-0 w-px h-32 bg-gradient-to-b from-purple-400 to-transparent" />
      </div>
      <div className="absolute bottom-0 left-0 w-32 h-32 pointer-events-none">
        <div className="absolute bottom-0 left-0 w-32 h-px bg-gradient-to-r from-pink-400 to-transparent" />
        <div className="absolute bottom-0 left-0 w-px h-32 bg-gradient-to-t from-pink-400 to-transparent" />
      </div>
      <div className="absolute bottom-0 right-0 w-32 h-32 pointer-events-none">
        <div className="absolute bottom-0 right-0 w-32 h-px bg-gradient-to-l from-blue-400 to-transparent" />
        <div className="absolute bottom-0 right-0 w-px h-32 bg-gradient-to-t from-blue-400 to-transparent" />
      </div>
    </div>
  )
}
