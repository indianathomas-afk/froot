"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, Check, Clock } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarDueBanner } from "@/components/calendar-due-banner"
import { cn } from "@/lib/utils"
import { resolveSingleStore, useSavedStoreId } from "@/lib/dashboard-store"
import { checklistTitle, checklistTypeStyle, templateNameLine, type ChecklistTypeStyle } from "@/lib/checklist-types"
import { startTodayChecklist } from "@/lib/checklist-start"
import { formatWindowTime } from "@/lib/checklist-status-display"
import {
  dueChipLabel,
  opensChipLabel,
  orderTodayChecklists,
  splitForChecklistsPage,
  type TodayEntry,
} from "@/lib/tablet-today"
import {
  applyItemsOutcome,
  initialItemsHealth,
  itemsNotice,
  nextItemsHealth,
  readTabletTasks,
  type ItemsHealth,
  type TabletServerData,
} from "@/lib/tablet-tasks-refresh"
import type { PinStaff } from "@/lib/tablet-pin-options"
import {
  TabletRefreshProvider,
  useTabletRefreshController,
  type RefreshCycle,
} from "../dashboard/tablet-refresh"
import type { TabletChecklist, TabletStore } from "../dashboard/tablet-data"

// TAB-14 — THE TABLET CHECKLISTS PAGE: type-first, this store only.
// Design: "Froot Tablet — Checklists" PDF, boards "Checklists · Tablet
// landscape", "Checklists · Tablet portrait" and "Checklist type key". Where the
// mock and TAB-13's ratified rulings disagree, TAB-13 wins. Rulings R1–R9 and
// RN-1–RN-6 in docs/DECISIONS.md (2026-11-11, TAB-14).
//
// EVERYTHING HERE IS REUSED, NOTHING IS RE-DERIVED:
//   which store      the tablet's own (useSavedStoreId + resolveSingleStore over
//                    tablet Home's store list, page.tsx) — R2
//   which checklists GET /api/stores/[id]/templates, tablet Home's list — R3
//   order            orderTodayChecklists (TAB-13 RN-3), then
//                    splitForChecklistsPage: tiles, then "Done today" — R4
//   names            checklistTitle (TAB-13 RN-6) and templateNameLine (RN-3)
//   colours, icons   checklistTypeStyle (src/lib/checklist-types.ts)
//   counts           the tick list's own once a row exists (loadTabletData /
//                    the tablet-tasks re-read), the route's taskCount before —
//                    TAB-13's rule (DEBT-132)
//   Start            startTodayChecklist — tablet Home's POST (RN-2), then this
//                    page opens the row, where "View Checklist" always went
//   refresh          tablet Home's controller (TAB-5) and re-read (TAB-8) —
//                    RN-6 as amended: tablets are left on this page, so the
//                    order and "Opens <time>" must stay current
//   overdue banner   CalendarDueBanner scoped to this store (R8)
//
// NO WRITE OF ITS OWN. Start is POST /api/checklists, exactly as tablet Home
// and Start Daily Checklist send it; Continue and View are links.

/** One row of GET /api/stores/[id]/templates. */
type Row = TodayEntry & {
  type: string
  taskCount: number
  existingStatus: string | null
  timeZone: string
  /** TAB-14 RN-1 — the window start, for "Opens <time>". */
  expectedStartAt?: string | null
}

const executionHref = (checklistId: string) => `/store-view/checklist/${checklistId}`

