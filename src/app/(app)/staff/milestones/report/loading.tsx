import { Skeleton } from "@/components/ui/skeleton"

export default function MilestoneReportLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-20 mb-2" />
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  )
}
