/** @type {import('next').NextConfig} */
/** 开发时把浏览器的同源 `/api/*` 转到本地 FastAPI，配合 lib/api.ts 开发环境默认 API_BASE="" */
const backendOrigin = (process.env.BACKEND_PROXY_URL || "http://127.0.0.1:8000").replace(/\/$/, "")

const nextConfig = {
  output: "export",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
