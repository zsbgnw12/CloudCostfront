"use client"

import { Loader2 } from "lucide-react"

export default function AzureCallbackPage() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
      <p className="text-muted-foreground">正在完成登录...</p>
    </div>
  )
}
