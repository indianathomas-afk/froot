"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CalendarClock, Check } from "lucide-react"

// ── CAL-1: THE DUE-REMINDER BANNER ───────────────────────────────────────────
//
// Mounts on /dashboard and on /checklists (the NAV-1 "Daily Tasks" target — the
// two places STORE and STAFF actually land).
//
// IT LIVES IN src/components/, NOT BESIDE A PAGE. SELF-1's banner sits under
// (app)/dashboard/ because it renders on one page. This one renders on two, and
// a client component imported across route folders from a sibling page
// directory is the exact shape CLAUDE.md § "Verifying a guard covers every
// path" records: HR-11j's uncovered ceremony route was a shared client imported
// across a route-group boundary, and the guard had been built on the page that
// OWNED the client. A shared component belongs somewhere neither page owns.
//
// REUSES SELF-1'S SHELL AND NOT ITS DATA. The bar, icon, semibold line and
// `text-xs opacity-90` subline are copied from compliance-banner.tsx so the two
// banners read as one system when they stack. The data path is deliberately
// different: SELF-1 goes through getActiveStaffSelf(), which is an HR gate that
// resolves a STAFF MEMBER, and a calendar occurrence is scoped to a STORE.
//
// NO RESERVED SLOT. It arrives a beat after paint and pushes the page down once
// when it does. SELF-1 considered reserving the slot and rejected it — most
// people owe nothing, so a reserved slot is a permanent empty gap at the top of
// almost every dashboard in the org. A second banner reserving one would
// reintroduce exactly the gap that argument rejected. Named here so it is not
// later filed as a layout bug.
//
// NO DISMISS CONTROL, deliberately, as in SELF-1: it clears when the work is
// done and on nothing else.

type DueItem = {
  id: string
  title: string
  category: string
  categoryLabel: string
  priority: string
  storeId: string
  storeName: string
  dueAt: string
  daysOverdue: number
}

type DueResponse = {
  items: DueItem[]
  earliestDueAt: string | null
  overdueCount: number
  maxDaysOverdue: number
}

export function CalendarDueBanner() {
  const [data, setData] = useState<DueResponse | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)
  const [caughtUp, setCaughtUp] = useState(false)
  // Whether this session has ever SEEN something due. The "all caught up" state
  // fires only on a non-empty → empty TRANSITION, so a first load with nothing
  // due renders nothing at all rather than congratulating someone for a list
  // they never had.
  const hadItems = useRef(false)

  async function load(): Promise<DueResponse | null> {
    try {
      const res = await fetch("/api/calendar/due", { signal: AbortSignal.timeout(12_000) })
      // 404 is the module being off (ruling 9) — silence, not an error.
      if (!res.ok) {
        if (res.status !== 404) console.error(`[calendar] due feed failed: HTTP ${res.status}`)
        return null
      }
      return (await res.json()) as DueResponse
    } catch (err) {
      console.error("[calendar] due feed fetch error:", err)
      return null
    }
  }

  useEffect(() => {
    let live = true
    load().then((d) => {
      if (!live || !d) return
      if (d.items.length > 0) hadItems.current = true
      setData(d)
    })
    return () => {
      live = false
    }
  }, [])

  async function complete(id: string) {
    setCompleting(id)
    const res = await fetch(`/api/calendar/occurrences/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null)
    setCompleting(null)
    // A 409 means somebody else got there first — the right response is to
    // re-read, not to argue with the floor about who tapped first.
    if (!res?.ok && res?.status !== 409) return

    const next = await load()
    if (!next) return
    if (next.items.length === 0 && hadItems.current) {
      setCaughtUp(true)
      // ~3s, then clear. The success state is a moment, not furniture.
      setTimeout(() => {
        setCaughtUp(false)
        setData(next)
      }, 3000)
    }
    setData(next)
  }

  if (caughtUp) {
    return (
      <div
        className="cal-caught-up mb-6 flex items-center gap-3 rounded-lg border px-5 py-4 bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]"
        role="status"
      >
        <Check className="h-5 w-5 shrink-0" />
        <p className="text-sm font-semibold">You&apos;re all caught up</p>
      </div>
    )
  }

  // Nothing due, or the feed refused (module off, no store scope, a failed
  // load): render nothing. Identical to SELF-1's single `if (!owed) return null`.
  if (!data || data.items.length === 0) return null

  const overdue = data.overdueCount > 0
  const plural = data.items.length === 1 ? "" : "s"
  // "1 day overdue", never "1 days overdue".
  const dayWord = data.maxDaysOverdue === 1 ? "day" : "days"

  return (
    <div
      // THE SINGLE PULSE, OVERDUE STATE ONLY. A banner for work merely due today
      // does not move — the pulse is the escalation, and spending it on the
      // ordinary case is how it stops meaning anything. One run, keyframe in
      // globals.css, and it cannot loop.
      className={`${overdue ? "cal-pulse-once" : ""} mb-6 rounded-lg border px-5 py-4 ${
        overdue
          ? "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] border-transparent"
          : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]"
      }`}
      role="status"
    >
      <div className="flex items-center gap-3">
        {overdue ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CalendarClock className="h-5 w-5 shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {data.items.length} reminder{plural} due
          </p>
          {overdue && data.maxDaysOverdue > 0 && (
            <p className="text-xs opacity-90">
              <strong className="font-bold">
                {data.maxDaysOverdue} {dayWord} overdue
              </strong>
            </p>
          )}
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {data.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-3 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-cal-${item.category})` }}
              />
              <span className="truncate">
                {item.title}
                <span className="opacity-80">
                  {" "}
                  · {item.storeName} · {item.categoryLabel}
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => complete(item.id)}
              disabled={completing === item.id}
              // ≥44px tap target — the floor completes these on a phone
              // (§ Design System: checklist execution surfaces are mobile-first).
              className="min-h-[44px] shrink-0 rounded-md border border-current/40 px-3 text-xs font-medium disabled:opacity-60"
            >
              {completing === item.id ? "Saving…" : "Complete"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
