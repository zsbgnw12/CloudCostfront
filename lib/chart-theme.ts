"use client"

import { useTheme } from "next-themes"

/** Recharts SVG 不吃 Tailwind className,只能传 stroke / fill 字面色。
 *  这里按主题(light / dark / neon)返回一组与 design tokens 视觉等价的颜色,
 *  统一三个图表页(dashboard / daily-report / metering)的视觉,
 *  并让 neon 主题在轴/网格/Tooltip/调色板上呈现霓虹·赛博效果。 */
export interface ChartTheme {
  /** 三态:light / dark / neon */
  variant: "light" | "dark" | "neon"
  /** 坐标轴线 + 刻度文字弱对比色 */
  axis: string
  /** 强对比轴标(如分类标签) */
  axisStrong: string
  /** 网格虚线 */
  grid: string
  /** Tooltip 背板 */
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  tooltipText2: string
  /** Bar/Pie hover 时的高亮罩 */
  cursor: string
  /** 通用 10 色调色板 — 按主题挑了视觉适配版 */
  palette: readonly string[]
}

const PALETTE_LIGHT = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#f97316",
] as const

const PALETTE_DARK = [
  "#e8854a", "#5b8def", "#4ade80", "#eab308", "#d946ef",
  "#14b8a6", "#ef4444", "#818cf8", "#84cc16", "#38bdf8",
] as const

/** Neon palette — 高饱和高亮度,匹配登录页的青蓝紫粉霓虹调 */
const PALETTE_NEON = [
  "#22d3ee", "#a78bfa", "#f0abfc", "#38bdf8", "#c084fc",
  "#f472b6", "#34d399", "#fb923c", "#facc15", "#60a5fa",
] as const

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme()
  // resolvedTheme 是 next-themes 的 key('light'/'dark'/'neon'),不是 class。
  const variant: ChartTheme["variant"] =
    resolvedTheme === "neon" ? "neon" :
    resolvedTheme === "light" ? "light" : "dark"

  if (variant === "neon") {
    return {
      variant,
      axis: "rgba(186,230,253,0.55)",                  // 浅青刻度
      axisStrong: "rgba(224,231,255,0.9)",             // 强对比标签
      grid: "rgba(99,102,241,0.18)",                   // 紫蓝虚线网格
      tooltipBg: "rgba(15,18,38,0.92)",                // 深午夜蓝半透
      tooltipBorder: "rgba(168,85,247,0.45)",          // 紫描边
      tooltipText: "#e0e7ff",
      tooltipText2: "#a5b4fc",
      cursor: "rgba(168,85,247,0.10)",
      palette: PALETTE_NEON,
    }
  }
  if (variant === "light") {
    return {
      variant,
      axis: "rgba(0,0,0,0.55)",
      axisStrong: "rgba(0,0,0,0.78)",
      grid: "rgba(0,0,0,0.08)",
      tooltipBg: "rgba(255,255,255,0.96)",
      tooltipBorder: "rgba(0,0,0,0.12)",
      tooltipText: "#1a1a1a",
      tooltipText2: "#3f3f46",
      cursor: "rgba(0,0,0,0.05)",
      palette: PALETTE_LIGHT,
    }
  }
  return {
    variant,
    axis: "rgba(255,255,255,0.55)",
    axisStrong: "rgba(255,255,255,0.85)",
    grid: "rgba(255,255,255,0.08)",
    tooltipBg: "rgba(20,20,20,0.92)",
    tooltipBorder: "rgba(255,255,255,0.12)",
    tooltipText: "#fafafa",
    tooltipText2: "#e4e4e7",
    cursor: "rgba(255,255,255,0.05)",
    palette: PALETTE_DARK,
  }
}
