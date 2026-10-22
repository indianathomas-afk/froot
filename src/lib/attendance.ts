// ─────────────────────────────────────────────────────────────────────────────
// MS-2 — STAFF MILESTONES ON-TIME %. Rulings: docs/DECISIONS.md 2026-10-16
// (MS-2), audit docs/prompts/2026-10-16_MS-2_AUDIT.md.
//
// ONE FUNCTION, ANY DATE RANGE. getOnTimeForStaff() takes an inclusive pair of
// store-local dates per member, not a "last N days" — the badge passes the
// rolling look-back window, and MS-3's raise eligibility will pass its own
// weeks. Nothing here is hard-wired to the badge.
//
// WHAT "ON TIME" MEANS — the first definition of it in Froot (the Day Inspector
// has NO-SHOW and UNSCHEDULED but no lateness, A1):
//   1. A shift COUNTS when it is published (F9), live, assigned to this member,
//      its START falls inside the range as a store-local date IN ITS OWN STORE'S
//      ZONE (F1), and the timecard sync has reached past start + the inspector's
//      20-minute NO-SHOW wait (noShowEligible, F3). A shift that is not yet
//      eligible is in neither the numerator nor the denominator.
//   2. A counted shift PAIRS with a card by the inspector's own predicate,
//      pairsAsAttendance() — same member, same store, ≥ 15 minutes' overlap
//      (F10, F12). There is no second copy of that rule.
//   3. A paired shift is ON TIME when its EARLIEST paired clock-in is at or
//      before scheduled start + the grace period, COMPARED TO THE MINUTE (F2,
//      Gary 2026-10-16: at 5 minutes 9:05:59 is on time, 9:06:00 is late).
//      Early is always on time.
//   4. An unpaired counted shift is a NO-SHOW and is NOT on time (F3).
//      Unscheduled cards are ignored entirely.
//
// THE GREY STATES come before any colour: overlay off or nothing published at
// the member's stores → "no-schedule" (F5); no Square link → "not-linked"
// (F11); fewer counted shifts than the minimum → "not-enough" (F4).
//
// READ-ONLY, MIRRORED ROWS ONLY. No Square call and no sync trigger. NEVER
// WAGES, RATES, TIPS OR NOTES — the select lists below are the ruling, the
// inspector's discipline kept.
// ─────────────────────────────────────────────────────────────────────────────

import type { Organization } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { addDaysStr, localMidnightUtc } from "@/lib/labor-schedule"
import { laborOverlayOn } from "@/lib/labor-dashboard"
import {
  DEFAULT_MILESTONE_SETTINGS,
  settingsProblem,
  type MilestoneSettingsValues,
} from "@/lib/attendance-settings"
import { NO_SHOW_GRACE_MINUTES, SHOWED_UP_MIN_OVERLAP_MINUTES, noShowEligible, pairsAsAttendance } from "@/lib/labor-inspector"

// ─── SETTINGS ────────────────────────────────────────────────────────────────
//
// The values, defaults and validator live in src/lib/attendance-settings.ts —
// no prisma import there, so the setup form can show the same refusal text.
export * from "@/lib/attendance-settings"

/// The org's row, or the defaults when it has never saved. Selected field by
/// field so a column MS-3 adds does not ride along into MS-2's callers.
export async function getMilestoneSettings(organizationId: string): Promise<MilestoneSettingsValues> {
  const row = await prisma.milestoneSettings.findUnique({
    where: { organizationId },
    select: {
      onTimeRedBelow: true,
      onTimeGreenAtOrAbove: true,
      onTimeLookbackDays: true,
      onTimeMinShifts: true,
      onTimeGraceMinutes: true,
    },
  })
  return row ?? { ...DEFAULT_MILESTONE_SETTINGS }
}

/// The write, extracted from the route so scripts/verify-ms2.ts runs the same
/// refusal the route does. THE CALLER HAS ALREADY PASSED
/// requireMilestones("milestones.manage") and resolved organizationId from the
/// session — this is not a gate. First save creates the row (A7).
export async function saveMilestoneSettings(
  organizationId: string,
  values: MilestoneSettingsValues
): Promise<{ ok: true; settings: MilestoneSettingsValues } | { ok: false; error: string }> {
  const problem = settingsProblem(values)
  if (problem) return { ok: false, error: problem }
  await prisma.milestoneSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...values },
    update: values,
  })
  return { ok: true, settings: values }
}

// ─── PURE: THE CALCULATION ───────────────────────────────────────────────────

