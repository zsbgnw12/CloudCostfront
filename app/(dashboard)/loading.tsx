import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 animate-pulse animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-1/4 rounded-lg" />
        <Skeleton className="h-8 w-[150px] rounded-lg" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-[300px] w-full rounded-xl" />
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    </div>
  )
}
