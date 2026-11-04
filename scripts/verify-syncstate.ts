/**
 * SYNCSTATE acceptance fixture — the dashboard's labor / schedule refresh claim
 * is single-flight per store and never prints a prisma:error.
 *
 *   npx tsx scripts/verify-syncstate.ts
 *
 * Audit and plan: docs/prompts/SYNCSTATE_AUDIT.md. The bug: claimSync /
 * claimScheduleSync (src/lib/labor-dashboard.ts) fell back to create() inside a
 * bare catch, which was reached on every load inside the cooldown and printed
 * "Unique constraint failed on the fields: (`storeId`)" each time. They now use
 * createMany({ skipDuplicates: true }) read by count.
 *
 * "ONE SQUARE REFRESH" IS COUNTED AS ONE CLAIM WINNER. The refresh loop calls
 * the Square sync if and only if the claim returns true (labor-dashboard.ts,
 * both after() loops), so the winners ARE the refreshes. Square is never
 * reachable from this file: nothing here imports a sync function.
 *
 * WHY A CHILD PROCESS. The "zero prisma:error" checks are the point of the
 * phase, so they read the REAL output streams — the same bytes a Vercel runtime
 * log receives — rather than an in-process console tap. The tap was tried
 * first and the positive control (A2) proved it blind: Prisma's line printed
 * to the terminal while the tap recorded nothing, three attempts running. A
 * detector that cannot see the thing it is counting produces a false PASS,
 * which is the expensive direction (CLAUDE.md § Verifying a guard). So each
 * scenario runs in a child (`SYNCSTATE_CHILD=<scenario>`), prints its results as
 * one JSON line, and the parent counts prisma:error / "Unique constraint" in
 * the child's combined stdout+stderr.
 *
 *   A. Detector — the child running the OLD create()-in-catch shape on an
 *      existing row shows the prisma:error line (positive control), so silence
 *      in the other child means something.
 *   B. Concurrent first loads, both tables — 5 concurrent claims for a store
 *      with no row: exactly one true, one row.
 *   C. Inside the window (the case that filled the logs) — row present: false,
 *      no write.
 *   D. After the window — 15 min labor / 30 min schedule: one winner again; the
 *      schedule claim still refuses at 16 min.
 *   E. Different stores do not block each other.
 *   Z. Zero prisma:error / Unique constraint lines across B–E's child output.
 *   F. Cleanup (in each child; the count is reported back and asserted here).
 *
 * Dev branch only. Every fixture row is named "SYNCSTATE …" (CLAUDE.md § Name
 * every test principal).
 */
import "dotenv/config"
import { spawnSync } from "node:child_process"

const MIN = 60 * 1000
const CONCURRENCY = 5
const MARK = "SYNCSTATE_RESULT "

// ─── child ────────────────────────────────────────────────────────────────────

async function child(scenario: string) {
  const { prisma } = await import("../src/lib/prisma")
  const { claimSync, claimScheduleSync } = await import("../src/lib/labor-dashboard")
  const out: Record<string, unknown> = {}
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
  out.branch = branch[0]?.b ?? null

  const stamp = `${Date.now()}-${scenario}`
  const org = await prisma.organization.create({
    data: { clerkOrgId: `syncstate-fixture-${stamp}`, name: "SYNCSTATE Fixture Org" },
  })
  try {
    const mkStore = (n: string) =>
      prisma.store.create({
        data: { organizationId: org.id, name: `SYNCSTATE ${n}`, timezone: "America/Los_Angeles", squareLocationId: `syncstate-loc-${n}-${stamp}` },
      })
    const t0 = new Date()
    const many = <T>(fn: () => Promise<T>) => Promise.all(Array.from({ length: CONCURRENCY }, fn))
    const wins = (r: boolean[]) => r.filter(Boolean).length
    const laborAt = async (storeId: string) =>
      (await prisma.squareLaborSyncState.findUniqueOrThrow({ where: { storeId } })).lastSyncStartedAt?.toISOString()

    if (scenario === "control") {
      const c = await mkStore("C")
      await prisma.squareLaborSyncState.create({ data: { organizationId: org.id, storeId: c.id, lastSyncStartedAt: t0 } })
      try {
        // The OLD shape, on purpose: create() on an existing row inside a catch.
        await prisma.squareLaborSyncState.create({ data: { organizationId: org.id, storeId: c.id, lastSyncStartedAt: t0 } })
        out.code = "no throw"
      } catch (e) {
        out.code = (e as { code?: string }).code ?? "threw"
      }
    } else {
      const a = await mkStore("A")
      const b = await mkStore("B")
      const c = await mkStore("C")
      // B
      out.B_laborWins = wins(await many(() => claimSync(org.id, a.id, t0)))
      out.B_laborRows = await prisma.squareLaborSyncState.count({ where: { storeId: a.id } })
      out.B_schedWins = wins(await many(() => claimScheduleSync(org.id, a.id, t0)))
      out.B_schedRows = await prisma.squareScheduleSyncState.count({ where: { storeId: a.id } })
      out.B_claimInstant = (await laborAt(a.id)) === t0.toISOString()
      // C
      const t5 = new Date(t0.getTime() + 5 * MIN)
      out.C_inside = [await claimSync(org.id, a.id, t5), await claimScheduleSync(org.id, a.id, t5)]
      out.C_unchanged = (await laborAt(a.id)) === t0.toISOString()
      out.C_raceWins = wins(await many(() => claimSync(org.id, a.id, t5)))
      // D
      const t16 = new Date(t0.getTime() + 16 * MIN)
      out.D_laborWins16 = wins(await many(() => claimSync(org.id, a.id, t16)))
      out.D_advanced = (await laborAt(a.id)) === t16.toISOString()
      out.D_sched16 = await claimScheduleSync(org.id, a.id, t16)
      const t31 = new Date(t0.getTime() + 31 * MIN)
      out.D_schedWins31 = wins(await many(() => claimScheduleSync(org.id, a.id, t31)))
      // E
      out.E_both = await Promise.all([
        claimSync(org.id, b.id, t0),
        claimSync(org.id, c.id, t0),
        claimScheduleSync(org.id, b.id, t0),
        claimScheduleSync(org.id, c.id, t0),
      ])
      out.E_aUntouched = (await laborAt(a.id)) === t16.toISOString()
    }
  } finally {
    await prisma.squareLaborSyncState.deleteMany({ where: { organizationId: org.id } })
    await prisma.squareScheduleSyncState.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.deleteMany({ where: { id: org.id } })
    out.leftover = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "syncstate-fixture" } } })
    await prisma.$disconnect()
  }
  console.log(MARK + JSON.stringify(out))
}

