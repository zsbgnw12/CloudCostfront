import { redirect } from "next/navigation"

/** 计费已合并至统计（日报表），旧链接跳转。 */
export default function CostsPage() {
  redirect("/daily-report")
}
