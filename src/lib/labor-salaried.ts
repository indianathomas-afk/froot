import { prisma } from "@/lib/prisma"
import type { PermissionUser } from "@/lib/permissions"
import { compVisibleForMember } from "@/lib/comp-confidential"

// R7-C — THE ONE RESOLUTION POINT for per-person salaried allocation. Every path
// that needs "what salaried cost and hours does THIS store carry" comes through
// here, so the arithmetic exists once and cannot drift between callers.
//
// SEAM (b) AS AMENDED. What reaches the core engine from here is Froot-owned,
// admin-entered data: a weekly cost typed by a human, weekly hours typed by a
// human, and percentages typed by a human. NOTHING SYNCED. Square's annualRate
// is never read by this module — it seeds weeklyCost once, elsewhere, and is
// thereafter only displayed (see squareAnnualRateSeen).
//
// THE BOUNDARY TEST PASSES VERBATIM BECAUSE OF WHERE THE ROWS LIVE. Drop
// SquareTimecard, SquareScheduledShift and SquareTeamMemberWage and both tables
// this module reads survive intact, so no labor number moves.

/// BASIS POINTS IN A FULL ALLOCATION. Integer, so equality is exact and no float
/// tolerance is offered anywhere.
export const FULL_ALLOCATION_BPS = 10000

export type SalariedAllocationRow = {
  personId: string
  displayName: string
  weeklyCost: number // dollars per week, the whole person
  weeklyHours: number // the whole person's weekly hours
  allocationBps: number // this store's share
}

export type StoreSalariedResolution = {
  /// Dollars per week this store carries. Absent means zero — a store with no
  /// allocated person carries nothing (Gary, 2026-08-22).
  salariedCost: number
  /// FRACTIONAL BY DESIGN. 33.33% of 40 is 13.332 hours and must stay that way:
  /// rounding each share to an Int loses an hour at 33.33/33.33/33.34
  /// (13+13+13 = 39). LaborBudgetPosition.impliedWeeklyHours is typed
  /// `number | null`, not Int, so nothing downstream coerces. Display rounds;
  /// the arithmetic never does.
  salariedHours: number
  /// True when at least one allocated person contributes hours to this store.
  /// Replaces the archetype-era `positions.some(payType === "SALARIED")`.
  hasSalariedPerson: boolean
  /// A LEAF, and deliberately so — it renders a banner and feeds NO arithmetic.
  /// True when some person contributing to this store has an allocation set that
  /// does not sum to FULL_ALLOCATION_BPS. See resolveStoreSalaried.
  hasIncompleteAllocation: boolean
  /// Who those people are, for the banner's text. Empty when the flag is false.
  incompletePeople: { displayName: string; totalBps: number }[]
}

/// PURE. Resolve one store's salaried figures from the allocation rows that
/// touch it, plus each involved person's full allocation total.
///
/// IT ASSERTS AND NEVER NORMALISES. If a person's set sums to 9000 bps, this
/// charges the store exactly what its own row says and raises
/// hasIncompleteAllocation. It does NOT scale the shares up to 100% — that would
/// invent a percentage nobody typed and hide the forgotten 10%, which is the
/// failure LaborDaySplit's read-side normalisation would have reproduced here
/// (labor-daily.ts:97-107, harmless for a day split, silent corruption for a
/// person).
export function resolveStoreSalaried(
  rows: SalariedAllocationRow[],
  totalBpsByPerson: Map<string, number>
): StoreSalariedResolution {
  let salariedCost = 0
  let salariedHours = 0
  const incompletePeople: { displayName: string; totalBps: number }[] = []

  for (const r of rows) {
    // MULTIPLY BEFORE DIVIDING, and this is not stylistic. `hours * (bps/10000)`
    // divides first and compounds the rounding of an inexact quotient:
    // 40 * (3333/10000) yields 13.331999999999999, which then renders as
    // "13.331999999999999" inside a JSON payload and trips the promotion diff on
    // a difference that does not exist. `(hours * bps) / 10000` multiplies two
    // integers exactly and divides once, landing on the nearest double to
    // 13.332 — bit-identical to the literal. Caught by the fixture, not by
    // reading.
    salariedCost += (r.weeklyCost * r.allocationBps) / FULL_ALLOCATION_BPS
    salariedHours += (r.weeklyHours * r.allocationBps) / FULL_ALLOCATION_BPS // fractional on purpose
    const total = totalBpsByPerson.get(r.personId)
    if (total != null && total !== FULL_ALLOCATION_BPS) {
      incompletePeople.push({ displayName: r.displayName, totalBps: total })
    }
  }

  return {
    // Money rounds to the cent at the boundary; hours do not round at all.
    salariedCost: +salariedCost.toFixed(2),
    salariedHours,
    hasSalariedPerson: salariedHours > 0,
    hasIncompleteAllocation: incompletePeople.length > 0,
    incompletePeople,
  }
}

