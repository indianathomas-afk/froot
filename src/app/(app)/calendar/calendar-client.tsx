"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Flag, Paperclip, Link2 } from "lucide-react"
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { CALENDAR_CATEGORIES, categoryLabel } from "@/lib/calendar"
import { CreateReminderForm } from "./create-reminder-form"
import { OccurrenceDetail } from "./occurrence-detail"

// CAL-1 — the month grid.
//
// POPOVERS, NOT ROUTE CHANGES. Creating and inspecting a reminder never leaves
// /calendar: the grid is the context, and bouncing to a detail route and back
// loses the month you were looking at.
//
// PROJECTED DATES AND REAL OCCURRENCES ARE DIFFERENT THINGS and the grid keeps
// them apart (ruling 3). A projected date is the rule saying "this will come
// due"; only a materialised occurrence can be completed, because only it has a
// frozen dueAt and a row to write to. So a projected cell with no occurrence
// renders as a chip you can read and not one you can tick.

export type StoreOption = { id: string; name: string }
export type StaffOption = { id: string; name: string }

type EventRow = {
  id: string
  title: string
  notes: string | null
  url: string | null
  category: string
  priority: string
  recurrence: string
  startDate: string
  dueTime: string | null
  endDate: string | null
  appliesTo: string
  storeIds: string[]
  attachment: { id: string; label: string; url: string } | null
  projectedDates: string[]
}

type OccurrenceRow = {
  id: string
  eventId: string
  storeId: string
  dueDate: string
  dueAt: string
  status: string
  completedAt: string | null
  notes: string | null
  photoUrl: string | null
}

type FeedResponse = { stores: StoreOption[]; events: EventRow[]; occurrences: OccurrenceRow[] }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "YYYY-MM-DD" for a UTC-keyed civil date. Every date in this component is a
 *  calendar date, never an instant — the same discipline src/lib/calendar.ts
 *  keeps, and the reason the columns are @db.Date. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The 42 cells of a Sun–Sat, 6-row month grid containing `anchor`. Always 42,
 *  so the grid does not change height between months — a layout that reflows as
 *  you page through it reads as a bug. */
function monthCells(anchor: Date): string[] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
  const start = new Date(first)
  start.setUTCDate(1 - first.getUTCDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    return iso(d)
  })
}

