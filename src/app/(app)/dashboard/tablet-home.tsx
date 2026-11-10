"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Clock, Delete, GraduationCap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { TouchCheck, TouchRow } from "@/components/ui/touch-row"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatWindowTime } from "@/lib/checklist-status-display"
import { resolveSingleStore, saveStoreId, useSavedStoreId } from "@/lib/dashboard-store"
import { pickTodayChecklist, type TodayEntry } from "@/lib/tablet-today"
import { dueChipFor, dueRowSuffix } from "@/lib/tablet-due"
import { formatInstant } from "@/lib/display-time"
import { dayRolledOver, nextShownDay, pruneOverrides, type TickOverride } from "@/lib/tablet-refresh"
import type { OwedSummary } from "@/lib/hr-compliance"
import { fetchCard } from "./card-fetch"
import { StatStrip } from "./tablet-strip"
import { MessagesColumn } from "./tablet-messages"
import {
  TabletRefreshProvider,
  useBusyFlag,
  useRefreshLoader,
  useTabletRefresh,
  useTabletRefreshController,
  type RefreshCycle,
} from "./tablet-refresh"
import type { TabletChecklist, TabletStore, TabletTask } from "./tablet-data"

/** TAB-1b — one button on the name sheet. `id` is what goes in
 *  `completedByStaffId`: "manager" for both generic options, as on desktop. */
type PickerOption = { key: string; id: string; label: string }

/** TAB-1b — who the following ticks are credited to, for one checklist. */
type Person = { checklistId: string; id: string; label: string }

/** The desktop picker's list, in its order: the two generic options (both send
 *  "manager", which the task-log route saves as no name), then the store's
 *  ACTIVE staff by name (src/app/(app)/store-view/checklist/[id]/page.tsx). */
function pickerOptions(store: TabletStore): PickerOption[] {
  return [
    { key: "generic:team", id: "manager", label: "Team Member" },
    { key: "generic:manager", id: "manager", label: "Manager" },
    ...store.staff.map((s) => ({ key: s.id, id: s.id, label: s.displayName })),
  ]
}

// TAB-1 — the tablet home on /dashboard (Direction 1 · Status Stage).
//
// Left: the Tasks panel — Not started / In progress / Done. Right: the existing
// Team Messages card, unchanged (TAB-2 replaces it). No Sales, Goal or Labor
// (Gary's ruling 4). Each column scrolls on its own; the page does not.
// TAB-2, 2026-11-10 — appended; the line above describing the right column is
// spent. The right column is now the Messages column (./tablet-messages.tsx):
// Corporate Update pinned, the thread, a composer fixed at the bottom. In
// portrait it stacks below Tasks. The stat strip moved to TAB-3 (Gary,
// 2026-11-10).
//
// EVERY WRITE IS AN EXISTING ENDPOINT, CALLED THE WAY ITS EXISTING SCREEN CALLS IT:
//   tick / untick   POST /api/checklists/[id]/task-log   (the execution page)
//   value entry     the same route's `temperatureValue`  (accepted since Phase 1)
//   Start, no row   POST /api/checklists {templateId, storeId} (Start Daily Checklist)
//   Submit button   POST /api/checklists/[id]/submit     (the execution page's Submit)
//   due list        POST /api/calendar/occurrences/[id]/complete (the due banner)
// Ticks post as the logged-in account with no staff name (ruling 6), exactly
// as the execution page does when its picker's "Team Member" is chosen.
//
// TAB-1b, 2026-11-09 — appended; the two lines above describe adec345 and are
// spent. Ruling 6's premise ("same as today") was wrong: desktop already asks
// "Who completed this task?" on every tick whenever the store has staff (Gary:
// "Agreed, fix it."). The tablet now follows DESKTOP'S RULE EXACTLY — the same
// list (Team Member, Manager, then the store's ACTIVE staff by name), the same
// condition (asked only when the store has staff; required then, since closing
// the sheet ticks nothing, like desktop's Cancel), the same field
// (`completedByStaffId`, with "manager" for both generic options) and the same
// untick (no name sent). Only HOW it asks differs: the first tick of a
// checklist opens "Who's completing these?", the pick sticks as a "Completing
// as …" chip for the following ticks, and it lives in React state only — gone
// on submit, on reload, and when the panel moves to another checklist.
// PARTIAL SUBMIT sends the same submit desktop's "Submit Partial" sends, after
// a confirm sheet; desktop sends it with no confirm.
//
// SUBMIT IS A DELIBERATE TAP, NEVER A SIDE EFFECT OF A TICK (Gary, 2026-11-09,
// TAB-1 fix — replaces adec345's last-tick submit). When every item is ticked
// the In progress panel shows one full-width "Submit <NAME> checklist" button,
// which sends the same submit the desktop Submit button sends. Unticking an
// item hides it again. Done appears ONLY after that submit succeeds with
// status Completed; on failure the error shows and the button stays.
// Why Done waits for submit: a checklist only becomes Completed through submit,
// and the day-close cron files every row that is not Completed as Missed —
// fully ticked or not (api/cron/checklist-day-close). A Done panel over an
// unsubmitted row would be false.

/** One row of GET /api/stores/[id]/templates — the Start Daily Checklist list. */
type TodayRow = TodayEntry & {
  taskCount: number
  existingStatus: string | null
  timeZone: string
}

type DueItem = {
  id: string
  title: string
  categoryLabel: string
  storeId: string
  dueAt: string
  daysOverdue: number
  templateId: string | null
  checklistId: string | null
}

type Override = TickOverride

/** TAB-5 — `value` while `usable`, otherwise the last value that was usable.
 *  How the tablet home keeps showing the day it is on while the server has
 *  already moved to the next one but the page is busy (ruling 3): the new
 *  day's data waits, it never replaces the old day's under an open sheet.
 *  `value` must be referentially stable between renders. */
function useHeld<T>(value: T, usable: boolean): T {
  const [held, setHeld] = useState(value)
  if (usable && held !== value) setHeld(value)
  return usable ? value : held
}

async function readError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : null
  } catch {
    return null
  }
}

