import { prisma } from "@/lib/prisma"
import { expectedWindow, hoursForDate, type HoursRow, type WindowTemplate } from "@/lib/checklist-lifecycle"
import { dbDate } from "@/lib/reports"
import type { Prisma } from "@prisma/client"

// CHK-3 (S3). Plumbing for freezing a checklist's expected window ONTO THE ROW
// at the moment the row is created — the one shared bit of wiring between the
// two creation paths in api/checklists/route.ts and the day-close job.
//
// WHY AT CREATE, AND NOT AT COMPLETION. `Checklist.expectedStartAt` /
// `expectedEndAt` exist so a later offset edit cannot retroactively change how a
// past day was judged (plan §2.2). Freezing at completion would reopen exactly
// that hole with one extra step in front of it: a checklist started at 6am,
// whose template offsets are edited at 10am, would be judged against the 10am
// window. The window a checklist is judged against is the window it was
// MATERIALISED under — created, for one somebody started; day close, for one the
// cron filed as missed.
//
// A NULL WINDOW IS A REAL ANSWER AND IT IS COMMON. AllDay templates, blank
// offsets, a store with no hours for that weekday and a store marked closed all
// produce no expectation, and nothing here invents one. Null never means
// "on time" — see the column comments in prisma/schema.prisma.
//
// The window itself is defined once, in src/lib/checklist-lifecycle.ts. This
// file only loads rows and shapes the two columns; it decides nothing.

export type FrozenWindow = { expectedStartAt: Date | null; expectedEndAt: Date | null }

/** `StoreHours` for several stores in one query, keyed by storeId. */
export async function hoursByStore(storeIds: string[]): Promise<Map<string, HoursRow[]>> {
  const rows = await prisma.storeHours.findMany({
    where: { storeId: { in: storeIds } },
    select: { storeId: true, dayOfWeek: true, openingTime: true, closingTime: true, isClosed: true },
  })
  const byStore = new Map<string, HoursRow[]>()
  for (const r of rows) byStore.set(r.storeId, [...(byStore.get(r.storeId) ?? []), r])
  return byStore
}

/** The two columns, for a store-local date. */
export function freezeWindow(
  template: WindowTemplate,
  hours: HoursRow[],
  dateStr: string,
  timeZone: string
): FrozenWindow {
  const w = expectedWindow(template, hoursForDate(hours, dateStr), dateStr, timeZone)
  return { expectedStartAt: w?.start ?? null, expectedEndAt: w?.end ?? null }
}

// ─── CAL-2 — the one call that creates a checklist ───────────────────────────

/** `P2002`, the unique-constraint violation. Lifted here from the day-close
 *  cron (api/cron/checklist-day-close/route.ts) rather than copied a third
 *  time, now that three callers create checklists. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002"
}

/** A Prisma client or an interactive transaction client — the cron creates the
 *  occurrence and the checklist in one transaction, so this has to accept both. */
type Db = Prisma.TransactionClient | typeof prisma

/**
 * THE MINIMUM CALL THAT CREATES ONE Checklist FOR (template, store, date) WITH
 * THE CHK-3 WINDOW FROZEN.
 *
 * CAL-2 EXTRACTED THIS FROM TWO INLINE COPIES in api/checklists/route.ts — the
 * single create and the bulk loop — so that the calendar's materialise cron is
 * a third CALLER and not a third copy. The data shape was already identical in
 * both; only `freezeWindow` and `hoursByStore` were shared, and the
 * `prisma.checklist.create` call itself was written out twice.
 *
 * THE DATE IS A STRING, AND THAT IS THE WHOLE DIFFERENCE FROM THE TWO CALLERS
 * IT REPLACES. Both of them take it from businessDayWindow(now, timeZone),
 * which returns `{ day, gte: dbDate(day), lt }` — the same date expressed
 * twice, once for the column and once for the window computation. A calendar
 * occurrence supplies an arbitrary due date that is not today, so this takes
 * the string and derives the column from it. The two existing callers keep
 * using businessDayWindow and pass `w.day`, so their behaviour is unchanged,
 * which is the point of extracting rather than rewriting.
 *
 * ADOPTION ON COLLISION (`adopted: true`). Checklist carries
 * @@unique([storeId, templateId, date]), and a row may already exist for this
 * triple — most often DEBT-61 LITTER, a Pending row bulk generate created for a
 * Weekly template before CAL-2 stopped it doing that. Failing would strand the
 * occurrence; creating a second row is impossible. So the existing row is
 * adopted: the caller's `calendarOccurrenceId` is written onto it and it
 * becomes a tracked row. That is strictly better than orphaning one beside it,
 * and the cron counts it as `adoptedExisting` so the number is visible rather
 * than inferred.
 *
 * The read-then-skip both existing callers already perform stays where it is.
 * It is now a fast path rather than the only guard — the catch below is what
 * makes the concurrent case safe.
 */
export async function createChecklistForDate(
  db: Db,
  args: {
    organizationId: string
    storeId: string
    template: WindowTemplate & { id: string }
    /** "YYYY-MM-DD", store-local. */
    dateStr: string
    timeZone: string
    hours: HoursRow[]
    /** Defaults to "Pending" — the state both existing callers create. */
    status?: string
    calendarOccurrenceId?: string | null
  }
): Promise<{ id: string; adopted: boolean }> {
  const data = {
    organizationId: args.organizationId,
    storeId: args.storeId,
    templateId: args.template.id,
    date: dbDate(args.dateStr),
    status: args.status ?? "Pending",
    ...(args.calendarOccurrenceId ? { calendarOccurrenceId: args.calendarOccurrenceId } : {}),
    ...freezeWindow(args.template, args.hours, args.dateStr, args.timeZone),
  }

  try {
    const created = await db.checklist.create({ data })
    return { id: created.id, adopted: false }
  } catch (e) {
    if (!isUniqueViolation(e)) throw e

    // The row exists. Adopt it rather than fail: re-read by the same triple the
    // index is on, and write the link onto it if one was asked for.
    const existing = await db.checklist.findFirst({
      where: { storeId: args.storeId, templateId: args.template.id, date: dbDate(args.dateStr) },
      select: { id: true, calendarOccurrenceId: true },
    })
    if (!existing) throw e

    // THE WINDOW ON AN ADOPTED ROW IS NOT REWRITTEN. It was frozen when that row
    // was materialised and it is the window that row was judged against — CHK-3's
    // whole argument, and rewriting it here would be exactly the retroactive
    // re-judgement the freeze exists to prevent.
    if (args.calendarOccurrenceId && existing.calendarOccurrenceId == null) {
      await db.checklist.update({
        where: { id: existing.id },
        data: { calendarOccurrenceId: args.calendarOccurrenceId },
      })
    }
    return { id: existing.id, adopted: true }
  }
}