export type OnTimeStatus = "green" | "amber" | "red" | "not-enough" | "no-schedule" | "not-linked"

/// Why a grey badge is grey — the full badge words it; the compact one does not.
export type OnTimeReason = "square-labor-off" | "no-published-shifts" | null

export type OnTimeResult = {
  status: OnTimeStatus
  reason: OnTimeReason
  onTime: number
  total: number
  /// Exact, unrounded. Null when there is nothing to divide.
  percent: number | null
  /// What a badge prints: the exact percentage ROUNDED DOWN (Gary,
  /// 2026-10-16: "the displayed % must never disagree with the badge colour").
  /// The colour is still decided on the exact value (F8), and flooring is what
  /// keeps the two in step: 89.6 prints "89%" and is amber, and no label can
  /// reach a green threshold its colour has not. Rounding to nearest would
  /// print "90%" on an amber badge.
  displayPercent: number | null
  range: { from: string; to: string }
}

export type AttendanceShift = {
  storeId: string
  effectiveTeamMemberId: string | null
  effectiveStartAt: Date
  effectiveEndAt: Date
  effectiveSource: string
  effectiveIsDeleted: boolean
}

export type AttendanceCard = {
  storeId: string
  squareTeamMemberId: string
  startAt: Date
  endAt: Date | null
}

/// Minutes late, floored — the "compared to the minute" half of F2. Negative
/// when early.
export function minutesLate(clockIn: Date, scheduledStart: Date): number {
  return Math.floor((clockIn.getTime() - scheduledStart.getTime()) / 60000)
}

export function isOnTime(clockIn: Date, scheduledStart: Date, graceMinutes: number): boolean {
  return minutesLate(clockIn, scheduledStart) <= graceMinutes
}

/// F8: red strictly below, green at or above, amber between — on the EXACT
/// percentage.
export function colourFor(percent: number, s: Pick<MilestoneSettingsValues, "onTimeRedBelow" | "onTimeGreenAtOrAbove">): "green" | "amber" | "red" {
  if (percent < s.onTimeRedBelow) return "red"
  if (percent >= s.onTimeGreenAtOrAbove) return "green"
  return "amber"
}

/// PURE — no DB, injected clock. Everything for ONE member.
///
/// `memberShifts` and `memberCards` are this member's rows (any store).
/// `storesWithSchedule` is every store that has at least one counted-shape
/// (published, live) shift dated inside this member's range, whoever it is
/// assigned to — the F5 "does this person's store schedule at all" test.
export function assembleOnTime(args: {
  squareTeamMemberId: string | null
  assignedStoreIds: string[]
  memberShifts: AttendanceShift[]
  memberCards: AttendanceCard[]
  storesWithSchedule: Set<string>
  storeZones: Map<string, string>
  /// min(now, lastTimecardSyncOkAt) per store; null/absent = never synced.
  syncedThroughByStore: Map<string, number | null>
  range: { from: string; to: string }
  now: Date
  settings: MilestoneSettingsValues
}): OnTimeResult {
  const { range, settings } = args
  const empty = { onTime: 0, total: 0, percent: null, displayPercent: null, range }

  if (!args.squareTeamMemberId) return { status: "not-linked", reason: null, ...empty }

  const counted = args.memberShifts.filter((s) => {
    if (s.effectiveIsDeleted || s.effectiveSource !== "published") return false
    if (s.effectiveTeamMemberId !== args.squareTeamMemberId) return false
    const zone = args.storeZones.get(s.storeId)
    if (!zone) return false
    const day = localDateStr(s.effectiveStartAt, zone)
    if (day < range.from || day > range.to) return false
    return noShowEligible(s.effectiveStartAt, args.syncedThroughByStore.get(s.storeId) ?? null, NO_SHOW_GRACE_MINUTES)
  })

  const ceilingMs = args.now.getTime()
  let onTime = 0
  for (const s of counted) {
    // Same store, same member — the inspector's per-store read, restated as a
    // filter because this read spans stores.
    const paired = args.memberCards
      .filter((c) => c.storeId === s.storeId && c.squareTeamMemberId === args.squareTeamMemberId)
      .filter((c) => pairsAsAttendance(c, s, ceilingMs, SHOWED_UP_MIN_OVERLAP_MINUTES))
    if (paired.length === 0) continue // no-show: counted, not on time
    const earliest = paired.reduce((a, b) => (b.startAt < a.startAt ? b : a))
    if (isOnTime(earliest.startAt, s.effectiveStartAt, settings.onTimeGraceMinutes)) onTime++
  }

  const total = counted.length
  if (total === 0) {
    const schedules =
      args.assignedStoreIds.some((id) => args.storesWithSchedule.has(id)) ||
      args.memberShifts.some((s) => args.storesWithSchedule.has(s.storeId))
    if (!schedules) return { status: "no-schedule", reason: "no-published-shifts", ...empty }
  }
  // MULTIPLY FIRST. (onTime / total) * 100 is not exact in floating point —
  // 29/50 gives 57.99999999999999, which the floor below would print as
  // "57%". onTime * 100 / total is exact whenever the true value is a whole
  // number, so a whole percentage is never floored down by one.
  const percent = total === 0 ? null : (onTime * 100) / total
  if (total < settings.onTimeMinShifts || percent === null) {
    return { status: "not-enough", reason: null, onTime, total, percent, displayPercent: percent === null ? null : Math.floor(percent), range }
  }
  return { status: colourFor(percent, settings), reason: null, onTime, total, percent, displayPercent: Math.floor(percent), range }
}

