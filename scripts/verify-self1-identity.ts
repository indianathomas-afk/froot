/**
 * SELF-1 acceptance fixture — identity resolution and the "owed" summary.
 *
 *   npx tsx scripts/verify-self1-identity.ts
 *
 * ── WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT ──────────────────────
 *
 * THIS PROVES LOGIC ONLY. It runs against the DEV branch with a throwaway org
 * and IS NOT THE STAGING PASS (Gary, 2026-09-07). The two are reported
 * separately and neither substitutes for the other: this script cannot render a
 * page, cannot hold a Clerk session, and therefore cannot exercise
 * getActiveStaffSelf — which is where the HR-module gate and the ACTIVE refusal
 * live. Route-level verification of criteria 1-9 happens on staging against
 * real accounts.
 *
 * THE ONE HAZARD THIS SCRIPT EXISTS FOR. An account that resolves to no staff
 * member shows no banner, which looks exactly like being compliant. A browser
 * cannot tell those apart. So every assertion here is on resolveSelfStaff's
 * RETURN VALUE — ok/via/reason — never on whether something rendered. That is
 * the instrument the §2e evidence standard asks for.
 *
 * IT ALSO COVERS THE CASE STAGING CANNOT. Zero staff rows share an email inside
 * any org on br-square-feather (measured 2026-09-07), so the ambiguity branch is
 * unreachable there. It is constructed here.
 *
 * Everything is deleted afterwards. No real employee is touched, on any branch.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { resolveSelfStaff } from "../src/lib/hr"
import {
  getStaffComplianceDetail,
  openComplianceItems,
  summarizeOwed,
} from "../src/lib/hr-compliance"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const FILE = {
  fileUrl: "https://example.invalid/fixture.pdf",
  fileName: "fixture.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}

async function main() {
  const tag = Math.random().toString(36).slice(2, 8)
  const dayMs = 24 * 60 * 60 * 1000
  const now = Date.now()

  // §2e: the branch AND the ep- host, in the same output as the results, asked
  // of the server rather than parsed out of a connection string — so the label
  // cannot drift from the database actually being written to. The ::text casts
  // are required: current_setting returns `name`, which the Prisma client
  // rejects as an unsupported native type.
  //
  // THIS SCRIPT WRITES, so the guard is a hard stop rather than a print. Only
  // the dev branch is an acceptable target; staging is ep-odd-rain and is
  // verified through the browser, never through a fixture writer.
  const [env] = await prisma.$queryRawUnsafe<
    { neon_branch_id: string | null; neon_endpoint_id: string | null; db: string; utc_now: string }[]
  >(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id, " +
      "current_setting('neon.endpoint_id', true)::text AS neon_endpoint_id, " +
      "current_database()::text AS db, (now() AT TIME ZONE 'UTC')::text AS utc_now"
  )
  console.log(`Neon branch   : ${env?.neon_branch_id ?? "UNKNOWN"}`)
  console.log(`Neon endpoint : ${env?.neon_endpoint_id ?? "UNKNOWN"}`)
  console.log(`Database      : ${env?.db}   UTC now: ${env?.utc_now}\n`)
  const DEV_BRANCH = "br-broad-wave-a6vpjdw0"
  if (env?.neon_branch_id !== DEV_BRANCH) {
    console.error(`REFUSING TO RUN: expected the dev branch ${DEV_BRANCH}, got ${env?.neon_branch_id}.`)
    console.error("This script creates and deletes rows. It must never point anywhere else.")
    process.exit(1)
  }

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-self1-${tag}`,
      name: "ZZ SELF-1 Fixture Org (safe to delete)",
      activeModules: ["hr"],
    },
  })
  console.log(`Fixture org ${org.id}\n`)

  try {
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "ZZ SELF-1 Store", timezone: "America/Los_Angeles" },
    })

    const mkUser = (label: string, email: string) =>
      prisma.user.create({
        data: {
          clerkUserId: `fixture-self1-${tag}-${label}`,
          organizationId: org.id,
          email,
          role: "MANAGER",
        },
      })
    const mkStaff = (name: string, opts: { email?: string; userId?: string; status?: string } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: name,
          fullName: `${name} Fixture`,
          email: opts.email ?? null,
          userId: opts.userId ?? null,
          status: opts.status ?? "ACTIVE",
        },
      })

    // ── Population ──────────────────────────────────────────────────────────
    const uLinked = await mkUser("linked", "linked@fixture.invalid")
    const uEmail = await mkUser("email", "emailonly@fixture.invalid")
    const uNone = await mkUser("none", "nobody@fixture.invalid")
    const uAmbig = await mkUser("ambig", "twice@fixture.invalid")
    const uStolen = await mkUser("stolen", "taken@fixture.invalid")
    const uOther = await mkUser("other", "other@fixture.invalid")
    const uTerm = await mkUser("term", "terminated@fixture.invalid")
    const uNoEmail = await prisma.user.create({
      data: { clerkUserId: `fixture-self1-${tag}-noemail`, organizationId: org.id, email: "", role: "MANAGER" },
    })

    const sLinked = await mkStaff("SELF1-Linked", { userId: uLinked.id, email: "different@fixture.invalid" })
    const sEmail = await mkStaff("SELF1-EmailOnly", { email: "EmailOnly@Fixture.Invalid" }) // case differs on purpose
    const sTerm = await mkStaff("SELF1-Terminated", { userId: uTerm.id, status: "TERMINATED" })
    // Two unlinked rows sharing one email — the ambiguity staging cannot show.
    await mkStaff("SELF1-Twin-A", { email: "twice@fixture.invalid" })
    await mkStaff("SELF1-Twin-B", { email: "twice@fixture.invalid" })
    // An email match already claimed by a DIFFERENT login.
    await mkStaff("SELF1-SomeoneElse", { email: "taken@fixture.invalid", userId: uOther.id })

    await prisma.storeStaffAssignment.createMany({
      data: [
        { staffMemberId: sLinked.id, storeId: store.id, isPrimary: true },
        { staffMemberId: sEmail.id, storeId: store.id, isPrimary: true },
        { staffMemberId: sTerm.id, storeId: store.id, isPrimary: true },
      ],
    })

    // ── 1. Resolution ───────────────────────────────────────────────────────
    const rLinked = await resolveSelfStaff(org.id, uLinked)
    check("FK link resolves", rLinked.ok && rLinked.via === "link" && rLinked.staffMember.id === sLinked.id)
    check(
      "FK link WINS over a different email on the same row",
      rLinked.ok && rLinked.staffMember.displayName === "SELF1-Linked"
    )

    const rEmail = await resolveSelfStaff(org.id, uEmail)
    check("email match resolves, case-insensitively", rEmail.ok && rEmail.via === "email" && rEmail.staffMember.id === sEmail.id)

    const rNone = await resolveSelfStaff(org.id, uNone)
    check("no match → reason no-match (NOT a silent null)", !rNone.ok && rNone.reason === "no-match", !rNone.ok ? rNone.reason : "resolved")

    const rNoEmail = await resolveSelfStaff(org.id, uNoEmail)
    check("blank email → reason no-email", !rNoEmail.ok && rNoEmail.reason === "no-email")

    // THE R1 CASE. findFirst would have returned Twin-A and called it an answer.
    const rAmbig = await resolveSelfStaff(org.id, uAmbig)
    check(
      "two email matches → ambiguous, resolves to NOTHING",
      !rAmbig.ok && rAmbig.reason === "ambiguous",
      !rAmbig.ok ? rAmbig.reason : `WRONGLY resolved to ${rAmbig.staffMember.displayName}`
    )

    // The /users guard (users/page.tsx:184), now in the resolver.
    const rStolen = await resolveSelfStaff(org.id, uStolen)
    check(
      "email match owned by another login is NOT mine",
      !rStolen.ok && rStolen.reason === "no-match",
      !rStolen.ok ? rStolen.reason : `WRONGLY resolved to ${rStolen.staffMember.displayName}`
    )

    // Status-blind by design — the ACTIVE refusal is getActiveStaffSelf's.
    const rTerm = await resolveSelfStaff(org.id, uTerm)
    check("terminated member still RESOLVES (identity is status-blind)", rTerm.ok && rTerm.staffMember.id === sTerm.id)

    // Org scoping: the same login against a foreign org id resolves to nothing.
    const rCrossOrg = await resolveSelfStaff("cl_no_such_org_fixture", uLinked)
    check("wrong org → no match", !rCrossOrg.ok)

    // ── 2. Owed ─────────────────────────────────────────────────────────────
    const mod = await prisma.trainingModule.create({
      data: { organizationId: org.id, title: "ZZ SELF-1 Module", description: "fixture" },
    })
    const mod2 = await prisma.trainingModule.create({
      data: { organizationId: org.id, title: "ZZ SELF-1 Module 2", description: "fixture" },
    })
    // Two open assignments with different due dates; the nearer one is overdue.
    await prisma.trainingAssignment.create({
      data: {
        trainingModuleId: mod.id, staffMemberId: sLinked.id, assignedByUserId: "fixture",
        status: "InProgress", dueDate: new Date(now - 3 * dayMs),
      },
    })
    await prisma.trainingAssignment.create({
      data: {
        trainingModuleId: mod2.id, staffMemberId: sLinked.id, assignedByUserId: "fixture",
        status: "NotStarted", dueDate: new Date(now + 10 * dayMs),
      },
    })
    // A TERMINATED member with a live obligation — the trap criterion 6 guards.
    await prisma.trainingAssignment.create({
      data: {
        trainingModuleId: mod.id, staffMemberId: sTerm.id, assignedByUserId: "fixture",
        status: "NotStarted", dueDate: new Date(now - 5 * dayMs),
      },
    })

    const dLinked = await getStaffComplianceDetail(org.id, sLinked.id)
    const owed = summarizeOwed(dLinked!)
    check("owed counts both open assignments", owed.openCount === 2, `got ${owed.openCount}`)
    check("owed counts the overdue one", owed.overdueCount === 1, `got ${owed.overdueCount}`)
    check(
      "nearest due date is the EARLIER of the two",
      owed.nearestDueDate === dLinked!.items
        .filter((i) => i.kind === "training" && i.dueDate)
        .map((i) => (i.kind === "training" ? i.dueDate! : ""))
        .sort()[0]
    )
    check("owed carries the member's display zone", owed.timeZone === "America/Los_Angeles", owed.timeZone)
    check(
      "openComplianceItems == the /my filter it replaced",
      openComplianceItems(dLinked).length === dLinked!.items.filter((i) => i.status !== "complete").length
    )

    // Document-only debt: a required doc, no training. Ruled 2026-09-07 —
    // renders a COUNT WITH NO DUE-DATE CLAUSE, because HrDocument has no due
    // date at all. nearestDueDate must be null, not an epoch, not a guess.
    await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "Acknowledgment", title: "ZZ SELF-1 Doc", category: "Policy",
        appliesTo: "all", requiresAcknowledgment: true,
        versions: { create: { versionNumber: 1, fileHash: `hash-${tag}`, ...FILE } },
        checkpoints: { create: [{ name: "ck1", type: "Signature", orderIndex: 0 }] },
      },
    })
    const dDocOnly = await getStaffComplianceDetail(org.id, sEmail.id)
    const owedDoc = summarizeOwed(dDocOnly!)
    check("document-only debt is counted", owedDoc.openCount === 1, `got ${owedDoc.openCount}`)
    check("document-only debt has NO due date (null, not fabricated)", owedDoc.nearestDueDate === null, String(owedDoc.nearestDueDate))
    check("document-only debt is not overdue", owedDoc.overdueCount === 0)

    // ── 3. Criterion 6's ingredient ─────────────────────────────────────────
    // The gate itself is getActiveStaffSelf's and needs a Clerk session, so it
    // is proven at route level on staging. What is proven HERE is that the
    // hazard is real: the rollup hands back live obligations for a terminated
    // member, so any surface that forgets to check `active` will show them.
    const dTerm = await getStaffComplianceDetail(org.id, sTerm.id)
    check("TRAP CONFIRMED: terminated member's rollup still lists open items", summarizeOwed(dTerm!).openCount > 0)
    check("…and the only signal is detail.active === false", dTerm!.active === false)
  } finally {
    await prisma.trainingAssignment.deleteMany({ where: { trainingModule: { organizationId: org.id } } })
    await prisma.trainingModule.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
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
