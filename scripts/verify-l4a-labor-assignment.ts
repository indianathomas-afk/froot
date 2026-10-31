/**
 * L-4a acceptance fixture — the LaborAssignment data model.
 *
 *   npx tsx scripts/verify-l4a-labor-assignment.ts
 *
 * Rulings: Gary 2026-10-30, "Ratify all as written" (docs/DECISIONS.md
 * "2026-10-30 — L-4a: labor assignment data model (Gary)"). Every EXPECTED value
 * is written from those rulings:
 *   1. several rows per person per day; overlap is NOT refused by the database;
 *   2. no overnight; 0 <= startMinutes < endMinutes <= 1440, by CHECK;
 *   3. a store delete removes its rows; a staff delete with rows is refused;
 *      createdByUserId is a plain id, so a user delete leaves the row;
 *   4. same-org / same-store / ACTIVE is L-4b's, NOT a database guarantee;
 *   5. a second index on (staffMemberId, date).
 *
 * Rules 1 and 4 are asserted as ACCEPTED by the database on purpose, so the
 * fixture states out loud what the table does not protect.
 *
 * DEV ONLY. It creates and deletes rows, so it refuses to run on any branch but
 * br-broad-wave-a6vpjdw0 (the verify-self1-identity.ts guard). Throwaway orgs,
 * every principal named "L-4a-…" / "ZZ L-4a …" (CLAUDE.md § Name every test
 * principal). Everything is deleted afterwards and removal is asserted by
 * RE-QUERY.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"

let failures = 0
let checks = 0
function check(label: string, ok: boolean, detail = "") {
  checks += 1
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const DEV_BRANCH = "br-broad-wave-a6vpjdw0"
const CHECK_NAME = "LaborAssignment_minutes_check"
const STAFF_FK = "LaborAssignment_staffMemberId_fkey"

/** The whole error, message and meta, so a constraint name is found wherever the adapter put it. */
function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const extra = e as Error & { code?: string; meta?: unknown; cause?: unknown }
  return [extra.message, extra.code, JSON.stringify(extra.meta ?? null), String(extra.cause ?? "")].join(" | ")
}

/** Resolves to the error text if `op` was refused, or null if it succeeded. */
async function refusal(op: () => Promise<unknown>): Promise<string | null> {
  try {
    await op()
    return null
  } catch (e) {
    return errorText(e)
  }
}

