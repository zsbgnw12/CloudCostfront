import type { ReactNode } from "react"

export async function generateStaticParams() {
  const raw = process.env.NEXT_PUBLIC_API_BASE ?? ""
  const base = raw.replace(/\/$/, "")
  if (!base) return [{ id: "0" }]
  try {
    const res = await fetch(`${base}/api/projects/`, { cache: "no-store" })
    if (!res.ok) throw new Error(String(res.status))
    const projects: { id: number }[] = await res.json()
    const ids = projects.map((p) => ({ id: String(p.id) }))
    return ids.length > 0 ? ids : [{ id: "0" }]
  } catch {
    return [{ id: "0" }]
  }
}

export default function ProjectDetailLayout({ children }: { children: ReactNode }) {
  return children
}