export function CalendarClient({
  stores,
  canManage,
  isMultiStore,
  staff,
}: {
  stores: StoreOption[]
  canManage: boolean
  isMultiStore: boolean
  staff: StaffOption[]
}) {
  const today = iso(new Date())
  const [anchor, setAnchor] = useState(() => {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  })
  const [storeId, setStoreId] = useState<string>(stores[0]?.id ?? "")
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // ── FEED STATE IS KEYED, AND THAT IS WHY THERE IS NO `loading` BOOLEAN ────
  // A `setLoading(true)` at the top of the fetch would be a synchronous
  // setState inside the effect body, which cascades renders
  // (react-hooks/set-state-in-effect). Storing the key the data was fetched FOR
  // makes "loading" a DERIVED fact — the held key does not match the one the
  // view wants — so there is one state write per fetch, in the continuation,
  // and the skeletons appear the instant the month changes rather than one
  // render later.
  const [feed, setFeed] = useState<{ key: string; data: FeedResponse } | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [createOn, setCreateOn] = useState<string | null>(null)
  const [detailOn, setDetailOn] = useState<{ eventId: string; date: string } | null>(null)

  const cells = useMemo(() => monthCells(anchor), [anchor])
  const from = cells[0]!
  const to = cells[41]!

  // Everything a fetch depends on, including the manual-refresh nonce so a
  // save re-reads without a second code path.
  const feedKey = `${from}|${to}|${storeId}|${refreshNonce}`
  const loading = feed?.key !== feedKey
  const data = feed?.key === feedKey ? feed.data : null

  /** Re-read after a write. Called from event handlers, never from an effect. */
  const reload = useCallback(() => setRefreshNonce((n) => n + 1), [])

  useEffect(() => {
    let live = true
    const params = new URLSearchParams({ from, to })
    if (storeId) params.set("storeId", storeId)

    fetch(`/api/calendar/events?${params}`, { signal: AbortSignal.timeout(12_000) })
      .then(async (res) => {
        if (!res.ok) {
          console.error(`[calendar] feed failed: HTTP ${res.status}`)
          return { stores, events: [], occurrences: [] } as FeedResponse
        }
        return (await res.json()) as FeedResponse
      })
      .catch((err) => {
        console.error("[calendar] feed fetch error:", err)
        return { stores, events: [], occurrences: [] } as FeedResponse
      })
      .then((fetched) => {
        // The ONE state write per fetch, and it carries the key it answers —
        // so a slow response for last month cannot overwrite this month's.
        if (live) setFeed({ key: feedKey, data: fetched })
      })

    return () => {
      live = false
    }
  }, [from, to, storeId, feedKey, stores])

  // Chips per day: every event whose projection lands on that date, paired with
  // its real occurrence for that (event, store, date) if one has been
  // materialised.
  const byDate = useMemo(() => {
    const map = new Map<string, { event: EventRow; occurrence: OccurrenceRow | null }[]>()
    if (!data) return map
    for (const event of data.events) {
      if (hidden.has(event.category)) continue
      for (const date of event.projectedDates) {
        const occurrence =
          data.occurrences.find((o) => o.eventId === event.id && o.dueDate === date && (!storeId || o.storeId === storeId)) ??
          null
        const list = map.get(date) ?? []
        list.push({ event, occurrence })
        map.set(date, list)
      }
    }
    return map
  }, [data, hidden, storeId])

  const monthLabel = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  function shiftMonth(by: number) {
    setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + by, 1)))
  }

  function toggleCategory(id: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Calendar</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Scheduled reminders for tasks that aren&apos;t daily checklists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date()
              setAnchor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
            }}
            className="h-10 rounded-md border border-[var(--color-border)] px-4 text-sm font-medium hover:bg-[var(--color-muted)]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-border)] hover:bg-[var(--color-muted)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* ── Left rail ─────────────────────────────────────────────────── */}
        <aside className="w-56 shrink-0 space-y-6">
          {isMultiStore && (
            <div>
              <label htmlFor="cal-store" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Store
              </label>
              <select
                id="cal-store"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Categories
            </p>
            {/* SHOW/HIDE IS LOCAL AND UNPERSISTED — a view preference for this
                visit, not a setting. Persisting it would mean a reminder can be
                invisible on a shared iPad because of a choice somebody made
                last week. */}
            <ul className="space-y-1.5">
              {CALENDAR_CATEGORIES.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.id)}
                      onChange={() => toggleCategory(c.id)}
                      className="h-4 w-4 rounded border-[var(--color-border)]"
                    />
                    <span aria-hidden className="h-3 w-3 rounded-sm" style={{ backgroundColor: `var(${c.token})` }} />
                    <span className="truncate">{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-[var(--color-border)] p-3">
            <p className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
              <Flag className="h-3.5 w-3.5 text-[var(--color-destructive)]" />
              Critical priority
            </p>
            <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
              Colour shows the category. Priority is a flag, never a colour.
            </p>
          </div>
        </aside>

        {/* ── The grid ──────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-sm font-semibold text-[var(--color-foreground)]">{monthLabel}</div>

          <div className="grid grid-cols-7 gap-px rounded-lg border border-[var(--color-border)] bg-[var(--color-border)] overflow-hidden">
            {DAY_NAMES.map((d) => (
              <div key={d} className="bg-[var(--color-muted)] px-2 py-1.5 text-center text-xs font-semibold text-[var(--color-muted-foreground)]">
                {d}
              </div>
            ))}

            {loading
              ? // SKELETONS, NEVER SPINNERS (§ Design System).
                Array.from({ length: 42 }, (_, i) => (
                  <div key={i} className="min-h-24 bg-[var(--color-card)] p-1.5">
                    <Skeleton className="h-4 w-6" />
                  </div>
                ))
              : cells.map((date) => {
                  const inMonth = Number(date.slice(5, 7)) === anchor.getUTCMonth() + 1
                  const items = byDate.get(date) ?? []
                  const isToday = date === today
                  return (
                    <Popover
                      key={date}
                      open={createOn === date}
                      onOpenChange={(open) => setCreateOn(open ? date : null)}
                    >
                      <PopoverAnchor asChild>
                        <div
                          onClick={() => {
                            // Ruling 5: only calendar.manage opens the create
                            // popover. The route refuses regardless — this is
                            // the affordance, not the gate.
                            if (canManage) setCreateOn(date)
                          }}
                          className={`min-h-24 bg-[var(--color-card)] p-1.5 ${canManage ? "cursor-pointer hover:bg-[var(--color-muted)]" : ""} ${
                            inMonth ? "" : "opacity-45"
                          }`}
                        >
                          <div
                            className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs ${
                              isToday
                                ? "bg-[var(--color-primary)] font-semibold text-white"
                                : "text-[var(--color-muted-foreground)]"
                            }`}
                          >
                            {Number(date.slice(8, 10))}
                          </div>
                          <ul className="space-y-1">
                            {items.map(({ event, occurrence }) => {
                              const completed = occurrence?.status === "Completed"
                              const overdue =
                                !!occurrence && occurrence.status === "Open" && occurrence.dueAt <= new Date().toISOString()
                              return (
                                <li key={`${event.id}-${date}`}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setDetailOn({ eventId: event.id, date })
                                    }}
                                    className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-[var(--color-muted)] ${
                                      overdue ? "border-l-2 border-[var(--color-destructive)]" : ""
                                    }`}
                                  >
                                    <span
                                      aria-hidden
                                      className="h-3 w-1 shrink-0 rounded-full"
                                      style={{ backgroundColor: `var(--color-cal-${event.category})` }}
                                    />
                                    {event.priority === "Critical" && (
                                      <Flag className="h-3 w-3 shrink-0 text-[var(--color-destructive)]" />
                                    )}
                                    <span className={`truncate ${completed ? "line-through opacity-60" : ""}`}>
                                      {event.dueTime ? `${event.dueTime} ` : ""}
                                      {event.title}
                                    </span>
                                    {event.attachment && <Paperclip className="h-3 w-3 shrink-0 opacity-60" />}
                                    {event.url && <Link2 className="h-3 w-3 shrink-0 opacity-60" />}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      </PopoverAnchor>

                      {createOn === date && (
                        <PopoverContent className="w-96">
                          <CreateReminderForm
                            date={date}
                            stores={stores}
                            onDone={() => {
                              setCreateOn(null)
                              reload()
                            }}
                            onCancel={() => setCreateOn(null)}
                          />
                        </PopoverContent>
                      )}
                    </Popover>
                  )
                })}
          </div>

          {!loading && data && data.events.length === 0 && (
            // EMPTY STATES INCLUDE A CTA (§ Design System).
            <div className="mt-6 rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center">
              <p className="text-sm font-medium text-[var(--color-foreground)]">No reminders yet</p>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {canManage
                  ? "Click any day to schedule recurring work — mailbox, filters, deposits."
                  : "Nothing is scheduled for this store yet."}
              </p>
            </div>
          )}
        </div>
      </div>

      {detailOn && data && (
        <OccurrenceDetail
          event={data.events.find((e) => e.id === detailOn.eventId)!}
          date={detailOn.date}
          occurrence={
            data.occurrences.find(
              (o) => o.eventId === detailOn.eventId && o.dueDate === detailOn.date && (!storeId || o.storeId === storeId)
            ) ?? null
          }
          stores={stores}
          staff={staff}
          canManage={canManage}
          categoryLabel={categoryLabel(data.events.find((e) => e.id === detailOn.eventId)?.category ?? "other")}
          onClose={() => setDetailOn(null)}
          onChanged={() => {
            setDetailOn(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
