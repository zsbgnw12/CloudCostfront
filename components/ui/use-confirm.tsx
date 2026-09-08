"use client"

import { useCallback, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

export interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作：确定按钮用红色 */
  destructive?: boolean
}

/**
 * 命令式确认弹窗，替代原生 window.confirm。
 *
 *   const { confirm, ConfirmDialog } = useConfirm()
 *   ...
 *   if (!(await confirm({ description: "确定删除？", destructive: true }))) return
 *   ...
 *   return (<>{ConfirmDialog}...</>)   // 在页面 JSX 里渲染一次
 */
export function useConfirm() {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions>({})
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOptions = {}) => {
    setOpts(o)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (v: boolean) => {
    setOpen(false)
    resolver.current?.(v)
    resolver.current = null
  }

  const ConfirmDialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title ?? "确认操作"}</AlertDialogTitle>
          {opts.description ? (
            <AlertDialogDescription className="whitespace-pre-wrap break-words">
              {opts.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {opts.cancelText ?? "取消"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={cn(opts.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {opts.confirmText ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, ConfirmDialog }
}
