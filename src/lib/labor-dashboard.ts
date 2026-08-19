import { after } from "next/server"
import type { Organization, Store } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { can, type PermissionUser } from "@/lib/permissions"
import { laborModuleAvailable, squareLaborAvailable } from "@/lib/auth"
import { localDateStr } from "@/lib/reports"
import {
  getLaborActuals,
  getLaborActualsForStores,
  getTipPayoutForStores,
  syncTimecardsForStore,
  type TipPayoutResult,
} from "@/lib/labor-actuals"
import { aggregateLaborActuals, toLaborBlock, type EstateLaborBlock, type LaborBlock } from "@/lib/labor-judgment"
import type { TipBlock } from "@/lib/labor-costs"

// AL-2 — THE DASHBOARD'S ONE DOOR TO SQUARE LABOR. Design record:
// docs/ADVANCED_LABOR.md § Phase 2.
//
// AL-3 WIDENED IT PAST THE DASHBOARD, and the name is now slightly smaller than
// the file. canSeeWages below is asked by /staff, /staff/[id] and the Positions
// card as well as by the All Locations table. Keeping it here rather than
// starting a fifth labor module is deliberate: this file already owns
// laborOverlayOn and laborDollarsVisible, and a wage gate that did not sit beside
// them would be a second answer to "which gates are on" waiting to disagree with
// the first.
//
// Three dashboard routes (sales, summary, rollup) need the same four gates, the
// same target lookup and the same freshness policy. They get them here rather
// than three times over, because a gate copied three times is a gate that is
// eventually only checked twice.
//
// THE GATES, IN ORDER, AND THE ORDER IS THE ONE requireSquareLabor USES:
//   1. laborModuleAvailable(env)      — does Labor exist in this environment
//   2. org.activeModules "labor"      — has the org bought the module
//   3. squareLaborAvailable(env)      — does the Square overlay exist here
//   4. org.squareLaborEnabled         — has the admin turned it on
//   5. can(actor, "labor.actuals.view") — may THIS PERSON see the percentage
//
// GATE 1-4 OFF ⇒ THE DASHBOARD RENDERS EXACTLY AS IT DID BEFORE AL-2. Not a
// zeroed field, not a null field, not an empty card — NO FIELD AT ALL, which is
// what makes the boundary test a test rather than a promise: with the toggle off
// the payloads are byte-identical to Phase 1's.
//
// WHAT IS DELIBERATELY *NOT* A GATE: whether Square is currently connected.
// Gary's ruling of 2026-08-05, re-affirmed as AL-2's R1 (2026-08-19): a
// disconnect degrades the card to ON BUT UNHEALTHY with a last-synced stamp, and
// NEVER removes it. "Renders exactly as today" binds the toggle and the env
// gates only. Hiding data Froot still holds because a token expired would be the
// opposite of the ruling.

/// The same 15 minutes /api/dashboard/summary and /api/dashboard/sales already
/// use for the sales cache. One number for both halves of one percentage.
const SYNC_COOLDOWN_MS = 15 * 60 * 1000

/// AL-2 A3 — the fan-out bound for the All Locations view. Nine stores on one
/// load would be nine Square round trips inside a route whose maxDuration is 60.
/// Three per load, cooldown-gated, and the remainder is picked up by the next
/// load — the estate converges within a couple of refreshes and no single request
/// can spend the whole estate's quota. THE DROP IS LOGGED (see below): a silent
/// cap reads as full coverage, which is the failure mode this repo keeps filing.
const MAX_SYNCS_PER_LOAD = 3

export function laborOverlayOn(org: Organization): boolean {
  return (
    laborModuleAvailable(org.clerkOrgId) &&
    org.activeModules.includes("labor") &&
    squareLaborAvailable(org.clerkOrgId) &&
    org.squareLaborEnabled
  )
}

/// Gates 1-5 together. `null` means "this dashboard carries no labor field at
/// all" — the caller spreads nothing rather than spreading a null.
export function laborVisible(org: Organization, actor: PermissionUser): boolean {
  return laborOverlayOn(org) && can(actor, "labor.actuals.view")
}

