"use client"

import { useEffect, useState } from "react"
import { Moon, Sun, Sparkles } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

/** 顶部栏主题切换 — 三态循环:light → dark → neon → light。
 *  neon = 与登录页同款霓虹·赛博风,深午夜蓝 + 蓝紫青粉辉光。 */
const ORDER = ["light", "dark", "neon"] as const
type Theme = (typeof ORDER)[number]

const META: Record<Theme, { next: Theme; label: string; title: string; Icon: typeof Sun }> = {
  light: { next: "dark", label: "切换到夜间", title: "当前:日间", Icon: Sun },
  dark:  { next: "neon", label: "切换到霓虹", title: "当前:夜间", Icon: Moon },
  neon:  { next: "light", label: "切换到日间", title: "当前:霓虹", Icon: Sparkles },
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="切换主题" className="h-9 w-9">
        <Sun className="w-4 h-4" />
      </Button>
    )
  }

  const current: Theme = (ORDER as readonly string[]).includes(theme || "")
    ? (theme as Theme)
    : "dark"
  const { next, label, title, Icon } = META[current]

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={`${title} · 点击${label}`}
      className={
        "h-9 w-9 " +
        (current === "neon"
          ? "text-cyan-300 hover:text-cyan-200 hover:bg-white/5"
          : "")
      }
      onClick={() => setTheme(next)}
    >
      <Icon className="w-4 h-4" />
    </Button>
  )
}
