import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import type { Organization, Store } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSquareClient } from "@/lib/square"
import { dbDate, localDateStr } from "@/lib/reports"

// AL-1 — ADVANCED LABOR PHASE 1. Design record: docs/ADVANCED_LABOR.md.
//
// THE COMPARISON LAYER, and it sits on TOP of forecast-driven labor rather than
// under it. L-2 seam (b): the core engines — labor-budget.ts, labor-plan.ts,
// labor-coverage.ts, labor-forecast.ts — NEVER import this module and never gain
// a Square-sourced input. THE BOUNDARY TEST is a real test to run before
// shipping: drop SquareTimecard and SquareLaborSyncState and every existing
// labor surface must render BYTE-IDENTICALLY. If anything moves, the boundary
// leaked.
//
// READ-ONLY TOWARD SQUARE, ABSOLUTELY (Gary, 2026-08-18). Every call here goes
// through getSquareClient(org), which uses the merchant's OAuth token and throws
// SQUARE_NOT_CONNECTED rather than falling back to the SQUARE_ACCESS_TOKEN
// personal token the way fetchSquareTeamMembers does. A sync that silently ran
// on the personal token would repeat the exact defect SQ-WB-1 removed: a
// credential not constrained by the merchant's consent grant.

// ─── SHAPES ───────────────────────────────────────────────────────────────────

/// seam (c)'s three states, plus the distinction that makes them meaningful.
/// "never" is NOT "0 hours" — absent data reads "not synced", which is a
/// different sentence, and conflating them is the defect this whole module is
/// arranged to avoid.
export type LaborHealth = "fresh" | "stale" | "error" | "never"

export type LaborActualsTimecard = {
  startAt: Date
  endAt: Date | null
  breakUnpaidMinutes: number
  /// null = Square has no wage configured for this team member. NOT zero.
  wageHourlyRate: number | null
}

export type LaborActualsSyncState = {
  lastSyncOkAt: Date | null
  lastError: string | null
} | null

export type LaborActualsResult = {
  /// null when sales are zero — cost with no sales is "no sales yet", which is
  /// not the same statement as "0% labor". NEVER render this as a 0.
  ///
  /// AL-2: MEASURED OVER THE COVERED DAYS ONLY (see daysCovered below), so the
  /// numerator and the denominator always describe the same days.
  laborPct: number | null
  /// Dollars. A FLOOR, not a total, whenever costComplete is false.
  laborCost: number
  laborHours: number
  /// Dollars. Net sales (gross − tax − tips) — Gary's ruling, 2026-08-18.
  /// AL-2: net sales ON THE COVERED DAYS, which is laborPct's actual denominator.
  sales: number
  /// AL-2 — THE COVERAGE PAIR, and the reason laborPct can be trusted over a
  /// partly-synced window.
  ///
  /// Store-local days in the requested window that carry at least one timecard,
  /// against the number of days the window spans. A month with timecards for
  /// three days and sales for nineteen is the defect this pair exists to prevent:
  /// three days of cost over nineteen days of sales renders ~5% against a 20%
  /// target — a confident, wrong, REASSURING number, which is the worst kind.
  /// Both sides are therefore restricted to the covered days, and the surface
  /// says "N of M days synced" whenever they differ (Gary, 2026-08-19).
  daysCovered: number
  daysInWindow: number
  health: LaborHealth
  timecardCount: number
  /// People currently on the clock. Their cost is projected to `now` and will
  /// grow, so a surface rendering this number must say it is moving.
  openTimecardCount: number
  /// Timecards whose wage Square does not carry. The seam requires the
  /// integration WARN on the gap rather than render a silent zero.
  wageMissingCount: number
  costComplete: boolean
  /// ALWAYS false in Phase 1 — straight time only, so laborCost UNDERSTATES
  /// wherever overtime occurred. Returned as data rather than assumed so a
  /// Phase-2 card cannot render the number as if OT were handled, and so the day
  /// OT lands nothing has to guess whether an old response included it.
  /// Overtime stays deferred by ruling (Gary, 2026-08-18).
  otApplied: false
  lastSyncOkAt: string | null
}

// Dollars ↔ integer cents. docs/LABOR.md § Money convention: dollars in and out,
// cents internally, so nothing drifts by a float penny.
const toCents = (dollars: number) => Math.round(dollars * 100)
const toDollars = (cents: number) => cents / 100

