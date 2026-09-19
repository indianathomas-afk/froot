"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Flag, ListChecks, Paperclip, Link2, Plus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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

/** What the create/edit forms need of a store, and ALL they need. Unchanged by
 *  CAL-2a on purpose: /templates renders CreateEventForm with a store list of
 *  its own (template-form.tsx:1717) and has no timezone to hand, so widening
 *  this type would have pulled that page into a contained fix. */
export type StoreOption = { id: string; name: string }

/** The GRID's store option: a StoreOption plus THE STORE'S OWN calendar date,
 *  resolved server-side through localDateStr(now, Store.timezone) — see
 *  calendar/page.tsx. It travels per store rather than as one page-level date
 *  because two stores in different zones are not on the same day, and the grid
 *  marks today for whichever one is selected. */
export type CalendarStoreOption = StoreOption & { today: string }
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
  /** CAL-2. Null is a reminder; set is a template scheduled to run (ruling 1).
   *  Every branch in this file reads THIS, never the presence of a name. */
  templateId: string | null
  templateName: string | null
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
  /** CAL-2. Where "Open checklist" points, and the source of the Missed
   *  instant — there is no missedAt column, by design (R2). */
  checklistId: string | null
  checklistStatus: string | null
  missedAt: string | null
}

type FeedResponse = { stores: StoreOption[]; events: EventRow[]; occurrences: OccurrenceRow[] }

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "YYYY-MM-DD" for a UTC-keyed civil date. Every date in this component is a
 *  calendar date, never an instant — the same discipline src/lib/calendar.ts
 *  keeps, and the reason the columns are @db.Date. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The UTC-keyed first-of-month for a "YYYY-MM-DD". CAL-2a: the anchor used to
 *  be minted from `new Date()` and read with getUTCMonth(), which opens the
 *  WRONG MONTH for the last evening of every month in a western zone — the
 *  today-marker defect one step up. Taking a store-local date string instead
 *  means no instant is ever read as a day in this file. */
function monthStart(dateStr: string): Date {
  return new Date(Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, 1))
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

/** At most three chips per cell; the rest go behind "+N more" (CAL-2a). Three
 *  is what fits in a min-h-24 cell above a blank strip that is still comfortably
 *  clickable — the cap exists to PROTECT that strip, not to save space. */
const MAX_CHIPS = 3

/** One chip. Extracted by CAL-2a because the overflow list shows the same rows
 *  the cell does, and two copies of this markup would drift the first time a
 *  glyph is added to one of them. */