export function TabletHome({
  stores,
  checklists,
  stripTiles = [],
}: {
  stores: TabletStore[]
  checklists: TabletChecklist[]
  /** TAB-3 — the stat strip's enabled tiles in the ADMIN's order (stripTileKeys
   *  in page.tsx). Empty — the default — renders no strip and leaves this
   *  layout byte-identical to TAB-2b's. */
  stripTiles?: string[]
}) {
  const router = useRouter()
  const savedStoreId = useSavedStoreId()
  // The latest server render's store. What the page SHOWS may be held one day
  // behind it (TAB-5, below).
  const latestStore = resolveSingleStore(stores, savedStoreId)
  const storeId = latestStore?.id ?? ""
  const storeTimeZone = latestStore?.timezone ?? ""

  // ── TAB-5: the day the tablet home is showing, per store (ruling 2) ──
  // Starts as the server's day for each store. Moves only to a day the SERVER
  // has rendered (nextShownDay), and only while nothing is busy (ruling 3).
  // Until it moves, the previous render's stores and checklists stay on screen.
  const [shown, setShown] = useState<Record<string, string>>(() =>
    Object.fromEntries(stores.map((s) => [s.id, s.day]))
  )
  const shownDay = latestStore ? (shown[latestStore.id] ?? latestStore.day) : ""
  const server = useMemo(() => ({ stores, checklists }), [stores, checklists])
  const view = useHeld(server, !latestStore || latestStore.day === shownDay)
  const store = latestStore ? (view.stores.find((s) => s.id === latestStore.id) ?? latestStore) : undefined

  // What the controller's callbacks read: the latest values, not the ones
  // their closure saw.
  const serverDay = latestStore?.day ?? ""
  const latest = useRef({ storeId, serverDay, shownDay })
  useLayoutEffect(() => {
    latest.current = { storeId, serverDay, shownDay }
  })

  // ── Today's checklists for this store (the Start Daily Checklist list) ──
  // TAB-5: a list read after the store's midnight belongs to the NEXT day. It
  // is not shown until the page has moved to that day (ruling 2, only while
  // idle — ruling 3), so it never lands under yesterday's checklist; moving
  // re-reads it (the effect below keys on shownDay).
  const [today, setToday] = useState<{ storeId: string; rows: TodayRow[] | null } | null>(null)
  // Promise chains rather than async/await so every setState sits in a
  // callback — the same shape the desktop dashboard's loaders use. Resolves
  // true when the list answered. A failed RE-read (refresh) keeps what is
  // showing — BUG-6's rule, never flip real data into an error state.
  const loadToday = useCallback(
    (refresh = false): Promise<boolean> => {
      if (!storeId) return Promise.resolve(false)
      const fetchedAt = new Date()
      return fetch(`/api/stores/${storeId}/templates`)
        .then((res) => (res.ok ? (res.json() as Promise<TodayRow[]>) : null))
        .catch(() => null)
        .then((rows) => {
          if (rows === null && refresh) return false
          if (rows !== null && dayRolledOver(latest.current.shownDay, fetchedAt, storeTimeZone)) return true
          setToday({ storeId, rows })
          return rows !== null
        })
    },
    [storeId, storeTimeZone]
  )
  const shownToday = today && today.storeId === storeId ? today : null

  // ── The due feed behind the calendar banner ──
  const [due, setDue] = useState<DueItem[] | null>(null)
  const loadDue = useCallback((): Promise<void> => {
    return fetch("/api/calendar/due", { signal: AbortSignal.timeout(12_000) })
      .then((res) => (res.ok ? (res.json() as Promise<{ items: DueItem[] }>) : { items: [] }))
      .catch(() => ({ items: [] as DueItem[] }))
      .then((body) => setDue(body.items))
  }, [])

  // ── TAB-5: the one refresh controller ──
  const cycleRef = useRef<RefreshCycle | null>(null)
  const ctl = useTabletRefreshController(cycleRef)

  // The server half (the Tasks panel's items and ticks, the header date) is a
  // server render: no route returns a checklist's items (tablet-data.ts), so
  // it is re-read with router.refresh(), which keeps client state and scroll.
  // ONE AT A TIME: each waits for the last to land, so `syncedFrom` is always
  // the start of the read that produced the props on screen. A read "lands"
  // when new server props arrive; one that never does is let go after 20s.
  const [syncedFrom, setSyncedFrom] = useState(0)
  const landing = useRef<(() => void) | null>(null)
  const serverChain = useRef<Promise<void>>(Promise.resolve())
  const refreshServer = useCallback((): Promise<void> => {
    const next = serverChain.current.then(
      () =>
        new Promise<void>((resolve) => {
          const startedAt = Date.now()
          const timer = window.setTimeout(() => {
            landing.current = null
            resolve()
          }, 20_000)
          landing.current = () => {
            window.clearTimeout(timer)
            landing.current = null
            setSyncedFrom(startedAt)
            resolve()
          }
          router.refresh()
        })
    )
    serverChain.current = next
    return next
  }, [router])
  useEffect(() => {
    landing.current?.()
  }, [stores, checklists])

  // Ruling 2: move to the server's day if it has moved on and nothing is busy.
  const acceptDay = useCallback(() => {
    const { storeId: id, serverDay: day, shownDay: cur } = latest.current
    if (!id) return
    const next = nextShownDay(cur, day, ctl.busy())
    if (next === cur) return
    setShown((prev) => ({ ...prev, [id]: next }))
    // Yesterday's list goes with yesterday: a skeleton until the new day's
    // list is read (the loadToday effect keys on shownDay).
    setToday(null)
  }, [ctl, setShown, setToday])
  // Switching stores is a tap, not a refresh: show that store's current day.
  useLayoutEffect(() => {
    acceptDay()
  }, [storeId, acceptDay])

  /** One cycle (ruling 1). The controller calls it only while the page is
   *  visible, idle and not already refreshing. */
  const cycle = useCallback<RefreshCycle>(async (loaders) => {
    // A day the server reached while the page was busy is adopted first.
    acceptDay()
    const [answered] = await Promise.all([
      loadToday(true),
      loadDue(),
      ...loaders.map((load) => load().catch(() => undefined)),
    ])
    // Ruling 4: re-read the items, so ticks made elsewhere show. ONLY right
    // after a read has just answered: when a refresh's own request fails, Next
    // falls back to a full browser navigation, which with the store's wifi
    // down would leave Safari's error page on the counter.
    if (!answered || navigator.onLine === false) return
    await refreshServer()
    acceptDay()
  }, [acceptDay, loadToday, loadDue, refreshServer])
  useLayoutEffect(() => {
    cycleRef.current = cycle
  }, [cycle])

  useEffect(() => {
    void loadToday()
  }, [loadToday, shownDay])
  useEffect(() => {
    void loadDue()
  }, [loadDue])

  /** After a write that changes which checklist is current: re-read the list,
   *  and re-render the server half for the new row's items / completedAt. */
  const refresh = useCallback(async () => {
    await loadToday()
    await refreshServer()
  }, [loadToday, refreshServer])

  const rows = shownToday ? shownToday.rows : undefined
  const checklistsById = useMemo(() => new Map(view.checklists.map((c) => [c.id, c])), [view.checklists])

  if (!store) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-lg text-[var(--color-muted-foreground)]">
          No store is assigned to this login yet. Ask an admin to add one.
        </p>
      </div>
    )
  }

  return (
    <TabletRefreshProvider value={ctl}>
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          {stores.length > 1 ? (
            <Select value={store.id} onValueChange={saveStoreId} onOpenChange={(open) => ctl.setBusy("store-select", open)}>
              <SelectTrigger className="h-14 w-auto min-w-56 rounded-xl border-none bg-transparent px-2 text-2xl font-bold shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="py-3 text-lg">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h1 className="truncate text-2xl font-bold text-[var(--color-foreground)]">{store.name}</h1>
          )}
          <p className="text-lg text-[var(--color-muted-foreground)]">{store.headerDate}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ComplianceChip />
          <DueChip feed={due ?? []} storeId={store.id} onChanged={loadDue} />
        </div>
      </header>

      {/* TAB-3 — the stat strip, below both columns (ruling 4). With no tile
          enabled (the default) the columns render exactly as in TAB-2b. With
          tiles enabled, columns and strip share a flex column: a flex gap only
          falls BETWEEN rendered children, so when no tile is visible to this
          viewer StatStrip renders null and leaves no strip container and no
          gap (Gary, 2026-11-10). Each tile still asks its own gate. */}
      {stripTiles.length > 0 ? (
        <div className="flex min-h-0 flex-col gap-4">
          {columns("min-h-0 flex-1")}
          <StatStrip key={store.id} storeId={store.id} tiles={stripTiles} />
        </div>
      ) : (
        columns("min-h-0")
      )}
    </div>
    </TabletRefreshProvider>
  )

  function columns(sizing: string) {
    return (
      <div className={`grid ${sizing} gap-4 landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] portrait:grid-rows-[minmax(0,3fr)_minmax(0,2fr)]`}>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)]">
          {/* TAB-5: keyed by the day too, so a new day starts the panel clean —
              no ticks, "Completing as …" chip or Done state carried over. */}
          <TasksPanel
            key={`${store!.id}:${shownDay}`}
            store={store!}
            rows={rows}
            checklistsById={checklistsById}
            // While the previous day is held on screen, nothing on it has
            // been re-read, so no local tick may be retired yet.
            syncedFrom={view === server ? syncedFrom : 0}
            onRetry={() => void loadToday()}
            onChanged={refresh}
          />
        </section>
        <MessagesColumn key={store!.id} storeId={store!.id} />
      </div>
    )
  }
}

