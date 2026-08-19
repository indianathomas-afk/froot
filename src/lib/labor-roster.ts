import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import type { Organization } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSquareClient } from "@/lib/square"

// AL-3 — ADVANCED LABOR PHASE 3. Design record: docs/ADVANCED_LABOR.md § Phase 3.
//
// THE CURRENT WAGE SETTING PER TEAM MEMBER — what we pay a person NOW, which is
// a different fact from SquareTimecard.wageHourlyRate (what a past shift cost).
// Both are correct for their own question. A later "unification" of the two
// would silently re-cost history at today's rates, so they stay apart and this
// comment is why.
//
// READ-ONLY TOWARD SQUARE, VIA THE ORG'S OAUTH TOKEN ONLY. getSquareClient(org)
// throws SQUARE_NOT_CONNECTED rather than falling back to the SQUARE_ACCESS_TOKEN
// personal token — which is exactly what src/lib/square.ts's fetchSquareTeamMembers
// DOES do (square.ts:139). THIS MODULE DELIBERATELY DOES NOT CALL THAT HELPER.
// Building wage reads on a credential the merchant never granted would repeat
// SQ-WB-1's defect on the most sensitive data in the product. Routing the five
// legacy call sites through the org client is SQ-3 item (b) and stays owed for
// the HR flows; when it lands, this reader and that helper can merge.
//
// SEAM (b) HOLDS. No core labor engine imports this — labor-budget.ts,
// labor-plan.ts, labor-coverage.ts and labor-forecast.ts still run entirely on
// LaborPosition, and the weekly budget's blended rate is untouched. That is
// Gary's Q3 ruling made structural: the Square roster is a VIEW, never an input.

// ─── SHAPES ───────────────────────────────────────────────────────────────────

type SquareMoney = { amount?: number; currency?: string } | null | undefined

type SquareJobAssignment = {
  job_title?: string
  job_id?: string
  pay_type?: string
  hourly_rate?: SquareMoney
  annual_rate?: SquareMoney
  weekly_hours?: number
}

type SquareWageSetting = {
  job_assignments?: SquareJobAssignment[]
  is_overtime_exempt?: boolean
  version?: number
  updated_at?: string
}

type SquareRosterMember = {
  id: string
  status?: string
  is_owner?: boolean
  assigned_locations?: {
    assignment_type?: "ALL_CURRENT_AND_FUTURE_LOCATIONS" | "EXPLICIT_LOCATIONS"
    location_ids?: string[]
  }
  wage_setting?: SquareWageSetting
}

/// One roster row as a surface renders it. NAME IS NOT IN HERE and is not in the
/// table either — it is joined from StaffMember by the caller. `staffMemberId`
/// null means Square knows this person and Froot has not imported them, which is
/// reported as a counted line, never dropped.
export type RosterRow = {
  squareTeamMemberId: string
  staffMemberId: string | null
  displayName: string | null
  status: string
  isOwner: boolean
  jobTitle: string | null
  payType: string | null
  /// Dollars. Null = not set in Square — a sentence, never $0 (Gary, Q1).
  hourlyRate: number | null
  annualRate: number | null
  /// Square's own weekly_hours, the default under weeklyHoursOverride.
  squareWeeklyHours: number | null
  /// FROOT-OWNED, and nothing reads them yet — see the schema note.
  weeklyHoursOverride: number | null
  isSupervisory: boolean | null
  /// > 1 means Square carries more than one job for this person and the row
  /// above shows the first. Surfaced rather than truncated silently.
  jobAssignmentCount: number
}

export type RosterResult = {
  rows: RosterRow[]
  /// Square members on this store with no StaffMember row. The fix is the
  /// existing Sync from Square action, so the count is actionable rather than
  /// decorative.
  unmatchedCount: number
  /// Square location ids on the roster that map to no Froot Store. Measured
  /// 2026-08-19: five of them across the Keva account, carrying 11 assignments.
  unmappedLocationCount: number
  /// max(syncedAt). Null = never synced. Unlike timecards, an org with ZERO team
  /// members is degenerate rather than a normal quiet day, so this is a valid
  /// freshness signal and needs no SquareLaborSyncState equivalent — see the
  /// schema comment, which explains why that is a distinction and not a
  /// contradiction of AL-1's Q3.
  syncedAt: Date | null
}

