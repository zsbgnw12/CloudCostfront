"use client"

import * as React from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export interface MultiSelectOption {
  /** 字符串化的值，内部用于去重 / 选中状态；外部回调会拿到原始 value 列表 */
  value: string
  label: string
  /** 可选搜索关键字；没传则用 label */
  keywords?: string
  /** 可选的右侧灰字说明（如云厂商前缀、external id） */
  description?: string
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** 未选中任何项时触发按钮显示的占位文字 */
  placeholder?: string
  /** 搜索框 placeholder */
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  triggerClassName?: string
  disabled?: boolean
}

/**
 * 通用多选下拉。
 *
 * - 空数组 = 未勾选任何项（调用方通常把空当作"全部"处理）
 * - 触发按钮显示"已选 N 个"或单条 label
 * - 选项列表顶部有"全选 / 清空"行
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "全部",
  searchPlaceholder = "搜索...",
  emptyText = "无匹配项",
  className,
  triggerClassName,
  disabled,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const selected = React.useMemo(() => new Set(value), [value])

  const toggle = (v: string) => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(Array.from(next))
  }

  const clearAll = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    onChange([])
  }

  const selectAll = () => {
    onChange(options.map((o) => o.value))
  }

  const allSelected = value.length > 0 && value.length === options.length

  const triggerLabel = React.useMemo(() => {
    if (value.length === 0) return placeholder
    if (value.length === 1) {
      const one = options.find((o) => o.value === value[0])
      return one?.label ?? placeholder
    }
    return `已选 ${value.length} 个`
  }, [value, options, placeholder])

  return (
    <div className={cn("inline-flex", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-8 justify-between gap-2 text-sm font-normal",
              value.length === 0 && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate">{triggerLabel}</span>
            <div className="flex items-center gap-1 shrink-0">
              {value.length > 0 && !disabled && (
                <X
                  className="size-3.5 opacity-60 hover:opacity-100"
                  onClick={clearAll}
                />
              )}
              <ChevronsUpDown className="size-3.5 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} className="h-9" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {options.length > 0 && (
                <>
                  <CommandGroup>
                    <CommandItem
                      value="__select_all__"
                      onSelect={() => (allSelected ? clearAll() : selectAll())}
                      className="text-xs"
                    >
                      <Check
                        className={cn(
                          "size-4",
                          allSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span>{allSelected ? "清空" : "全选"}</span>
                      <span className="ml-auto text-muted-foreground">
                        {value.length}/{options.length}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              <CommandGroup>
                {options.map((opt) => {
                  const checked = selected.has(opt.value)
                  return (
                    <CommandItem
                      key={opt.value}
                      value={opt.keywords ?? opt.label}
                      onSelect={() => toggle(opt.value)}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{opt.label}</span>
                      {opt.description && (
                        <span className="ml-auto text-xs text-muted-foreground shrink-0">
                          {opt.description}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
