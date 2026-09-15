import type { ServiceAccount } from "@/lib/api"

/** 无法确定用户名时的显示标签。 */
export const UNKNOWN_TAIJI_USER = "未知用户"

/**
 * 取一个 taiji 服务账号所属的用户名，取不到时返回 null。
 *
 * 用户是 站点 → 用户 → 令牌 这个层级里的一级，现在由后端的
 * projects.taiji_username 提供（见 CloudCostbrank 迁移 028）。这个函数优先读那
 * 个字段，只在它为空时才回退到解析 external_project_id —— 回填之前写入的行、以
 * 及本次前端发布早于后端发布的那段时间里，都会走到回退分支。
 *
 * 在此之前，同一段解析在 accounts、metering、daily-report 三个页面各写了一份，
 * 而且三份并不一致：两处判 `i < 0`，一处判 `idx <= 0`，于是 ":令牌" 这样的 id
 * 在一个页面归到 ":令牌" 名下、在另一个页面归到 "" 名下。统一到这里之后只有一
 * 个口径。
 *
 * 回退的口径与后端回填严格一致：取第一个冒号之前的部分，且要求冒号前非空。没有
 * 冒号、或形如 ":令牌" 的 id 返回 null —— 那不是"用户名是空字符串"，而是"这个
 * id 根本不符合 用户:令牌 的约定，用户名未知"。
 */
export function taijiUsernameOf(
  account: Pick<ServiceAccount, "taiji_username" | "external_project_id">,
): string | null {
  if (account.taiji_username) return account.taiji_username

  const extId = account.external_project_id
  if (!extId) return null
  const idx = extId.indexOf(":")
  return idx > 0 ? extId.slice(0, idx) : null
}

/** 同上，但把"未知"渲染成可显示的标签，供分组标题一类的地方使用。 */
export function taijiUsernameLabel(
  account: Pick<ServiceAccount, "taiji_username" | "external_project_id">,
): string {
  return taijiUsernameOf(account) ?? UNKNOWN_TAIJI_USER
}
