import { prisma } from "@/lib/prisma"
import { dbDate, localDateStr } from "@/lib/reports"
import { dayCloseJudgesChecklist } from "@/lib/calendar"
import {
  checklistState,
  dayCloseAppliesTo,
  dayCloseInstant,
  hoursForDate,
  isCompletedLate,
  shiftDateStr,
  type DayCloseSource,
  type HoursRow,
} from "@/lib/checklist-lifecycle"
import { frozenWindow } from "@/lib/checklist-status-display"

// ─── The operations report's computation (CHK-5, R4), as a library ──────────
//
// MOVED HERE BY NOTIFY-4 (Tasks and Communication email), F9 — Gary,
// 2026-11-06: "Use the Operations Report's definition: Daily checklists,
// store-local day. Move it into src/lib/ and point /reports/operations at it.
// Leave /reports alone and file a ROW to reconcile the two."
//
// The body below is getOperationsData()'s from
// src/app/(app)/reports/operations/page.tsx, MOVED, NOT REWRITTEN. What changed
// is only the inputs: the page resolved the org, the viewer's store scope and
// the date range from the session and the URL; this function takes them as
// arguments, so the page and the email cron call ONE definition (DEBT-26). The
// page still does auth, scoping and URL parsing, and nothing else.
//
// EVERY STATE COMES FROM src/lib/checklist-lifecycle.ts (the page's CHK-5
// header, which stays on the page):
//   missed          → checklistState(...) === "missed"
//   completed late  → isCompletedLate(row)
//   tracked at all  → dayCloseJudgesChecklist(dayCloseAppliesTo(frequency), calendarOccurrenceId)
//   window          → frozenWindow(row)
//   day close       → dayCloseInstant(...).source

export interface OperationsBucket {
  key: string
  label: string
  /** Only set on the by-store view — the day-close provenance column. */
  sub?: string
  total: number
  completed: number
  completedLate: number
  missed: number
  noWindow: number
}

export function emptyBucket(key: string, label: string): OperationsBucket {
  return { key, label, total: 0, completed: 0, completedLate: 0, missed: 0, noWindow: 0 }
}

/** Completed ÷ tracked, rounded to a whole percent; null when nothing was tracked. */
export function completionPct(b: OperationsBucket): number | null {
  return b.total > 0 ? Math.round((b.completed / b.total) * 100) : null
}

/** "Mon, Aug 10" for a store-local date string, rendered in UTC so the label
 *  cannot drift a day against `Checklist.date`'s UTC-midnight convention. */
