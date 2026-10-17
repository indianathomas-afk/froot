import type { Organization } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { dateColumnStr } from "@/lib/milestones"
import { canSeeWages } from "@/lib/labor-dashboard"
import { compVisibleForMember } from "@/lib/comp-confidential"
import type { PermissionUser } from "@/lib/permissions"

// ─────────────────────────────────────────────────────────────────────────────
// MS-3b — RAISE HISTORY. THE ONLY READER OF THE WAGE SNAPSHOT TABLE, AND THE
// ONLY FILE THAT NAMES StaffLastRaise. scripts/verify-ms1.ts C18 allows exactly
// this file and its writer (labor-roster.ts) to name the snapshot table;
// scripts/verify-ms3b.ts pins StaffLastRaise to this file. Pages and routes
// call the functions here and never touch either table.
//
// THE RULINGS (Gary, 2026-10-16 — F5, F6, F10, F15 "approved as listed"; G1–G4
// "approved as your leans", docs/prompts/2026-10-16_MS-3b_AUDIT.md):
//   F5  a raise is an hourlyRate HIGHER than the immediately previous snapshot
//       for that member, both non-null. The baseline (first) snapshot is never
//       a raise; a decrease resets nothing; 15 → 14 → 15 counts; a job change
//       at a higher rate is just a higher rate. Latest snapshot SALARY =
//       detection off.
//   G2  the detected DATE is the snapshot's capture (the sync that first saw
//       the new rate), as a calendar date in the member's display zone. Square
//       does not tell us when it changed; the daily cron keeps this within a
//       day.
//   G4  a salaried member's MANUAL date still counts — only detection is off.
//   F6/F15 the manual "last raise date" is ADMIN-entered; the cooldown counts
//       from the LATER of it and the detected raise (raise-eligibility.ts).
//   F10/G3 who may see the DATES: canSeeWages(org, actor) and then
//       compVisibleForMember(actor, compConfidential) — FAILS CLOSED with no
//       wage row for anyone but an ADMIN.
//
// COMP-1: every function that returns a date or a rate here is PAY DATA. The
// caller must redact (redactForViewer) before anything renders or returns.
// Rates (fromRate/toRate) leave this file only for MS-4/MS-5 and the fixture —
// the eligibility result never carries them (F7: no amounts on that surface).
// ─────────────────────────────────────────────────────────────────────────────

// ─── PURE: DETECTION ─────────────────────────────────────────────────────────

export type WageHistoryRow = { payType: string | null; hourlyRate: number | null; capturedAt: Date }
export type DetectedRaise = { date: string; capturedAt: Date; fromRate: number; toRate: number }

/// F5 over ONE member's history, OLDEST FIRST. Returns the LATEST raise, or
/// null: no history, only a baseline, no increase, or salaried now.
export function latestRaise(rows: WageHistoryRow[], zone: string): DetectedRaise | null {
  if (rows.length === 0) return null
  if (rows[rows.length - 1].payType === "SALARY") return null
  let found: DetectedRaise | null = null
  for (let k = 1; k < rows.length; k++) {
    const prev = rows[k - 1].hourlyRate
    const next = rows[k].hourlyRate
    // Compared to the cent, the same as wageChanged in labor-roster.ts.
    if (prev === null || next === null || Math.round(next * 100) <= Math.round(prev * 100)) continue
    found = { date: localDateStr(rows[k].capturedAt, zone), capturedAt: rows[k].capturedAt, fromRate: prev, toRate: next }
  }
  return found
}

// ─── THE READS (DB) ──────────────────────────────────────────────────────────

export type RaiseHistoryMember = { id: string; squareTeamMemberId: string | null; zone: string }

