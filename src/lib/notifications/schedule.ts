// ─── NOTIFY-SCHED: when a scheduled kind's slot is due ───────────────────────
// docs/prompts/NOTIFY-SCHED_AUDIT.md; leans F1–F16 approved by Gary 2026-10-24
// ("F10 pace hours limited to 5 AM–8 PM local; F11 monthly pace = today's
// behavior; F12 milestones daily or weekly only; F13 wording follows the
// schedule, default unchanged; F15 reset deletes the row; F16 weekly = one
// day").
//
// PURE EXCEPT claimScheduleSlot(). The hourly runner (src/lib/scheduled-emails.ts)
// asks slotDue() of every (org, kind, store|org); the fixture asks it of fixed
// instants. Nothing here reads the clock — `now` is always passed in.
//
// TWO LOCKS, TWO JOBS (audit § 9):
//   the RUN MARKER (NotificationScheduleRun, claimScheduleSlot) — "this slot
//     has been evaluated", one per (org, kind, store|org, local date);
//   the SEND LOCK — the NotificationIntent dedupeKey, whose period suffix is
//     periodKey() below. This file never decides whether mail went out.
//
// LOCAL TIME IS Intl WITH IANA ZONES, so DST is the platform's problem, not
// ours. Two consequences the fixture pins: a 2 AM schedule on the
// spring-forward day (no 2 AM exists) fires at the first run after it, and the
// repeated 1 AM on the fall-back day is stopped by the run marker.

import { prisma } from "@/lib/prisma"
import type { KindSchedule, ScheduleFrequency } from "./define"

/** The NotificationSchedule fields the evaluator reads. */
export type ScheduleRowLike = {
  frequency: string
  sendHour: number
  daysOfWeek: number[]
  dayOfMonth: number | null
  timeZone: string | null
}

/** Local date, hour (0–23) and ISO weekday (1 Mon … 7 Sun) of an instant. */
export function localSlotParts(now: Date, timeZone: string): { date: string; hour: number; isoWeekday: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  })
  const p = Object.fromEntries(dtf.formatToParts(now).map((x) => [x.type, x.value]))
  const date = `${p.year}-${p.month}-${p.day}`
  return { date, hour: Number(p.hour), isoWeekday: isoWeekdayOf(date) }
}

/** ISO weekday of a "YYYY-MM-DD" — calendar arithmetic on the date string, no zone. */
export function isoWeekdayOf(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00.000Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** ISO-8601 week of a "YYYY-MM-DD": "2026-W43". Monday start (MilestoneSettings' week). */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`)
  // The week belongs to the year its Thursday falls in.
  d.setUTCDate(d.getUTCDate() + 4 - isoWeekdayOf(dateStr))
  const year = d.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1, 12)
  const week = 1 + Math.floor((d.getTime() - jan1) / (7 * 86_400_000))
  return `${year}-W${String(week).padStart(2, "0")}`
}

/**
 * The send-lock period for a LOCAL date. Monthly is "YYYY-MM" — the exact
 * suffix every pace intent has carried since NOTIFY-6, so existing intents keep
 * locking. The three shapes cannot collide ("2026-10", "2026-W43",
 * "2026-10-24").
 */
