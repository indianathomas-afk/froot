"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { format, formatDistanceToNow, differenceInCalendarDays } from "date-fns"
import { ClipboardList, Play, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type CountRow = {
  id: string
  storeId: string
  storeName: string
  name: string | null
  status: string
  isPartial: boolean
  startedAt: string
  finalizedAt: string | null
  sittingInventoryVal: number | null
  draftValue: number
  linesCounted: number
  linesTotal: number
  correctionsCount: number
  countedByNames: string[]
}

// Generic event shape for the history timeline — Phase I-6 interleaves loss /
// transfer / prep-event rows into this same list so the history reads as
// everything that changed inventory between counts.
export type HistoryEvent = {
  type: "count"
  date: string | null
  label: string
  value: number | null
  href: string
  status: string
  isPartial: boolean
  correctionsCount: number
  countedByNames: string[]
  progress?: string
}

export function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function countLabel(c: CountRow) {
  if (c.name) return c.name
  const d = c.finalizedAt ?? c.startedAt
  return `${format(new Date(d), "MMM d, yyyy")} count`
}

export function CountsClient({ stores, canManage }: { stores: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [result, setResult] = useState<{ storeId: string; counts: CountRow[] } | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(() => {
    if (!storeId) return
    fetch(`/api/inventory/counts?storeId=${storeId}`)
      .then((res): Promise<{ counts: CountRow[] }> => (res.ok ? res.json() : Promise.resolve({ counts: [] })))
      .then((json) => setResult({ storeId, counts: json.counts ?? [] }))
      .catch(() => setResult({ storeId, counts: [] }))
  }, [storeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const counts = result?.storeId === storeId ? result.counts : null
  const loading = counts === null

  async function startCount() {
    setCreating(true)
    setError("")
    const res = await fetch("/api/inventory/counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId }),
    })
    const body = await res.json().catch(() => null)
    setCreating(false)
    if (res.status === 409 && body?.draftId) {
      router.push(`/inventory/counts/${body.draftId}`)
      return
    }
    if (!res.ok) {
      setError(body?.error ?? "Could not start a count")
      return
    }
    router.push(`/inventory/counts/${body.id}`)
  }

  if (stores.length === 0) {
    return (
      <div className="p-16 text-center text-[var(--color-muted-foreground)]">
        <p className="text-sm">No stores available. Add a store first, then run its first count.</p>
      </div>
    )
  }

  const draft = counts?.find((c) => c.status === "Draft") ?? null
  const finalized = (counts ?? []).filter((c) => c.status === "Finalized" && c.finalizedAt)
  // Sitting inventory = the most recent finalized, NON-partial count. A newer
  // partial count shows in history but never moves this figure.
  const sitting = finalized.filter((c) => !c.isPartial)[0] ?? null
  const lastFinalized = finalized[0] ?? null
  const daysSince = lastFinalized?.finalizedAt
    ? differenceInCalendarDays(new Date(), new Date(lastFinalized.finalizedAt))
    : null

  const events: HistoryEvent[] = (counts ?? []).map((c) => ({
    type: "count",
    date: c.finalizedAt ?? c.startedAt,
    label: c.status === "Draft" ? "Draft count in progress" : countLabel(c),
    value: c.status === "Draft" ? c.draftValue : c.sittingInventoryVal,
    href: `/inventory/counts/${c.id}`,
    status: c.status,
    isPartial: c.isPartial,
    correctionsCount: c.correctionsCount,
    countedByNames: c.countedByNames,
    progress: c.status === "Draft" ? `${c.linesCounted} of ${c.linesTotal} counted` : undefined,
  }))

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Inventory Counts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Walk the store area by area, count ingredients, and lock in sitting inventory value.
          </p>
        </div>
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="w-52 min-h-11">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-[var(--color-destructive)] mb-4">{error}</p>}

      {loading ? (
        <div className="space-y-4">
          <div className="h-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
          <div className="h-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
        </div>
      ) : (
        <>
          {/* Overview header */}
          <Card className="mb-6">
            <CardContent className="p-6">
              {sitting ? (
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <p className="text-sm text-[var(--color-muted-foreground)] mb-1">Sitting inventory</p>
                    <p className="text-4xl font-bold text-[var(--color-foreground)]">
                      {fmtMoney(sitting.sittingInventoryVal ?? 0)}
                    </p>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-2">
                      {countLabel(sitting)} · finalized{" "}
                      {sitting.finalizedAt ? format(new Date(sitting.finalizedAt), "MMM d, yyyy h:mm a") : ""}
                      {sitting.countedByNames.length > 0 && <> · counted by {sitting.countedByNames.join(", ")}</>}
                    </p>
                    {daysSince !== null && (
                      <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                        {daysSince === 0 ? "Counted today" : `${daysSince} day${daysSince === 1 ? "" : "s"} since last count`}
                      </p>
                    )}
                  </div>
                  <PrimaryAction draft={draft} creating={creating} onStart={startCount} router={router} />
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                    <ClipboardList className="h-6 w-6 text-[var(--color-primary)]" />
                  </div>
                  <h2 className="font-semibold text-[var(--color-foreground)] mb-1">No finalized counts yet</h2>
                  <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto mb-4">
                    Your first finalized count establishes opening stock — usage and COGS reporting begin after it.
                    Set up storage areas, then walk the store.
                  </p>
                  <div className="flex justify-center">
                    <PrimaryAction draft={draft} creating={creating} onStart={startCount} router={router} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* History timeline */}
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">History</h2>
            </div>
            {events.length === 0 ? (
              <p className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                Nothing yet — counts you run will show up here.
              </p>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {events.map((e) => (
                  <button
                    key={e.href}
                    onClick={() => router.push(e.href)}
                    className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-[var(--color-accent)] transition-colors"
                  >
                    <div className="flex-1 min-w-40">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{e.label}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {e.date ? format(new Date(e.date), "MMM d, yyyy h:mm a") : "—"}
                        {e.countedByNames.length > 0 && <> · {e.countedByNames.join(", ")}</>}
                        {e.progress && <> · {e.progress}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {e.status === "Draft" ? (
                        <Badge variant="info">Draft</Badge>
                      ) : (
                        <Badge variant="success">Finalized</Badge>
                      )}
                      {e.isPartial && <Badge variant="warning">Partial</Badge>}
                      {e.correctionsCount > 0 && (
                        <Badge variant="secondary">
                          {e.correctionsCount} correction{e.correctionsCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <p className="w-24 text-right text-sm font-semibold text-[var(--color-foreground)]">
                      {e.value !== null ? fmtMoney(e.value) : "—"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!canManage && (
            <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
              Anyone can count; finalizing a count needs a manager or admin.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function PrimaryAction({
  draft,
  creating,
  onStart,
  router,
}: {
  draft: CountRow | null
  creating: boolean
  onStart: () => void
  router: ReturnType<typeof useRouter>
}) {
  if (draft) {
    return (
      <div className="text-right">
        <Button size="lg" className="min-h-11" onClick={() => router.push(`/inventory/counts/${draft.id}`)}>
          <Play className="h-4 w-4" />
          Continue draft
        </Button>
        <p className="text-xs text-[var(--color-muted-foreground)] mt-2">
          Started {formatDistanceToNow(new Date(draft.startedAt), { addSuffix: true })}
          {draft.countedByNames.length > 0 && <> · {draft.countedByNames.join(", ")} counting</>}
        </p>
      </div>
    )
  }
  return (
    <Button size="lg" className="min-h-11" onClick={onStart} disabled={creating}>
      <Plus className="h-4 w-4" />
      {creating ? "Starting…" : "Start new count"}
    </Button>
  )
}
