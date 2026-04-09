import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { PageTransition } from "@/components/page-transition"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden relative">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-8 z-10 scroll-smooth">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}