// ─── parent ───────────────────────────────────────────────────────────────────

let passes = 0
let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passes++
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

function runChild(scenario: string): { result: Record<string, unknown> | null; errorLines: number; raw: string } {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, SYNCSTATE_CHILD: scenario },
    encoding: "utf8",
    timeout: 120_000,
  })
  const raw = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
  const line = raw.split("\n").find((l) => l.startsWith(MARK))
  const errorLines = raw.split("\n").filter((l) => /prisma:error|Unique constraint/i.test(l)).length
  return { result: line ? JSON.parse(line.slice(MARK.length)) : null, errorLines, raw }
}

function parent() {
  // ── A. detector ──
  const control = runChild("control")
  if (!control.result) console.log(control.raw)
  console.log(`branch id: ${control.result?.branch ?? "(null — not Neon)"}  (expected: dev)`)
  check("A1. control child: old create() on an existing row throws P2002", control.result?.code, "P2002")
  check("A2. control child: its output carries the prisma:error line for a CAUGHT P2002", control.errorLines > 0, true)
  check("A3. control child cleaned up", control.result?.leftover, 0)

  // ── B–E ──
  const main = runChild("main")
  if (!main.result) console.log(main.raw)
  const r = main.result ?? {}
  check(`B1. labor: ${CONCURRENCY} concurrent first-load claims → exactly one winner`, r.B_laborWins, 1)
  check("B2. labor: one state row", r.B_laborRows, 1)
  check(`B3. schedule: ${CONCURRENCY} concurrent first-load claims → exactly one winner`, r.B_schedWins, 1)
  check("B4. schedule: one state row", r.B_schedRows, 1)
  check("B5. the winner's lastSyncStartedAt is the claim instant", r.B_claimInstant, true)
  check("C1. row present, inside both cooldowns → both claims refuse", r.C_inside, [false, false])
  check("C2. a refused claim writes nothing (lastSyncStartedAt unchanged)", r.C_unchanged, true)
  check(`C3. ${CONCURRENCY} concurrent claims inside the window → no winner`, r.C_raceWins, 0)
  check(`D1. labor at +16 min (cooldown 15) → exactly one winner among ${CONCURRENCY}`, r.D_laborWins16, 1)
  check("D2. ...and the claim instant advanced", r.D_advanced, true)
  check("D3. schedule at +16 min (cooldown 30) → still refused", r.D_sched16, false)
  check(`D4. schedule at +31 min → exactly one winner among ${CONCURRENCY}`, r.D_schedWins31, 1)
  check("E1. two stores claimed concurrently → all four claims win", r.E_both, [true, true, true, true])
  check("E2. store A's state was not touched by B/C", r.E_aUntouched, true)
  check("Z1. zero prisma:error / Unique constraint lines in the B–E child's stdout+stderr", main.errorLines, 0)
  check("F1. cleanup: no SYNCSTATE fixture orgs left", r.leftover, 0)

  console.log(`\n${passes} passed, ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

const scenario = process.env.SYNCSTATE_CHILD
if (scenario) {
  child(scenario).catch((e) => {
    console.log("child threw:", e)
    process.exit(1)
  })
} else {
  parent()
}
