/**
 * R7-C — the ENGINE-PATH fixture. DATABASE-BACKED ON PURPOSE.
 *
 *   npx tsx scripts/verify-labor-salaried-db.ts
 *
 * WHY THIS EXISTS, AND IT IS THE WHOLE POINT OF THE FILE.
 * scripts/verify-labor-salaried.ts tests `resolveStoreSalaried` — the PURE
 * function — by handing it rows directly. It passed green while the API returned
 * salariedCost 0 for a fully allocated person, because the defect was in
 * `resolveStoreSalariedFor`'s QUERY (`exempt: { not: true }` drops NULL rows) and
 * that query is a surface the pure fixture never touches. A green fixture beside
 * a broken endpoint is the A13 failure: the test asserted the wrong surface.
 *
 * SO THIS ONE GOES THROUGH `getWeeklyDayPlan` — the exact entry point
 * /api/labor/budget and /api/labor/weekly-plan use — and never calls the helper
 * directly. If the wiring, the scoping or the filter breaks again, this fails.
 *
 * It writes and deletes rows on whatever branch DATABASE_URL points at, and every
 * principal it creates is named R7C-DBFIX-* so it is findable and cleanable
 * (CLAUDE.md § Name every test principal). It removes them on the way out,
 * including after a failure.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { getWeeklyDayPlan } from "../src/lib/labor-plan"

const TAG = "R7C-DBFIX"
let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

async function cleanup(orgId: string) {
  await prisma.laborSalariedPerson.deleteMany({
    where: { organizationId: orgId, squareTeamMemberId: { startsWith: TAG } },
  })
}

async function main() {
  // Any org with at least two active stores and a labor forecast; the assertions
  // are all RELATIVE to the same store's own baseline, so no seeded sales are
  // needed and the fixture is branch-agnostic.
  const org = await prisma.organization.findFirst({
    where: { stores: { some: { isActive: true } } },
    select: { id: true, name: true, stores: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 2 } },
  })
  if (!org || org.stores.length < 2) {
    console.log("  · SKIPPED — this branch has no org with two active stores.")
    return
  }
  const [a, b] = org.stores
  console.log(`  · org ${org.name} (${org.id}) · stores ${a.name}, ${b.name}`)
  await cleanup(org.id)

  const plan = (storeId: string) => getWeeklyDayPlan(storeId, "2026-08-17", "2026-08-22")
  const baseA = (await plan(a.id)).budget
  if (!baseA) {
    console.log("  · SKIPPED — no forecast on this branch, so there is no budget to move.")
    return
  }

  console.log("\n1 · Baseline — no salaried people (absent means zero):")
  check("salariedCost", baseA.salariedCost, 0)
  check("salariedHours", baseA.salariedHours, 0)
  const baseBlended = baseA.blendedHourlyRate
  const baseHourly = baseA.hourlyHours

  // THE REGRESSION CASE. exempt is NULL — the state every person the settings
  // card creates starts in, because the dialog seeds the switch from a null
  // record and an operator who never touches it sends null back.
  const person = await prisma.laborSalariedPerson.create({
    data: {
      organizationId: org.id,
      squareTeamMemberId: `${TAG}-person`,
      displayName: `${TAG} Person`,
      weeklyCost: 1000,
      weeklyHours: 40,
      exempt: null,
      squareAnnualRateSeen: 52000,
    },
  })
  await prisma.laborSalariedAllocation.createMany({
    data: [
      { organizationId: org.id, personId: person.id, storeId: a.id, allocationBps: 5000 },
      { organizationId: org.id, personId: person.id, storeId: b.id, allocationBps: 5000 },
    ],
  })

  console.log("\n2 · exempt = NULL (NOT REVIEWED) MUST STILL REACH THE ENGINE:")
  console.log("     — this is the exact case that shipped broken; a NULL person was")
  console.log("       silently dropped by `exempt: { not: true }` while the card rendered fine.")
  const nullPlan = await plan(a.id)
  check("salariedCost reaches the budget", nullPlan.budget!.salariedCost, 500)
  check("salariedHours reaches the budget", nullPlan.budget!.salariedHours, 20)
  check("hasGm is true", nullPlan.hasGm, true)
  check("hourlyHours MOVED from baseline", nullPlan.budget!.hourlyHours !== baseHourly, true)
  check("blendedHourlyRate UNCHANGED (canary)", nullPlan.budget!.blendedHourlyRate, baseBlended)
  check("hasIncompleteAllocation false at 100%", nullPlan.hasIncompleteAllocation, false)

  console.log("\n3 · exempt = false (explicitly included) behaves identically:")
  await prisma.laborSalariedPerson.update({ where: { id: person.id }, data: { exempt: false } })
  const falsePlan = await plan(a.id)
  check("salariedCost", falsePlan.budget!.salariedCost, 500)
  check("salariedHours", falsePlan.budget!.salariedHours, 20)
  check("identical to the NULL case", JSON.stringify(falsePlan.budget), JSON.stringify(nullPlan.budget))

  console.log("\n4 · exempt = true is OUTSIDE the system — and only true:")
  await prisma.laborSalariedPerson.update({ where: { id: person.id }, data: { exempt: true } })
  const exemptPlan = await plan(a.id)
  check("salariedCost back to zero", exemptPlan.budget!.salariedCost, 0)
  check("salariedHours back to zero", exemptPlan.budget!.salariedHours, 0)
  check("hasGm false", exemptPlan.hasGm, false)
  check("budget identical to baseline", JSON.stringify(exemptPlan.budget), JSON.stringify(baseA))

  console.log("\n5 · The other store is unaffected by this store's allocation:")
  await prisma.laborSalariedPerson.update({ where: { id: person.id }, data: { exempt: null } })
  const other = await plan(b.id)
  check("store B also carries 500 (it is allocated too)", other.budget!.salariedCost, 500)
  check("store B blendedHourlyRate unchanged", other.budget!.blendedHourlyRate, baseBlended)

  console.log("\n6 · A 50/40 set is charged AS STORED and flagged, never normalised:")
  await prisma.laborSalariedAllocation.updateMany({
    where: { personId: person.id, storeId: b.id },
    data: { allocationBps: 4000 },
  })
  const partial = await plan(a.id)
  check("still 500, NOT normalised to 555.56", partial.budget!.salariedCost, 500)
  check("still 20 hours, NOT 22.22", partial.budget!.salariedHours, 20)
  check("the leaf is raised", partial.hasIncompleteAllocation, true)
  check("and it names the person", partial.incompleteAllocationPeople[0]?.displayName, `${TAG} Person`)
  check("with the real total", partial.incompleteAllocationPeople[0]?.totalBps, 9000)

  console.log("\n7 · Removing the person returns the store to baseline exactly:")
  await cleanup(org.id)
  const restored = await plan(a.id)
  check("budget byte-identical to baseline", JSON.stringify(restored.budget), JSON.stringify(baseA))
}

main()
  .then(async () => {
    const org = await prisma.organization.findFirst({ select: { id: true } })
    if (org) await cleanup(org.id)
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`)
    process.exitCode = failures === 0 ? 0 : 1
  })
  .catch(async (e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    // Belt and braces: never leave fixtures behind, even on a throw.
    await prisma.laborSalariedPerson.deleteMany({ where: { squareTeamMemberId: { startsWith: TAG } } })
    await prisma.$disconnect()
  })