// ─── THE SYNC (ONE CALL FOR THE WHOLE ROSTER) ─────────────────────────────────

export type RosterSyncResult = { members: number; written: number; pages: number }

/// SearchTeamMembers RETURNS wage_setting INLINE, which is the finding that made
/// this phase cheap. Square's own docs recommend it over RetrieveWageSetting, and
/// it was verified live 2026-08-19 against the Keva account at Square-Version
/// 2026-01-22: 99 of 99 ACTIVE members carried a wage_setting, every one with
/// exactly one job assignment, 94 HOURLY with a rate and 5 SALARY with both an
/// annual rate and weekly hours. So the whole roster is ONE paginated call
/// rather than one call per member.
///
/// NO NEW OAUTH SCOPE. EMPLOYEES_READ already covers team, wage and job reads
/// (LABOR-0B Task 3, confirmed at source), and it has been in the authorize
/// string since long before the labor work. No consent batch, no merchant
/// re-auth — which is the opposite of the TIMECARDS_READ story AL-1 had to wait
/// on.
///
/// THE BETA CAVEAT AND ITS FALLBACK. TeamMember.wage_setting is marked Beta on
/// Square's object reference. Gary ruled to use it (Q1, 2026-08-19) with a
/// documented fallback chain: wage_setting → ListTeamMemberWages (GA, hourly
/// only) → the timecard snapshot. THE SECOND TIER IS IMPLEMENTED BELOW; the
/// third is not code — it is the fact that costing never read this table in the
/// first place, so a total failure here degrades the ROSTER and leaves labor %
/// exactly as it was.
export async function syncTeamMemberWages(
  org: Organization,
  status: "ACTIVE" | "INACTIVE" = "ACTIVE"
): Promise<RosterSyncResult> {
  const client = await getSquareClient(org)

  const collected: SquareRosterMember[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const res = await fetch(`${client.baseUrl}/v2/team-members/search`, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        query: { filter: { status } },
        // Square's documented maximum.
        limit: 200,
        ...(cursor ? { cursor } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      // The status rides in the message on purpose: a 403 here means the grant
      // is missing EMPLOYEES_READ and the fix is re-consent, not a code change.
      throw new Error(`SQUARE_TEAM_MEMBERS_${res.status}: ${body.slice(0, 300)}`)
    }
    const data = (await res.json()) as { team_members?: SquareRosterMember[]; cursor?: string }
    collected.push(...(data.team_members ?? []))
    cursor = data.cursor
    pages++
  } while (cursor)

  // TIER TWO OF THE FALLBACK CHAIN, and it runs only for the members that need
  // it. ListTeamMemberWages is GA where wage_setting is Beta, carries the same
  // EMPLOYEES_READ scope, and returns hourly_rate ONLY — no annual_rate, no
  // weekly_hours — so it can repair an hourly gap and can never repair a
  // salaried one. Measured 2026-08-19: zero members needed it, which is why the
  // call is CONDITIONAL rather than unconditional. Paying for a second round
  // trip on every sync to cover a case that has never occurred is the kind of
  // cost that outlives the reason for it.
  const missingWage = collected.filter((m) => !m.wage_setting)
  const fallbackRates = missingWage.length > 0 ? await fetchTeamMemberWages(client) : new Map()
  if (missingWage.length > 0) {
    console.log(
      `[labor-roster] org=${org.id} ${missingWage.length} member(s) had no wage_setting; ` +
        `ListTeamMemberWages resolved ${missingWage.filter((m) => fallbackRates.has(m.id)).length}`
    )
  }

  const written = await writeRoster(org, collected, fallbackRates, new Date())
  console.log(
    `[labor-roster] org=${org.id} status=${status}: ${collected.length} members, ${written} written, ${pages} page(s)`
  )
  return { members: collected.length, written, pages }
}

/// GET /v2/labor/team-member-wages — the GA hourly-only source. One paginated
/// sweep, keyed by team member; the LAST wage seen for a member wins, which is
/// arbitrary but bounded: this only ever fills a gap that would otherwise render
/// "Not set in Square", and a wrong-job hourly rate is still that person's rate.
async function fetchTeamMemberWages(
  client: Awaited<ReturnType<typeof getSquareClient>>
): Promise<Map<string, { hourlyRate: number | null; jobTitle: string | null; jobId: string | null }>> {
  const out = new Map<string, { hourlyRate: number | null; jobTitle: string | null; jobId: string | null }>()
  let cursor: string | undefined
  try {
    do {
      const url = new URL(`${client.baseUrl}/v2/labor/team-member-wages`)
      url.searchParams.set("limit", "200")
      if (cursor) url.searchParams.set("cursor", cursor)
      const res = await fetch(url, { headers: client.headers })
      if (!res.ok) {
        console.error(`[labor-roster] ListTeamMemberWages HTTP ${res.status} — gaps stay unresolved`)
        return out
      }
      const data = (await res.json()) as {
        team_member_wages?: { team_member_id?: string; title?: string; job_id?: string; hourly_rate?: SquareMoney }[]
        cursor?: string
      }
      for (const w of data.team_member_wages ?? []) {
        if (!w.team_member_id) continue
        out.set(w.team_member_id, {
          hourlyRate: moneyToDollars(w.hourly_rate),
          jobTitle: w.title ?? null,
          jobId: w.job_id ?? null,
        })
      }
      cursor = data.cursor
    } while (cursor)
  } catch (e) {
    // A fallback that throws would take down a sync that has already succeeded
    // for every member Square answered properly. Log and return what we have.
    console.error("[labor-roster] ListTeamMemberWages failed — gaps stay unresolved:", e)
  }
  return out
}

/// THE GUARDED UPSERT, and the guard is the part that matters here.
///
/// One INSERT ... ON CONFLICT ... DO UPDATE, never check-then-act — BUG-7's
/// shape, the same one writeTimecards uses. Rows are sorted by id so every
/// writer takes its locks in the same order.
///
/// THE DO UPDATE LIST DELIBERATELY OMITS weeklyHoursOverride AND isSupervisory.
/// They are Froot-owned (vision item 10: "WK HRS and SUP stay Froot-adjustable")
/// and Square has no opinion about either, so a resync must not clobber a value
/// a human set — the discipline StaffMember.fullNameLocked already encodes for
/// the legal name. IF A LATER EDIT ADDS THEM TO THIS LIST, every supervisory
/// flag in the org is erased by the next sync, silently.
async function writeRoster(
  org: Organization,
  members: SquareRosterMember[],
  fallback: Map<string, { hourlyRate: number | null; jobTitle: string | null; jobId: string | null }>,
  syncedAt: Date
): Promise<number> {
  if (members.length === 0) return 0

  const byId = new Map<string, SquareRosterMember>()
  for (const m of members) byId.set(m.id, m)
  const ordered = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  let multiJob = 0
  const values = ordered.map((m) => {
    const assignments = m.wage_setting?.job_assignments ?? []
    if (assignments.length > 1) multiJob++
    const primary = assignments[0]
    const fb = fallback.get(m.id)
    const assigned = m.assigned_locations
    const allLocations = assigned?.assignment_type === "ALL_CURRENT_AND_FUTURE_LOCATIONS" || !assigned

    return Prisma.sql`(${randomUUID()}, ${org.id}, ${m.id}, ${m.status ?? "ACTIVE"},
      ${m.is_owner ?? false}, ${allLocations}, ${allLocations ? [] : (assigned?.location_ids ?? [])},
      ${primary?.job_title ?? fb?.jobTitle ?? null}, ${primary?.job_id ?? fb?.jobId ?? null},
      ${primary?.pay_type ?? null}, ${assignments.length},
      ${moneyToDollars(primary?.hourly_rate) ?? fb?.hourlyRate ?? null},
      ${moneyToDollars(primary?.annual_rate)},
      ${typeof primary?.weekly_hours === "number" ? Math.round(primary.weekly_hours) : null},
      ${m.wage_setting?.is_overtime_exempt ?? null}, ${m.wage_setting?.version ?? null},
      ${m.wage_setting?.updated_at ? new Date(m.wage_setting.updated_at) : null},
      ${syncedAt}, ${syncedAt})`
  })

  if (multiJob > 0) {
    // NO SILENT TRUNCATION. jobAssignmentCount carries the fact into the row and
    // the card renders it; this line is the operator-invisible half. Measured
    // 2026-08-19: zero members carried more than one, so a nonzero count here is
    // genuinely new information about the account.
    console.log(`[labor-roster] org=${org.id} ${multiJob} member(s) carry >1 job assignment; the first is stored`)
  }

  const won = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "SquareTeamMemberWage" (
      "id", "organizationId", "squareTeamMemberId", "status",
      "isOwner", "allLocations", "locationIds",
      "jobTitle", "jobId", "payType", "jobAssignmentCount",
      "hourlyRate", "annualRate", "squareWeeklyHours",
      "isOvertimeExempt", "wageVersion", "squareUpdatedAt",
      "syncedAt", "updatedAt"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("organizationId", "squareTeamMemberId") DO UPDATE SET
      "status"             = EXCLUDED."status",
      "isOwner"            = EXCLUDED."isOwner",
      "allLocations"       = EXCLUDED."allLocations",
      "locationIds"        = EXCLUDED."locationIds",
      "jobTitle"           = EXCLUDED."jobTitle",
      "jobId"              = EXCLUDED."jobId",
      "payType"            = EXCLUDED."payType",
      "jobAssignmentCount" = EXCLUDED."jobAssignmentCount",
      "hourlyRate"         = EXCLUDED."hourlyRate",
      "annualRate"         = EXCLUDED."annualRate",
      "squareWeeklyHours"  = EXCLUDED."squareWeeklyHours",
      "isOvertimeExempt"   = EXCLUDED."isOvertimeExempt",
      "wageVersion"        = EXCLUDED."wageVersion",
      "squareUpdatedAt"    = EXCLUDED."squareUpdatedAt",
      "syncedAt"           = EXCLUDED."syncedAt",
      "updatedAt"          = EXCLUDED."updatedAt"
    RETURNING "id"
  `
  return won.length
}

function moneyToDollars(m: SquareMoney): number | null {
  if (!m || typeof m.amount !== "number") return null
  return m.amount / 100
}

// ─── THE READS ────────────────────────────────────────────────────────────────

/// One store's roster. THE CALLER HAS ALREADY PASSED canSeeWages — this function
/// selects wage columns unconditionally, and that is safe only because every
/// call site is behind the gate. It is not a second gate and must never be
/// mistaken for one.
///
/// Store membership comes from Square's own assigned_locations, never from
/// StaffMember.primaryStore: DEBT-9's boundary, confirmed 2026-08-02 and
/// restated by AL-1. A member flagged allLocations belongs to EVERY store, which
/// is why per-store roster counts legitimately sum past the org total.
export async function getStoreRoster(
  org: Organization,
  squareLocationId: string | null,
  knownLocationIds: string[]
): Promise<RosterResult> {
  const rows = await prisma.squareTeamMemberWage.findMany({
    where: { organizationId: org.id, status: "ACTIVE" },
  })
  if (rows.length === 0) {
    return { rows: [], unmatchedCount: 0, unmappedLocationCount: 0, syncedAt: null }
  }

  const known = new Set(knownLocationIds)
  // Square locations on the roster that Froot has no Store for. Counted across
  // the WHOLE roster rather than this store's slice, because the fact being
  // reported is about the account's mapping, not about one store.
  const unmapped = new Set<string>()
  for (const r of rows) for (const id of r.locationIds) if (!known.has(id)) unmapped.add(id)

  const mine = squareLocationId
    ? rows.filter((r) => r.allLocations || r.locationIds.includes(squareLocationId))
    : []

  const staff = await prisma.staffMember.findMany({
    where: {
      organizationId: org.id,
      squareTeamMemberId: { in: mine.map((r) => r.squareTeamMemberId) },
    },
    select: { id: true, displayName: true, squareTeamMemberId: true },
  })
  const staffBySquareId = new Map(staff.map((s) => [s.squareTeamMemberId!, s]))

  const out: RosterRow[] = mine.map((r) => {
    const match = staffBySquareId.get(r.squareTeamMemberId)
    return {
      squareTeamMemberId: r.squareTeamMemberId,
      staffMemberId: match?.id ?? null,
      displayName: match?.displayName ?? null,
      status: r.status,
      isOwner: r.isOwner,
      jobTitle: r.jobTitle,
      payType: r.payType,
      hourlyRate: r.hourlyRate === null ? null : Number(r.hourlyRate),
      annualRate: r.annualRate === null ? null : Number(r.annualRate),
      squareWeeklyHours: r.squareWeeklyHours,
      weeklyHoursOverride: r.weeklyHoursOverride,
      isSupervisory: r.isSupervisory,
      jobAssignmentCount: r.jobAssignmentCount,
    }
  })
  // Named members first, then the unmatched, each group alphabetical — so the
  // gap collects at the bottom instead of scattering through the roster.
  out.sort((a, b) => {
    if ((a.displayName === null) !== (b.displayName === null)) return a.displayName === null ? 1 : -1
    return (a.displayName ?? a.squareTeamMemberId).localeCompare(b.displayName ?? b.squareTeamMemberId)
  })

  return {
    rows: out,
    unmatchedCount: out.filter((r) => r.staffMemberId === null).length,
    unmappedLocationCount: unmapped.size,
    syncedAt: rows.reduce<Date | null>((m, r) => (m === null || r.syncedAt > m ? r.syncedAt : m), null),
  }
}

/// Pay for a set of Froot staff members, keyed by StaffMember.id — the /staff
/// list's read. ONE QUERY regardless of roster size, and it selects nothing for
/// a member with no squareTeamMemberId, which is how a manually-added staff row
/// renders "—" rather than someone else's wage.
///
/// AGAIN: THE CALLER HAS ALREADY PASSED canSeeWages. Every one of the three call
/// sites gates before calling, and the /staff page does not even build the id
/// list when the gate is closed.
export async function getPayForStaff(
  org: Organization,
  staff: { id: string; squareTeamMemberId: string | null }[]
): Promise<Map<string, { payType: string | null; hourlyRate: number | null; annualRate: number | null; jobTitle: string | null }>> {
  const out = new Map<string, { payType: string | null; hourlyRate: number | null; annualRate: number | null; jobTitle: string | null }>()
  const squareIds = staff.map((s) => s.squareTeamMemberId).filter((v): v is string => v !== null)
  if (squareIds.length === 0) return out

  const rows = await prisma.squareTeamMemberWage.findMany({
    where: { organizationId: org.id, squareTeamMemberId: { in: squareIds } },
    select: { squareTeamMemberId: true, payType: true, hourlyRate: true, annualRate: true, jobTitle: true },
  })
  const bySquareId = new Map(rows.map((r) => [r.squareTeamMemberId, r]))

  for (const s of staff) {
    if (!s.squareTeamMemberId) continue
    const row = bySquareId.get(s.squareTeamMemberId)
    if (!row) continue
    out.set(s.id, {
      payType: row.payType,
      hourlyRate: row.hourlyRate === null ? null : Number(row.hourlyRate),
      annualRate: row.annualRate === null ? null : Number(row.annualRate),
      jobTitle: row.jobTitle,
    })
  }
  return out
}

/// max(syncedAt) for the org's roster — the freshness stamp the cards print.
export async function getRosterSyncedAt(organizationId: string): Promise<Date | null> {
  const row = await prisma.squareTeamMemberWage.findFirst({
    where: { organizationId },
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  })
  return row?.syncedAt ?? null
}