export function periodKey(frequency: ScheduleFrequency, localDate: string): string {
  if (frequency === "daily") return localDate
  if (frequency === "weekly") return isoWeekKey(localDate)
  return localDate.slice(0, 7)
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * Why a row cannot be used for this kind, or null. THE WRITE ROUTE'S
 * VALIDATION AND THE EVALUATOR'S, ONE FUNCTION — Prisma models no CHECK, so a
 * row edited by hand could carry anything, and the evaluator must not guess.
 */
export function scheduleProblem(spec: KindSchedule, row: ScheduleRowLike): string | null {
  if (!spec.frequencies.includes(row.frequency as ScheduleFrequency)) return `frequency "${row.frequency}" not offered`
  if (!Number.isInteger(row.sendHour) || row.sendHour < spec.hours.min || row.sendHour > spec.hours.max) {
    return `sendHour ${row.sendHour} outside ${spec.hours.min}–${spec.hours.max}`
  }
  const days = row.daysOfWeek
  if (days.length === 0 || new Set(days).size !== days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return "daysOfWeek must be distinct ISO weekdays 1–7"
  }
  // F16 (Gary, 2026-10-24): "weekly = one day".
  if (row.frequency === "weekly" && days.length !== 1) return "weekly takes exactly one day"
  if (row.frequency === "monthly" && spec.monthly === "day-of-month") {
    const n = row.dayOfMonth
    if (n === null || !Number.isInteger(n) || n < 1 || n > 28) return "dayOfMonth must be 1–28"
  }
  if (spec.scope === "org") {
    if (!row.timeZone || !isValidZone(row.timeZone)) return "an org-scoped schedule needs a valid timeZone"
  }
  return null
}

export type SlotDecision =
  | {
      due: true
      /** The run marker's slotDate: local date (row) or UTC date (legacy). */
      slotDate: string
      /** Undefined = no schedule row: the producer's legacy behaviour, untouched payloads (F6). */
      frequency: ScheduleFrequency | undefined
      /** The local date the send-lock period is taken from. */
      localDate: string
    }
  | { due: false; reason: string }

/**
 * Is this slot open at `now`?
 *
 *   NO ROW (or an unusable one): open once the UTC hour reaches
 *     spec.legacyUtcHour, for the rest of that UTC day — today's 15:00 UTC
 *     cron, with F8's same-day catch-up so a skipped or overflowing run is
 *     finished by the next hour rather than lost.
 *   A ROW: open once the LOCAL hour reaches sendHour on an allowed local day,
 *     for the rest of that local day (F8: never the next day). Allowed day:
 *       daily / pace-monthly (F11) — today's ISO weekday is in daysOfWeek;
 *       weekly — it IS the one day (F16);
 *       monthly day-of-month — today is dayOfMonth (F5; weekday boxes ignored).
 *
 * `zone` is the store's (scope "store") or the row's own (scope "org") — the
 * caller resolves it; an org-scoped row with no zone is caught by
 * scheduleProblem() before it is used.
 */
export function slotDue(spec: KindSchedule, row: ScheduleRowLike | null, now: Date, zone: string): SlotDecision {
  const usable = row && scheduleProblem(spec, row) === null ? row : null
  if (!usable) {
    if (now.getUTCHours() < spec.legacyUtcHour) return { due: false, reason: "before the default send hour" }
    const utcDate = now.toISOString().slice(0, 10)
    // The legacy producer reads its own store-local dates; localDate is only
    // used for a period suffix, which legacy runs never take (frequency
    // undefined).
    return { due: true, slotDate: utcDate, frequency: undefined, localDate: utcDate }
  }

  const local = localSlotParts(now, zone)
  if (local.hour < usable.sendHour) return { due: false, reason: "before the chosen hour" }
  const frequency = usable.frequency as ScheduleFrequency
  let allowed: boolean
  if (frequency === "monthly" && spec.monthly === "day-of-month") {
    allowed = Number(local.date.slice(8, 10)) === usable.dayOfMonth
  } else if (frequency === "weekly") {
    allowed = usable.daysOfWeek[0] === local.isoWeekday
  } else {
    allowed = usable.daysOfWeek.includes(local.isoWeekday)
  }
  if (!allowed) return { due: false, reason: "not an allowed day" }
  return { due: true, slotDate: local.date, frequency, localDate: local.date }
}

/**
 * Claim the run marker for one slot. TRUE = this run owns it and must evaluate;
 * FALSE = another run (an earlier hour, an overlapping invocation, a hand-fire)
 * already did. Claimed BEFORE the producer runs, so two overlapping runs cannot
 * both evaluate — the same insert-as-lock shape as NotificationDelivery's
 * per-recipient claim. A run that dies after claiming loses that slot for the
 * day, exactly as a failed daily run lost its day before this phase; queued
 * intents are still retried by the hourly sweep.
 */
export async function claimScheduleSlot(args: {
  organizationId: string
  kind: string
  scopeKey: string
  slotDate: string
}): Promise<boolean> {
  // ON CONFLICT DO NOTHING, read by count — not create() + catch P2002. An
  // already-run slot is the NORMAL case (every store, every hour after its send
  // hour until local midnight), and a caught P2002 still prints a prisma:error
  // line, which would fill the cron log with errors that are not errors.
  const { count } = await prisma.notificationScheduleRun.createMany({ data: [args], skipDuplicates: true })
  return count === 1
}
