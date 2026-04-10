"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Cloud,
  Building2,
  Package,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Activity,
  TrendingUp,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useState } from "react"

const navigation = [
  { name: "仪表盘", href: "/", icon: LayoutDashboard },
  { name: "供应商管理", href: "/suppliers", icon: Building2 },
  { name: "货源管理", href: "/accounts", icon: Package },
  { name: "模型管理", href: "/azure-deploy", icon: Sparkles },
  { name: "计费", href: "/costs", icon: BarChart3 },
  { name: "计量", href: "/metering", icon: Activity },
  { name: "统计", href: "/daily-report", icon: TrendingUp },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar/60 backdrop-blur-xl border-r border-white/5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-20 shadow-[4px_0_24px_rgba(0,0,0,0.2)]",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-white/5">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
            <Cloud className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold text-sidebar-foreground">
              CloudCost
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ease-out active:scale-[0.98]",
                isActive
                  ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md"
                  : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
              )}
              <item.icon className={cn(
                "w-5 h-5 shrink-0 transition-transform duration-300",
                !isActive && "group-hover:scale-110"
              )} />
              {!collapsed && <span className="truncate">{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Collapse button */}
      <div className="p-2 border-t border-white/5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full justify-center text-sidebar-foreground/70 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-300"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 mr-2" />
              <span>收起</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  )
}
