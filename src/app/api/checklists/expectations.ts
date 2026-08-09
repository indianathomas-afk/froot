import { prisma } from "@/lib/prisma"
import { expectedWindow, hoursForDate, type HoursRow, type WindowTemplate } from "@/lib/checklist-lifecycle"

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
