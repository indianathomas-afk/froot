"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatLaborPct, judgeLaborPct, laborVerdictClass } from "@/lib/labor-judgment"
import { formatInstant } from "@/lib/display-time"
import { goalDetail, laborDetail, salesDetail, type StripSummary } from "@/lib/tablet-cards"
import { laborNoValueLabel } from "./labor-pct"
import { fetchCard } from "./card-fetch"

// TAB-3 — the Tablet stat strip, below the Tasks and Messages columns (ruling
// 4; moved here from TAB-2 by its ruling 1). Optional tiles, ADMIN-ordered and
// all off by default: Sales, Monthly Goal, Labor %.
//
// ONE EXISTING ENDPOINT, NO NEW ONE: GET /api/dashboard/summary?storeId= —
// the payload behind the desktop Monthly Goal card. Each tile shows the figure
// the desktop shows (audit § 2):
//   sales         sales.today.total = SalesPeriodCache.netSales for today, the
//                 Sales Performance card's "Today so far", with its ▲/▼ vs the
//                 same weekday last year (DeltaPill's formula).
//   monthly-goal  goal.monthToDate / goal.goalAmount, capped at 100% — the
//                 Monthly Goal card's "% of goal".
//   labor-pct     `labor`, MONTH-TO-DATE (audit F4) — the Monthly Goal card's
//                 "<Month> labor %" line, judged the same way.
//
// PERMISSIONS ARE THE PAYLOAD'S (ruling 5). The route 403s a store this login
// isn't assigned to. `labor` is ABSENT unless the overlay is on and the viewer
// holds labor.actuals.view (AL-2), so the Labor tile has nothing to render for
// anyone who couldn't see labor % on desktop. Sales has no capability gate on
// desktop either; it hides only when the store has no sales (no Square link /
// Inventory module — audit F8). A goal that isn't set reads "No goal set"
// (F9), as the desktop card does. If no enabled tile survives, the strip
// renders nothing at all.
//
// LIVE: the Messages column's timer (TAB-2 ruling 8) — every
// TABLET_REFRESH_MS while visible, at once on becoming visible again, never
// while hidden. A failed refresh keeps the numbers on screen (BUG-6's rule:
// never flip real numbers into an error state).
// ── TAB-5, 2026-11-10: the strip no longer runs its own timer; the tablet
// home's one refresh controller (./tablet-refresh.tsx) runs `load` on its
// cycle, under the same rule, and skips the cycle while the page is busy.

// ── TAB-9, 2026-11-10 — appended; "the strip" above is now three parts. The
// fetch is useStripSummary (TabletHome owns it, because the tile row sits at
// the bottom of the first screen while an expanded card's detail opens BELOW
// that screen, and both read the same payload). StripRow is the row, each
// tile looking exactly as before until tapped (ruling 2); StripDetail is the
// expanded card (ruling 5), built from src/lib/tablet-cards.ts out of this
// same payload — nothing new is fetched. A tile its gate hides (labor absent)
// has no card at all, collapsed or expanded. Expansion is TabletHome's React
// state only (ruling 7). The whole-cycle refresh still runs `load`, through
// TabletHome's controller.

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

/** The strip's payload for `storeId`. `register` adds the re-read to the
 *  TAB-5 refresh cycle. Disabled (no tiles enabled) it fetches nothing, so a
 *  strip that is off costs nothing — as before. A failed re-read keeps what
 *  is showing (BUG-6). */
export function useStripSummary(
  storeId: string,
  enabled: boolean,
  register: (load: () => Promise<unknown>) => () => void
): StripSummary | null {
  const [res, setRes] = useState<{ storeId: string; data: StripSummary } | null>(null)

  const load = useCallback((): Promise<void> => {
    if (!enabled || !storeId) return Promise.resolve()
    return fetchCard<StripSummary>("tablet strip", `/api/dashboard/summary?storeId=${storeId}`).then((data) => {
      if (data) setRes({ storeId, data })
    })
  }, [storeId, enabled])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => register(load), [register, load])

  return enabled && res && res.storeId === storeId ? res.data : null
}

/** The keys of the tiles this viewer actually gets, in the admin's order. */
export function renderedTileKeys(tiles: string[], data: StripSummary | null): string[] {
  if (!data) return []
  return tiles.filter((t) => tile(t, data) !== null)
}