/// BATCHED: one read for every member passed. Unlinked members have no history.
export async function detectRaises(org: Pick<Organization, "id">, members: RaiseHistoryMember[]): Promise<Map<string, DetectedRaise>> {
  const out = new Map<string, DetectedRaise>()
  const linked = members.filter((m) => m.squareTeamMemberId)
  if (linked.length === 0) return out
  const rows = await prisma.wageSnapshot.findMany({
    where: { organizationId: org.id, squareTeamMemberId: { in: linked.map((m) => m.squareTeamMemberId as string) } },
    select: { squareTeamMemberId: true, payType: true, hourlyRate: true, capturedAt: true },
    orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
  })
  const bySquareId = new Map<string, WageHistoryRow[]>()
  for (const r of rows) {
    const list = bySquareId.get(r.squareTeamMemberId) ?? []
    list.push({ payType: r.payType, hourlyRate: r.hourlyRate === null ? null : Number(r.hourlyRate), capturedAt: r.capturedAt })
    bySquareId.set(r.squareTeamMemberId, list)
  }
  for (const m of linked) {
    const raise = latestRaise(bySquareId.get(m.squareTeamMemberId as string) ?? [], m.zone)
    if (raise) out.set(m.id, raise)
  }
  return out
}

/// The ADMIN-entered dates, yyyy-mm-dd, for members that have one. A cleared
/// row (date null) is absent. Org-scoped.
export async function getManualRaiseDates(organizationId: string, staffIds: string[]): Promise<Map<string, string>> {
  if (staffIds.length === 0) return new Map()
  const rows = await prisma.staffLastRaise.findMany({
    where: { organizationId, staffMemberId: { in: staffIds }, lastRaiseDate: { not: null } },
    select: { staffMemberId: true, lastRaiseDate: true },
  })
  return new Map(rows.map((r) => [r.staffMemberId, dateColumnStr(r.lastRaiseDate as Date)]))
}

// ─── WHO MAY SEE THE DATES (F10, G3) ─────────────────────────────────────────

/// The member ids whose raise dates this viewer may see. EMPTY unless
/// canSeeWages (overlay on AND labor.costs.view). Then COMP-1 per member through
/// compVisibleForMember — which is a POSITIVE test on purpose: no wage row
/// (unlinked, or never synced) is MASKED for a MANAGER. Reads the flag only, no
/// rate. Store scope is the caller's (the roster query / getStaffMember 404).
export async function getRaiseDetailVisibility(
  org: Organization,
  actor: PermissionUser,
  members: { id: string; squareTeamMemberId: string | null }[]
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!canSeeWages(org, actor) || members.length === 0) return out
  const squareIds = members.map((m) => m.squareTeamMemberId).filter((v): v is string => v !== null)
  const rows = squareIds.length
    ? await prisma.squareTeamMemberWage.findMany({
        where: { organizationId: org.id, squareTeamMemberId: { in: squareIds } },
        select: { squareTeamMemberId: true, compConfidential: true },
      })
    : []
  const flag = new Map(rows.map((r) => [r.squareTeamMemberId, r.compConfidential]))
  for (const m of members) {
    if (compVisibleForMember(actor, m.squareTeamMemberId ? flag.get(m.squareTeamMemberId) : undefined)) out.add(m.id)
  }
  return out
}

// ─── THE WRITE (F15) ─────────────────────────────────────────────────────────

/// Set (date) or clear (null) a member's manual last-raise date. THE CALLER HAS
/// ALREADY PASSED the last-raise route's gates — this is not one. Org-scoped by
/// id: a member of another org is refused, never written. Clearing keeps the
/// row so it still records who cleared it and when.
export async function setLastRaiseDate(
  organizationId: string,
  staffMemberId: string,
  date: string | null,
  setByUserId: string
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const member = await prisma.staffMember.findFirst({ where: { id: staffMemberId, organizationId }, select: { id: true } })
  if (!member) return { ok: false, error: "not-found" }
  const lastRaiseDate = date === null ? null : new Date(`${date}T00:00:00.000Z`)
  const setAt = new Date()
  await prisma.staffLastRaise.upsert({
    where: { staffMemberId },
    create: { organizationId, staffMemberId, lastRaiseDate, setByUserId, setAt },
    update: { lastRaiseDate, setByUserId, setAt },
  })
  return { ok: true }
}