async function main() {
  const [env] = await prisma.$queryRawUnsafe<
    { neon_branch_id: string | null; neon_endpoint_id: string | null; utc_now: string }[]
  >(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id, " +
      "current_setting('neon.endpoint_id', true)::text AS neon_endpoint_id, " +
      "(now() AT TIME ZONE 'UTC')::text AS utc_now"
  )
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`Neon branch   : ${env?.neon_branch_id ?? "UNKNOWN"}`)
  console.log(`Neon endpoint : ${env?.neon_endpoint_id ?? "UNKNOWN"}`)
  console.log(`UTC now       : ${env?.utc_now} UTC\n`)
  if (env?.neon_branch_id !== DEV_BRANCH) {
    console.error(`REFUSING TO RUN: expected the dev branch ${DEV_BRANCH}, got ${env?.neon_branch_id}.`)
    console.error("This script creates and deletes rows. It must never point anywhere else.")
    process.exit(1)
  }
  check(`guard: running on dev ${DEV_BRANCH}, any other branch exits before a write`, true)

  const outsideBefore = await prisma.laborAssignment.count()
  const tag = Date.now()
  const org = await prisma.organization.create({
    data: { clerkOrgId: `fixture-l4a-${tag}`, name: "ZZ L-4a Fixture Org (safe to delete)" },
  })
  const orgB = await prisma.organization.create({
    data: { clerkOrgId: `fixture-l4a-b-${tag}`, name: "ZZ L-4a Fixture Org B (safe to delete)" },
  })
  const orgIds = [org.id, orgB.id]
  console.log(`Fixture orgs ${org.id} / ${orgB.id}\n`)

  try {
    const brisas = await prisma.store.create({ data: { organizationId: org.id, name: "ZZ L-4a Store Brisas" } })
    const unr = await prisma.store.create({ data: { organizationId: org.id, name: "ZZ L-4a Store UNR" } })
    const foreign = await prisma.store.create({ data: { organizationId: orgB.id, name: "ZZ L-4a Store OrgB" } })
    const maria = await prisma.staffMember.create({ data: { organizationId: org.id, displayName: "L-4a-Maria" } })
    const kristie = await prisma.staffMember.create({ data: { organizationId: org.id, displayName: "L-4a-Kristie" } })
    const admin = await prisma.user.create({
      data: { clerkUserId: `l4a-fixture-${tag}`, organizationId: org.id, email: `l4a-fixture-${tag}@example.invalid`, name: "L-4a Admin" },
    })

    const MONDAY = "2026-11-02"
    const row = (storeId: string, staffMemberId: string, startMinutes: number, endMinutes: number, date = MONDAY) => ({
      organizationId: org.id,
      storeId,
      staffMemberId,
      date: new Date(`${date}T00:00:00Z`),
      startMinutes,
      endMinutes,
      createdByUserId: admin.id,
    })

    // ── 1. Round trip ─────────────────────────────────────────────────────────
    console.log("── 1. Round trip ──")
    const created = await prisma.laborAssignment.create({ data: row(brisas.id, maria.id, 420, 840) })
    const read = await prisma.laborAssignment.findUnique({ where: { id: created.id } })
    check(
      "a valid row writes and reads back, every field equal",
      read !== null &&
        read.organizationId === org.id &&
        read.storeId === brisas.id &&
        read.staffMemberId === maria.id &&
        read.startMinutes === 420 &&
        read.endMinutes === 840 &&
        read.createdByUserId === admin.id &&
        read.createdAt instanceof Date &&
        read.updatedAt instanceof Date
    )
    check("date is the same calendar day (@db.Date, no zone shift)", read?.date.toISOString().slice(0, 10) === MONDAY, read?.date.toISOString())

    // ── 2. Ruling 1 + range edges: accepted ───────────────────────────────────
    console.log("\n── 2. Accepted (rulings 1 and 2) ──")
    const am = await refusal(() => prisma.laborAssignment.create({ data: row(brisas.id, kristie.id, 360, 720) }))
    const pm = await refusal(() => prisma.laborAssignment.create({ data: row(unr.id, kristie.id, 780, 1080) }))
    check("ruling 1: one person, one day, two stores (the split manager) — both accepted", am === null && pm === null, am ?? pm ?? "")
    const sameStoreTwice = await refusal(() => prisma.laborAssignment.create({ data: row(brisas.id, maria.id, 900, 1020) }))
    check("ruling 1: a second, non-overlapping row at the same store that day — accepted (no unique key)", sameStoreTwice === null, sameStoreTwice ?? "")
    const endsMidnight = await refusal(() => prisma.laborAssignment.create({ data: row(unr.id, maria.id, 1200, 1440, "2026-11-03") }))
    check("ruling 2 edge: end exactly 1440 (midnight) — accepted", endsMidnight === null, endsMidnight ?? "")
    const startsMidnight = await refusal(() => prisma.laborAssignment.create({ data: row(unr.id, maria.id, 0, 60, "2026-11-04") }))
    check("ruling 2 edge: start exactly 0 — accepted", startsMidnight === null, startsMidnight ?? "")

    // ── 3. Ruling 2: refused by the CHECK ─────────────────────────────────────
    console.log("\n── 3. Refused by the CHECK (ruling 2) ──")
    const bad: [string, number, number][] = [
      ["end before start (840 → 420)", 840, 420],
      ["zero length (600 → 600)", 600, 600],
      ["start below 0 (-1 → 60)", -1, 60],
      ["end above 1440 (1380 → 1441)", 1380, 1441],
      ["overnight (22:00 → 02:00, 1320 → 120)", 1320, 120],
    ]
    for (const [label, s, e] of bad) {
      const err = await refusal(() => prisma.laborAssignment.create({ data: row(brisas.id, maria.id, s, e, "2026-11-05") }))
      check(`refused: ${label} — by ${CHECK_NAME}`, err !== null && err.includes(CHECK_NAME), err === null ? "WRITTEN" : err.slice(0, 160))
    }
    const badCount = await prisma.laborAssignment.count({ where: { organizationId: org.id, date: new Date("2026-11-05T00:00:00Z") } })
    check("no refused row was written", badCount === 0, `${badCount}`)
    const badUpdate = await refusal(() => prisma.laborAssignment.update({ where: { id: created.id }, data: { endMinutes: 300 } }))
    check(`an UPDATE into an invalid range is refused too — by ${CHECK_NAME}`, badUpdate !== null && badUpdate.includes(CHECK_NAME), badUpdate === null ? "UPDATED" : badUpdate.slice(0, 160))

    // ── 4. Rulings 1 and 4: NOT database guarantees (asserted as accepted) ────
    console.log("\n── 4. Not refused by the database — L-4b's job (rulings 1 and 4) ──")
    const overlap = await refusal(() => prisma.laborAssignment.create({ data: row(brisas.id, maria.id, 480, 600) }))
    check("ruling 1: an OVERLAPPING row (08:00–10:00 inside 07:00–14:00) is ACCEPTED by the database", overlap === null, overlap ?? "")
    const crossOrg = await refusal(() => prisma.laborAssignment.create({ data: row(foreign.id, maria.id, 420, 840, "2026-11-06") }))
    check("ruling 4: a store from ANOTHER org is ACCEPTED by the database", crossOrg === null, crossOrg ?? "")

    // ── 5. Ruling 3: deletes ─────────────────────────────────────────────────
    console.log("\n── 5. Deletes (ruling 3) ──")
    const staffDel = await refusal(() => prisma.staffMember.delete({ where: { id: maria.id } }))
    check(`deleting a staff member WITH assignments is refused — by ${STAFF_FK}`, staffDel !== null && staffDel.includes(STAFF_FK), staffDel === null ? "DELETED" : staffDel.slice(0, 160))
    check("…and the person and their rows are still there", (await prisma.staffMember.count({ where: { id: maria.id } })) === 1 && (await prisma.laborAssignment.count({ where: { staffMemberId: maria.id } })) > 0)

    await prisma.user.delete({ where: { id: admin.id } })
    const afterUser = await prisma.laborAssignment.findUnique({ where: { id: created.id } })
    check("deleting the creating user leaves the row, createdByUserId unchanged", afterUser?.createdByUserId === admin.id)

    const unrBefore = await prisma.laborAssignment.count({ where: { storeId: unr.id } })
    const brisasBefore = await prisma.laborAssignment.count({ where: { storeId: brisas.id } })
    await prisma.store.delete({ where: { id: unr.id } })
    const unrAfter = await prisma.laborAssignment.count({ where: { storeId: unr.id } })
    const brisasAfter = await prisma.laborAssignment.count({ where: { storeId: brisas.id } })
    check(`deleting a store removes its assignments (${unrBefore} → ${unrAfter})`, unrBefore > 0 && unrAfter === 0)
    check(`…and no other store's (${brisasBefore} → ${brisasAfter})`, brisasBefore > 0 && brisasAfter === brisasBefore)

    // ── 6. Boundary ──────────────────────────────────────────────────────────
    console.log("\n── 6. Boundary ──")
    const outsideNow = await prisma.laborAssignment.count({ where: { organizationId: { notIn: orgIds } } })
    check(`no row written outside the fixture orgs (${outsideBefore} before, ${outsideNow} now)`, outsideNow === outsideBefore)
  } finally {
    await prisma.laborAssignment.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.store.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })

    console.log("\n── 7. Fixture removal (re-queried) ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { name: { startsWith: "ZZ L-4a " } } }),
      prisma.store.count({ where: { name: { startsWith: "ZZ L-4a " } } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "L-4a-" } } }),
      prisma.user.count({ where: { clerkUserId: { startsWith: "l4a-fixture-" } } }),
      prisma.laborAssignment.count({ where: { organizationId: { in: orgIds } } }),
    ])
    check("all L-4a fixtures removed", leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
    const total = await prisma.laborAssignment.count()
    check(`LaborAssignment back to its pre-run count (${outsideBefore})`, total === outsideBefore, `${total}`)
  }

  console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} of ${checks} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