// ─── THE RANGE ───────────────────────────────────────────────────────────────

/// The badge's rolling window (F1): the N store-local days ending today in the
/// member's display zone. A terminated member's window ends on their
/// store-local termination date instead (F11, MS-1 F4's precedent).
export function lookbackRange(
  lookbackDays: number,
  now: Date,
  zone: string,
  terminatedAt: Date | null
): { from: string; to: string } {
  const today = localDateStr(now, zone)
  const end = terminatedAt ? localDateStr(terminatedAt, zone) : today
  const to = end < today ? end : today
  return { from: addDaysStr(to, -(lookbackDays - 1)), to }
}

// ─── THE READ (DB) ───────────────────────────────────────────────────────────

export type AttendanceMember = {
  id: string
  squareTeamMemberId: string | null
  assignedStoreIds: string[]
  range: { from: string; to: string }
  /// MS-6 — StaffMember.milestoneEligible. REQUIRED, not optional, so the
  /// build refuses any caller that forgets it: an ineligible member gets NO
  /// entry in the result (R2), on every surface, without each page re-checking.
  milestoneEligible: boolean
}

/// BATCHED: one shift read, one timecard read and one sync-state read for every
/// member passed, whether that is one profile or a whole /staff roster (HR-8's
/// "never a query per row"). Returns a result per member id.
///
/// F5: with the Square labor overlay off NO ROW IS READ — the inspector's rule
/// that rows predating the toggle are not drawn as if they were live.
export async function getOnTimeForStaff(
  org: Organization,
  allMembers: AttendanceMember[],
  settings: MilestoneSettingsValues,
  now = new Date()
): Promise<Map<string, OnTimeResult>> {
  const out = new Map<string, OnTimeResult>()
  // MS-6 R2 — dropped before anything is read, so an ineligible member has no
  // result at all (absent, not "no data"). R3: nothing is deleted.
  const members = allMembers.filter((m) => m.milestoneEligible)
  if (members.length === 0) return out

  const emptyFor = (m: AttendanceMember, status: OnTimeStatus, reason: OnTimeReason): OnTimeResult => ({
    status,
    reason,
    onTime: 0,
    total: 0,
    percent: null,
    displayPercent: null,
    range: m.range,
  })

  if (!laborOverlayOn(org)) {
    for (const m of members) {
      out.set(m.id, m.squareTeamMemberId ? emptyFor(m, "no-schedule", "square-labor-off") : emptyFor(m, "not-linked", null))
    }
    return out
  }

  // Square-linked stores only — SquareScheduledShift / SquareTimecard rows are
  // resolved FROM squareLocationId, so an unlinked store holds none (DEBT-78).
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id, squareLocationId: { not: null } },
    select: { id: true, timezone: true },
  })
  const storeZones = new Map(stores.map((s) => [s.id, s.timezone]))
  const storeIds = stores.map((s) => s.id)

  // ONE PADDED UTC WINDOW covering every member's range in every store's zone;
  // the exact store-local test is done per shift in assembleOnTime. A day of
  // padding each side is wider than any zone offset.
  const froms = members.map((m) => m.range.from).sort()
  const tos = members.map((m) => m.range.to).sort()
  const qFrom = localMidnightUtc(addDaysStr(froms[0], -1), "UTC")
  const qTo = localMidnightUtc(addDaysStr(tos[tos.length - 1], 2), "UTC")

  const squareIds = [...new Set(members.map((m) => m.squareTeamMemberId).filter((v): v is string => !!v))]

  const [shifts, closedCards, openCards, syncStates] = await Promise.all([
    // EVERY published live shift at the org's stores in the window, whoever it
    // is assigned to — the member's own shifts AND the "does this store
    // schedule at all" test come out of the same rows. Notes are not selected.
    prisma.squareScheduledShift.findMany({
      where: {
        organizationId: org.id,
        storeId: { in: storeIds },
        effectiveIsDeleted: false,
        effectiveSource: "published",
        effectiveStartAt: { gte: qFrom, lt: qTo },
      },
      select: {
        storeId: true,
        effectiveTeamMemberId: true,
        effectiveStartAt: true,
        effectiveEndAt: true,
        effectiveSource: true,
        effectiveIsDeleted: true,
      },
    }),
    // Cards — no wage, rate or tip column. A card may start up to a day before
    // a shift it pairs with (an early clock-in), hence the extra day.
    squareIds.length === 0
      ? Promise.resolve([])
      : prisma.squareTimecard.findMany({
          where: {
            organizationId: org.id,
            storeId: { in: storeIds },
            squareTeamMemberId: { in: squareIds },
            startAt: { gte: new Date(qFrom.getTime() - 86400000), lt: qTo },
            endAt: { not: null },
          },
          select: { storeId: true, squareTeamMemberId: true, startAt: true, endAt: true },
        }),
    // OPEN cards get no lower bound — the inspector's S5-A1 split, kept so an
    // open card pairs here exactly as it pairs there.
    squareIds.length === 0
      ? Promise.resolve([])
      : prisma.squareTimecard.findMany({
          where: {
            organizationId: org.id,
            storeId: { in: storeIds },
            squareTeamMemberId: { in: squareIds },
            endAt: null,
            startAt: { lt: qTo },
          },
          select: { storeId: true, squareTeamMemberId: true, startAt: true, endAt: true },
        }),
    prisma.squareLaborSyncState.findMany({
      where: { storeId: { in: storeIds } },
      select: { storeId: true, lastSyncOkAt: true },
    }),
  ])

  const syncedThroughByStore = new Map<string, number | null>(
    syncStates.map((s) => [s.storeId, s.lastSyncOkAt ? Math.min(now.getTime(), s.lastSyncOkAt.getTime()) : null])
  )
  const cards = [...closedCards, ...openCards]

  const shiftsBy = new Map<string, AttendanceShift[]>()
  for (const s of shifts) {
    if (!s.effectiveTeamMemberId) continue
    const list = shiftsBy.get(s.effectiveTeamMemberId)
    if (list) list.push(s)
    else shiftsBy.set(s.effectiveTeamMemberId, [s])
  }
  const cardsBy = new Map<string, AttendanceCard[]>()
  for (const c of cards) {
    const list = cardsBy.get(c.squareTeamMemberId)
    if (list) list.push(c)
    else cardsBy.set(c.squareTeamMemberId, [c])
  }

  // Each store's published days, dated once in its own zone — so the per-member
  // "does this store schedule at all" test is a lookup, not a rescan.
  const storeDays = new Map<string, Set<string>>()
  for (const s of shifts) {
    const zone = storeZones.get(s.storeId)
    if (!zone) continue
    const days = storeDays.get(s.storeId) ?? new Set<string>()
    days.add(localDateStr(s.effectiveStartAt, zone))
    storeDays.set(s.storeId, days)
  }

  for (const m of members) {
    // Stores with a published shift dated inside THIS member's range.
    const storesWithSchedule = new Set<string>()
    for (const [storeId, days] of storeDays) {
      for (const d of days) {
        if (d >= m.range.from && d <= m.range.to) {
          storesWithSchedule.add(storeId)
          break
        }
      }
    }
    out.set(
      m.id,
      assembleOnTime({
        squareTeamMemberId: m.squareTeamMemberId,
        assignedStoreIds: m.assignedStoreIds,
        memberShifts: m.squareTeamMemberId ? (shiftsBy.get(m.squareTeamMemberId) ?? []) : [],
        memberCards: m.squareTeamMemberId ? (cardsBy.get(m.squareTeamMemberId) ?? []) : [],
        storesWithSchedule,
        storeZones,
        syncedThroughByStore,
        range: m.range,
        now,
        settings,
      })
    )
  }
  return out
}