export function dayLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateStr}T00:00:00.000Z`))
}

/**
 * WHY A STORE'S DAY ENDED WHEN IT DID, summarised over the range — the second
 * visible fallback signal, handed over by CHK-3 ("the two VISIBLE signals — a
 * note on /stores, a column on the operations report — are CHK-4/CHK-5 surface
 * work, and they read this").
 *
 * It is computed per DATE rather than read off the checklist row because there
 * is no `dayCloseSource` column: the engine exposes the fact queryably through
 * `dayCloseInstant()`, and asking it here is reading the engine, not copying it.
 *
 * The three fallback reasons are kept apart exactly as the lib keeps them apart
 * — "you marked Sunday closed" and "nobody has ever set this store's hours" are
 * different facts, and merging them tells an operator to fix something they
 * already did.
 */
export function dayCloseSummary(hours: HoursRow[], dates: string[], timeZone: string): string {
  const counts = new Map<DayCloseSource, number>()
  for (const d of dates) {
    const source = dayCloseInstant(hoursForDate(hours, d), d, timeZone).source
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  const fallbackDays = dates.length - (counts.get("hours") ?? 0)
  if (fallbackDays === 0) return "Store hours"

  const reason = counts.get("no-hours")
    ? "hours not set"
    : counts.get("no-close-time")
      ? "no closing time"
      : "closed days"
  return fallbackDays === dates.length
    ? `Midnight fallback — ${reason}`
    : `Midnight fallback ${fallbackDays}/${dates.length} days — ${reason}`
}

export type OperationsStore = { id: string; name: string; timezone: string }

export type OperationsReport = {
  totals: OperationsBucket
  byStore: Map<string, OperationsBucket>
  byDay: Map<string, OperationsBucket>
  byTemplate: Map<string, OperationsBucket>
  /** Rows the report will NOT judge (unscheduled non-Daily), counted not hidden. */
  excludedUnscheduled: number
  /** Names of stores in scope running on the midnight day-close fallback. */
  fallbackStores: string[]
  dates: string[]
}

/**
 * The operations report over `stores` (already scoped by the caller — this
 * function never widens or narrows them) for the store-local dates `from`..`to`
 * inclusive, judged at `now`. One instant for the whole computation (the
 * /checklists precedent): taking `new Date()` per row would let two rows be
 * judged against different "now"s.
 */
export async function computeOperationsReport(args: {
  organizationId: string
  stores: OperationsStore[]
  from: string
  to: string
  now: Date
}): Promise<OperationsReport> {
  const { organizationId, stores: scopedStores, from, to, now } = args

  const dates: string[] = []
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) dates.push(d)

  const scopedIds = scopedStores.map((s) => s.id)
  const [checklists, hoursRows] = await Promise.all([
    prisma.checklist.findMany({
      where: {
        organizationId,
        storeId: { in: scopedIds },
        // Checklist.date is the UTC-midnight stamp of a STORE-LOCAL day
        // (src/lib/reports.ts dbDate/businessDayWindow), so a plain range over
        // the two date strings is timezone-free and needs no per-store OR.
        date: { gte: dbDate(from), lte: dbDate(to) },
      },
      select: {
        id: true,
        date: true,
        status: true,
        closedAt: true,
        completedLate: true,
        expectedStartAt: true,
        expectedEndAt: true,
        storeId: true,
        templateId: true,
        // CAL-2, ruling 4. The gate this page asks is now "Daily OR scheduled",
        // the same one day close asks — so the link has to be selected here too.
        calendarOccurrenceId: true,
        template: { select: { name: true, frequency: true } },
      },
    }),
    prisma.storeHours.findMany({
      where: { storeId: { in: scopedIds } },
      select: { storeId: true, dayOfWeek: true, openingTime: true, closingTime: true, isClosed: true },
    }),
  ])

  const hoursByStore = new Map<string, HoursRow[]>()
  for (const r of hoursRows) hoursByStore.set(r.storeId, [...(hoursByStore.get(r.storeId) ?? []), r])

  const byStore = new Map<string, OperationsBucket>()
  const byDay = new Map<string, OperationsBucket>()
  const byTemplate = new Map<string, OperationsBucket>()
  const totals = emptyBucket("all", "All")

  // Rows the report will NOT judge, counted so the exclusion is a number on the
  // page rather than an absence. DEBT-61 was the open row behind it; the page
  // says so in plain words and never cites the row on screen.
  //
  // ── CAL-2 RENAMED THIS FROM `excludedNonDaily`, AND THE RENAME IS THE POINT
  // It no longer counts non-Daily rows: it counts UNSCHEDULED ones. A weekly
  // template that has been added to the calendar is tracked here in full, and
  // its rows land in every tile and both tables. What is still excluded is a
  // weekly or monthly template NOBODY HAS SCHEDULED — pre-CAL-2 litter, plus
  // anything generated before this phase. "A name is not evidence of what it
  // counts" is this engine's own recorded lesson (checklist-lifecycle.ts), and
  // leaving the old name on the new meaning is exactly how that fires.
  let excludedUnscheduled = 0

  for (const c of checklists) {
    if (!dayCloseJudgesChecklist(dayCloseAppliesTo(c.template.frequency), c.calendarOccurrenceId)) {
      excludedUnscheduled++
      continue
    }

    const window = frozenWindow(c)
    const state = checklistState(c, window, now)
    const late = isCompletedLate(c)
    const dayStr = localDateStr(c.date, "UTC")
    const store = scopedStores.find((s) => s.id === c.storeId)

    const targets = [
      totals,
      byStore.get(c.storeId) ?? byStore.set(c.storeId, emptyBucket(c.storeId, store?.name ?? "Unknown store")).get(c.storeId)!,
      byDay.get(dayStr) ?? byDay.set(dayStr, emptyBucket(dayStr, dayLabel(dayStr))).get(dayStr)!,
      byTemplate.get(c.templateId) ?? byTemplate.set(c.templateId, emptyBucket(c.templateId, c.template.name)).get(c.templateId)!,
    ]
    for (const b of targets) {
      b.total++
      if (state === "completed") b.completed++
      if (state === "missed") b.missed++
      if (late) b.completedLate++
      if (window === null) b.noWindow++
    }
  }

  // The day-close provenance column, per store, over the selected range.
  for (const s of scopedStores) {
    const bucket = byStore.get(s.id)
    if (bucket) bucket.sub = dayCloseSummary(hoursByStore.get(s.id) ?? [], dates, s.timezone)
  }

  // Which stores in scope are running on the midnight fallback — the third
  // disclosure, named rather than left for the reader to spot in a column.
  const fallbackStores = scopedStores
    .filter((s) => dayCloseSummary(hoursByStore.get(s.id) ?? [], dates, s.timezone) !== "Store hours")
    .map((s) => s.name)

  return { totals, byStore, byDay, byTemplate, excludedUnscheduled, fallbackStores, dates }
}