export function StripRow({
  data,
  tiles,
  expanded,
  onTap,
}: {
  data: StripSummary | null
  tiles: string[]
  /** The expanded tile's key (already checked against what renders). */
  expanded: string | null
  onTap: (key: string) => void
}) {
  // NO SKELETON, deliberately (Gary, 2026-11-10: "When no stat-strip tile is
  // visible to the viewer, render no strip container (no gap)"). Which tiles
  // this viewer may see is only known from the payload, so a placeholder
  // would show a strip to someone who then gets none. Before the first answer,
  // and if it never comes, there is no strip at all.
  if (!data) return null

  const rendered = tiles.map((t) => tile(t, data)).filter((x): x is NonNullable<typeof x> => x !== null)
  if (rendered.length === 0) return null

  return (
    <div className="flex shrink-0 gap-3">
      {rendered.map((r) => {
        const open = expanded === r.key
        return (
          <button
            type="button"
            key={r.key}
            onClick={() => onTap(r.key)}
            aria-expanded={open}
            aria-controls="tablet-card-detail"
            className={cn(
              "flex min-h-[72px] flex-1 items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-3 text-left",
              open && "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30"
            )}
          >
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{r.label}</p>
            <div className="flex items-baseline gap-2 text-right">
              <span className={cn("text-2xl font-extrabold text-[var(--color-foreground)]", r.valueClass)}>{r.value}</span>
              {r.aside}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** The expanded card, below the first screen. Renders nothing for a key whose
 *  tile does not render for this viewer. */
export function StripDetail({
  data,
  expanded,
  onShowLess,
}: {
  data: StripSummary
  expanded: string
  onShowLess: () => void
}) {
  const head = tile(expanded, data)
  if (!head) return null
  let body: React.ReactNode = null
  if (expanded === "sales") body = <SalesBody data={data} />
  else if (expanded === "monthly-goal") body = <GoalBody data={data} />
  else if (expanded === "labor-pct") body = <LaborBody data={data} />
  if (!body) return null

  return (
    <section
      id="tablet-card-detail"
      aria-label={`${head.label} details`}
      className="rounded-3xl border-2 border-[var(--color-primary)]/40 bg-[var(--color-card)] p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-[var(--color-foreground)]">{head.label}</h2>
          <span className={cn("text-2xl font-extrabold text-[var(--color-foreground)]", head.valueClass)}>{head.value}</span>
          {head.aside}
        </div>
        <Button size="touch" variant="outline" onClick={onShowLess}>
          <ChevronUp className="h-5 w-5" /> Show less
        </Button>
      </div>
      {body}
    </section>
  )
}

function DetailRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <span className="text-lg text-[var(--color-muted-foreground)]">{label}</span>
      <span className={cn("text-xl font-bold text-[var(--color-foreground)]", valueClass)}>{value}</span>
    </div>
  )
}

function SalesBody({ data }: { data: StripSummary }) {
  const d = salesDetail(data)
  if (!d) return null
  const lyDay = d.lastYearDate
    ? new Date(`${d.lastYearDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null
  return (
    <div>
      <DetailRow label="Today so far" value={usd(d.todayTotal)} />
      <DetailRow
        label={lyDay ? `Same weekday last year (${lyDay}), whole day` : "Same weekday last year"}
        value={d.lastYearTotal === null ? "No sales recorded" : usd(d.lastYearTotal)}
      />
      <h3 className="mt-5 mb-2 text-lg font-bold text-[var(--color-foreground)]">Hour by hour</h3>
      {d.hours.length === 0 ? (
        <p className="text-lg text-[var(--color-muted-foreground)]">No hourly sales yet today.</p>
      ) : (
        <div role="table" aria-label="Sales hour by hour, today against last year">
          <div role="row" className="grid grid-cols-[6rem_minmax(0,1fr)_7rem_7rem] items-center gap-3 pb-2 text-base font-semibold text-[var(--color-muted-foreground)]">
            <span role="columnheader">Hour</span>
            <span role="columnheader" className="flex items-center gap-4">
              <Legend className="bg-[var(--color-primary)]" label="Today" />
              <Legend className="bg-[var(--color-muted-foreground)]/40" label="Last year" />
            </span>
            <span role="columnheader" className="text-right">Today</span>
            <span role="columnheader" className="text-right">Last year</span>
          </div>
          {d.hours.map((h) => (
            <div
              role="row"
              key={h.hour}
              className="grid min-h-14 grid-cols-[6rem_minmax(0,1fr)_7rem_7rem] items-center gap-3 border-t border-[var(--color-border)] py-1.5"
            >
              <span role="cell" className="text-lg font-semibold text-[var(--color-foreground)]">{h.label}</span>
              <span role="cell" className="flex flex-col gap-1" aria-hidden="true">
                <Bar value={h.today} max={d.max} className="bg-[var(--color-primary)]" />
                <Bar value={h.lastYear} max={d.max} className="bg-[var(--color-muted-foreground)]/40" />
              </span>
              <span role="cell" className="text-right text-lg font-bold text-[var(--color-foreground)]">{h.today === null ? "—" : usd(h.today)}</span>
              <span role="cell" className="text-right text-lg text-[var(--color-muted-foreground)]">{h.lastYear === null ? "—" : usd(h.lastYear)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", className)} />
      {label}
    </span>
  )
}

function Bar({ value, max, className }: { value: number | null; max: number; className: string }) {
  const pct = value === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <span className="block h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-muted)]">
      <span className={cn("block h-full rounded-full", className)} style={{ width: `${pct.toFixed(1)}%` }} />
    </span>
  )
}

function GoalBody({ data }: { data: StripSummary }) {
  const d = goalDetail(data)
  if (d.kind === "no-goal") {
    return (
      <div>
        <DetailRow label="Month to date" value={usd(d.monthToDate)} />
        <p className="mt-3 text-lg text-[var(--color-muted-foreground)]">No goal set for {d.month} yet.</p>
      </div>
    )
  }
  return (
    <div>
      <DetailRow label="Month to date" value={usd(d.monthToDate)} />
      <DetailRow label={`${d.month} goal`} value={usd(d.goalAmount)} />
      <DetailRow label="Still to go" value={usd(d.toGo)} />
      <DetailRow
        label={d.daysLeft > 0 ? `Needed per remaining day (${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left)` : "Needed per remaining day"}
        value={d.toGo === 0 ? "Goal reached" : d.perDayNeeded === null ? `Last day of ${d.month}` : usd(d.perDayNeeded)}
      />
    </div>
  )
}

function LaborBody({ data }: { data: StripSummary }) {
  const d = laborDetail(data)
  if (!d) return null
  const tz = data.store?.timezone
  return (
    <div>
      <DetailRow label="Month-to-date labor" value={d.pct} valueClass={laborVerdictClass(d.verdict)} />
      <DetailRow label="Target" value={d.target} />
      <DetailRow
        label="Last synced"
        value={d.lastSyncOkAt ? (tz ? formatInstant(d.lastSyncOkAt, tz, "monthDayTime") : new Date(d.lastSyncOkAt).toLocaleString("en-US")) : "Never"}
      />
      {d.notes.length > 0 && (
        <ul className="mt-4 space-y-2">
          {d.notes.map((n, i) => (
            <li
              key={i}
              className={cn(
                "text-lg",
                n.tone === "warn" ? "text-[var(--color-warning-text,#a36a00)]" : "text-[var(--color-muted-foreground)]"
              )}
            >
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Tile = { key: string; label: string; value: string; valueClass?: string; aside?: React.ReactNode }

function tile(key: string, s: StripSummary): Tile | null {
  switch (key) {
    case "sales": {
      if (!s.salesAvailable || !s.sales) return null
      const today = s.sales.today.total
      const ly = s.sales.lastYear?.total ?? null
      // DeltaPill (sales-performance-card.tsx): hidden without a positive baseline.
      const delta = ly && ly > 0 ? ((today - ly) / ly) * 100 : null
      return {
        key,
        label: "Sales today",
        value: usd(today),
        aside:
          delta === null ? undefined : (
            <span
              className={cn(
                "text-sm font-bold",
                delta >= 0 ? "text-[var(--color-success-text,#1d7c2e)]" : "text-[var(--color-warning-text,#a36a00)]"
              )}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </span>
          ),
      }
    }
    case "monthly-goal": {
      const month = new Date(`${s.goal.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
      if (s.goal.goalAmount === null) {
        return { key, label: `${month} goal`, value: "No goal set", valueClass: "text-lg font-semibold text-[var(--color-muted-foreground)]" }
      }
      const pct = Math.min(1, (s.goal.monthToDate ?? 0) / s.goal.goalAmount)
      return { key, label: `${month} goal`, value: `${(pct * 100).toFixed(0)}%` }
    }
    case "labor-pct": {
      // Absent = a gate is off for this viewer: no tile, not an empty one.
      if (!s.labor) return null
      const block = s.labor
      const verdict = judgeLaborPct(block.laborPct, block.target, block.health)
      const note = laborNoValueLabel(block)
      // Month-named, as the desktop's "<Month> labor %" line is, so a
      // month-to-date number never reads as today's (audit F4).
      const month = new Date(`${s.goal.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
      return {
        key,
        label: `${month} labor`,
        value: formatLaborPct(block.laborPct),
        valueClass: laborVerdictClass(verdict),
        aside: (
          <span className="whitespace-nowrap text-sm text-[var(--color-muted-foreground)]">
            {note || `target ${block.target}%`}
          </span>
        ),
      }
    }
    default:
      return null
  }
}
