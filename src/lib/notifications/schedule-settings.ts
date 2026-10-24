// ─── NOTIFY-SCHED: reading and writing a kind's schedule (build step 3) ──────
// The Schedule section on /settings/notifications reads loadScheduleView();
// PUT/DELETE /api/notify/schedule/[kind] writes through parseScheduleBody().
// What a row MEANS is src/lib/notifications/schedule.ts; this file only moves
// rows in and out, and validates with the same scheduleProblem() the hourly
// runner uses, so a row the page can save is a row the runner will honour.

import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import type { KindSchedule, ScheduleFrequency } from "./define"
import { getKind } from "./registry"
import { scheduleProblem, type ScheduleRowLike } from "./schedule"

/** Everything the client editor needs, serialisable. */
export type ScheduleView = {
  kind: string
  spec: KindSchedule
  saved: (ScheduleRowLike & { updatedAt: string }) | null
  /** Org-scoped kinds: the zone a new schedule starts on (F3). */
  defaultZone: string
}

/**
 * F3 (approved 2026-10-24): an org-scoped schedule's zone is PRE-FILLED with
 * the org's most common ACTIVE store zone, then stored on the row and never
 * recomputed — so adding a store later cannot move a saved send hour (the
 * drift DEBT-70a rejected). Ties go to the alphabetically first zone, so the
 * pre-fill is stable. No active store → the house default.
 */
export async function mostCommonStoreZone(organizationId: string): Promise<string> {
  const groups = await prisma.store.groupBy({
    by: ["timezone"],
    where: { organizationId, isActive: true },
    _count: { _all: true },
  })
  groups.sort((a, b) => b._count._all - a._count._all || a.timezone.localeCompare(b.timezone))
  return groups[0]?.timezone ?? DEFAULT_TIME_ZONE
}

/** Null for a kind with no `schedule` (an event kind). */
export async function loadScheduleView(organizationId: string, kind: string): Promise<ScheduleView | null> {
  const spec = getKind(kind)?.schedule
  if (!spec) return null
  const [row, defaultZone] = await Promise.all([
    prisma.notificationSchedule.findUnique({
      where: { organizationId_kind: { organizationId, kind } },
      select: { frequency: true, sendHour: true, daysOfWeek: true, dayOfMonth: true, timeZone: true, updatedAt: true },
    }),
    spec.scope === "org" ? mostCommonStoreZone(organizationId) : Promise.resolve(DEFAULT_TIME_ZONE),
  ])
  return {
    kind,
    spec,
    saved: row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null,
    defaultZone,
  }
}

const bodySchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  sendHour: z.number().int(),
  daysOfWeek: z.array(z.number().int()).max(7),
  dayOfMonth: z.number().int().nullable().optional(),
  timeZone: z.string().max(64).nullable().optional(),
})

/**
 * The body → the row to store, normalised so a row never carries a field its
 * kind ignores: a store-scoped kind stores no zone (it reads Store.timezone),
 * and dayOfMonth is kept only for a day-of-month monthly kind. Days are sorted.
 */
export function parseScheduleBody(
  spec: KindSchedule,
  body: unknown
): { ok: true; row: ScheduleRowLike & { frequency: ScheduleFrequency } } | { ok: false; error: string } {
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return { ok: false, error: "Invalid body" }
  const b = parsed.data
  const row = {
    frequency: b.frequency,
    sendHour: b.sendHour,
    daysOfWeek: [...b.daysOfWeek].sort((x, y) => x - y),
    dayOfMonth: b.frequency === "monthly" && spec.monthly === "day-of-month" ? (b.dayOfMonth ?? null) : null,
    timeZone: spec.scope === "org" ? (b.timeZone ?? null) : null,
  }
  const problem = scheduleProblem(spec, row)
  if (problem) return { ok: false, error: `Invalid schedule: ${problem}.` }
  return { ok: true, row }
}
