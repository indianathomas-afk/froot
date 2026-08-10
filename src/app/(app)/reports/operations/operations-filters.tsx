"use client"

import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// CHK-5. The filter island for the operations report. URL-param driven, exactly
// like checklists/store-filter.tsx — the page is a server component that reads
// searchParams, so the whole control surface is a router.push and there is no
// client state to keep in sync with the query.
//
// DELIBERATELY UNLIKE reports/page.tsx's filters, which are `<Select>`s with a
// defaultValue and no handler: they render three date-range options and change
// nothing, and the store dropdown has one hard-coded "All Stores" entry. Those
// are decorative and this report does not copy them.

export interface OperationsFilterProps {
  stores: { id: string; name: string }[]
  selectedStoreId: string
  /** Hidden entirely when the user is locked to a single store. */
  showStorePicker: boolean
  from: string
  to: string
  view: string
}

const VIEWS = [
  { value: "store", label: "By store" },
  { value: "day", label: "By day" },
  { value: "template", label: "By template" },
]

export function OperationsFilters({ stores, selectedStoreId, showStorePicker, from, to, view }: OperationsFilterProps) {
  const router = useRouter()

  function push(next: Partial<{ store: string; from: string; to: string; view: string }>) {
    const params = new URLSearchParams()
    const store = next.store ?? selectedStoreId
    if (store && store !== "all") params.set("store", store)
    params.set("from", next.from ?? from)
    params.set("to", next.to ?? to)
    params.set("view", next.view ?? view)
    router.push(`/reports/operations?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6">
      {showStorePicker && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-muted-foreground)]">Store</span>
          <Select defaultValue={selectedStoreId} onValueChange={(v) => push({ store: v })}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All My Stores</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-muted-foreground)]">From</span>
        <input
          type="date"
          defaultValue={from}
          max={to}
          onChange={(e) => e.target.value && push({ from: e.target.value })}
          className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm text-[var(--color-foreground)]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-muted-foreground)]">To</span>
        <input
          type="date"
          defaultValue={to}
          min={from}
          onChange={(e) => e.target.value && push({ to: e.target.value })}
          className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm text-[var(--color-foreground)]"
        />
      </label>

      <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => push({ view: v.value })}
            className={`px-3 h-7 rounded-md text-sm transition-colors ${
              view === v.value
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}