/// One interval plus a margin, so a single missed cron run does not cry wolf.
/// Phase 1 registers no cron (Gary's ruling), so this is the on-demand answer:
/// a sync older than a day is stale.
export const DEFAULT_STALE_AFTER_MINUTES = 26 * 60

// ─── THE CALCULATION (PURE — no DB, no network) ───────────────────────────────

/// Labor cost over net sales for one store and one window. PURE so it is
/// unit-testable without a database, in the shape of computeWeeklyLaborBudget
/// (scripts/verify-labor-budget.ts); its fixture is
/// scripts/verify-labor-actuals.ts.
///
/// PHASE 1 IS STRAIGHT TIME. No overtime rule, no salaried allocation, no tips
/// in the cost — all three deferred with a ruling behind each
/// (docs/ADVANCED_LABOR.md § Open questions Q5, Q6).
export function computeLaborActuals({
  timecards,
  netSales,
  now,
  windowEnd,
  syncState,
  daysCovered = 1,
  daysInWindow = 1,
  staleAfterMinutes = DEFAULT_STALE_AFTER_MINUTES,
}: {
  timecards: LaborActualsTimecard[]
  /// Net sales ON THE COVERED DAYS. The caller restricts this — see
  /// getLaborActuals — so this function never divides days by other days.
  netSales: number
  now: Date
  /// The end of the requested window. An OPEN timecard is costed to whichever
  /// of `now` and this comes FIRST — a card left open on Tuesday must not
  /// accrue cost into Thursday's query.
  windowEnd: Date
  syncState: LaborActualsSyncState
  /// AL-2 coverage pair. Both default to 1 so the single-day call this function
  /// was born with — where covered and window are the same day by construction —
  /// keeps its old meaning without every caller restating it.
  daysCovered?: number
  daysInWindow?: number
  staleAfterMinutes?: number
}): LaborActualsResult {
  let paidMinutes = 0
  let costCents = 0
  let openCount = 0
  let wageMissing = 0

  const ceiling = Math.min(now.getTime(), windowEnd.getTime())

  for (const tc of timecards) {
    const isOpen = tc.endAt === null
    if (isOpen) openCount++

    const endMs = isOpen ? ceiling : tc.endAt!.getTime()
    const grossMinutes = (endMs - tc.startAt.getTime()) / 60000
    // A negative span is a clock skew or a bad row, never negative work. Clamp
    // rather than subtract from the total — a corrupt row must not make the
    // estate's labor look cheaper than it is.
    if (grossMinutes <= 0) continue

    // Paid breaks are compensable and stay inside gross; unpaid breaks come out.
    // Clamped at zero for the same reason.
    const minutes = Math.max(0, grossMinutes - tc.breakUnpaidMinutes)
    paidMinutes += minutes

    if (tc.wageHourlyRate === null) {
      // Hours still count — the person worked. Only the DOLLARS are unknown, and
      // costComplete below is what says so. Dropping the hours as well would
      // hide the gap instead of reporting it.
      wageMissing++
      continue
    }
    costCents += Math.round((minutes / 60) * toCents(tc.wageHourlyRate))
  }

  const laborCost = toDollars(costCents)
  const salesCents = toCents(netSales)

  return {
    // Integer-cents division on both sides, so the percentage never inherits a
    // float penny from either input.
    laborPct: salesCents > 0 ? (costCents / salesCents) * 100 : null,
    laborCost,
    laborHours: paidMinutes / 60,
    sales: toDollars(salesCents),
    daysCovered,
    daysInWindow,
    health: computeHealth(syncState, now, staleAfterMinutes),
    timecardCount: timecards.length,
    openTimecardCount: openCount,
    wageMissingCount: wageMissing,
    costComplete: wageMissing === 0,
    otApplied: false,
    lastSyncOkAt: syncState?.lastSyncOkAt?.toISOString() ?? null,
  }
}