export function ChecklistsTablet({
  stores: propStores,
  checklists: propChecklists,
  pinRequired: propPinRequired,
  pinStaffByStore,
}: {
  stores: TabletStore[]
  checklists: TabletChecklist[]
  pinRequired: boolean
  pinStaffByStore: Record<string, PinStaff[]>
}) {
  // ── The server half: this render's props, then every answered re-read
  // (tablet Home's TAB-8 rule: a failed or expired read changes nothing; a new
  // render's props — a navigation back here — replace it). No strip here.
  const fromProps = (): TabletServerData => ({
    stores: propStores,
    checklists: propChecklists,
    pinRequired: propPinRequired,
    stripTiles: [],
  })
  const [live, setLive] = useState<TabletServerData>(fromProps)
  const [propsSeen, setPropsSeen] = useState(fromProps)
  if (propsSeen.stores !== propStores || propsSeen.checklists !== propChecklists || propsSeen.pinRequired !== propPinRequired) {
    const next = fromProps()
    setPropsSeen(next)
    setLive(next)
  }

  const savedStoreId = useSavedStoreId()
  const store = resolveSingleStore(live.stores, savedStoreId)
  const storeId = store?.id ?? ""
  const latest = useRef(storeId)
  useLayoutEffect(() => {
    latest.current = storeId
  })

  // ── Today's list for this store (tablet Home's) ──
  const [today, setToday] = useState<{ storeId: string; rows: Row[] | null } | null>(null)
  // Reads the CURRENT store (the ref), so the function is stable and the
  // refresh cycle never holds a stale store; the effect below re-runs it on a
  // switch.
  const loadToday = useCallback((refresh = false): Promise<void> => {
    const id = latest.current
    if (!id) return Promise.resolve()
    return fetch(`/api/stores/${id}/templates`)
      .then((res) => (res.ok ? (res.json() as Promise<Row[]>) : null))
      .catch(() => null)
      .then((rows) => {
        // A failed RE-read keeps what is showing (BUG-6, as on Home).
        if (rows === null && refresh) return
        setToday({ storeId: id, rows })
      })
  }, [])

  // ── Tablet Home's refresh controller (TAB-5) and items re-read (TAB-8) ──
  const cycleRef = useRef<RefreshCycle | null>(null)
  const missedRef = useRef<(() => void) | null>(null)
  const ctl = useTabletRefreshController(cycleRef, missedRef)
  const [health, setHealth] = useState<ItemsHealth>(() => initialItemsHealth(Date.now()))
  useLayoutEffect(() => {
    missedRef.current = () => setHealth((h) => nextItemsHealth(h, "missed", Date.now()))
  }, [])
  const serverChain = useRef<Promise<void>>(Promise.resolve())
  const refreshServer = useCallback((): Promise<void> => {
    const next = serverChain.current.then(async () => {
      const id = latest.current
      if (!id) return
      const outcome = await readTabletTasks(id)
      if (outcome.kind === "ok") setLive((prev) => applyItemsOutcome(prev, outcome))
      setHealth((h) => nextItemsHealth(h, outcome.kind, Date.now()))
    })
    serverChain.current = next
    return next
  }, [])
  // One cycle: the list (lifecycle states, so the order and the chips move on
  // their own), the banner (registered by CalendarDueBanner), then the items.
  const cycle = useCallback<RefreshCycle>(
    async (loaders) => {
      await Promise.all([loadToday(true), ...loaders.map((load) => load().catch(() => undefined))])
      await refreshServer()
    },
    [loadToday, refreshServer]
  )
  useLayoutEffect(() => {
    cycleRef.current = cycle
  }, [cycle])

  useEffect(() => {
    void loadToday()
  }, [loadToday, storeId])
  // Another tab switched the store (Home's picker): read it at once, as Home
  // does on a switch. Not on the first render — the page's render is that read.
  const readFor = useRef(storeId)
  useEffect(() => {
    if (!storeId || readFor.current === storeId) return
    readFor.current = storeId
    void refreshServer()
  }, [storeId, refreshServer])

  // ── Start ──
  const router = useRouter()
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function start(row: Row) {
    if (!store) return
    setStarting(row.id)
    setError(null)
    try {
      const started = await ctl.track(startTodayChecklist(row.id, store.id))
      if (!started.ok) {
        setError(started.error)
        return
      }
      // No id: the answer was not the route's (an expired sign-in can answer
      // with the sign-in page). Claim nothing about whether it started — a
      // second Start is safe either way (the route returns today's row).
      if (!started.id) {
        setError("That didn't open. Reload the page and tap Start again.")
        return
      }
      router.push(executionHref(started.id))
    } finally {
      setStarting(null)
    }
  }

  if (!store) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <p className="text-lg text-[var(--color-muted-foreground)]">
          No store is assigned to this login yet. Ask an admin to add one.
        </p>
      </div>
    )
  }

  const rows = today && today.storeId === storeId ? today.rows : undefined
  const byId = new Map(live.checklists.map((c) => [c.id, c]))
  const rowOf = (e: Row) => (e.existingChecklistId ? byId.get(e.existingChecklistId) : undefined)
  /** Started and not completed — tablet Home's rule without this page's own
   *  unsaved ticks (it has none): the row's status, or a saved tick. */
  const inProgress = (e: Row): boolean => {
    if (e.lifecycleState === "completed" || !e.existingChecklistId) return false
    if (e.existingStatus && e.existingStatus !== "Pending") return true
    const c = rowOf(e)
    return !!c && (c.status !== "Pending" || c.sections.some((s) => s.tasks.some((t) => t.done)))
  }
  const countsOf = (e: Row): { done: number; total: number } => {
    const c = rowOf(e)
    if (!c) return { done: 0, total: e.taskCount }
    const all = c.sections.flatMap((s) => s.tasks)
    return { done: all.filter((t) => t.done).length, total: all.length }
  }
  const ordered = rows ? orderTodayChecklists(rows, inProgress) : []
  const { tiles, doneToday } = splitForChecklistsPage(ordered)
  const notice = itemsNotice(health, (at) => formatWindowTime(at, store.timezone))

  return (
    <TabletRefreshProvider value={ctl}>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-4xl font-extrabold tracking-tight text-[var(--color-foreground)]">Today&apos;s checklists</h1>
            <p className="mt-1 text-xl text-[var(--color-muted-foreground)]">{store.headerDate}</p>
            {notice && (
              <p role="status" className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {notice}
              </p>
            )}
          </div>
          {rows && ordered.length > 0 && (
            <p className="text-2xl font-bold text-[var(--color-foreground)]/80">
              {doneToday.length} of {ordered.length} done
            </p>
          )}
        </header>

        {/* R8: this store's items only, the banner's own data and actions;
            renders nothing when the store owes nothing. Keyed by store so a
            switch starts it over. Its own mb-6 is absorbed by the gap. */}
        <div className="empty:hidden [&>*]:mb-0">
          <CalendarDueBanner key={store.id} storeId={store.id} pinRequired={live.pinRequired} pinStaffByStore={pinStaffByStore} />
        </div>

        {error && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-lg font-semibold text-[var(--color-destructive)]">
            {error}
          </p>
        )}

        {rows === undefined ? (
          <div className="grid gap-6 landscape:grid-cols-2">
            <Skeleton className="h-96 rounded-3xl" />
            <Skeleton className="h-96 rounded-3xl" />
          </div>
        ) : rows === null ? (
          <div className="flex flex-col items-start gap-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-8">
            <p className="text-2xl font-bold text-[var(--color-foreground)]">Couldn&apos;t load today&apos;s checklists</p>
            <p className="text-lg text-[var(--color-muted-foreground)]">Check the store&apos;s wifi, then try again.</p>
            <button
              type="button"
              onClick={() => void loadToday()}
              className="min-h-14 rounded-2xl border border-[var(--color-border)] px-8 text-xl font-bold text-[var(--color-foreground)]"
            >
              Try again
            </button>
          </div>
        ) : ordered.length === 0 ? (
          // RN-5: tablet Home's empty state, word for word.
          <div className="flex flex-col items-start gap-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-8">
            <p className="text-2xl font-bold text-[var(--color-foreground)]">No checklists today</p>
            <p className="text-lg text-[var(--color-muted-foreground)]">
              Nothing is scheduled for {store.name} today. Checklists come from templates assigned to this store.
            </p>
          </div>
        ) : (
          <>
            {tiles.length > 0 && (
              <div className="grid gap-6 landscape:grid-cols-2">
                {tiles.map((e) => {
                  const started = inProgress(e)
                  const upcoming = !started && e.lifecycleState === "upcoming"
                  const { done, total } = countsOf(e)
                  return (
                    <ChecklistTile
                      key={e.id}
                      title={checklistTitle(e, ordered)}
                      templateLine={templateNameLine(e, ordered)}
                      style={checklistTypeStyle(e.type)}
                      total={total}
                      done={done}
                      status={started ? "In progress" : "Not started"}
                      // RN-1: an upcoming tile's chip says when it opens; it
                      // falls back to Due if the window has no start.
                      chip={(upcoming ? opensChipLabel(e) : null) ?? dueChipLabel(e)}
                      action={started ? "Continue" : "Start"}
                      href={e.existingChecklistId ? executionHref(e.existingChecklistId) : null}
                      busy={starting === e.id}
                      onStart={() => void start(e)}
                    />
                  )
                })}
              </div>
            )}

            {doneToday.length > 0 && (
              <section aria-labelledby="done-today" className="flex flex-col gap-3">
                <h2 id="done-today" className="text-base font-bold uppercase tracking-widest text-[var(--color-muted-foreground)]">
                  Done today
                </h2>
                <ul className="flex flex-col gap-3">
                  {doneToday.map((e) => (
                    <DoneRow
                      key={e.id}
                      title={checklistTitle(e, ordered)}
                      templateLine={templateNameLine(e, ordered)}
                      style={checklistTypeStyle(e.type)}
                      href={e.existingChecklistId ? executionHref(e.existingChecklistId) : null}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </TabletRefreshProvider>
  )
}

// ─── One tile (R5, R7) ────────────────────────────────────────────────────────
//
// Landscape (the landscape board): band on top — icon chip and the chip in a
// row, then the type name, then "N tasks" — and the body below with the full
// width button. Portrait (the portrait board): the band runs sideways — icon,
// name block, chip — and the button sits beside the progress. `portrait:` /
// `landscape:` are the viewport's orientation, tablet Home's variants.
//
// R9 / TAB-13 R8: every line on the type's fill is ≥ 19px bold (the type name
// 48–60px, the lines under it 24px bold, the button 30px bold). Literal class
// names only; colours from the type key.

function ChecklistTile({
  title,
  templateLine,
  style,
  total,
  done,
  status,
  chip,
  action,
  href,
  busy,
  onStart,
}: {
  title: string
  templateLine: string | null
  style: ChecklistTypeStyle
  total: number
  done: number
  status: "In progress" | "Not started"
  chip: string | null
  action: "Start" | "Continue"
  /** The row to open, when one exists (Continue, or Start on a Pending row). */
  href: string | null
  busy: boolean
  onStart: () => void
}) {
  const { Icon } = style
  const buttonClass = cn(
    "flex min-h-20 items-center justify-center gap-3 rounded-2xl px-6 text-3xl font-bold disabled:opacity-60 landscape:mt-auto landscape:w-full portrait:w-64 portrait:shrink-0",
    style.fill,
    style.ink
  )
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
      <div className={cn("flex gap-5 p-7 landscape:flex-col portrait:flex-row portrait:items-center", style.fill, style.ink)}>
        <div className="flex items-start justify-between gap-3 portrait:contents">
          <span className={cn("flex size-16 shrink-0 items-center justify-center rounded-2xl", style.onFillChip)}>
            <Icon className="size-9" aria-hidden />
          </span>
          {chip && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--color-card)] px-5 py-2 text-xl font-bold portrait:order-last",
                style.chipText
              )}
            >
              <Clock className="size-5" aria-hidden />
              {chip}
            </span>
          )}
        </div>
        <div className="min-w-0 portrait:flex-1">
          <h2 className="break-words text-6xl font-extrabold uppercase leading-none tracking-tight portrait:text-5xl">{title}</h2>
          {templateLine && <p className="mt-2 break-words text-2xl font-bold">{templateLine}</p>}
          <p className="mt-2 text-2xl font-bold">
            {total} {total === 1 ? "task" : "tasks"}
          </p>
        </div>
      </div>

      {/* flex-1 + the button's landscape:mt-auto: two tiles in a row share a
          height (one may carry the template line), so the buttons line up at
          the bottom instead of one floating above empty card. */}
      <div className="flex flex-1 gap-6 p-7 landscape:flex-col portrait:flex-row portrait:items-center">
        <div className="min-w-0 landscape:flex-none portrait:flex-1">
          <div className="flex items-baseline justify-between gap-3 text-xl">
            <span className="font-bold text-[var(--color-foreground)]">{status}</span>
            <span className="font-semibold text-[var(--color-muted-foreground)]">
              {done} of {total} done
            </span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--color-muted)]">
            <div
              className={cn("h-full rounded-full transition-all duration-300", style.fill)}
              style={{ width: `${total ? (done / total) * 100 : 0}%` }}
            />
          </div>
        </div>
        {href ? (
          <Link href={href} className={buttonClass}>
            {action}
            <ArrowRight className="size-8" aria-hidden />
          </Link>
        ) : (
          <button type="button" onClick={onStart} disabled={busy} className={buttonClass}>
            {busy ? "Starting…" : action}
            {!busy && <ArrowRight className="size-8" aria-hidden />}
          </button>
        )}
      </div>
    </article>
  )
}

// ─── One "Done today" row (R4) ────────────────────────────────────────────────

function DoneRow({
  title,
  templateLine,
  style,
  href,
}: {
  title: string
  templateLine: string | null
  style: ChecklistTypeStyle
  href: string | null
}) {
  const { Icon } = style
  return (
    <li className="flex items-center gap-5 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <span className={cn("flex size-16 shrink-0 items-center justify-center rounded-2xl", style.fill, style.ink)}>
        <Icon className="size-9" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-3xl font-extrabold uppercase tracking-tight text-[var(--color-foreground)]">{title}</p>
        {templateLine && <p className="truncate text-xl font-bold text-[var(--color-muted-foreground)]">{templateLine}</p>}
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-success-border)] bg-[var(--color-success-bg)] px-4 py-2 text-xl font-bold text-[var(--color-success-text)]">
        <Check className="size-5" aria-hidden />
        Completed
      </span>
      {href && (
        <Link
          href={href}
          className="ml-auto flex min-h-14 shrink-0 items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] px-8 text-2xl font-bold text-[var(--color-foreground)]"
        >
          View
        </Link>
      )}
    </li>
  )
}