/// Load and resolve one store's salaried figures.
///
/// EXEMPT PEOPLE ARE EXCLUDED AT THE QUERY. An exempt person is OUTSIDE the
/// system, not allocated 0%, so their rows never enter the sum and never enter
/// the completeness check either — a person who is not in the system cannot be
/// half in it. `exempt: true` is the ONLY excluded state: NULL (not reviewed)
/// and false (explicitly included) both participate.
///
/// THE FILTER IS AN EXPLICIT `OR` AND MUST STAY ONE. It was
/// `exempt: { not: true }`, which is WRONG on a nullable column and was the whole
/// of the "allocation does not reach the engine" defect: Prisma emits
/// `exempt <> true`, and in SQL `NULL <> true` is NULL rather than TRUE, so every
/// NOT-REVIEWED person was silently dropped. NULL is the DEFAULT state of every
/// person the card creates, so the bug hit everyone who never touched the toggle
/// — while the settings card kept rendering them perfectly, because it reads the
/// allocations through the person RELATION and never applies this filter.
///
/// MEASURED ON dev 2026-08-22, three people (NULL / false / true), one allocation
/// each, asking for the two that should participate:
///   person: { exempt: { not: true } }            -> [false]        WRONG
///   person: { NOT: { exempt: true } }            -> [false]        ALSO WRONG
///   NOT: { person: { exempt: true } }            -> [false]        ALSO WRONG
///   person: { OR: [{exempt: null},{exempt: false}] } -> [false, null]  CORRECT
///
/// THE OBVIOUS FIX IS ALSO BROKEN — that is why the measurement is recorded here
/// rather than summarised. Prisma's negation is uniformly not NULL-aware on a
/// nullable Boolean, so anyone "tidying" this back into a `NOT` reintroduces the
/// defect and the tests that pin it are the only thing that would say so.
export async function resolveStoreSalariedFor(
  organizationId: string,
  storeId: string
): Promise<StoreSalariedResolution> {
  const mine = await prisma.laborSalariedAllocation.findMany({
    where: { organizationId, storeId, person: { OR: [{ exempt: null }, { exempt: false }] } },
    select: {
      personId: true,
      allocationBps: true,
      person: { select: { displayName: true, weeklyCost: true, weeklyHours: true } },
    },
  })
  if (mine.length === 0) {
    return { salariedCost: 0, salariedHours: 0, hasSalariedPerson: false, hasIncompleteAllocation: false, incompletePeople: [] }
  }

  // The completeness check needs each involved person's WHOLE set, not just the
  // row that touches this store — a person can only be found under-allocated by
  // looking at every store they reach.
  const personIds = [...new Set(mine.map((r) => r.personId))]
  const all = await prisma.laborSalariedAllocation.groupBy({
    by: ["personId"],
    where: { personId: { in: personIds } },
    _sum: { allocationBps: true },
  })
  const totals = new Map(all.map((g) => [g.personId, g._sum.allocationBps ?? 0]))

  return resolveStoreSalaried(
    mine.map((r) => ({
      personId: r.personId,
      displayName: r.person.displayName,
      weeklyCost: Number(r.person.weeklyCost),
      weeklyHours: r.person.weeklyHours,
      allocationBps: r.allocationBps,
    })),
    totals
  )
}