/// Health is about the ATTEMPT, not about the rows. This is why
/// SquareLaborSyncState exists as its own table: a store that synced perfectly
/// and had nobody clocked in holds NO timecard rows, so max(syncedAt) over an
/// empty set is null and is indistinguishable from "never synced".
export function computeHealth(
  syncState: LaborActualsSyncState,
  now: Date,
  staleAfterMinutes: number
): LaborHealth {
  if (!syncState || !syncState.lastSyncOkAt) return "never"
  const ageMinutes = (now.getTime() - syncState.lastSyncOkAt.getTime()) / 60000
  if (syncState.lastError && ageMinutes > staleAfterMinutes) return "error"
  if (ageMinutes > staleAfterMinutes) return "stale"
  return "fresh"
}

// ─── THE READ (DB) ────────────────────────────────────────────────────────────

/// Loads one store's window and runs the calculation. AGGREGATES ONLY —
/// no per-person field is selected, so there is no per-person payload for a
/// caller to leak. DEBT-10 territory (138 employees' emails were exposed in
/// production) is answered by not assembling the data in the first place.
export async function getLaborActuals(
  org: Organization,
  store: Store,
  startDate: string,
  endDate: string,
  now = new Date()
): Promise<LaborActualsResult> {
  const rangeStart = localMidnightUtc(startDate, store.timezone)
  const rangeEnd = localMidnightUtc(nextDay(endDate), store.timezone)

  const [rows, syncState] = await Promise.all([
    prisma.squareTimecard.findMany({
      where: { storeId: store.id, organizationId: org.id, startAt: { gte: rangeStart, lt: rangeEnd } },
      select: { startAt: true, endAt: true, breakUnpaidMinutes: true, wageHourlyRate: true },
    }),
    prisma.squareLaborSyncState.findUnique({
      where: { storeId: store.id },
      select: { lastSyncOkAt: true, lastError: true },
    }),
  ])

  // AL-2 — THE COVERED DAYS, derived from rows ALREADY LOADED. No second query,
  // and no per-person field is read to get it: a timecard's own startAt rendered
  // in the store's zone is the business day it belongs to, which is the same
  // notion of "a day" the sync's `workday` filter and SalesPeriodCache.date use.
  const coveredDates = [...new Set(rows.map((r) => localDateStr(r.startAt, store.timezone)))].sort()

  // THE DENOMINATOR IS RESTRICTED TO THOSE DAYS. `date: { in: … }` rather than a
  // range, so a month with three synced days divides three days of cost by three
  // days of sales instead of by nineteen. An empty set means no timecards at all,
  // and Prisma's `in: []` correctly sums nothing — laborPct then goes null via
  // the sales > 0 test, which reads "no sales yet" and never 0%.
  const sales = await prisma.salesPeriodCache.aggregate({
    where: { storeId: store.id, date: { in: coveredDates.map(dbDate) } },
    _sum: { netSales: true },
  })

  return computeLaborActuals({
    timecards: rows.map((r) => ({
      startAt: r.startAt,
      endAt: r.endAt,
      breakUnpaidMinutes: r.breakUnpaidMinutes,
      wageHourlyRate: r.wageHourlyRate === null ? null : Number(r.wageHourlyRate),
    })),
    netSales: sales._sum.netSales ?? 0,
    now,
    windowEnd: rangeEnd,
    syncState,
    daysCovered: coveredDates.length,
    daysInWindow: daysInclusive(startDate, endDate),
    })
}