/// AL-3 — THE WAGE GATE. Gates 1-4 (laborOverlayOn) PLUS labor.costs.view.
///
/// THE RULE IT ENFORCES, in Gary's words (2026-08-19): "the payload for a
/// non-MANAGE viewer must never contain wage fields — not hidden in the UI,
/// ABSENT from the response." Every caller uses this to decide whether to RUN THE
/// QUERY, not whether to render the cell. A wage that is never selected cannot
/// leak through a payload, a props tree, an RSC flight payload, or a future JSON
/// route that forgets to re-check.
///
/// WHY STORE ACCOUNTS ARE THE MOTIVATING CASE. They are shared iPad logins. A
/// roster of names-with-wages on one is DEBT-10's exposure (138 employees'
/// emails readable by any authenticated account) repeated on purpose rather than
/// by accident — and unlike an email, a wage cannot be rotated afterwards.
///
/// GATE ORDER IS DELIBERATE: overlay first, capability second. With the overlay
/// off there is no wage data in this environment at all, so the answer is "no"
/// for an ADMIN too — which keeps the toggle-off render byte-identical to Phase 2
/// rather than merely permission-shaped.
export function canSeeWages(org: Organization, actor: PermissionUser): boolean {
  return laborOverlayOn(org) && can(actor, "labor.costs.view")
}

/// The Tips column rides the SAME capability as wages (Gary's Q8 ruling,
/// 2026-08-19). It is a store average rather than one person's pay, so an
/// OPERATIONAL tier was arguable — the tie went to the stricter option for this
/// phase, and it is reversible later without a migration because nothing about
/// the stored data depends on it.
export const canSeeTips = canSeeWages

/// Gary's Q-V ruling: the PERCENTAGE is OPERATIONAL (ADMIN, MANAGER, STORE),
/// the DOLLARS are MANAGE. labor.manage is the existing MANAGE-tier labor
/// capability; nothing new is introduced for the dollars half.
export function laborDollarsVisible(actor: PermissionUser): boolean {
  return can(actor, "labor.manage")
}

// ─── TARGETS ──────────────────────────────────────────────────────────────────

/// Every store's laborTargetPct IN ONE QUERY.
///
/// resolveLaborSettings() is the right shape for one store and the wrong shape
/// here: it issues two findFirst calls per store, so the All Locations view —
/// which needs targets for three windows across nine stores — would have spent
/// 54 round trips resolving a number that lives in at most ten rows. This reads
/// the org's whole LaborSettings table once and applies the SAME precedence:
/// the store's own row wins over the org default (storeId null), which falls back
/// to the schema default. Kept in step with src/lib/labor-settings.ts — if that
/// precedence ever changes, it changes in both places or the dashboard and the
/// /labor page will judge against different targets.
const DEFAULT_LABOR_TARGET_PCT = 20

async function resolveLaborTargets(organizationId: string, storeIds: string[]): Promise<Map<string, number>> {
  const rows = await prisma.laborSettings.findMany({
    where: { organizationId, OR: [{ storeId: null }, { storeId: { in: storeIds } }] },
    select: { storeId: true, laborTargetPct: true },
  })
  const orgRow = rows.find((r) => r.storeId === null)
  const byStore = new Map(rows.filter((r) => r.storeId !== null).map((r) => [r.storeId!, r]))
  return new Map(
    storeIds.map((id) => {
      const row = byStore.get(id) ?? orgRow
      return [id, row ? Number(row.laborTargetPct) : DEFAULT_LABOR_TARGET_PCT]
    })
  )
}

// ─── FRESHNESS ────────────────────────────────────────────────────────────────