/// Validate a complete allocation set before it is written. Returns null when
/// the set is legal.
///
/// AN EMPTY SET IS LEGAL and means "not allocated anywhere" — that is how a
/// person is removed from every store without deleting their record.
export function validateAllocationSet(entries: { storeId: string; allocationBps: number }[]): string | null {
  if (entries.length === 0) return null
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.storeId)) return "A store appears twice in the allocation set"
    seen.add(e.storeId)
    if (!Number.isInteger(e.allocationBps) || e.allocationBps < 0 || e.allocationBps > FULL_ALLOCATION_BPS) {
      return "Each allocation must be a whole number of basis points from 0 to 10000"
    }
  }
  const total = entries.reduce((t, e) => t + e.allocationBps, 0)
  if (total !== FULL_ALLOCATION_BPS) {
    return `Allocations must total exactly 100% — this set totals ${(total / 100).toFixed(2)}%`
  }
  return null
}

/// Square's annual figure -> a Froot weekly cost, at SEED TIME ONLY.
/// $52,000/yr -> $1,000.00/wk. Called once when a person record is created and
/// never again; after that weeklyCost is Froot-owned and Square cannot move it.
export function seedWeeklyCostFromAnnual(annualRate: number): number {
  return +(annualRate / 52).toFixed(2)
}

