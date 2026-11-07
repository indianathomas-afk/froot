/**
 * DEBT-129 fixture — User.name kept in step with Clerk.
 *
 * Run: npx tsx scripts/verify-debt-129.ts
 *
 * THIS PROVES LOGIC ONLY, against the DEV branch, with a throwaway org named
 * for this phase. It exercises src/lib/user-name.ts — the helper (rule A), the
 * webhook path (syncUserNameFromClerk, which the user.updated handler calls),
 * and the lazy fill (fillMissingUserName, which the usage beacon calls). It does
 * NOT post a signed event to the webhook route or a beacon to /api/usage; the
 * route wiring is covered by the build and the staging test list on the row.
 *
 * The Clerk loader is a stub that counts its calls, so "no Clerk call for a
 * named row" is measured, not assumed. Everything is deleted afterwards.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { clerkDisplayName, syncUserNameFromClerk, fillMissingUserName } from "../src/lib/user-name"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

async function main() {
  const tag = Math.random().toString(36).slice(2, 8)

  // Branch identity from the server, never typed. This script WRITES, so it is
  // a hard stop anywhere but dev.
  const [env] = await prisma.$queryRawUnsafe<{ neon_branch_id: string | null; utc_now: string }[]>(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id, (now() AT TIME ZONE 'UTC')::text AS utc_now"
  )
  console.log(`Neon branch : ${env?.neon_branch_id ?? "UNKNOWN"}   UTC now: ${env?.utc_now}\n`)
  const DEV_BRANCH = "br-broad-wave-a6vpjdw0"
  if (env?.neon_branch_id !== DEV_BRANCH) {
    console.error(`REFUSING TO RUN: expected the dev branch ${DEV_BRANCH}, got ${env?.neon_branch_id}.`)
    process.exit(1)
  }

  // ── Helper (pure) ─────────────────────────────────────────────────────────
  check('helper: "Gary" + "Thomas" → "Gary Thomas"', clerkDisplayName("Gary", "Thomas") === "Gary Thomas")
  check('helper: trims parts → "Gary Thomas"', clerkDisplayName("  Gary ", " Thomas  ") === "Gary Thomas")
  check('helper: first only → "Gary"', clerkDisplayName("Gary", null) === "Gary")
  check('helper: last only → "Thomas"', clerkDisplayName(undefined, "Thomas") === "Thomas")
  check("helper: both null → null", clerkDisplayName(null, null) === null)
  check("helper: blanks → null", clerkDisplayName("   ", "") === null)
  check('helper: first containing "@" → null', clerkDisplayName("gary@keva.com", null) === null)
  check('helper: last containing "@" → null', clerkDisplayName("Gary", "t@x") === null)
  check("helper: takes first + last only — no username parameter exists", clerkDisplayName.length === 2)

  const org = await prisma.organization.create({
    data: { clerkOrgId: `fixture-debt129-${tag}`, name: "ZZ DEBT-129 Fixture Org (safe to delete)" },
  })
  console.log(`\nFixture org ${org.id}\n`)

  const mk = (key: string, role: "ADMIN" | "MANAGER" | "STAFF" | "STORE", name: string | null) =>
    prisma.user.create({
      data: {
        clerkUserId: `debt129-${key}-${tag}`,
        organizationId: org.id,
        email: `debt129-${key}-${tag}@example.invalid`,
        role,
        name,
      },
    })
  const nameOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).name

  try {
    // ── Webhook path (user.updated) ─────────────────────────────────────────
    const w1 = await mk("w-null", "ADMIN", null)
    const n1 = await syncUserNameFromClerk(w1.clerkUserId, "Gary", "Thomas")
    check("webhook: user.updated with a name → User.name set", (await nameOf(w1.id)) === "Gary Thomas", `wrote ${n1}`)

    const w2 = await mk("w-named", "MANAGER", "DEBT-129 Old Name")
    const n2 = await syncUserNameFromClerk(w2.clerkUserId, null, null)
    check("webhook: user.updated with no name → existing name unchanged", (await nameOf(w2.id)) === "DEBT-129 Old Name", `wrote ${n2}`)

    const n2b = await syncUserNameFromClerk(w2.clerkUserId, "  ", "")
    check("webhook: user.updated with blank name → existing name unchanged", (await nameOf(w2.id)) === "DEBT-129 Old Name", `wrote ${n2b}`)

    const n2c = await syncUserNameFromClerk(w2.clerkUserId, "someone@example.com", null)
    check('webhook: user.updated with an "@" name → existing name unchanged', (await nameOf(w2.id)) === "DEBT-129 Old Name", `wrote ${n2c}`)

    const n3 = await syncUserNameFromClerk(w2.clerkUserId, "New", "Name")
    check("webhook: a Clerk rename reaches Froot", (await nameOf(w2.id)) === "New Name", `wrote ${n3}`)

    const w4 = await mk("w-store", "STORE", "#1 — DEBT-129 Store")
    const n4 = await syncUserNameFromClerk(w4.clerkUserId, "Tommy", "Thomas")
    check("webhook: STORE row's device name is never overwritten", (await nameOf(w4.id)) === "#1 — DEBT-129 Store" && n4 === 0, `wrote ${n4}`)

    // ── Lazy fill (usage beacon) ────────────────────────────────────────────
    let calls = 0
    const loader = (firstName: string | null, lastName: string | null) => async () => {
      calls += 1
      return { firstName, lastName }
    }

    const l1 = await mk("l-null", "ADMIN", null)
    calls = 0
    const f1 = await fillMissingUserName(l1, loader("Gary", "Thomas"))
    check("lazy: null name + Clerk name → filled once", f1 === 1 && (await nameOf(l1.id)) === "Gary Thomas" && calls === 1, `wrote ${f1}, clerk calls ${calls}`)

    const l1fresh = await prisma.user.findUniqueOrThrow({ where: { id: l1.id } })
    calls = 0
    const f2 = await fillMissingUserName(l1fresh, loader("Someone", "Else"))
    check("lazy: second call writes nothing and makes no Clerk call", f2 === 0 && calls === 0 && (await nameOf(l1.id)) === "Gary Thomas", `wrote ${f2}, clerk calls ${calls}`)

    // Stale in-memory row (name null) against a DB row that has since been
    // named — the WHERE name IS NULL guard is what refuses the write.
    calls = 0
    const f3 = await fillMissingUserName(l1, loader("Someone", "Else"))
    check("lazy: stale null row never overwrites a name set in the meantime", f3 === 0 && (await nameOf(l1.id)) === "Gary Thomas", `wrote ${f3}, clerk calls ${calls}`)

    const l2 = await mk("l-named", "STAFF", "DEBT-129 Kept")
    calls = 0
    const f4 = await fillMissingUserName(l2, loader("Other", "Name"))
    check("lazy: existing name → untouched, no Clerk call", f4 === 0 && calls === 0 && (await nameOf(l2.id)) === "DEBT-129 Kept", `clerk calls ${calls}`)

    const l3 = await mk("l-store", "STORE", null)
    calls = 0
    const f5 = await fillMissingUserName(l3, loader("Tommy", "Thomas"))
    check("lazy: STORE row → untouched, no Clerk call", f5 === 0 && calls === 0 && (await nameOf(l3.id)) === null, `clerk calls ${calls}`)

    const l4 = await mk("l-noname", "STAFF", null)
    const f6 = await fillMissingUserName(l4, loader(null, null))
    check("lazy: Clerk has no name (username-only account) → stays null", f6 === 0 && (await nameOf(l4.id)) === null)

    const f7 = await fillMissingUserName(l4, loader("x@y.com", null))
    check('lazy: Clerk name containing "@" → stays null', f7 === 0 && (await nameOf(l4.id)) === null)

    let threw = false
    let f8 = -1
    try {
      f8 = await fillMissingUserName(l4, async () => {
        throw new Error("DEBT-129 simulated Clerk outage")
      })
    } catch {
      threw = true
    }
    check("lazy: a Clerk failure is swallowed (never breaks the beacon)", !threw && f8 === 0 && (await nameOf(l4.id)) === null)
  } finally {
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    console.log("\nFixture cleaned up.")
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