// ─── Tasks panel ──────────────────────────────────────────────────────────────

function TasksPanel({
  store,
  rows,
  checklistsById,
  syncedFrom,
  onRetry,
  onChanged,
}: {
  store: TabletStore
  /** undefined = loading, null = the list failed to load. */
  rows: TodayRow[] | null | undefined
  checklistsById: Map<string, TabletChecklist>
  /** TAB-5 — when the server read behind `checklistsById` started (ms). */
  syncedFrom: number
  onRetry: () => void
  onChanged: () => Promise<void>
}) {
  // Local ticks on top of the server's rows, keyed `${checklistId}:${taskId}`,
  // so a tap reads instantly and a refused write can be put back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  // Mirrors `overrides` for reads inside async handlers (the "was that the last
  // item?" check runs after an await). Every write below updates both.
  const overridesRef = useRef<Record<string, Override>>({})
  // Start on an existing row writes nothing (audit point 4): the row turns In
  // Progress at its first tick, through task-log. This only remembers the tap.
  const [started, setStarted] = useState<Set<string>>(new Set())
  // The checklist this device just finished, shown as Done until the crew
  // moves on, even when another checklist is already due.
  const [justFinished, setJustFinished] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [valueFor, setValueFor] = useState<{ checklistId: string; task: TabletTask } | null>(null)
  // TAB-1b — the sticky person. React state ONLY: never a cookie or storage, so
  // it cannot outlive a reload, a day or a device.
  const [person, setPerson] = useState<Person | null>(null)
  // The name sheet. `task` is the tap that opened it (ticked once a name is
  // picked); null when Change opened it.
  const [nameSheet, setNameSheet] = useState<{ checklistId: string; task: TabletTask | null } | null>(null)
  // The partial-submit confirm sheet, its in-sheet error, and the calm done
  // state shown after it lands.
  const [partialFor, setPartialFor] = useState<string | null>(null)
  const [partialError, setPartialError] = useState<string | null>(null)
  const [partialFinished, setPartialFinished] = useState<{ id: string; done: number; total: number } | null>(null)

  // ── TAB-5: tell the refresh controller when this panel is busy (ruling 3) ──
  const ctl = useTabletRefresh()
  const track = <T,>(p: Promise<T>): Promise<T> => (ctl ? ctl.track(p) : p)
  useBusyFlag("tasks:sheet", !!valueFor || !!nameSheet || !!partialFor)
  useBusyFlag("tasks:write", busy !== null)
  // Ruling 4: once a server read that began after a tick settled has landed,
  // that tick's local copy is redundant — drop it, so a later change made on
  // another device shows through instead of being masked by it.
  useEffect(() => {
    const pruned = pruneOverrides(overridesRef.current, syncedFrom)
    if (pruned === overridesRef.current) return
    overridesRef.current = pruned
    setOverrides(pruned)
  }, [syncedFrom])

  if (rows === undefined) return <PanelSkeleton />
  if (rows === null) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center gap-4 p-8">
        <p className="text-lg text-[var(--color-muted-foreground)]">Couldn&apos;t load today&apos;s checklists.</p>
        <Button size="touch" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }

  const pick = pickTodayChecklist(rows)

  function tasksOf(c: TabletChecklist): TabletTask[] {
    return c.sections.flatMap((s) =>
      s.tasks.map((t) => {
        const o = overridesRef.current[`${c.id}:${t.id}`]
        return o ? { ...t, done: o.done, value: o.value } : t
      })
    )
  }
  function withOverrides(c: TabletChecklist): TabletChecklist {
    return {
      ...c,
      sections: c.sections.map((s) => ({
        ...s,
        tasks: s.tasks.map((t) => {
          const o = overrides[`${c.id}:${t.id}`]
          return o ? { ...t, done: o.done, value: o.value } : t
        }),
      })),
    }
  }

  async function submit(c: TabletChecklist) {
    setBusy(`submit:${c.id}`)
    try {
      const completedTaskIds = tasksOf(c).filter((t) => t.done).map((t) => t.id)
      let res: Response
      try {
        res = await fetch(`/api/checklists/${c.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completedTaskIds }),
        })
      } catch {
        setError("Every item is saved, but the checklist didn't submit — no connection. Check the store's wifi and tap Submit again.")
        return
      }
      if (!res.ok) {
        setError((await readError(res)) ?? `Every item is saved, but the checklist didn't submit (error ${res.status}). Tap Submit again.`)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { status?: string }
      // Done only on a Completed answer. Anything else (an item unticked on
      // another device in the meantime) is a failure: say so, keep the button.
      if (body.status !== "Completed") {
        setError("The checklist didn't submit as complete — an item may have been unticked elsewhere. Check the list and tap Submit again.")
        await onChanged()
        return
      }
      setJustFinished(c.id)
      setPerson(null)
      setError(null)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  // TAB-1b — PARTIAL SUBMIT. The same request as desktop's "Submit Partial"
  // (and as submit() above). The server recomputes status from the saved logs:
  // a partial lands In Progress, or Non-Compliant when a critical task is
  // open. Completed means the rest was ticked elsewhere meanwhile, so the
  // normal Done panel shows. Anything else is a failure, c83a5c3's rule: say so
  // and keep the sheet open.
  async function submitPartial(c: TabletChecklist) {
    setBusy(`partial:${c.id}`)
    setPartialError(null)
    try {
      const tasks = tasksOf(c)
      const completedTaskIds = tasks.filter((t) => t.done).map((t) => t.id)
      let res: Response
      try {
        res = await fetch(`/api/checklists/${c.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completedTaskIds }),
        })
      } catch {
        setPartialError("The ticked items are saved, but the checklist didn't submit — no connection. Check the store's wifi and try again.")
        return
      }
      if (!res.ok) {
        setPartialError((await readError(res)) ?? `The ticked items are saved, but the checklist didn't submit (error ${res.status}). Try again.`)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { status?: string }
      if (body.status === "Completed") {
        setPartialFor(null)
        setPerson(null)
        setJustFinished(c.id)
        await onChanged()
        return
      }
      if (body.status !== "In Progress" && body.status !== "Non-Compliant") {
        setPartialError("The checklist didn't submit as expected. Check the list and try again.")
        await onChanged()
        return
      }
      setPartialFor(null)
      setPerson(null)
      setError(null)
      setPartialFinished({ id: c.id, done: completedTaskIds.length, total: tasks.length })
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function toggle(c: TabletChecklist, task: TabletTask, value: number | null = null, staffId: string | null = null) {
    const key = `${c.id}:${task.id}`
    const next: Override = task.done ? { done: false, value: null } : { done: true, value }
    const prior = overridesRef.current[key]
    setOverrides((prev) => ({ ...prev, [key]: next }))
    overridesRef.current = { ...overridesRef.current, [key]: next }
    setError(null)
    let res: Response
    try {
      res = await track(fetch(`/api/checklists/${c.id}/task-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // TAB-1b: the picked name rides on a tick, exactly as desktop sends it
        // ("manager" for Team Member / Manager). An untick sends none — desktop
        // doesn't, and the route never reads it on an untick.
        body: JSON.stringify({
          taskId: task.id,
          completedByStaffId: next.done ? staffId : null,
          temperatureValue: next.done ? value : null,
        }),
      }))
    } catch {
      res = new Response(null, { status: 0 })
    }
    if (!res.ok) {
      const restore = (prev: Record<string, Override>) => {
        const n = { ...prev }
        if (prior) n[key] = prior
        else delete n[key]
        return n
      }
      overridesRef.current = restore(overridesRef.current)
      setOverrides(restore)
      setError(
        res.status === 0
          ? "That didn't save — no connection. Check the store's wifi and tap it again."
          : ((await readError(res)) ?? `That didn't save (error ${res.status}). Tap it again.`)
      )
      return
    }
    // TAB-5: the write is saved; stamp when, so the first server read that
    // starts after this moment retires the local copy (pruneOverrides). Only
    // if the tap is still the latest one for this item.
    const settled: Override = { ...next, settledAt: Date.now() }
    const settle = (prev: Record<string, Override>) => (prev[key] === next ? { ...prev, [key]: settled } : prev)
    overridesRef.current = settle(overridesRef.current)
    setOverrides(settle)
    // No submit here — ticking the last item only reveals the Submit button.
  }

  async function start(entry: TodayRow) {
    if (entry.existingChecklistId) {
      setStarted((prev) => new Set(prev).add(entry.existingChecklistId!))
      setJustFinished(null)
      return
    }
    // No row yet: instantiate today's checklist exactly as Start Daily
    // Checklist does. A login without checklists.create is refused there and
    // here alike — no permission changes.
    setBusy(`start:${entry.id}`)
    setError(null)
    try {
      let res: Response
      try {
        res = await fetch("/api/checklists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: entry.id, storeId: store.id }),
        })
      } catch {
        setError("Couldn't start — no connection. Check the store's wifi and try again.")
        return
      }
      if (!res.ok) {
        setError(
          res.status === 403
            ? "This login can't start a checklist that hasn't been started today. Ask a manager to start it."
            : ((await readError(res)) ?? `Couldn't start (error ${res.status}).`)
        )
        return
      }
      const data = (await res.json()) as { id?: string }
      if (data.id) setStarted((prev) => new Set(prev).add(data.id!))
      setJustFinished(null)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  // ── TAB-1b: who a tick is credited to ──
  const options = pickerOptions(store)
  // Desktop's condition: the picker opens only when the store has staff; with
  // none, a tick saves no name without asking.
  const asksForName = store.staff.length > 0

  function tapTask(view: TabletChecklist, t: TabletTask) {
    if (t.done) return void toggle(view, t) // untick: no name, as desktop
    const who = person?.checklistId === view.id ? person : null
    if (asksForName && !who) {
      // First tick of this checklist: the name comes first, then (for a
      // temperature task) the number pad.
      setNameSheet({ checklistId: view.id, task: t })
      return
    }
    if (t.requiresTemp) setValueFor({ checklistId: view.id, task: t })
    else void toggle(view, t, null, who?.id ?? null)
  }

  function pickName(o: PickerOption) {
    const target = nameSheet
    setNameSheet(null)
    if (!target) return
    setPerson({ checklistId: target.checklistId, id: o.id, label: o.label })
    if (!target.task) return // Change: nothing to tick
    if (target.task.requiresTemp) {
      setValueFor({ checklistId: target.checklistId, task: target.task })
      return
    }
    const c = checklistsById.get(target.checklistId)
    if (c) void toggle(c, target.task, null, o.id)
  }

  // ── Which state ──
  const finishedRow = justFinished ? checklistsById.get(justFinished) : undefined
  const finishedEntry = justFinished ? rows.find((r) => r.existingChecklistId === justFinished) : undefined
  const partialRow = partialFinished ? checklistsById.get(partialFinished.id) : undefined
  const partialEntry = partialFinished ? rows.find((r) => r.existingChecklistId === partialFinished.id) : undefined
  // The checklist the In progress panel is showing, if it is showing one.
  let shownId: string | null = null

  let body: React.ReactNode
  if (partialFinished && partialRow && partialEntry) {
    body = (
      <DonePanel
        checklist={withOverrides(partialRow)}
        timeZone={partialEntry.timeZone}
        upNext={null}
        onStartNext={(e) => void start(e)}
        busy={busy}
        partial={{ done: partialFinished.done, total: partialFinished.total }}
        onKeepGoing={() => setPartialFinished(null)}
      />
    )
  } else if (finishedRow && finishedEntry) {
    const upNext = pick.mode === "current" ? pick.current : pick.mode === "done" ? pick.upNext : null
    body = (
      <DonePanel
        checklist={withOverrides(finishedRow)}
        timeZone={finishedEntry.timeZone}
        upNext={upNext && upNext.id !== finishedEntry.id ? upNext : null}
        onStartNext={(e) => void start(e)}
        busy={busy}
      />
    )
  } else if (pick.mode === "none") {
    body = (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 p-8">
        <p className="text-2xl font-bold text-[var(--color-foreground)]">No checklists today</p>
        <p className="text-lg text-[var(--color-muted-foreground)]">
          Nothing is scheduled for {store.name} today. Checklists come from templates assigned to this store.
        </p>
      </div>
    )
  } else if (pick.mode === "done") {
    const row = pick.lastDone.existingChecklistId ? checklistsById.get(pick.lastDone.existingChecklistId) : undefined
    body = row ? (
      <DonePanel
        checklist={withOverrides(row)}
        timeZone={pick.lastDone.timeZone}
        upNext={pick.upNext}
        onStartNext={(e) => void start(e)}
        busy={busy}
      />
    ) : (
      <PanelSkeleton />
    )
  } else {
    const entry = pick.current
    const row = entry.existingChecklistId ? checklistsById.get(entry.existingChecklistId) : undefined
    const view = row ? withOverrides(row) : undefined
    const anyDone = view?.sections.some((s) => s.tasks.some((t) => t.done)) ?? false
    const inProgress =
      !!view && (started.has(view.id) || anyDone || (row?.status !== "Pending" && row?.status !== undefined))
    if (entry.existingChecklistId && !row && started.has(entry.existingChecklistId)) {
      body = <PanelSkeleton />
    } else if (view && inProgress) {
      shownId = view.id
      body = (
        <InProgressPanel
          checklist={view}
          entry={entry}
          busy={busy}
          person={person?.checklistId === view.id ? person.label : null}
          onChangePerson={() => setNameSheet({ checklistId: view.id, task: null })}
          onTap={(t) => tapTask(view, t)}
          onSubmit={() => void submit(view)}
          onSubmitPartial={() => {
            setPartialError(null)
            setPartialFor(view.id)
          }}
        />
      )
    } else {
      body = <NotStartedPanel entry={entry} busy={busy === `start:${entry.id}`} onStart={() => void start(entry)} />
    }
  }

  // The chip clears when the panel moves to a different checklist (or off the
  // In progress panel altogether). A state update during render, React's
  // documented pattern for resetting state when an input changes.
  if (person && person.checklistId !== shownId) setPerson(null)

  const partialRowForSheet = partialFor ? checklistsById.get(partialFor) : undefined
  const partialOpen = partialRowForSheet
    ? withOverrides(partialRowForSheet).sections.flatMap((s) => s.tasks).filter((t) => !t.done).length
    : 0
  const partialBusy = busy === `partial:${partialFor}`

  return (
    <>
      {body}
      {error && (
        <p role="alert" className="border-t border-[var(--color-border)] bg-[var(--color-warning-bg)] px-5 py-3 text-base font-medium text-[var(--color-warning-text)]">
          {error}
        </p>
      )}
      <ValueSheet
        key={valueFor?.task.id ?? "closed"}
        task={valueFor?.task ?? null}
        onClose={() => setValueFor(null)}
        onSave={(v) => {
          const target = valueFor
          setValueFor(null)
          const c = target ? checklistsById.get(target.checklistId) : undefined
          const who = target && person?.checklistId === target.checklistId ? person.id : null
          if (c && target) void toggle(c, target.task, v, who)
        }}
      />
      <NameSheet
        key={nameSheet ? `name:${nameSheet.checklistId}:${nameSheet.task?.id ?? "change"}` : "name:closed"}
        open={!!nameSheet}
        options={options}
        onClose={() => setNameSheet(null)}
        onPick={pickName}
      />
      <BottomSheet
        open={!!partialRowForSheet}
        onClose={() => {
          if (!partialBusy) setPartialFor(null)
        }}
        title={`Submit with ${partialOpen} ${partialOpen === 1 ? "task" : "tasks"} unfinished?`}
      >
        <div className="mx-auto flex max-w-md flex-col gap-4 pb-2">
          <p className="text-lg text-[var(--color-muted-foreground)]">
            The ticked items are already saved. Submitting files this checklist as it stands.
          </p>
          {partialError && (
            <p role="alert" className="rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-base font-medium text-[var(--color-warning-text)]">
              {partialError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button size="touch" variant="outline" onClick={() => setPartialFor(null)} disabled={partialBusy}>
              Keep going
            </Button>
            <Button
              size="touch"
              onClick={() => partialRowForSheet && void submitPartial(partialRowForSheet)}
              disabled={partialBusy}
            >
              {partialBusy ? "Submitting…" : "Submit partial"}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </>
  )
}

// ─── TAB-1b: "Who's completing these?" ───────────────────────────────────────

/** Above this many names a search box appears — past ~12 the two-column grid
 *  outgrows the sheet's height on a landscape iPad and starts to scroll. */
const NAME_SEARCH_AT = 12

function NameSheet({
  open,
  options,
  onClose,
  onPick,
}: {
  open: boolean
  options: PickerOption[]
  onClose: () => void
  onPick: (o: PickerOption) => void
}) {
  // Remounted per opening (keyed by the caller), so the search starts empty.
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  return (
    <BottomSheet open={open} onClose={onClose} title="Who's completing these?">
      <div className="flex flex-col gap-4 pb-2">
        {options.length > NAME_SEARCH_AT && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names"
            aria-label="Search names"
            className="h-14 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 text-lg text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          {shown.map((o) => (
            <Button
              key={o.key}
              size="touch"
              variant="outline"
              className="h-16 justify-start truncate"
              onClick={() => onPick(o)}
            >
              {o.label}
            </Button>
          ))}
        </div>
        {shown.length === 0 && (
          <p className="text-lg text-[var(--color-muted-foreground)]">No name matches “{query}”.</p>
        )}
      </div>
    </BottomSheet>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-5">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

function dueLabel(entry: TodayRow): string | null {
  if (!entry.expectedEndAt) return null
  const at = formatWindowTime(new Date(entry.expectedEndAt), entry.timeZone)
  return entry.lifecycleState === "overdue" ? `Overdue · was due ${at}` : `Due ${at}`
}

// ─── Not started: solid orange, the name as a banner, one big Start ─────────

function NotStartedPanel({ entry, busy, onStart }: { entry: TodayRow; busy: boolean; onStart: () => void }) {
  const due = dueLabel(entry)
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain bg-[var(--color-primary)] p-8 text-[var(--color-primary-foreground)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-4xl font-extrabold uppercase leading-tight tracking-tight">{entry.name}</h2>
        {due && (
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--color-card)] px-4 py-2 text-lg font-bold text-[var(--color-primary)]">
            <Clock className="h-5 w-5" />
            {due}
          </span>
        )}
      </div>
      <p className="text-xl font-semibold">
        {entry.taskCount} {entry.taskCount === 1 ? "task" : "tasks"}
      </p>
      <div className="mt-auto">
        <Button size="touch-lg" variant="secondary" onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : "Start"}
          {!busy && <ArrowRight />}
        </Button>
      </div>
    </div>
  )
}

// ─── In progress: dark sticky banner, remaining items under section headers ──

function InProgressPanel({
  checklist,
  entry,
  busy,
  person,
  onChangePerson,
  onTap,
  onSubmit,
  onSubmitPartial,
}: {
  checklist: TabletChecklist
  entry: TodayRow
  busy: string | null
  /** TAB-1b — the sticky person's name, or null when nobody is chosen yet. */
  person: string | null
  onChangePerson: () => void
  onTap: (t: TabletTask) => void
  onSubmit: () => void
  onSubmitPartial: () => void
}) {
  const [showDone, setShowDone] = useState(false)
  const all = checklist.sections.flatMap((s) => s.tasks)
  const total = all.length
  const doneTasks = all.filter((t) => t.done)
  const left = total - doneTasks.length
  const due = dueLabel(entry)
  const submitting = busy === `submit:${checklist.id}`
  // "Submit Opening checklist", not "Submit Mid-day checklist checklist".
  const submitName = checklist.name.replace(/\s+checklist\s*$/i, "")

  return (
    <>
      <div className="shrink-0 bg-[var(--color-foreground)] px-6 pb-5 pt-5 text-[var(--color-background)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-3xl font-extrabold tracking-tight">
            <span className="uppercase">{checklist.name}</span> · {doneTasks.length} of {total}
          </h2>
          <p className="text-lg font-semibold opacity-80">
            {left} left{due ? ` · ${due.charAt(0).toLowerCase()}${due.slice(1)}` : ""}
          </p>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--color-background)]/20">
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
            style={{ width: `${total ? (doneTasks.length / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* TAB-1b — the sticky person. Outside the scroll area, so it stays put
          under the banner while the list scrolls. */}
      {person && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-accent)] px-5 py-1">
          <p className="min-w-0 truncate text-lg text-[var(--color-foreground)]">
            Completing as <span className="font-bold">{person}</span>
          </p>
          <button
            type="button"
            onClick={onChangePerson}
            disabled={submitting}
            className="flex min-h-14 shrink-0 items-center px-3 text-lg font-semibold text-[var(--color-primary)] underline underline-offset-4 disabled:opacity-50"
          >
            Change
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 snap-y snap-proximity overflow-y-auto overscroll-contain">
        {doneTasks.length > 0 && (
          <div className="border-b border-[var(--color-border)]">
            <TouchRow onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="snap-start font-semibold">
              <span className="flex size-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)]">
                <Check className="h-5 w-5" />
              </span>
              {doneTasks.length} done
              <span className="ml-auto flex items-center gap-1 text-base text-[var(--color-muted-foreground)]">
                {showDone ? "Hide" : "Show"}
                <ChevronDown className={cn("h-5 w-5 transition-transform", showDone && "rotate-180")} />
              </span>
            </TouchRow>
            {showDone &&
              doneTasks.map((t) => (
                <TouchRow key={t.id} state="done" onClick={() => onTap(t)} title="Tap to undo" disabled={submitting}>
                  <span className="min-w-0 flex-1">{t.label}</span>
                  {t.value !== null && <span className="text-base no-underline">{t.value}°F</span>}
                  <TouchCheck checked />
                </TouchRow>
              ))}
          </div>
        )}

        {checklist.sections.map((s) => {
          const open = s.tasks.filter((t) => !t.done)
          if (open.length === 0) return null
          return (
            <div key={s.key}>
              <div className="sticky top-0 z-10 flex snap-start items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-muted)] px-5 py-2.5 text-base font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <span>{s.name}</span>
                <span>{open.length} left</span>
              </div>
              {open.map((t) => (
                <TouchRow key={t.id} size="roomy" onClick={() => onTap(t)} disabled={submitting}>
                  <span className={cn("min-w-0 flex-1", t.isCritical && "font-semibold text-[var(--color-destructive)]")}>
                    {t.label}
                  </span>
                  {t.requiresTemp && (
                    <span className="shrink-0 rounded-full border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-1 text-sm font-semibold text-[var(--color-warning-text)]">
                      Log °F
                    </span>
                  )}
                  <TouchCheck checked={false} />
                </TouchRow>
              ))}
            </div>
          )
        })}

        {/* Every item ticked and not yet submitted. Unticking any item makes
            `left` non-zero and the button goes away again. */}
        {total > 0 && left === 0 && (
          <div className="p-6">
            <Button size="touch-lg" onClick={onSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : `Submit ${submitName} checklist`}
            </Button>
          </div>
        )}

        {/* TAB-1b — partial submit: a quiet link while some but not all items
            are ticked. The big Submit above stays for the all-ticked case. */}
        {doneTasks.length > 0 && left > 0 && (
          <div className="flex justify-center px-6 py-4">
            <button
              type="button"
              onClick={onSubmitPartial}
              className="flex min-h-14 items-center px-3 text-lg font-semibold text-[var(--color-muted-foreground)] underline underline-offset-4"
            >
              Submit partial ({doneTasks.length} of {total})
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Done: calm green, with what's next ──────────────────────────────────────

function DonePanel({
  checklist,
  timeZone,
  upNext,
  onStartNext,
  busy,
  partial,
  onKeepGoing,
}: {
  checklist: TabletChecklist
  timeZone: string
  upNext: TodayRow | null
  onStartNext: (e: TodayRow) => void
  busy: string | null
  /** TAB-1b — set after a partial submit: the calm, not-green variant. */
  partial?: { done: number; total: number }
  /** TAB-1b — back to the In progress panel after a partial submit. */
  onKeepGoing?: () => void
}) {
  const all = checklist.sections.flatMap((s) => s.tasks)
  const finished = checklist.completedAt ? formatWindowTime(new Date(checklist.completedAt), timeZone) : null
  const nextDueNow = upNext && (upNext.lifecycleState === "active" || upNext.lifecycleState === "overdue")
  const nextDue = upNext ? dueLabel(upNext) : null

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center gap-6 overflow-y-auto overscroll-contain p-8 text-center",
        partial ? "bg-[var(--color-muted)]" : "bg-[var(--color-success-bg)]"
      )}
    >
      <span
        className={cn(
          "mt-4 flex size-24 shrink-0 items-center justify-center rounded-full",
          partial
            ? "border-4 border-[var(--color-muted-foreground)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]"
            : "bg-[var(--color-success)] text-[var(--color-primary-foreground)]"
        )}
      >
        <Check className="size-14" strokeWidth={3} />
      </span>
      <div>
        <h2 className="text-4xl font-extrabold text-[var(--color-foreground)]">
          {partial ? `Partial submitted · ${partial.done} of ${partial.total}` : `${checklist.name} done`}
        </h2>
        <p className="mt-2 text-xl text-[var(--color-muted-foreground)]">
          {/* Gary, 2026-11-09: partial submit stays at desktop parity, and day
              close still files any unfinished checklist Missed — so say so. */}
          {partial
            ? "Unfinished checklists are still marked Missed at day close."
            : `All ${all.length} tasks checked off${finished ? ` · finished ${finished}` : ""}`}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {checklist.sections.map((s) => (
          <span
            key={s.key}
            className={cn(
              "rounded-full border bg-[var(--color-card)] px-4 py-2 text-base font-semibold",
              partial
                ? "border-[var(--color-border)] text-[var(--color-foreground)]"
                : "border-[var(--color-success-border)] text-[var(--color-success-text)]"
            )}
          >
            {s.name} {s.tasks.filter((t) => t.done).length}/{s.tasks.length}
          </span>
        ))}
      </div>

      {upNext && (
        <div className="flex w-full max-w-md items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 text-left">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)]">
            <Clock className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">Up next</p>
            <p className="text-xl font-bold text-[var(--color-foreground)]">{upNext.name}</p>
            {nextDue && <p className="text-base text-[var(--color-muted-foreground)]">{nextDue}</p>}
          </div>
          {nextDueNow && (
            <Button size="touch" onClick={() => onStartNext(upNext)} disabled={busy === `start:${upNext.id}`}>
              Start
            </Button>
          )}
        </div>
      )}

      {partial && onKeepGoing && (
        <Button size="touch" variant="outline" onClick={onKeepGoing}>
          Keep working on it
        </Button>
      )}

      <Link
        href={`/store-view/checklist/${checklist.id}`}
        className={cn(
          "flex min-h-14 items-center text-lg font-semibold underline underline-offset-4",
          partial ? "text-[var(--color-foreground)]" : "text-[var(--color-success-text)]"
        )}
      >
        Review checked items
      </Link>
    </div>
  )
}

// ─── Value entry: a bottom sheet with a number pad (audit point 6) ───────────

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", "."]

function ValueSheet({
  task,
  onClose,
  onSave,
}: {
  task: TabletTask | null
  onClose: () => void
  onSave: (value: number) => void
}) {
  // Remounted per task (keyed by the caller), so it always opens empty.
  const [text, setText] = useState("")

  function press(k: string) {
    setText((t) => {
      if (k === "±") return t.startsWith("-") ? t.slice(1) : `-${t}`
      if (k === "." && t.includes(".")) return t
      if (t.replace("-", "").length >= 6) return t
      return t + k
    })
  }

  const value = Number(text)
  const valid = text !== "" && text !== "-" && text !== "." && text !== "-." && Number.isFinite(value)

  return (
    <BottomSheet open={!!task} onClose={onClose} title={task?.label ?? ""}>
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <p className="rounded-2xl bg-[var(--color-muted)] px-5 py-4 text-right text-5xl font-bold tabular-nums text-[var(--color-foreground)]">
          {text || <span className="text-[var(--color-muted-foreground)]">—</span>}
          <span className="ml-2 text-2xl text-[var(--color-muted-foreground)]">°F</span>
        </p>
        <div className="grid grid-cols-3 gap-3">
          {PAD.map((k) => (
            <Button key={k} size="touch" variant="outline" className="h-16 text-2xl" onClick={() => press(k)}>
              {k}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Button size="touch" variant="outline" className="h-16" aria-label="Delete" onClick={() => setText((t) => t.slice(0, -1))}>
            <Delete />
          </Button>
          <Button size="touch" className="col-span-2 h-16" disabled={!valid} onClick={() => valid && onSave(value)}>
            Save
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}

// ─── Overdue chip + the due list as a bottom sheet (ruling 7) ────────────────

function DueChip({ feed, storeId, onChanged }: { feed: DueItem[]; storeId: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [completing, setCompleting] = useState<string | null>(null)
  // TAB-5 ruling 3: the sheet open, or a Complete in flight, holds the refresh.
  useBusyFlag("due:sheet", open || completing !== null)

  // TAB-1c: the filter and count live in src/lib/tablet-due.ts (pinned by
  // scripts/verify-tab1c-due-chip.ts). Overdue is `dueAt <= now` — ruling 8 of
  // CAL-1, the banner's own rule.
  const nowIso = new Date().toISOString()
  const { items, overdue, label } = dueChipFor(feed, storeId, nowIso)
  if (!label) return null

  async function complete(id: string) {
    setCompleting(id)
    await fetch(`/api/calendar/occurrences/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null)
    setCompleting(null)
    await onChanged()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-14 items-center gap-2 rounded-full px-6 text-lg font-bold",
          overdue > 0
            ? "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
            : "border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
        )}
      >
        <AlertTriangle className="h-5 w-5" />
        {label}
        <ChevronRight className="h-5 w-5" />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Due at this store">
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-16 items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-[var(--color-foreground)]">{item.title}</p>
                <p className="text-base text-[var(--color-muted-foreground)]">
                  {item.categoryLabel}
                  {dueRowSuffix(item, nowIso)}
                </p>
              </div>
              {item.templateId ? (
                // CAL-2 ruling 3: a scheduled checklist completes by submitting
                // the checklist, so the row links there instead of ticking.
                item.checklistId ? (
                  <Button asChild size="touch" variant="outline">
                    <a href={`/store-view/checklist/${item.checklistId}`}>Open checklist</a>
                  </Button>
                ) : null
              ) : (
                <Button size="touch" variant="outline" onClick={() => void complete(item.id)} disabled={completing === item.id}>
                  {completing === item.id ? "Saving…" : "Complete"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  )
}

// ─── TAB-1c: the SELF-1 compliance banner, as a header chip ──────────────────
//
// TAB-1 dropped the desktop dashboard's ComplianceBanner (compliance-banner.tsx)
// from the tablet along with the calendar banner, and no ruling covered it, so a
// person's own overdue training or documents became invisible on the tablet.
// TAB-1c brings it back as a chip (Gary chose this over filing a row,
// 2026-11-10; DECISIONS DRAFT rider on the 2026-11-09 TAB-1 entry):
// the same endpoint, the same rule (renders only when the signed-in person owes
// something), the same words, the same colours (red when anything is overdue,
// amber otherwise), the same /my link, and no dismiss. A device login resolves
// to no staff member and the route answers owed: null, so it stays silent.
//
// TAB-5 — re-read on every refresh cycle (ruling 1). The answer replaces the
// chip: owing nothing now clears it. A failed read keeps what is showing.
function ComplianceChip() {
  const [owed, setOwed] = useState<OwedSummary | null>(null)
  const live = useRef(true)
  const load = useCallback(
    () =>
      fetchCard<{ owed: OwedSummary | null }>("my compliance", "/api/dashboard/my-compliance").then((data) => {
        if (live.current && data) setOwed(data.owed ?? null)
      }),
    []
  )
  useEffect(() => {
    live.current = true
    void load()
    return () => {
      live.current = false
    }
  }, [load])
  useRefreshLoader(load)

  if (!owed) return null
  const overdue = owed.overdueCount > 0
  const plural = owed.openCount === 1 ? "" : "s"

  return (
    <Link
      href="/my"
      aria-label={`${owed.openCount} outstanding training or document item${plural}. Go to your portal.`}
      className={cn(
        "flex min-h-14 items-center gap-2 rounded-full px-6 py-2",
        overdue
          ? "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
          : "border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
      )}
    >
      {overdue ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <GraduationCap className="h-5 w-5 shrink-0" />}
      <span className="min-w-0">
        <span className="block text-lg font-bold leading-tight">
          You have {owed.openCount} item{plural} to complete
          {overdue ? ` · ${owed.overdueCount} overdue` : ""}
        </span>
        {owed.nearestDueDate && (
          <span className="block text-sm opacity-90">
            Nearest due {formatInstant(owed.nearestDueDate, owed.timeZone, "monthDay")}
          </span>
        )}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0" />
    </Link>
  )
}
