"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Clock, Delete } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { TouchCheck, TouchRow } from "@/components/ui/touch-row"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatWindowTime } from "@/lib/checklist-status-display"
import { resolveSingleStore, saveStoreId, useSavedStoreId } from "@/lib/dashboard-store"
import { pickTodayChecklist, type TodayEntry } from "@/lib/tablet-today"
import { fetchCard } from "./card-fetch"
import { TeamMessagesCard, type Comms } from "./dashboard-client"
import type { TabletChecklist, TabletStore, TabletTask } from "./tablet-data"

// TAB-1 — the tablet home on /dashboard (Direction 1 · Status Stage).
//
// Left: the Tasks panel — Not started / In progress / Done. Right: the existing
// Team Messages card, unchanged (TAB-2 replaces it). No Sales, Goal or Labor
// (Gary's ruling 4). Each column scrolls on its own; the page does not.
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

type Override = { done: boolean; value: number | null }

async function readError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === "string" ? body.error : null
  } catch {
    return null
  }
}

export function TabletHome({ stores, checklists }: { stores: TabletStore[]; checklists: TabletChecklist[] }) {
  const router = useRouter()
  const savedStoreId = useSavedStoreId()
  const store = resolveSingleStore(stores, savedStoreId)
  const storeId = store?.id ?? ""

  // ── Today's checklists for this store (the Start Daily Checklist list) ──
  const [today, setToday] = useState<{ storeId: string; rows: TodayRow[] | null } | null>(null)
  // Promise chains rather than async/await so every setState sits in a
  // callback — the same shape the desktop dashboard's loaders use.
  const loadToday = useCallback((): Promise<void> => {
    if (!storeId) return Promise.resolve()
    return fetch(`/api/stores/${storeId}/templates`)
      .then((res) => (res.ok ? (res.json() as Promise<TodayRow[]>) : null))
      .catch(() => null)
      .then((rows) => setToday({ storeId, rows }))
  }, [storeId])

  // ── Team Messages (the desktop card's own endpoint) ──
  const [comms, setComms] = useState<{ storeId: string; data: Comms | null } | null>(null)
  const loadComms = useCallback(() => {
    if (!storeId) return
    fetchCard<Comms>("comms", `/api/dashboard/comms?storeId=${storeId}`).then((data) => setComms({ storeId, data }))
  }, [storeId])

  // ── The due feed behind the calendar banner ──
  const [due, setDue] = useState<DueItem[] | null>(null)
  const loadDue = useCallback((): Promise<void> => {
    return fetch("/api/calendar/due", { signal: AbortSignal.timeout(12_000) })
      .then((res) => (res.ok ? (res.json() as Promise<{ items: DueItem[] }>) : { items: [] }))
      .catch(() => ({ items: [] as DueItem[] }))
      .then((body) => setDue(body.items))
  }, [])

  useEffect(() => {
    void loadToday()
    loadComms()
  }, [loadToday, loadComms])
  useEffect(() => {
    void loadDue()
  }, [loadDue])

  /** After a write that changes which checklist is current: re-read the list,
   *  and re-render the server half for the new row's items / completedAt. */
  const refresh = useCallback(async () => {
    await loadToday()
    router.refresh()
  }, [loadToday, router])

  const rows = today && today.storeId === storeId ? today.rows : undefined
  const commsData = comms && comms.storeId === storeId ? comms.data : null
  const commsLoading = !!storeId && (comms === null || comms.storeId !== storeId)
  const commsFailed = !commsLoading && commsData === null
  const checklistsById = useMemo(() => new Map(checklists.map((c) => [c.id, c])), [checklists])

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
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          {stores.length > 1 ? (
            <Select value={store.id} onValueChange={saveStoreId}>
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
        <DueChip items={(due ?? []).filter((i) => i.storeId === store.id)} onChanged={loadDue} />
      </header>

      <div className="grid min-h-0 gap-4 landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] portrait:grid-rows-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)]">
          <TasksPanel
            key={store.id}
            store={store}
            rows={rows}
            checklistsById={checklistsById}
            onRetry={() => void loadToday()}
            onChanged={refresh}
          />
        </section>
        <section className="min-h-0 overflow-y-auto overscroll-contain rounded-3xl">
          <TeamMessagesCard loading={commsLoading} failed={commsFailed} onRetry={loadComms} comms={commsData} />
        </section>
      </div>
    </div>
  )
}

// ─── Tasks panel ──────────────────────────────────────────────────────────────

function TasksPanel({
  store,
  rows,
  checklistsById,
  onRetry,
  onChanged,
}: {
  store: TabletStore
  /** undefined = loading, null = the list failed to load. */
  rows: TodayRow[] | null | undefined
  checklistsById: Map<string, TabletChecklist>
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
      setError(null)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function toggle(c: TabletChecklist, task: TabletTask, value: number | null = null) {
    const key = `${c.id}:${task.id}`
    const next: Override = task.done ? { done: false, value: null } : { done: true, value }
    const prior = overridesRef.current[key]
    setOverrides((prev) => ({ ...prev, [key]: next }))
    overridesRef.current = { ...overridesRef.current, [key]: next }
    setError(null)
    let res: Response
    try {
      res = await fetch(`/api/checklists/${c.id}/task-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Ruling 6: posts as the logged-in account, no per-person name.
        body: JSON.stringify({ taskId: task.id, completedByStaffId: null, temperatureValue: next.done ? value : null }),
      })
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

  // ── Which state ──
  const finishedRow = justFinished ? checklistsById.get(justFinished) : undefined
  const finishedEntry = justFinished ? rows.find((r) => r.existingChecklistId === justFinished) : undefined

  let body: React.ReactNode
  if (finishedRow && finishedEntry) {
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
      body = (
        <InProgressPanel
          checklist={view}
          entry={entry}
          busy={busy}
          onTap={(t) => {
            if (!t.done && t.requiresTemp) setValueFor({ checklistId: view.id, task: t })
            else void toggle(view, t)
          }}
          onSubmit={() => void submit(view)}
        />
      )
    } else {
      body = <NotStartedPanel entry={entry} busy={busy === `start:${entry.id}`} onStart={() => void start(entry)} />
    }
  }

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
          if (c && target) void toggle(c, target.task, v)
        }}
      />
    </>
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
  onTap,
  onSubmit,
}: {
  checklist: TabletChecklist
  entry: TodayRow
  busy: string | null
  onTap: (t: TabletTask) => void
  onSubmit: () => void
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
}: {
  checklist: TabletChecklist
  timeZone: string
  upNext: TodayRow | null
  onStartNext: (e: TodayRow) => void
  busy: string | null
}) {
  const all = checklist.sections.flatMap((s) => s.tasks)
  const finished = checklist.completedAt ? formatWindowTime(new Date(checklist.completedAt), timeZone) : null
  const nextDueNow = upNext && (upNext.lifecycleState === "active" || upNext.lifecycleState === "overdue")
  const nextDue = upNext ? dueLabel(upNext) : null

  return (
    <div className="flex flex-1 flex-col items-center gap-6 overflow-y-auto overscroll-contain bg-[var(--color-success-bg)] p-8 text-center">
      <span className="mt-4 flex size-24 shrink-0 items-center justify-center rounded-full bg-[var(--color-success)] text-[var(--color-primary-foreground)]">
        <Check className="size-14" strokeWidth={3} />
      </span>
      <div>
        <h2 className="text-4xl font-extrabold text-[var(--color-foreground)]">{checklist.name} done</h2>
        <p className="mt-2 text-xl text-[var(--color-muted-foreground)]">
          All {all.length} tasks checked off{finished ? ` · finished ${finished}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {checklist.sections.map((s) => (
          <span
            key={s.key}
            className="rounded-full border border-[var(--color-success-border)] bg-[var(--color-card)] px-4 py-2 text-base font-semibold text-[var(--color-success-text)]"
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

      <Link
        href={`/store-view/checklist/${checklist.id}`}
        className="flex min-h-14 items-center text-lg font-semibold text-[var(--color-success-text)] underline underline-offset-4"
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

function DueChip({ items, onChanged }: { items: DueItem[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [completing, setCompleting] = useState<string | null>(null)
  if (items.length === 0) return null

  // Overdue is `dueAt <= now` — ruling 8 of CAL-1, the banner's own rule.
  const nowIso = new Date().toISOString()
  const overdue = items.filter((i) => i.dueAt <= nowIso).length

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
        {overdue > 0 ? `${overdue} overdue` : `${items.length} due`}
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
                  {item.dueAt <= nowIso
                    ? item.daysOverdue > 0
                      ? ` · ${item.daysOverdue} ${item.daysOverdue === 1 ? "day" : "days"} overdue`
                      : " · overdue"
                    : " · due today"}
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
