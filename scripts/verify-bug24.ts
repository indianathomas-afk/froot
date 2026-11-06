/**
 * BUG-24 acceptance fixture: a delete blocked by history is a 409 with one
 * plain sentence, never a 500. The blocked row survives, and an unblocked
 * delete still goes through.
 *
 *   npx tsx scripts/verify-bug24.ts
 *
 * DEV DATABASE ONLY. Every row is named for the phase (clerkOrgId
 * `fixture-bug24-*`, "BUG-24 …") and removed in `finally`. The leftover count
 * is asserted to be 0.
 *
 * Runs the SAME code the routes run: each fixed route's delete goes through
 * refuseIfRestricted() with a sentence from RESTRICT_MESSAGES, both from
 * src/lib/db/restrict-violation.ts. The fixture calls that helper with the
 * route's exact delete and asserts the HTTP status and body it returns. The
 * route adds only auth, the org lookup and any pre-check. Section S checks in
 * the source that each route is wired to the helper with its own sentence.
 *
 * Rows 8–13 are the RACE behind an existing pre-check. The fixture skips the
 * pre-check and calls the guarded delete directly, which is exactly what the
 * race does.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { Prisma } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { RESTRICT_MESSAGES, isRestrictViolation, refuseIfRestricted } from "../src/lib/db/restrict-violation"
import { isForeignKeyViolation } from "../src/app/api/templates/history"

let pass = 0
let fail = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}

// What the route would send: null → the route's own success; else status + body.
async function answer(run: () => Promise<unknown>, message: string) {
  const res = await refuseIfRestricted(run, message, "verify-bug24")
  if (!res) return { status: 200 }
  return { status: res.status, body: await res.json() }
}

async function main() {
  const [env] = await prisma.$queryRawUnsafe<{ neon_branch_id: string | null }[]>(
    "SELECT current_setting('neon.branch_id', true)::text AS neon_branch_id"
  )
  console.log(`BUG-24 fixture · Neon branch: ${env?.neon_branch_id ?? "UNKNOWN (null — not Neon?)"}`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `fixture-bug24-${stamp}`, name: "BUG-24 Fixture Org" } })
  const ids = { attempts: [] as string[], acks: [] as string[] }
  try {
    const mkStore = (name: string) =>
      prisma.store.create({ data: { organizationId: org.id, name, timezone: "America/Los_Angeles", squareLocationId: `bug24-${name}-${stamp}` } })
    const mkStaff = (displayName: string) => prisma.staffMember.create({ data: { organizationId: org.id, displayName } })

    // ── M. The matcher, against a real caught RESTRICT violation ─────────────
    console.log("\nM. Shared matcher")
    const storeBlocked = await mkStore("BUG-24 Store With Checklist")
    const tpl = await prisma.template.create({ data: { organizationId: org.id, name: "BUG-24 Template", type: "Opening" } })
    await prisma.checklist.create({
      data: { organizationId: org.id, templateId: tpl.id, storeId: storeBlocked.id, date: new Date(), status: "Completed", completedAt: new Date() },
    })
    let rawErr: unknown = null
    try {
      await prisma.store.delete({ where: { id: storeBlocked.id } })
    } catch (e) {
      rawErr = e
    }
    const cause = (rawErr as { cause?: { kind?: string; code?: string } } | null)?.cause
    const shape = rawErr instanceof Prisma.PrismaClientKnownRequestError ? `prisma:${rawErr.code}` : `${cause?.kind}:${cause?.code}`
    console.log(`        (raw error shape: ${shape})`)
    check("M1. a raw blocked store delete throws postgres 23001", shape, "postgres:23001")
    check("M2. isRestrictViolation recognises that real error", isRestrictViolation(rawErr), true)
    check("M3. …and not an unrelated error", isRestrictViolation(new Error("boom")), false)
    check("M4. BUG-23's re-exported name is the same function", isForeignKeyViolation === isRestrictViolation, true)
    const other = await answer(async () => { throw new Error("BUG-24 unrelated failure (expected in log)") }, "unused")
    check("M5. any other error stays a 500, never a 409", other.status, 500)

    // ── 1. Store (row 1) ─────────────────────────────────────────────────────
    console.log("\n1. DELETE /api/stores/[id]")
    check("1a. store with a checklist → 409 + sentence", await answer(() => prisma.store.delete({ where: { id: storeBlocked.id } }), RESTRICT_MESSAGES.store),
      { status: 409, body: { error: "This store has checklists, purchase orders or inventory counts — it can't be deleted." } })
    check("1b. …and the store survives", await prisma.store.count({ where: { id: storeBlocked.id } }), 1)
    const storeClean = await mkStore("BUG-24 Store Clean")
    check("1c. unused store → deleted (route: 200)", await answer(() => prisma.store.delete({ where: { id: storeClean.id } }), RESTRICT_MESSAGES.store), { status: 200 })
    check("1d. …and it is gone", await prisma.store.count({ where: { id: storeClean.id } }), 0)

    // ── 3. Staff (row 3) ─────────────────────────────────────────────────────
    console.log("\n3. DELETE /api/staff/[id]")
    const staffBlocked = await mkStaff("BUG-24 Staff With Labor")
    await prisma.laborAssignment.create({
      data: { organizationId: org.id, storeId: storeBlocked.id, staffMemberId: staffBlocked.id, date: new Date("2026-11-05"), startMinutes: 480, endMinutes: 960, createdByUserId: "bug24-fixture" },
    })
    check("3a. pre-check now counts LaborAssignment (it sees 1)", await prisma.laborAssignment.count({ where: { staffMemberId: staffBlocked.id } }), 1)
    check("3b. backstop: staff with a labor assignment → 409 + sentence",
      await answer(() => prisma.staffMember.deleteMany({ where: { id: staffBlocked.id, organizationId: org.id } }), RESTRICT_MESSAGES.staff),
      { status: 409, body: { error: "This staff member has records and cannot be deleted — terminate them instead" } })
    check("3c. …and the staff member survives", await prisma.staffMember.count({ where: { id: staffBlocked.id } }), 1)
    const staffClean = await mkStaff("BUG-24 Staff Clean")
    check("3d. staff member with no records → deleted",
      await answer(() => prisma.staffMember.deleteMany({ where: { id: staffClean.id, organizationId: org.id } }), RESTRICT_MESSAGES.staff), { status: 200 })
    check("3e. …and they are gone", await prisma.staffMember.count({ where: { id: staffClean.id } }), 0)

    // ── 8–13. The race behind each existing pre-check ────────────────────────
    console.log("\n8–13. Race backstop")
    const blocked409 = (msg: string) => ({ status: 409, body: { error: msg } })

    const tType = await prisma.templateType.create({ data: { organizationId: org.id, name: "BUG-24 Type" } })
    await prisma.template.create({ data: { organizationId: org.id, name: "BUG-24 Typed Template", type: "BUG-24 Type", typeId: tType.id } })
    check("8a. template type in use → 409", await answer(() => prisma.templateType.delete({ where: { id: tType.id } }), RESTRICT_MESSAGES.templateType), blocked409(RESTRICT_MESSAGES.templateType))
    check("8b. …survives", await prisma.templateType.count({ where: { id: tType.id } }), 1)
    const tTypeClean = await prisma.templateType.create({ data: { organizationId: org.id, name: "BUG-24 Type Clean" } })
    check("8c. unused template type → deleted", await answer(() => prisma.templateType.delete({ where: { id: tTypeClean.id } }), RESTRICT_MESSAGES.templateType), { status: 200 })

    const tCat = await prisma.trainingCategory.create({ data: { organizationId: org.id, name: "BUG-24 Training Cat" } })
    const tModule = await prisma.trainingModule.create({ data: { organizationId: org.id, title: "BUG-24 Module", categoryId: tCat.id } })
    check("9a. training category in use → 409", await answer(() => prisma.trainingCategory.delete({ where: { id: tCat.id } }), RESTRICT_MESSAGES.trainingCategory), blocked409(RESTRICT_MESSAGES.trainingCategory))
    check("9b. …survives", await prisma.trainingCategory.count({ where: { id: tCat.id } }), 1)

    const dCat = await prisma.hrDocumentCategory.create({ data: { organizationId: org.id, name: "BUG-24 Doc Cat" } })
    const doc = await prisma.hrDocument.create({ data: { organizationId: org.id, kind: "Acknowledgment", title: "BUG-24 Doc", category: "BUG-24 Doc Cat", categoryId: dCat.id } })
    check("10a. document category in use → 409", await answer(() => prisma.hrDocumentCategory.delete({ where: { id: dCat.id } }), RESTRICT_MESSAGES.hrDocumentCategory), blocked409(RESTRICT_MESSAGES.hrDocumentCategory))
    check("10b. …survives", await prisma.hrDocumentCategory.count({ where: { id: dCat.id } }), 1)

    const trainee = await mkStaff("BUG-24 Trainee")
    const assignment = await prisma.trainingAssignment.create({ data: { trainingModuleId: tModule.id, staffMemberId: trainee.id, assignedByUserId: "bug24-fixture" } })
    check("11a. module with an assignment → 409", await answer(() => prisma.trainingModule.delete({ where: { id: tModule.id } }), RESTRICT_MESSAGES.trainingModule), blocked409(RESTRICT_MESSAGES.trainingModule))
    check("11b. …survives", await prisma.trainingModule.count({ where: { id: tModule.id } }), 1)

    const attempt = await prisma.trainingQuizAttempt.create({
      data: { trainingAssignmentId: assignment.id, questionsSnapshot: [], answers: [], passThresholdSnapshot: 80, status: "Failed", authMethod: "ClerkSession" },
    })
    ids.attempts.push(attempt.id)
    check("12a. assignment with a quiz attempt → 409", await answer(() => prisma.trainingAssignment.delete({ where: { id: assignment.id } }), RESTRICT_MESSAGES.trainingAssignment), blocked409(RESTRICT_MESSAGES.trainingAssignment))
    check("12b. …survives", await prisma.trainingAssignment.count({ where: { id: assignment.id } }), 1)

    const version = await prisma.hrDocumentVersion.create({
      data: { hrDocumentId: doc.id, versionNumber: 1, fileUrl: "https://example.invalid/bug24.pdf", fileName: "bug24.pdf", contentType: "application/pdf", sizeBytes: 1, fileHash: "bug24", uploadedByUserId: "bug24-fixture" },
    })
    const checkpoint = await prisma.hrDocumentCheckpoint.create({ data: { hrDocumentId: doc.id, name: "BUG-24 Checkpoint", type: "Signature", orderIndex: 0 } })
    const ack = await prisma.hrDocumentAcknowledgment.create({
      data: {
        checkpointId: checkpoint.id, hrDocumentVersionId: version.id, checkpointName: "BUG-24 Checkpoint", checkpointType: "Signature",
        documentTitle: "BUG-24 Doc", documentVersionNumber: 1, documentFileHash: "bug24", staffName: "BUG-24 Trainee",
        method: "Signature", authMethod: "ClerkSession", consentGiven: true,
      },
    })
    ids.acks.push(ack.id)
    check("13a. signed checkpoint → 409", await answer(() => prisma.hrDocumentCheckpoint.delete({ where: { id: checkpoint.id } }), RESTRICT_MESSAGES.hrCheckpoint), blocked409(RESTRICT_MESSAGES.hrCheckpoint))
    check("13b. …survives", await prisma.hrDocumentCheckpoint.count({ where: { id: checkpoint.id } }), 1)

    // ── S. Source: each route wired to the helper with its own sentence ──────
    console.log("\nS. Source checks")
    const src = (p: string) => readFileSync(p, "utf8")
    const wired: [string, string, keyof typeof RESTRICT_MESSAGES][] = [
      ["S1", "src/app/api/stores/[id]/route.ts", "store"],
      ["S3", "src/app/api/staff/[id]/route.ts", "staff"],
      ["S8", "src/app/api/template-types/[id]/route.ts", "templateType"],
      ["S9", "src/app/api/hr/training/categories/[id]/route.ts", "trainingCategory"],
      ["S10", "src/app/api/hr/documents/categories/[id]/route.ts", "hrDocumentCategory"],
      ["S11", "src/app/api/hr/training/[id]/route.ts", "trainingModule"],
      ["S12", "src/app/api/hr/training/assignments/[id]/route.ts", "trainingAssignment"],
      ["S13", "src/app/api/hr/documents/[id]/checkpoints/[checkpointId]/route.ts", "hrCheckpoint"],
    ]
    for (const [n, p, key] of wired) {
      const s = src(p)
      check(`${n}. ${p.replace("src/app/api/", "")} uses refuseIfRestricted + RESTRICT_MESSAGES.${key}`,
        s.includes("refuseIfRestricted(") && s.includes(`RESTRICT_MESSAGES.${key}`), true)
    }
    const staffRoute = src("src/app/api/staff/[id]/route.ts")
    check("S3b. staff pre-check counts laborAssignment", staffRoute.includes("prisma.laborAssignment.count({ where: { staffMemberId: id } })"), true)
    check("S1b. no bare awaited store delete left", src("src/app/api/stores/[id]/route.ts").includes("await prisma.store.delete("), false)
    const dialog = src("src/app/(app)/stores/store-actions.tsx")
    check("S1c. store dialog checks res.ok and shows the error", dialog.includes("if (!res.ok)") && dialog.includes("{deleteError &&"), true)
    check("S3c. roster button checks res.ok and shows the error", src("src/app/(app)/staff/staff-buttons.tsx").includes(`alert(data?.error ?? "Failed to remove staff member")`), true)
  } finally {
    await prisma.trainingQuizAttempt.deleteMany({ where: { id: { in: ids.attempts } } })
    await prisma.trainingAssignment.deleteMany({ where: { trainingModule: { organizationId: org.id } } })
    await prisma.trainingModule.deleteMany({ where: { organizationId: org.id } })
    await prisma.trainingCategory.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { id: { in: ids.acks } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } }) // cascades versions + checkpoints
    await prisma.hrDocumentCategory.deleteMany({ where: { organizationId: org.id } })
    await prisma.laborAssignment.deleteMany({ where: { organizationId: org.id } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.checklist.deleteMany({ where: { organizationId: org.id } })
    await prisma.template.deleteMany({ where: { organizationId: org.id } })
    await prisma.templateType.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.deleteMany({ where: { id: org.id } })
    const left = {
      orgs: await prisma.organization.count({ where: { clerkOrgId: { startsWith: "fixture-bug24-" } } }),
      attempts: await prisma.trainingQuizAttempt.count({ where: { id: { in: ids.attempts } } }),
      acks: await prisma.hrDocumentAcknowledgment.count({ where: { id: { in: ids.acks } } }),
      versions: await prisma.hrDocumentVersion.count({ where: { fileHash: "bug24" } }),
    }
    check("Cleanup: zero fixture-bug24 leftovers", left, { orgs: 0, attempts: 0, acks: 0, versions: 0 })
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
