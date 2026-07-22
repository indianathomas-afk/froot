/**
 * Labor Phase 0 — backfill the default rate legend for existing orgs.
 *
 *   npx tsx scripts/seed-labor-positions.ts            # all orgs with Labor active
 *   npx tsx scripts/seed-labor-positions.ts <orgDbId>  # one org (by DB id)
 *
 * Idempotent: seedDefaultLaborPositions only seeds orgs that have zero
 * LaborPosition rows, so re-running never duplicates or clobbers edits. New
 * orgs get seeded automatically when an admin enables the module
 * (/api/labor/toggle); this covers orgs that were toggled on before seeding
 * existed, or any org you pass explicitly.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { seedDefaultLaborPositions, seedDefaultLaborDayparts } from "../src/lib/labor-positions"

async function main() {
  const argOrgId = process.argv[2]

  const orgs = argOrgId
    ? await prisma.organization.findMany({ where: { id: argOrgId }, select: { id: true, name: true } })
    : await prisma.organization.findMany({
        where: { activeModules: { has: "labor" } },
        select: { id: true, name: true },
      })

  if (orgs.length === 0) {
    console.log(argOrgId ? `No org found with id ${argOrgId}` : "No orgs have the Labor module active.")
    return
  }

  let seeded = 0
  for (const org of orgs) {
    const posCount = await seedDefaultLaborPositions(org.id)
    const dpCount = await seedDefaultLaborDayparts(org.id)
    if (posCount > 0 || dpCount > 0) {
      seeded++
      console.log(`  ✓ ${org.name} (${org.id}) — seeded ${posCount} positions, ${dpCount} dayparts`)
    } else {
      console.log(`  · ${org.name} (${org.id}) — already seeded, skipped`)
    }
  }
  console.log(`\nDone. Seeded ${seeded}/${orgs.length} org(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
