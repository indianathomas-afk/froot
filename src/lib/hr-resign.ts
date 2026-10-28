// DOC-7 — annual re-sign, written once (Gary, 2026-10-28, F1–F10;
// docs/DECISIONS.md; audit docs/prompts/DOC-7_AUDIT.md).
//
// A document may carry "re-sign every N months" (HrDocument.reSignEveryMonths).
// Each person's signature then lasts until an ANNIVERSARY: their own newest
// this-cycle signature on the document + N months, never earlier than the
// date the setting was turned on + 30 days (ruling 6). Nothing about expiry is
// stored. Every surface asks this module, so they cannot disagree (F3):
//
//   computeStaffComplianceDetails · /staff/[id] · /my/documents · both
//   ceremony pages · the acknowledgments route · the signed-record route
//
// RENEWAL. HrDocumentAcknowledgment.renewal / HrSignedRecord.renewal number the
// signings of one document within one signing cycle: 0 first, then 1, 2… One
// renewal's acks and record are one signing. Two numbers come out of here:
//
//   countedRenewal — the signing whose acks and record decide completion NOW.
//                    The governing renewal while it is valid; the owed one once
//                    it has expired (so a part-done re-sign shows its progress).
//   owedRenewal    — the renewal a signature made NOW is written under. The
//                    governing renewal + 1 inside the 30-day window or once
//                    expired (rulings 4, 5); otherwise the governing renewal,
//                    which makes a second submission today's no-op.
//
// NEWEST RENEWAL ALWAYS WINS (Gary, 2026-10-28, ordering FIX NOW). "Governing"
// is the highest renewal this cycle, ties broken by the later completedAt —
// compared here, never left to row order.
//
// NO SETTING = PRE-DOC-7, byte for byte: never expired, never in a window, and
// owedRenewal = countedRenewal = the governing renewal, which is 0 for every
// row that predates the migration.

import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { addDays, addMonthsClamped, daysBetween } from "@/lib/milestones"
import { DEFAULT_TIME_ZONE, displayTimeZone } from "@/lib/hr"

/** Ruling 1: the only intervals an admin may choose (client-safe module). */
export { RE_SIGN_CHOICES } from "@/lib/hr-resign-choices"
/** Ruling 3: how many days before the anniversary the notice shows. */
export const RE_SIGN_WINDOW_DAYS = 30
/** Ruling 6: the launch-day floor, in days after the setting is turned on. */
export const RE_SIGN_FLOOR_DAYS = 30

export type RenewalRecord = { renewal: number; completedAt: Date }

/** Newest renewal first; ties by the later completedAt. */
export function compareNewestRenewal(a: RenewalRecord, b: RenewalRecord): number {
  return b.renewal - a.renewal || b.completedAt.getTime() - a.completedAt.getTime()
}

/** The newest of `records` by compareNewestRenewal, or null. */
export function newestRenewal<T extends RenewalRecord>(records: readonly T[]): T | null {
  let best: T | null = null
  for (const r of records) if (!best || compareNewestRenewal(r, best) < 0) best = r
  return best
}

/**
 * The anniversary of a signature completed at `completedAt`: member-local day
 * + N months (clamped), floored at setAt + 30 days. Valid THROUGH this day
 * (F10); overdue from local midnight after.
 */
export function reSignAnniversary(input: {
  completedAt: Date
  everyMonths: number
  setAt: Date | null
  timeZone: string
}): string {
  const signed = addMonthsClamped(localDateStr(input.completedAt, input.timeZone), input.everyMonths)
  if (!input.setAt) return signed
  const floor = addDays(localDateStr(input.setAt, input.timeZone), RE_SIGN_FLOOR_DAYS)
  return floor > signed ? floor : signed
}

