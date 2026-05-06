'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
  useTheme,
} from 'next-themes'

/** Neon 主题 = 深底霓虹,视觉上是 dark 的子集。
 *  next-themes 的 value 不支持多 class(DOMTokenList 不允许带空格的 token),
 *  所以我们让 next-themes 只挂 `neon`,这里再用 effect 在 <html> 上同步 `dark` —
 *  这样所有现存 .dark 规则继续生效,.neon 仅做"覆盖式微调"。 */
function NeonDarkSync() {
  const { resolvedTheme } = useTheme()
  // useLayoutEffect:在 paint 之前同步 .dark 类,避免初次以 neon 主题加载时
  // 出现一帧"只有 .neon 没有 .dark"的样式断层。
  // SSR 阶段 useLayoutEffect 会告警,这里 typeof window 守一下。
  const useIso = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect
  useIso(() => {
    const html = document.documentElement
    if (resolvedTheme === 'neon') {
      html.classList.add('dark')
    } else if (resolvedTheme === 'light') {
      html.classList.remove('dark')
    }
    // resolvedTheme === 'dark':next-themes 自己挂了 .dark
  }, [resolvedTheme])
  return null
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <NeonDarkSync />
      {children}
    </NextThemesProvider>
  )
}