/// The settings card's read: every SALARIED member of the Square roster, joined
/// to their Froot record where one exists.
///
/// THE MIRROR IS READ FOR IDENTITY AND FOR SEEDING ONLY. `annualRate` comes back
/// so the card can offer to seed a new record and can SHOW a divergence; no
/// arithmetic anywhere reads it, and `weeklyCost` — the figure the engine uses —
/// comes from the Froot record alone. This is the read side of the seam
/// amendment: Square supplies who exists and what it thinks they earn; Froot
/// decides what the business carries.
///
/// IT LISTS PEOPLE WITH NO FROOT RECORD TOO, which is how Kelton, Karson and
/// Taylin become markable at all — none of them needs a StaffMember row, because
/// the key throughout is squareTeamMemberId.
/// COMP-1 — `viewer` IS REQUIRED, and this loader masks rather than the page.
/// These rows are server-rendered straight into LaborSettingsClient's props, so
/// they leave the server in the RSC FLIGHT PAYLOAD, which the Network tab shows
/// exactly like a JSON API response. Masking in the card would leave the real
/// weekly cost sitting in the page's own payload.
///
/// `estateWeeklyTotal` IS RETURNED ALONGSIDE THE ROWS BECAUSE THE CARD MAY NO
/// LONGER SUM THEM. Ruling 4 (Gary, 2026-08-28) and Option B (ruling 3): the
/// masked numbers still feed the total, and the total stays visible to managers.
/// It is computed HERE over the REAL values, before any masking, so a manager
/// sees the same estate figure an admin does. Summing the returned rows in the
/// browser would drop every confidential person and quietly under-report the
/// estate by exactly their pay — a wrong number that looks right, and the
/// subtraction attack ruling 3 accepted handed over for free.
export async function getSalariedPeopleForSettings(
  organizationId: string,
  viewer: PermissionUser
): Promise<{
  people: {
    id: string | null
    squareTeamMemberId: string
    displayName: string
    weeklyCost: number | null
    weeklyHours: number | null
    exempt: boolean | null
    squareAnnualRate: number | null
    squareAnnualRateSeen: number | null
    compConfidential: boolean
    allocations: { storeId: string; allocationBps: number }[]
  }[]
  estateWeeklyTotal: number
}> {
  const [wages, records, staff, flags] = await Promise.all([
    prisma.squareTeamMemberWage.findMany({
      where: { organizationId, OR: [{ payType: "SALARY" }, { annualRate: { not: null } }] },
      select: { squareTeamMemberId: true, annualRate: true, jobTitle: true, status: true },
    }),
    prisma.laborSalariedPerson.findMany({
      where: { organizationId },
      include: { allocations: { select: { storeId: true, allocationBps: true } } },
    }),
    prisma.staffMember.findMany({
      where: { organizationId, squareTeamMemberId: { not: null } },
      select: { squareTeamMemberId: true, displayName: true },
    }),
    // COMP-1 — THE FLAG MAP IS ITS OWN QUERY, OVER EVERY WAGE ROW IN THE ORG,
    // and not a column added to `wages` above. `wages` is filtered to salaried
    // rows, so reading the flag from it would make an HOURLY person's wage row
    // look ABSENT — and absent fails closed (ruling 6), which would mask people
    // nobody marked confidential. This query is what makes "no wage row" mean
    // what it says.
    prisma.squareTeamMemberWage.findMany({
      where: { organizationId },
      select: { squareTeamMemberId: true, compConfidential: true },
    }),
  ])

  const byRecord = new Map(records.map((r) => [r.squareTeamMemberId, r]))
  const nameBySquareId = new Map(staff.map((s) => [s.squareTeamMemberId!, s.displayName]))
  const flagBySquareId = new Map(flags.map((f) => [f.squareTeamMemberId, f.compConfidential]))

  // A Froot record may exist for someone the mirror no longer returns (a leaver,
  // or a wage sync that has not run). Those rows are still listed — dropping them
  // would hide an allocation that is still charging a store.
  const ids = new Set([...wages.map((w) => w.squareTeamMemberId), ...records.map((r) => r.squareTeamMemberId)])

  // THE TOTAL IS COMPUTED OVER THE REAL VALUES, BEFORE MASKING. It mirrors the
  // card's own former predicate exactly — a person participates when they are
  // not exempt AND carry at least one allocation — so moving the arithmetic
  // server-side changed where it runs and not what it says.
  //
  // `exempt !== true` IS CORRECT HERE AND IS NOT THE NULLABLE-BOOLEAN TRAP.
  // This is JavaScript over already-loaded rows, where `null !== true` is plain
  // `true`; the trap is Prisma emitting `exempt <> true` into SQL, where NULL
  // compares to NULL. See resolveStoreSalariedFor above, whose `where` keeps an
  // explicit OR for exactly that reason and must keep it.
  const estateWeeklyTotal = records
    .filter((r) => r.exempt !== true && r.allocations.length > 0)
    .reduce((t, r) => t + Number(r.weeklyCost), 0)

  const people = [...ids]
    .map((sqId) => {
      const rec = byRecord.get(sqId)
      const wage = wages.find((w) => w.squareTeamMemberId === sqId)
      // COMP-1 ruling 6 — read across the shared key, and FAIL CLOSED. An
      // undefined flag means this person has no SquareTeamMemberWage row at all
      // (a leaver the mirror dropped, or a Froot record entered ahead of the
      // sync) and that is MASKED, not visible.
      const flag = flagBySquareId.get(sqId)
      const visible = compVisibleForMember(viewer, flag)
      // THE SAME FAIL-CLOSED READING, STATED ONCE AS A FACT ABOUT THE PERSON
      // rather than about the viewer: `!== false` is true both for a flagged
      // person and for one with no wage row. An ADMIN therefore still sees the
      // lock (they see the numbers too), which is how they can tell WHO is
      // masked for their managers — `!visible` would have read false for every
      // row an admin looked at and shown them nothing.
      const confidential = flag !== false
      return {
        id: rec?.id ?? null,
        squareTeamMemberId: sqId,
        // The Froot record's snapshot wins, then the StaffMember name, then the
        // Square id — so an unmapped person is still identifiable on the card.
        displayName: rec?.displayName ?? nameBySquareId.get(sqId) ?? (wage?.jobTitle ? `${wage.jobTitle} (unmatched)` : sqId),
        weeklyCost: visible && rec ? Number(rec.weeklyCost) : null,
        // NULL WHEN THERE IS NO FROOT RECORD, not 40. This used to invent a 40
        // for a person nobody had entered, which made "has no values at all"
        // undetectable from the payload — and that emptiness is what the
        // settings card's badge is derived from (Gary, 2026-08-22). The dialog
        // owns its own form placeholder; the loader must not invent data.
        weeklyHours: rec?.weeklyHours ?? null,
        exempt: rec?.exempt ?? null,
        squareAnnualRate: !visible || wage?.annualRate == null ? null : Number(wage.annualRate),
        squareAnnualRateSeen: !visible || rec?.squareAnnualRateSeen == null ? null : Number(rec.squareAnnualRateSeen),
        // Sent to every viewer — the number is the secret, not its existence.
        // The card keys the lock on this, which is what keeps a masked person
        // distinguishable from one who simply has no figures entered.
        compConfidential: confidential,
        allocations: rec?.allocations ?? [],
      }
    })
    .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0))

  return { people, estateWeeklyTotal }
}