function Chip({
  event,
  occurrence,
  onOpen,
}: {
  event: EventRow
  occurrence: OccurrenceRow | null
  onOpen: () => void
}) {
  const completed = occurrence?.status === "Completed"
  // CAL-2: Missed strikes through like Completed — both are terminal and
  // neither is still owed. The difference is carried by the status line in the
  // detail dialog, not by the chip, which has room for one signal and should
  // spend it on "done or not".
  const terminal = completed || occurrence?.status === "Missed"
  // CAL-2a AUDIT — THIS `new Date()` IS CORRECT AND STAYS. It is an INSTANT
  // compared against an INSTANT (`dueAt` is the frozen ruling-8 moment, an ISO
  // UTC string), so no calendar date is derived from it and no timezone enters.
  // Ruling 8 says overdue begins at store close; re-expressing this as a
  // store-local DATE comparison would say a reminder due at 17:00 is not
  // overdue at 19:00, which is the ruling changed rather than the zone fixed.
  const overdue = !!occurrence && occurrence.status === "Open" && occurrence.dueAt <= new Date().toISOString()
  return (
    <button
      type="button"
      onClick={(e) => {
        // THE CHIP OWNS ITS CLICK. Without this the cell's create handler
        // fires too and the day's create form opens behind the detail dialog.
        e.stopPropagation()
        onOpen()
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
      {event.priority === "Critical" && <Flag className="h-3 w-3 shrink-0 text-[var(--color-destructive)]" />}
      {/* CAL-2. THE ONE GLYPH THAT SAYS "this is a checklist, not a reminder" —
          ruling 1's two entity types, told apart at a glance on the grid.
          Colour is still the CATEGORY's (ruling 7); this is a shape, like the
          Critical flag beside it. */}
      {event.templateId && <ListChecks className="h-3 w-3 shrink-0 opacity-70" aria-label="Scheduled checklist" />}
      <span className={`truncate ${terminal ? "line-through opacity-60" : ""}`}>
        {event.dueTime ? `${event.dueTime} ` : ""}
        {event.title}
      </span>
      {event.attachment && <Paperclip className="h-3 w-3 shrink-0 opacity-60" />}
      {event.url && <Link2 className="h-3 w-3 shrink-0 opacity-60" />}
    </button>
  )
}

export function CalendarClient({
  isAdmin,
  stores,
  orgToday,
  canManage,
  isMultiStore,
  staff,
}: {
  stores: CalendarStoreOption[]
  /** The org-local date (Organization.timezone -> DEFAULT_TIME_ZONE), used only
   *  when the actor has NO store in scope. The DEBT-70a chain, with no
   *  bare-UTC arm — see calendar/page.tsx. */
  orgToday: string
  canManage: boolean
  /** B11 (CAL-2): threaded to the create forms so a non-ADMIN's store label
   *  reads "All my stores" — the write is bounded server-side either way. */
  isAdmin: boolean
  isMultiStore: boolean
  staff: StaffOption[]
}) {
  const [storeId, setStoreId] = useState<string>(stores[0]?.id ?? "")
  // The grid opens on the month the SELECTED store is actually in. Initialised
  // from the first store because that is what `storeId` starts on; changing the
  // picker afterwards deliberately does NOT jump the month, which would move
  // the page under someone who only wanted to switch store.
  const [anchor, setAnchor] = useState(() => monthStart(stores[0]?.today ?? orgToday))
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
  // CAL-2a: the date whose overflow list is open. A cell shows at most three
  // chips; the rest live behind "+N more".
  const [moreOn, setMoreOn] = useState<string | null>(null)

  // CAL-2a — THE ONE PLACE THIS COMPONENT LEARNS WHAT DAY IT IS, and it is a
  // string that came from the server in the store's zone. `new Date()` is no
  // longer read for a calendar date anywhere in this file.
  const today = stores.find((s) => s.id === storeId)?.today ?? orgToday

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

  // ── THE DETAIL DIALOG READS THE LAST-HELD FEED, NOT THE KEYED ONE ────────
  // `data` is null for the whole duration of every re-read — that is what
  // raises the grid's skeletons — and CAL-1b's edit ENDS in a re-read. Binding
  // the dialog to `data` would therefore unmount it the instant Save
  // succeeded, taking the "Saved" note with it and flashing the panel shut and
  // open again. Holding the previous rows keeps the panel on screen showing
  // the values it had for the moment the fetch takes, then re-renders on the
  // new ones. The grid keeps using `data`, because there the null IS the
  // signal.
  const held = feed?.data ?? null

  // The event the dialog is open on, or undefined once an edit has moved it
  // out of the feed's scope. Derived, never asserted — see the render below.
  const detailEvent = detailOn ? held?.events.find((e) => e.id === detailOn.eventId) : undefined

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
            onClick={() => setAnchor(monthStart(today))}
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
          {/* ── CAL-2a — THE HEADER ROUTE INTO THE CREATE FORM ──────────────
              A day cell opens the form for THAT day, which is the fast path
              and stays. This is the one that does not depend on finding blank
              pixels: it works when every cell in the month is full, it is
              where anyone looks for "new", and it defaults to TODAY — the
              store's today, not the browser's.

              GATED ON canManage, THE SAME FLAG AS THE DAY-CLICK, and it is the
              affordance rather than the gate: POST /api/calendar/events calls
              requireCalendar("calendar.manage") on its own (PERM-2's lesson —
              the modal is not the gate). */}
          {canManage && (
            <button
              type="button"
              onClick={() => setCreateOn(today)}
              className="flex h-10 items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
          )}
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
                  // CAL-2a: cap the chips so the blank strip below them
                  // survives a busy day. The remainder is not hidden — it is
                  // one tap away and says how many.
                  const shown = items.slice(0, MAX_CHIPS)
                  const overflow = items.length - shown.length
                  return (
                    // CAL-1a: the cell is a plain div again. It used to be a
                    // PopoverAnchor inside a per-cell <Popover>, which meant 42
                    // popover roots per render and a create form anchored to
                    // whichever cell was clicked. The form is now ONE Dialog
                    // below the grid, so the cell anchors nothing.
                    <div
                      key={date}
                      onClick={() => {
                        // Ruling 5: only calendar.manage opens the create
                        // form. The route refuses regardless — this is
                        // the affordance, not the gate. UNCHANGED by CAL-1a.
                        //
                        // CAL-2a: THIS IS THE SECOND-ITEM PATH. It always
                        // opens the CREATE form for this date, whatever the
                        // cell already holds — nothing in the model stops two
                        // items sharing a day (uniqueness is per event / store
                        // / dueDate), so the cell must not stop it either.
                        if (canManage) setCreateOn(date)
                      }}
                      // flex-col so the spacer below can claim the leftover
                      // height and be a real click target.
                      className={`flex min-h-24 flex-col bg-[var(--color-card)] p-1.5 ${
                        canManage ? "cursor-pointer hover:bg-[var(--color-muted)]" : ""
                      } ${inMonth ? "" : "opacity-45"}`}
                    >
                      <div
                        className={`mb-1 inline-flex h-6 min-w-6 shrink-0 items-center justify-center self-start rounded-full px-1 text-xs ${
                          isToday
                            ? "bg-[var(--color-primary)] font-semibold text-white"
                            : "text-[var(--color-muted-foreground)]"
                        }`}
                      >
                        {Number(date.slice(8, 10))}
                      </div>
                      <ul className="space-y-1">
                        {shown.map(({ event, occurrence }) => (
                          <li key={`${event.id}-${date}`}>
                            <Chip
                              event={event}
                              occurrence={occurrence}
                              onOpen={() => setDetailOn({ eventId: event.id, date })}
                            />
                          </li>
                        ))}
                      </ul>

                      {overflow > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMoreOn(date)
                          }}
                          className="mt-0.5 shrink-0 rounded px-1 text-left text-[11px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                        >
                          +{overflow} more
                        </button>
                      )}

                      {/* ── CAL-2a — THE BLANK STRIP, AND IT IS DELIBERATE ──
                          The day-click is the create affordance, so a cell
                          whose chips reach the bottom edge has no create
                          affordance left. This spacer takes the leftover
                          height and, when there is none, still holds ~20px —
                          so there is ALWAYS somewhere in every cell to click
                          that means "new item on this day". aria-hidden and
                          empty: it is the cell's own click area, not a
                          control of its own. */}
                      <div aria-hidden className="min-h-5 flex-1" />
                    </div>
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

      {/* ── CAL-1a: the create form, ONE Dialog for the whole grid ────────
          It was a <Popover> anchored to the clicked cell, and on the top rows
          the form opened upward with its head above the viewport and no way to
          scroll to it — a popover positions against its anchor, not against
          the viewport, so there was nothing to scroll. Centred instead, bounded
          to 85vh, with Escape and a backdrop click to close (both Radix
          defaults on Dialog, neither of which the popover gave).

          The 85vh cap lives on DialogContent and the SCROLL LIVES ON THE BODY
          INSIDE CreateReminderForm, not here — UX-1's finding on the Edit User
          modal (users/user-actions.tsx): scrolling DialogContent itself puts
          Save below the fold of a form that only gets longer. */}
      <Dialog open={createOn !== null} onOpenChange={(open) => !open && setCreateOn(null)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            {/* CAL-2: the dialog now offers both entity types, so the title
                names the act rather than one of them. */}
            <DialogTitle>Add to calendar</DialogTitle>
          </DialogHeader>
          {/* Mounted only while a date is held, so the form's state resets
              between openings rather than carrying the last day's typing. */}
          {createOn !== null && (
            <CreateReminderForm
              date={createOn}
              stores={stores}
              isAdmin={isAdmin}
              onDone={() => {
                setCreateOn(null)
                reload()
              }}
              onCancel={() => setCreateOn(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── CAL-2a — THE OVERFLOW LIST ───────────────────────────────────
          A Dialog and not a Popover, for CAL-1a's reason exactly: the cells
          on the top and bottom rows anchored a popover off the viewport with
          nothing to scroll to. Centred, so a Saturday cell in the last week
          behaves like a Monday cell in the first.

          THE ROWS ARE THE SAME <Chip> THE CELL RENDERS, so a chip's glyphs,
          strike-through and overdue rule cannot differ between the two places
          a day's items appear. Opening one hands off to the detail dialog and
          closes this — the list is a way THROUGH to an item, not a place to
          stay. */}
      <Dialog open={moreOn !== null} onOpenChange={(open) => !open && setMoreOn(null)}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {moreOn
                ? new Date(`${moreOn}T00:00:00.000Z`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    // UTC, because `moreOn` is a CIVIL DATE keyed at UTC
                    // midnight, not an instant. Converting it to a zone here
                    // would move it a day backward — DEBT-70's trap, and the
                    // same argument monthLabel above carries.
                    timeZone: "UTC",
                  })
                : ""}
            </DialogTitle>
          </DialogHeader>
          <ul className="space-y-1">
            {(moreOn ? byDate.get(moreOn) ?? [] : []).map(({ event, occurrence }) => (
              <li key={`${event.id}-more`}>
                <Chip
                  event={event}
                  occurrence={occurrence}
                  onOpen={() => {
                    setDetailOn({ eventId: event.id, date: moreOn! })
                    setMoreOn(null)
                  }}
                />
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {/* ── CAL-1b: the detail dialog, which is now also the EDIT dialog ──
          THE EVENT IS LOOKED UP, NOT ASSERTED. This used to end in `!` on a
          find that could not miss, because the only write the dialog offered
          was Archive and Archive closed it. Edit can move a reminder OUT of
          the selected store's scope — appliesTo: "all" → one other store — and
          the feed's WHERE drops it on the next read, so the assertion would
          have been `undefined.title` on the re-render after a save.
          Rendering nothing is the right answer rather than a fallback: the
          reminder genuinely is not in this store's calendar any more. If the
          picker is later moved to the store it WAS given, it reappears with
          its detail open, which is where the user left it. */}
      {detailEvent && held && detailOn && (
        <OccurrenceDetail
          event={detailEvent}
          date={detailOn.date}
          occurrence={
            held.occurrences.find(
              (o) => o.eventId === detailOn.eventId && o.dueDate === detailOn.date && (!storeId || o.storeId === storeId)
            ) ?? null
          }
          stores={stores}
          staff={staff}
          canManage={canManage}
          isAdmin={isAdmin}
          categoryLabel={categoryLabel(detailEvent.category)}
          onClose={() => setDetailOn(null)}
          onChanged={() => {
            setDetailOn(null)
            reload()
          }}
          // An edit re-reads the month and LEAVES THE DIALOG OPEN, so the
          // detail view re-renders from the refreshed event and shows the new
          // values on the thing you just edited.
          onSaved={reload}
        />
      )}
    </div>
  )
}
