"use client"

import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

/** Neon 主题专属 canvas 粒子层 —— 与登录页同款,但密度/复杂度调低,
 *  避免后台长期停留时烧 CPU。粒子间在阈值内连线,鼠标附近粒子被吸引,
 *  整个画布固定 fixed 在 z-index -1,挂在 dashboard layout 里。
 *  其它主题(light/dark)直接 return null,零开销。 */
export function NeonBackdrop() {
  const { resolvedTheme } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (resolvedTheme !== "neon") return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: true })!
    let raf = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + "px"
      canvas.style.height = window.innerHeight + "px"
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener("resize", resize)

    interface P { x: number; y: number; vx: number; vy: number; r: number; hue: number }
    const N = Math.min(90, Math.floor((window.innerWidth * window.innerHeight) / 18000))
    const PARTS: P[] = []
    for (let i = 0; i < N; i++) {
      PARTS.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.4 + 0.4,
        hue: 200 + Math.random() * 120, // cyan -> purple -> pink
      })
    }

    const mouse = { x: -1000, y: -1000, active: false }
    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true }
    const onLeave = () => { mouse.active = false; mouse.x = -1000; mouse.y = -1000 }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseleave", onLeave)

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      // 粒子运动
      for (const p of PARTS) {
        // 鼠标轻吸引
        if (mouse.active) {
          const dx = mouse.x - p.x
          const dy = mouse.y - p.y
          const d2 = dx * dx + dy * dy
          if (d2 < 22500) { // 150px
            const f = (1 - d2 / 22500) * 0.04
            p.vx += dx * f / Math.sqrt(d2 + 1)
            p.vy += dy * f / Math.sqrt(d2 + 1)
          }
        }
        p.vx *= 0.985
        p.vy *= 0.985
        p.x += p.vx
        p.y += p.vy
        // 边界回卷
        if (p.x < -10) p.x = window.innerWidth + 10
        if (p.x > window.innerWidth + 10) p.x = -10
        if (p.y < -10) p.y = window.innerHeight + 10
        if (p.y > window.innerHeight + 10) p.y = -10
      }
      // 连线
      ctx.lineWidth = 0.6
      for (let i = 0; i < PARTS.length; i++) {
        for (let j = i + 1; j < PARTS.length; j++) {
          const a = PARTS[i], b = PARTS[j]
          const dx = a.x - b.x, dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < 14400) { // 120px
            const alpha = (1 - d2 / 14400) * 0.35
            ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 90%, 70%, ${alpha})`
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }
      // 粒子本体 + glow
      for (const p of PARTS) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6)
        g.addColorStop(0, `hsla(${p.hue}, 95%, 78%, 0.95)`)
        g.addColorStop(0.4, `hsla(${p.hue}, 95%, 65%, 0.4)`)
        g.addColorStop(1, `hsla(${p.hue}, 95%, 60%, 0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseleave", onLeave)
    }
  }, [resolvedTheme])

  if (resolvedTheme !== "neon") return null
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{ mixBlendMode: "screen" }}
    />
  )
}
