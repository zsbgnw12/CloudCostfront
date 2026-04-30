"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

/** 顶部栏日/夜切换按钮 — 点击在 dark / light 之间切。 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // 避免 SSR 与 client hydration 不一致(next-themes 推荐做法)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="切换主题" className="h-9 w-9">
        <Sun className="w-4 h-4" />
      </Button>
    )
  }

  const isDark = theme === "dark"
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "切换到日间主题" : "切换到夜间主题"}
      title={isDark ? "切换到日间" : "切换到夜间"}
      className="h-9 w-9"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  )
}