export type RenewalView<T extends RenewalRecord> = {
  /** Newest this-cycle record on the document, any version; null = never signed this cycle. */
  governing: T | null
  /** Member-local "YYYY-MM-DD"; null when the document has no setting or nobody signed. */
  anniversary: string | null
  /** anniversary − today in whole member-local days; null with anniversary. */
  daysToAnniversary: number | null
  expired: boolean
  /** 0 ≤ daysToAnniversary ≤ 30 — the notice shows and early re-sign is open (F9). */
  inWindow: boolean
  countedRenewal: number
  owedRenewal: number
}

/**
 * One (document, member). `records` must be THIS CYCLE's records on this
 * document, any version, any renewal — the caller filters by cycle and nothing
 * else. Pure: `today` is passed in so a fixture can pin it.
 */
export function renewalView<T extends RenewalRecord>(input: {
  records: readonly T[]
  everyMonths: number | null
  setAt: Date | null
  timeZone: string
  today: string
}): RenewalView<T> {
  const governing = newestRenewal(input.records)
  const base = governing?.renewal ?? 0
  if (!governing || !input.everyMonths || !input.setAt) {
    return {
      governing,
      anniversary: null,
      daysToAnniversary: null,
      expired: false,
      inWindow: false,
      countedRenewal: base,
      owedRenewal: base,
    }
  }
  const anniversary = reSignAnniversary({
    completedAt: governing.completedAt,
    everyMonths: input.everyMonths,
    setAt: input.setAt,
    timeZone: input.timeZone,
  })
  const daysToAnniversary = daysBetween(input.today, anniversary)
  const expired = daysToAnniversary < 0
  const inWindow = !expired && daysToAnniversary <= RE_SIGN_WINDOW_DAYS
  return {
    governing,
    anniversary,
    daysToAnniversary,
    expired,
    inWindow,
    countedRenewal: expired ? base + 1 : base,
    owedRenewal: expired || inWindow ? base + 1 : base,
  }
}

/**
 * The renewal view for ONE (document, staff member), loaded — for the write
 * paths and the per-person pages, which see one pair at a time. The batched
 * compliance engine builds the same view from rows it already holds; both end
 * in renewalView() above, so they cannot disagree.
 *
 * The zone is the member's display zone (DOC-8 / DEBT-70b), the same one the
 * engine uses, so "today" and the anniversary are the same days everywhere.
 */
export async function loadRenewalView(documentId: string, staffMemberId: string) {
  const [doc, staff] = await Promise.all([
    prisma.hrDocument.findUnique({
      where: { id: documentId },
      select: { reSignEveryMonths: true, reSignEveryMonthsSetAt: true },
    }),
    prisma.staffMember.findUnique({ where: { id: staffMemberId }, select: { signingCycle: true } }),
  ])
  if (!doc || !staff) return null
  const [records, timeZone] = await Promise.all([
    prisma.hrSignedRecord.findMany({
      where: { staffMemberId, signingCycle: staff.signingCycle, version: { hrDocumentId: documentId } },
      select: { id: true, hrDocumentVersionId: true, renewal: true, completedAt: true },
    }),
    memberDisplayZone(staffMemberId),
  ])
  return {
    signingCycle: staff.signingCycle,
    ...renewalView({
      records,
      everyMonths: doc.reSignEveryMonths,
      setAt: doc.reSignEveryMonthsSetAt,
      timeZone,
      today: localDateStr(new Date(), timeZone),
    }),
  }
}

/**
 * The member's display zone — primary store's, else the org's — resolved the
 * way computeStaffComplianceDetails resolves it, for the pages that build their
 * rows outside the engine. One query.
 */
export async function memberDisplayZone(staffMemberId: string): Promise<string> {
  const staff = await prisma.staffMember.findUnique({
    where: { id: staffMemberId },
    select: {
      isCorporate: true,
      organization: { select: { timezone: true } },
      storeAssignments: {
        select: { isPrimary: true, store: { select: { timezone: true, name: true } } },
        orderBy: [{ isPrimary: "desc" as const }, { store: { name: "asc" as const } }],
      },
    },
  })
  return displayTimeZone(staff, staff?.organization ?? { timezone: DEFAULT_TIME_ZONE })
}
