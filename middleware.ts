import { NextRequest, NextResponse } from "next/server"

/**
 * 未登录访问任何业务页 → 自动跳到 /login(炫酷登录页)。
 *
 * 检测依据:cookie cc_access_token(由后端 OAuth 回调写入,HttpOnly)。
 * 注意:静态导出模式(output: 'export')不会执行 middleware,这里仅在
 * server runtime 环境生效。Static Web Apps 走的是静态化 + Functions,
 * middleware 在 Static Web App 上不会跑;但本地 dev / Vercel 都有效。
 *
 * 即便 middleware 没生效也不要紧:lib/api.ts 的 redirectToLogin() 会在
 * 第一次 API 调用拿到 401 时把用户跳到 /login,效果一致。
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 白名单 — 这些路径不需要登录
  const PUBLIC = [
    "/login",
    "/redirect",          // OAuth 回调中转
    "/consent-success",   // Azure consent 公开回调页
    "/consent-fail",
    "/_next",
    "/favicon",
  ]
  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get("cc_access_token")?.value
  if (!token) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  // 排除静态资源,避免每次拉图片都跑 middleware
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