/// AL-2 — THE SAME READ FOR MANY STORES IN A FIXED NUMBER OF QUERIES.
///
/// The All Locations view asks for every store at once. Looping getLaborActuals
/// over nine stores is 27 round trips; this is THREE, regardless of how many
/// stores are passed. Still aggregates only — the select list is identical to the
/// single-store read plus `storeId`, so there is no per-person field to leak here
/// either, and there is no per-person field for a caller to ask for.
///
/// Each store keeps its OWN timezone and its OWN covered-day set: the window is
/// given as store-local yyyy-mm-dd and resolved per store, because two stores in
/// different zones do not share a business day.
export async function getLaborActualsForStores(
  org: Organization,
  stores: Store[],
  startDate: string,
  endDate: string,
  now = new Date()
): Promise<Map<string, LaborActualsResult>> {
  const out = new Map<string, LaborActualsResult>()
  if (stores.length === 0) return out

  // One window per store, then the widest span of them all for the single
  // timecard query — the per-store bounds are re-applied in memory below, so a
  // store never sees another store's zone shift.
  const bounds = new Map(
    stores.map((st) => [
      st.id,
      { start: localMidnightUtc(startDate, st.timezone), end: localMidnightUtc(nextDay(endDate), st.timezone) },
    ])
  )
  const widestStart = new Date(Math.min(...[...bounds.values()].map((b) => b.start.getTime())))
  const widestEnd = new Date(Math.max(...[...bounds.values()].map((b) => b.end.getTime())))

  const storeIds = stores.map((st) => st.id)
  const [rows, syncStates] = await Promise.all([
    prisma.squareTimecard.findMany({
      where: {
        organizationId: org.id,
        storeId: { in: storeIds },
        startAt: { gte: widestStart, lt: widestEnd },
      },
      select: { storeId: true, startAt: true, endAt: true, breakUnpaidMinutes: true, wageHourlyRate: true },
    }),
    prisma.squareLaborSyncState.findMany({
      where: { storeId: { in: storeIds } },
      select: { storeId: true, lastSyncOkAt: true, lastError: true },
    }),
  ])

  const syncByStore = new Map(syncStates.map((r) => [r.storeId, { lastSyncOkAt: r.lastSyncOkAt, lastError: r.lastError }]))
  const rowsByStore = new Map<string, typeof rows>()
  for (const r of rows) {
    const b = bounds.get(r.storeId)
    // The widest-span query can hand a store rows from outside ITS OWN window.
    // Drop them here rather than letting a zone shift smuggle an extra evening
    // shift into one store's day.
    if (!b || r.startAt < b.start || r.startAt >= b.end) continue
    const list = rowsByStore.get(r.storeId)
    if (list) list.push(r)
    else rowsByStore.set(r.storeId, [r])
  }

  const coveredByStore = new Map<string, string[]>()
  for (const st of stores) {
    const list = rowsByStore.get(st.id) ?? []
    coveredByStore.set(st.id, [...new Set(list.map((r) => localDateStr(r.startAt, st.timezone)))].sort())
  }

  // The third query: net sales for every (store, covered day) pair at once. An OR
  // of per-store day sets, grouped by store — one round trip for the whole estate.
  const salesPairs = stores
    .filter((st) => (coveredByStore.get(st.id) ?? []).length > 0)
    .map((st) => ({ storeId: st.id, date: { in: (coveredByStore.get(st.id) ?? []).map(dbDate) } }))
  const salesRows =
    salesPairs.length > 0
      ? await prisma.salesPeriodCache.groupBy({
          by: ["storeId"],
          where: { OR: salesPairs },
          _sum: { netSales: true },
        })
      : []
  const salesByStore = new Map(salesRows.map((r) => [r.storeId, r._sum.netSales ?? 0]))

  const windowDays = daysInclusive(startDate, endDate)
  for (const st of stores) {
    const list = rowsByStore.get(st.id) ?? []
    const covered = coveredByStore.get(st.id) ?? []
    out.set(
      st.id,
      computeLaborActuals({
        timecards: list.map((r) => ({
          startAt: r.startAt,
          endAt: r.endAt,
          breakUnpaidMinutes: r.breakUnpaidMinutes,
          wageHourlyRate: r.wageHourlyRate === null ? null : Number(r.wageHourlyRate),
        })),
        netSales: salesByStore.get(st.id) ?? 0,
        now,
        windowEnd: bounds.get(st.id)!.end,
        syncState: syncByStore.get(st.id) ?? null,
        daysCovered: covered.length,
        daysInWindow: windowDays,
      })
    )
  }
  return out
}

// ─── THE SYNC (POLL, NOT WEBHOOK) ─────────────────────────────────────────────

export type LaborSyncResult = { timecards: number; written: number; pages: number }

type SquareMoney = { amount?: number; currency?: string } | null | undefined
type SquareBreak = { start_at?: string; end_at?: string | null; is_paid?: boolean }
type SquareTimecardPayload = {
  id: string
  location_id: string
  team_member_id: string
  start_at: string
  end_at?: string | null
  status?: string
  version?: number
  created_at?: string
  updated_at?: string
  timezone?: string
  declared_cash_tip_money?: SquareMoney
  breaks?: SquareBreak[]
  wage?: { title?: string; job_id?: string; hourly_rate?: SquareMoney; tip_eligible?: boolean }
}

