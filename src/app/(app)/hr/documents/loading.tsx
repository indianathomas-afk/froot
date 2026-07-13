import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div>
      <div className="mb-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 mt-2" />
      </div>
      <div className="space-y-8">
        {[0, 1].map((section) => (
          <div key={section}>
            <Skeleton className="h-4 w-28 mb-3" />
            <div className="border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-64" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