/// THE DEBOUNCE, AND IT IS A DATABASE CLAIM RATHER THAN A TIMER.
///
/// SquareLaborSyncState.lastSyncStartedAt is already stamped BEFORE the Square
/// call (labor-actuals.ts, recordSyncStarted), so it is a ready-made claim token
/// and needs no new column — AL-2 adds no schema.
///
/// ONE STATEMENT, NEVER CHECK-THEN-ACT — BUG-7's shape. The conditional
/// updateMany takes the row lock and re-evaluates against the COMMITTED value, so
/// two concurrent dashboard loads cannot both win: the loser sees count 0. The
/// create() branch covers a store that has never synced at all, where there is no
/// row to update; its unique violation on storeId is the same race resolved the
/// same way, by losing quietly.
///
/// A FAILED SYNC STILL HOLDS THE CLAIM. lastSyncStartedAt is stamped before the
/// fetch and is not rolled back on error, so a store whose Square calls are
/// failing retries once per cooldown rather than on every dashboard load. That is
/// the difference between a degraded store and a sync storm (DEBT-69).
async function claimSync(organizationId: string, storeId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - SYNC_COOLDOWN_MS)
  const claimed = await prisma.squareLaborSyncState.updateMany({
    where: { storeId, OR: [{ lastSyncStartedAt: null }, { lastSyncStartedAt: { lt: cutoff } }] },
    data: { lastSyncStartedAt: now },
  })
  if (claimed.count > 0) return true
  try {
    await prisma.squareLaborSyncState.create({ data: { organizationId, storeId, lastSyncStartedAt: now } })
    return true
  } catch {
    // The row exists and is inside its cooldown — another load owns this window.
    return false
  }
}

/// Refreshes TODAY ONLY, after the response, for at most MAX_SYNCS_PER_LOAD
/// stores whose cooldown has expired.
///
/// after() rather than an inline await, for the reason BUG-1 step 4 gives: the
/// card must render cached numbers immediately instead of hanging on a slow
/// Square call. The refreshed rows are what the NEXT load reads — labor has no
/// equivalent of BUG-6's client poll because a labor percentage that lags one
/// dashboard load is a reporting figure, not a live total, and a poll would spend
/// requests to shave minutes off a number the cron will own once it is registered.
///
/// NEVER THROWS INTO THE RESPONSE. Every failure is caught and logged; the route
/// has already returned by the time this runs.
export function scheduleLaborRefresh(org: Organization, stores: Store[], now = new Date()): void {
  if (!org.squareAccessToken) return // read-only degrade — the rows still serve, stale
  const candidates = stores.filter((s) => s.squareLocationId)
  if (candidates.length === 0) return

  after(async () => {
    let spent = 0
    let deferred = 0
    for (const store of candidates) {
      if (spent >= MAX_SYNCS_PER_LOAD) {
        deferred++
        continue
      }
      try {
        if (!(await claimSync(org.id, store.id, now))) continue
        spent++
        const today = localDateStr(new Date(), store.timezone)
        await syncTimecardsForStore(org, store, today, today)
      } catch (err) {
        // syncTimecardsForStore has already recorded lastError and logged the
        // real cause; this catch only stops one store from ending the loop.
        console.error(`[labor-dashboard] refresh failed store=${store.id}:`, err)
      }
    }
    if (deferred > 0) {
      // THE DROP, NAMED. Without this line a capped sweep is indistinguishable
      // from a complete one in the logs.
      console.log(
        `[labor-dashboard] org=${org.id} synced ${spent}, deferred ${deferred} store(s) past the per-load cap of ${MAX_SYNCS_PER_LOAD}`
      )
    }
  })
}

// ─── THE READS ────────────────────────────────────────────────────────────────

/// One store, one window. Returns null when any gate is off, so the caller can
/// spread the result and add no key at all.
export async function loadLaborBlock(
  org: Organization,
  store: Store,
  actor: PermissionUser,
  startDate: string,
  endDate: string
): Promise<LaborBlock | null> {
  if (!laborVisible(org, actor)) return null
  const [actuals, targets] = await Promise.all([
    getLaborActuals(org, store, startDate, endDate),
    resolveLaborTargets(org.id, [store.id]),
  ])
  return toLaborBlock(actuals, targets.get(store.id) ?? DEFAULT_LABOR_TARGET_PCT, laborDollarsVisible(actor))
}

