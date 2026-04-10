"use client"

import { Activity, Construction } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function MeteringPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">计量</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Token 消耗记录与用量统计
        </p>
      </div>

      <div className="flex items-center justify-center py-32">
        <Card className="bg-card border-border max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <Activity className="w-10 h-10 text-muted-foreground/40" />
              <Construction className="w-10 h-10 text-muted-foreground/40" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">功能开发中</h2>
              <p className="text-sm text-muted-foreground mt-2">
                计量模块将记录各渠道 Token 消耗情况，支持按供应商、模型、时间维度进行用量查询与分析。
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Badge variant="secondary">AWS Token 计量</Badge>
              <Badge variant="outline" className="text-muted-foreground">更多渠道待接入</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