/// Pulls one store's timecards for a store-local workday range and mirrors them.
///
/// WHY `workday` AND NOT `start`. Square's `start` filter is an absolute-instant
/// range; `workday` is a store-local business-day range. An operator asking for
/// "Tuesday" means the store's Tuesday, and slicing at a UTC boundary would cut
/// the evening shift off one store and onto the next day for another. The
/// DENOMINATOR of the labor percentage — SalesPeriodCache.date — is already a
/// store-local business day (sales-sync uses localDateStr with store.timezone),
/// so using an absolute range here would divide two different notions of "a day"
/// by each other.
///
/// NEVER THROWS INTO A LABOR SURFACE. Every failure is recorded on
/// SquareLaborSyncState.lastError and re-thrown to the CALLER, which is a route
/// that owns its own response — the rows already stored are untouched and read
/// as stale. That is seam (c)'s ON BUT UNHEALTHY, and DON'T #5: an integration
/// error is never dressed as a 401.
export async function syncTimecardsForStore(
  org: Organization,
  store: Store,
  startDate: string,
  endDate: string
): Promise<LaborSyncResult> {
  if (!store.squareLocationId) throw new Error("STORE_NOT_LINKED")

  const startedAt = new Date()
  await recordSyncStarted(org.id, store.id, startedAt, startDate, endDate)

  try {
    const client = await getSquareClient(org)
    const collected: SquareTimecardPayload[] = []
    let cursor: string | undefined
    let pages = 0

    do {
      const res = await fetch(`${client.baseUrl}/v2/labor/timecards/search`, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({
          query: {
            filter: {
              location_ids: [store.squareLocationId],
              workday: {
                date_range: { start_date: startDate, end_date: endDate },
                match_timecards_by: "START_AT",
                default_timezone: store.timezone,
              },
            },
          },
          // Square's documented maximum. Fewer pages is fewer round trips against
          // a rate limit Square does not publish.
          limit: 200,
          cursor,
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        // The status is carried in the message on purpose: a 403 here means the
        // merchant's grant is missing TIMECARDS_READ and the fix is re-running
        // the consent URL, not a code change (see labor/verify/route.ts).
        throw new Error(`SQUARE_TIMECARDS_${res.status}: ${body.slice(0, 300)}`)
      }

      const data = (await res.json()) as { timecards?: SquareTimecardPayload[]; cursor?: string }
      collected.push(...(data.timecards ?? []))
      cursor = data.cursor
      pages++
    } while (cursor)

    const written = await writeTimecards(org, store, collected, new Date())
    await recordSyncOk(store.id, new Date(), collected.length)
    console.log(
      `[labor-actuals] org=${org.id} store=${store.id} ${startDate}..${endDate}: ` +
        `${collected.length} timecards, ${written} written, ${pages} page(s)`
    )
    return { timecards: collected.length, written, pages }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed"
    // Log the REAL cause before anything upstream gets a chance to mask it —
    // BUG-1's lesson, which is live in labor-access.ts's 401-swallowing catch.
    console.error(`[labor-actuals] org=${org.id} store=${store.id}: ${msg}`)
    await recordSyncError(store.id, msg)
    throw e
  }
}

/// THE GUARDED UPSERT. BUG-7's lesson, with a better guard column than
/// sales-sync could use.
///
/// One INSERT ... ON CONFLICT ... DO UPDATE ... WHERE, never check-then-act:
/// ON CONFLICT takes the row lock, so a second writer blocks until the first
/// commits and then re-evaluates against the COMMITTED value. There is no window
/// to insert into and P2002 becomes structurally impossible.
///
/// THE GUARD IS SQUARE'S `version`, NOT OUR READ CLOCK. sales-sync.ts guards on
/// syncedAt because Square's orders carry no version worth trusting; timecards
/// carry one that Square increments on every update. So a slow sync that read
/// version 3 cannot clobber a fast sync that read version 4 REGARDLESS OF COMMIT
/// ORDER — the ordering is the source's, not ours, which is strictly stronger.
///
/// `<=` rather than `<` is deliberate: an equal version means identical content,
/// and letting the write through refreshes syncedAt instead of leaving a row
/// looking older than the sync that just confirmed it.
///
/// RE-RUNNING A WINDOW IS SAFE BY CONSTRUCTION. The window is a filter, not a
/// delete — no deleteMany precedes this — so a re-run with a wider or narrower
/// window can only add or refresh rows. KNOWN LIMIT, recorded rather than
/// hidden: a timecard DELETED in Square persists here as a stale row. A
/// reconciliation pass belongs to a later phase and needs a ruling on whether a
/// deleted timecard should vanish or be tombstoned.
async function writeTimecards(
  org: Organization,
  store: Store,
  payloads: SquareTimecardPayload[],
  syncedAt: Date
): Promise<number> {
  if (payloads.length === 0) return 0

  // De-duplicated because ON CONFLICT rejects a batch that touches one row twice
  // ("cannot affect row a second time"), and sorted so every writer takes its
  // row locks in the same order — sales-sync.ts's deadlock argument, unchanged.
  const byId = new Map<string, SquareTimecardPayload>()
  for (const p of payloads) byId.set(p.id, p)
  const ordered = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const values = ordered.map((p) => {
    const breaks = summarizeBreaks(p.breaks)
    return Prisma.sql`(${randomUUID()}, ${org.id}, ${store.id}, ${p.id}, ${p.team_member_id},
      ${p.location_id}, ${new Date(p.start_at)}, ${p.end_at ? new Date(p.end_at) : null},
      ${p.status ?? "CLOSED"}, ${p.version ?? 0},
      ${p.created_at ? new Date(p.created_at) : new Date(p.start_at)},
      ${p.updated_at ? new Date(p.updated_at) : new Date(p.start_at)},
      ${breaks.paidMinutes}, ${breaks.unpaidMinutes},
      ${p.wage?.title ?? null}, ${p.wage?.job_id ?? null},
      ${moneyToDollars(p.wage?.hourly_rate)}, ${p.wage?.tip_eligible ?? null},
      ${moneyToDollars(p.declared_cash_tip_money)}, ${p.timezone ?? null},
      ${syncedAt}, ${syncedAt})`
  })

  // `new Date(rfc3339WithOffset)` is the whole UTC story. Square sends start_at
  // and end_at ALREADY SHIFTED TO THE LOCATION'S OFFSET (e.g.
  // "2026-08-18T09:00:00-07:00"); Date parses the offset and yields the correct
  // UTC instant, which is what TIMESTAMP(3) stores. Display-local conversion is
  // the reader's job, via Store.timezone. See CLAUDE.md § "A DATABASE TIMESTAMP
  // IS UTC" — the trap that fired three times in one day.
  const won = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "SquareTimecard" (
      "id", "organizationId", "storeId", "squareTimecardId", "squareTeamMemberId",
      "squareLocationId", "startAt", "endAt", "status", "squareVersion",
      "squareCreatedAt", "squareUpdatedAt", "breakPaidMinutes", "breakUnpaidMinutes",
      "wageTitle", "wageJobId", "wageHourlyRate", "wageTipEligible",
      "declaredCashTips", "timezone", "syncedAt", "updatedAt"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("organizationId", "squareTimecardId") DO UPDATE SET
      "storeId"            = EXCLUDED."storeId",
      "squareTeamMemberId" = EXCLUDED."squareTeamMemberId",
      "squareLocationId"   = EXCLUDED."squareLocationId",
      "startAt"            = EXCLUDED."startAt",
      "endAt"              = EXCLUDED."endAt",
      "status"             = EXCLUDED."status",
      "squareVersion"      = EXCLUDED."squareVersion",
      "squareCreatedAt"    = EXCLUDED."squareCreatedAt",
      "squareUpdatedAt"    = EXCLUDED."squareUpdatedAt",
      "breakPaidMinutes"   = EXCLUDED."breakPaidMinutes",
      "breakUnpaidMinutes" = EXCLUDED."breakUnpaidMinutes",
      "wageTitle"          = EXCLUDED."wageTitle",
      "wageJobId"          = EXCLUDED."wageJobId",
      "wageHourlyRate"     = EXCLUDED."wageHourlyRate",
      "wageTipEligible"    = EXCLUDED."wageTipEligible",
      "declaredCashTips"   = EXCLUDED."declaredCashTips",
      "timezone"           = EXCLUDED."timezone",
      "syncedAt"           = EXCLUDED."syncedAt",
      "updatedAt"          = EXCLUDED."updatedAt"
    WHERE "SquareTimecard"."squareVersion" <= EXCLUDED."squareVersion"
    RETURNING "id"
  `

  const discarded = ordered.length - won.length
  if (discarded > 0) {
    // The SUCCESS log, not an error log. BUG-7's corollary: when a fix removes an
    // error, the direct proof of the guard is the line the guard emits when it
    // WORKS. This is that line, and it is a count, never a rate — winners emit
    // nothing, so the denominator is invisible by construction.
    console.log(
      `[labor-actuals] store=${store.id} discarded ${discarded} superseded by a newer Square version`
    )
  }
  return won.length
}

/// Sums Square's breaks[] into paid and unpaid minutes. Paid breaks are
/// compensable time and stay inside the timecard's span; unpaid breaks come out
/// of it. An UNCLOSED break (no end_at) contributes zero — a break still running
/// has no known length, and guessing one would move the estate's labor number.
function summarizeBreaks(breaks: SquareBreak[] | undefined) {
  let paidMinutes = 0
  let unpaidMinutes = 0
  for (const b of breaks ?? []) {
    if (!b.start_at || !b.end_at) continue
    const minutes = (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000
    if (minutes <= 0) continue
    if (b.is_paid) paidMinutes += minutes
    else unpaidMinutes += minutes
  }
  return { paidMinutes: Math.round(paidMinutes), unpaidMinutes: Math.round(unpaidMinutes) }
}

/// Square Money is integer cents; this schema stores dollars as Decimal(10,2)
/// (docs/LABOR.md). ABSENT MONEY RETURNS null, NEVER 0 — Square carries a wage
/// only where team-member wage settings are configured, and a zero here would be
/// the silent zero the seam explicitly forbids.
function moneyToDollars(m: SquareMoney): number | null {
  if (!m || typeof m.amount !== "number") return null
  return m.amount / 100
}

// ─── SYNC STATE ───────────────────────────────────────────────────────────────

async function recordSyncStarted(
  organizationId: string,
  storeId: string,
  at: Date,
  startDate: string,
  endDate: string
) {
  await prisma.squareLaborSyncState.upsert({
    where: { storeId },
    create: {
      organizationId,
      storeId,
      lastSyncStartedAt: at,
      lastWindowStart: dbDate(startDate),
      lastWindowEnd: dbDate(endDate),
    },
    update: {
      lastSyncStartedAt: at,
      lastWindowStart: dbDate(startDate),
      lastWindowEnd: dbDate(endDate),
    },
  })
}

/// Clears lastError on success — a store that failed yesterday and succeeded
/// today is healthy, and leaving the stale error would keep it reading "error"
/// forever.
async function recordSyncOk(storeId: string, at: Date, timecardCount: number) {
  await prisma.squareLaborSyncState.update({
    where: { storeId },
    data: { lastSyncOkAt: at, lastTimecardCount: timecardCount, lastError: null },
  })
}

/// lastSyncOkAt is deliberately NOT touched. The last good sync is still the
/// last good sync; a failure makes the data OLDER, not absent, and seam (c)'s
/// badge wants to say when it was last true.
async function recordSyncError(storeId: string, message: string) {
  await prisma.squareLaborSyncState
    .update({ where: { storeId }, data: { lastError: message.slice(0, 500) } })
    .catch(() => {
      // The state row could not be written — log and move on rather than
      // replacing the real Square error with a Prisma one on the way out.
      console.error(`[labor-actuals] store=${storeId}: could not record sync error`)
    })
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────

/// The UTC instant of store-local midnight on a yyyy-mm-dd. Same job as
/// sales-sync's private helper of the same name; kept local so this module
/// imports nothing from a core labor engine and nothing from sales-sync.
function localMidnightUtc(dateStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T00:00:00.000Z`)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p = Object.fromEntries(dtf.formatToParts(guess).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  )
  return new Date(guess.getTime() - (asUtc - guess.getTime()))
}

/// Inclusive day span of a yyyy-mm-dd range. Calendar arithmetic on UTC midnights,
/// which is safe here because both ends are date STRINGS, not instants.
function daysInclusive(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