/// Many stores, one window — the All Locations read. Three timecard/sales/sync
/// queries total plus one settings resolve per store, rather than the four-per-
/// store a loop over loadLaborBlock would cost.
export async function loadLaborBlocks(
  org: Organization,
  stores: Store[],
  actor: PermissionUser,
  startDate: string,
  endDate: string
): Promise<Map<string, LaborBlock> | null> {
  if (!laborVisible(org, actor)) return null
  const [actuals, targets] = await Promise.all([
    getLaborActualsForStores(org, stores, startDate, endDate),
    resolveLaborTargets(org.id, stores.map((s) => s.id)),
  ])
  const includeDollars = laborDollarsVisible(actor)
  const out = new Map<string, LaborBlock>()
  for (const store of stores) {
    const a = actuals.get(store.id)
    if (a) out.set(store.id, toLaborBlock(a, targets.get(store.id) ?? DEFAULT_LABOR_TARGET_PCT, includeDollars))
  }
  return out
}

/// The All Locations summary figure — one percentage for every store in scope
/// over one window, PLUS the raw dollar sums it was computed from.
///
/// The sums are returned because the month-end projection needs the labor COST,
/// and `laborCost` is deliberately absent from the block whenever the viewer is
/// below the MANAGE tier. Callers use the sums to do arithmetic on the server and
/// send only percentages — the dollars never leave this process for an
/// OPERATIONAL viewer.
export async function loadEstateLabor(
  org: Organization,
  stores: Store[],
  actor: PermissionUser,
  startDate: string,
  endDate: string
): Promise<{ block: EstateLaborBlock; laborCost: number; sales: number } | null> {
  if (!laborVisible(org, actor)) return null
  if (stores.length === 0) return null
  const [actuals, targets] = await Promise.all([
    getLaborActualsForStores(org, stores, startDate, endDate),
    resolveLaborTargets(org.id, stores.map((s) => s.id)),
  ])
  const rows = stores
    .map((store) => ({ result: actuals.get(store.id), target: targets.get(store.id) ?? DEFAULT_LABOR_TARGET_PCT }))
    .filter((r): r is { result: NonNullable<typeof r.result>; target: number } => !!r.result)
  if (rows.length === 0) return null
  return {
    block: aggregateLaborActuals(
      rows.map((r) => ({ laborCost: r.result.laborCost, sales: r.result.sales, result: r.result })),
      rows.map((r) => r.target)
    ),
    laborCost: rows.reduce((sum, r) => sum + r.result.laborCost, 0),
    sales: rows.reduce((sum, r) => sum + r.result.sales, 0),
  }
}

// ─── THE TIPS READ (AL-3) ─────────────────────────────────────────────────────

/// Every store's tips for one window, or NULL when the viewer may not see them —
/// and null means the caller adds NO KEY AT ALL, never a null field. Same
/// discipline loadLaborBlocks follows for the labor block.
export async function loadTipBlocks(
  org: Organization,
  stores: Store[],
  actor: PermissionUser,
  startDate: string,
  endDate: string
): Promise<Map<string, TipBlock> | null> {
  if (!canSeeTips(org, actor)) return null
  const results = await getTipPayoutForStores(org, stores, startDate, endDate)
  const out = new Map<string, TipBlock>()
  for (const store of stores) {
    const r = results.get(store.id)
    if (r) out.set(store.id, toTipBlock(r))
  }
  return out
}

/// Narrows a TipPayoutResult to what a dashboard may carry. Today it is a
/// straight field copy — the narrowing exists so a field added to the
/// CALCULATION does not reach a payload by default, which is the same discipline
/// toLaborBlock enforces for labor.
function toTipBlock(r: TipPayoutResult): TipBlock {
  return {
    avgHourlyTips: r.avgHourlyTips,
    tipsTotal: r.tipsTotal,
    posTips: r.posTips,
    declaredCashTips: r.declaredCashTips,
    eligibleHours: r.eligibleHours,
    unknownEligibilityHours: r.unknownEligibilityHours,
    daysCovered: r.daysCovered,
    daysInWindow: r.daysInWindow,
  }
}
