/**
 * HR-8 acceptance fixture — compliance rollup definitions and batching.
 *
 *   npx tsx scripts/verify-hr8-compliance.ts
 *
 * Creates a throwaway org (2 stores, 5 staff) exercising every status branch
 * agreed for HR-8 (Gary, 2026-07-22 — see docs/DECISIONS.md):
 *   docs   — complete via signed record · complete via all-required-acked
 *            (pending-record) · needs-resign (record on old version) ·
 *            in-progress · not-started · store-scoped applicability ·
 *            inactive + non-required docs excluded
 *   training — Completed(+certified) · InProgress · overdue (dueDate past,
 *              not Completed) · terminated staff's assignment invisible
 *   forms  — outside the percentage; executed vs PendingSupervisor counts,
 *            pending list limited to ACTIVE staff in scope
 *   rollup — ACTIVE-only totals, primary-store grouping, manager store scope,
 *            summaries map (terminated → pct null), single-staff detail for a
 *            terminated member still returns auditable items
 * Everything is deleted afterwards.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import {
  computeStaffComplianceDetails,
  getOrgComplianceRollup,
  getStaffComplianceDetail,
  getStaffComplianceSummaries,
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
  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000

  const org = await prisma.organization.create({
    data: { clerkOrgId: `fixture-hr8-${tag}`, name: "ZZ HR-8 Fixture Org (safe to delete)", activeModules: ["hr"] },
  })
  console.log(`Fixture org ${org.id}\n`)

  try {
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((n) =>
        prisma.store.create({
          data: { organizationId: org.id, name: `ZZ HR-8 Store ${n}`, timezone: "America/Los_Angeles" },
        })
      )
    )

    const mkStaff = (name: string, status = "ACTIVE") =>
      prisma.staffMember.create({
        data: { organizationId: org.id, displayName: name, fullName: `${name} Fixture`, status },
      })
    const [s1, s2, s3, s4, s5] = await Promise.all([
      mkStaff("HR8-S1"), // Store A — fully compliant
      mkStaff("HR8-S2"), // Store A — pending-record + in-progress
      mkStaff("HR8-S3"), // Store B — needs-resign + overdue
      mkStaff("HR8-S4", "TERMINATED"), // Store A — excluded from rollups
      mkStaff("HR8-S5"), // no store — only appliesTo:"all" docs apply
    ])
    await prisma.storeStaffAssignment.createMany({
      data: [
        { staffMemberId: s1.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s2.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s3.id, storeId: storeB.id, isPrimary: true },
        { staffMemberId: s4.id, storeId: storeA.id, isPrimary: true },
      ],
    })

    // ── Documents ──
    // docA: appliesTo all, v1 current, 2 required + 1 optional checkpoint.
    const docA = await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "Acknowledgment", title: "HR8 Doc A", category: "Handbook",
        appliesTo: "all", requiresAcknowledgment: true,
        versions: { create: { versionNumber: 1, fileHash: "hashA1", ...FILE } },
        checkpoints: {
          create: [
            { name: "A ck1", type: "Initial", orderIndex: 0 },
            { name: "A ck2", type: "Signature", orderIndex: 1 },
            { name: "A optional", type: "Field", orderIndex: 2, required: false },
          ],
        },
      },
      include: { versions: true, checkpoints: { orderBy: { orderIndex: "asc" } } },
    })
    // docB: appliesTo all, v1 superseded by v2 (current), 2 required checkpoints.
    const docB = await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "Acknowledgment", title: "HR8 Doc B", category: "Policy",
        appliesTo: "all", requiresAcknowledgment: true,
        versions: {
          create: [
            { versionNumber: 1, fileHash: "hashB1", isCurrent: false, ...FILE },
            { versionNumber: 2, fileHash: "hashB2", ...FILE },
          ],
        },
        checkpoints: {
          create: [
            { name: "B ck1", type: "Initial", orderIndex: 0 },
            { name: "B ck2", type: "Signature", orderIndex: 1 },
          ],
        },
      },
      include: { versions: { orderBy: { versionNumber: "asc" } }, checkpoints: { orderBy: { orderIndex: "asc" } } },
    })
    // docC: appliesTo selected → Store B only.
    const docC = await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "Acknowledgment", title: "HR8 Doc C", category: "Policy",
        appliesTo: "selected", requiresAcknowledgment: true,
        storeAssignments: { create: { storeId: storeB.id } },
        versions: { create: { versionNumber: 1, fileHash: "hashC1", ...FILE } },
        checkpoints: { create: [{ name: "C ck1", type: "Signature", orderIndex: 0 }] },
      },
    })
    // Excluded from denominators: inactive doc + doc not requiring acknowledgment.
    await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "Acknowledgment", title: "HR8 Doc D (inactive)", category: "Other",
        appliesTo: "all", requiresAcknowledgment: true, isActive: false,
        versions: { create: { versionNumber: 1, fileHash: "hashD1", ...FILE } },
        checkpoints: { create: [{ name: "D ck1", type: "Signature", orderIndex: 0 }] },
      },
    })
    await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "Reference", title: "HR8 Doc E (reference)", category: "Other",
        appliesTo: "all", requiresAcknowledgment: false,
        versions: { create: { versionNumber: 1, fileHash: "hashE1", ...FILE } },
      },
    })

    const ackSnap = (doc: { title: string }, ck: { id: string; name: string; type: string }, version: { id: string; versionNumber: number; fileHash: string }, staff: { id: string; displayName: string }) => ({
      checkpointId: ck.id,
      hrDocumentVersionId: version.id,
      staffMemberId: staff.id,
      checkpointName: ck.name,
      checkpointType: ck.type,
      documentTitle: doc.title,
      documentVersionNumber: version.versionNumber,
      documentFileHash: version.fileHash,
      staffName: staff.displayName,
      method: "Signature" as const,
      authMethod: "ManagerAttested" as const,
      consentGiven: true,
    })

    const docAv1 = docA.versions[0]
    const [docBv1, docBv2] = docB.versions
    const requiredA = docA.checkpoints.filter((c) => c.required)
    const requiredB = docB.checkpoints

    // s1: signed records on docA v1 + docB v2 → complete/complete.
    await prisma.hrSignedRecord.createMany({
      data: [
        { hrDocumentVersionId: docAv1.id, staffMemberId: s1.id, completedAt: now, signedPdfPathname: "hr/fixture/s1-a.pdf", signedPdfHash: "sig1a" },
        { hrDocumentVersionId: docBv2.id, staffMemberId: s1.id, completedAt: now, signedPdfPathname: "hr/fixture/s1-b.pdf", signedPdfHash: "sig1b" },
      ],
    })
    // s2: ALL required checkpoints acked on docA v1 (incl. skipping the
    // optional one) but no record yet → pending-record = complete; ONE of two
    // checkpoints on docB v2 → in-progress.
    await prisma.hrDocumentAcknowledgment.createMany({
      data: [
        ...requiredA.map((ck) => ackSnap(docA, ck, docAv1, s2)),
        ackSnap(docB, requiredB[0], docBv2, s2),
      ],
    })
    // s3: signed record on docB v1 (superseded) → needs-resign.
    await prisma.hrSignedRecord.create({
      data: { hrDocumentVersionId: docBv1.id, staffMemberId: s3.id, completedAt: new Date(now.getTime() - 30 * dayMs), signedPdfPathname: "hr/fixture/s3-b.pdf", signedPdfHash: "sig3b" },
    })

    // ── Training ── module with 2 lessons.
    const module_ = await prisma.trainingModule.create({
      data: {
        organizationId: org.id, title: "HR8 Training M1",
        lessons: { create: [{ title: "L1", orderIndex: 0 }, { title: "L2", orderIndex: 1 }] },
      },
      include: { lessons: { orderBy: { orderIndex: "asc" } } },
    })
    await prisma.trainingAssignment.create({
      data: {
        trainingModuleId: module_.id, staffMemberId: s1.id, assignedByUserId: "fixture",
        status: "Completed", hoursLogged: 3, certifiedAt: now,
        lessonProgress: { create: module_.lessons.map((l) => ({ trainingLessonId: l.id })) },
      },
    })
    await prisma.trainingAssignment.create({
      data: {
        trainingModuleId: module_.id, staffMemberId: s2.id, assignedByUserId: "fixture",
        status: "InProgress", dueDate: new Date(now.getTime() + 7 * dayMs),
        lessonProgress: { create: [{ trainingLessonId: module_.lessons[0].id }] },
      },
    })
    await prisma.trainingAssignment.create({
      data: {
        trainingModuleId: module_.id, staffMemberId: s3.id, assignedByUserId: "fixture",
        status: "NotStarted", dueDate: new Date(now.getTime() - 3 * dayMs),
      },
    })
    await prisma.trainingAssignment.create({
      data: { trainingModuleId: module_.id, staffMemberId: s4.id, assignedByUserId: "fixture", status: "NotStarted" },
    })

    // ── Agreement form ── s1 executed, s2 pending countersign, s4 (terminated)
    // pending — must not surface.
    const form = await prisma.hrDocument.create({
      data: {
        organizationId: org.id, kind: "FillableForm", title: "HR8 Key Agreement", category: "PayAgreement",
        versions: { create: { versionNumber: 1, fileHash: "formhash", ...FILE, fileUrl: "", contentType: "application/x-froot-form-definition" } },
      },
      include: { versions: true },
    })
    const formV1 = form.versions[0]
    await prisma.formSubmission.createMany({
      data: [
        { hrDocumentVersionId: formV1.id, staffMemberId: s1.id, values: {}, status: "Completed", formTitle: form.title, employeeSignedAt: now, supervisorSignedAt: now },
        { hrDocumentVersionId: formV1.id, staffMemberId: s2.id, values: {}, status: "PendingSupervisor", formTitle: form.title, employeeSignedAt: new Date(now.getTime() - 2 * dayMs) },
        { hrDocumentVersionId: formV1.id, staffMemberId: s4.id, values: {}, status: "PendingSupervisor", formTitle: form.title, employeeSignedAt: now },
      ],
    })

    // ═══ Assertions ═══

    // 1. Per-staff details (all five, incl. terminated).
    const details = await computeStaffComplianceDetails(org.id, [s1.id, s2.id, s3.id, s4.id, s5.id])
    const byId = new Map(details.map((d) => [d.staffId, d]))
    const d1 = byId.get(s1.id)!, d2 = byId.get(s2.id)!, d3 = byId.get(s3.id)!, d4 = byId.get(s4.id)!, d5 = byId.get(s5.id)!

    const itemStatus = (d: typeof d1, title: string) =>
      d.items.find((i) => (i.kind === "document" ? i.title === title : i.moduleTitle === title))?.status

    check("s1: 3 required (docA, docB, training) — inactive/reference docs excluded", d1.requiredTotal === 3, `got ${d1.requiredTotal}`)
    check("s1: docA complete via signed record", itemStatus(d1, "HR8 Doc A") === "complete")
    check("s1: docB complete on current v2", itemStatus(d1, "HR8 Doc B") === "complete")
    check("s1: training complete + certified", itemStatus(d1, "HR8 Training M1") === "complete" && (d1.items.find((i) => i.kind === "training") as { certified: boolean }).certified)
    check("s1: pct 100", d1.pct === 100)

    check("s2: docA complete via all-required-acked (pending-record)", itemStatus(d2, "HR8 Doc A") === "complete")
    const d2docA = d2.items.find((i) => i.kind === "document" && i.title === "HR8 Doc A") as { ackedCount: number; requiredCount: number }
    check("s2: docA counts required checkpoints only (2/2, optional ignored)", d2docA.ackedCount === 2 && d2docA.requiredCount === 2, `got ${d2docA.ackedCount}/${d2docA.requiredCount}`)
    check("s2: docB in-progress (1/2)", itemStatus(d2, "HR8 Doc B") === "in-progress")
    check("s2: training in-progress (future due date)", itemStatus(d2, "HR8 Training M1") === "in-progress")
    const d2training = d2.items.find((i) => i.kind === "training") as { lessonsDone: number; lessonsTotal: number }
    check("s2: lesson progress 1/2", d2training.lessonsDone === 1 && d2training.lessonsTotal === 2)
    check("s2: pct 33 (1/3)", d2.pct === 33, `got ${d2.pct}`)

    check("s3: 4 required (docC applies via Store B)", d3.requiredTotal === 4, `got ${d3.requiredTotal}`)
    check("s3: docB needs-resign (record pinned to v1)", itemStatus(d3, "HR8 Doc B") === "needs-resign")
    const d3docB = d3.items.find((i) => i.kind === "document" && i.title === "HR8 Doc B") as { signedVersionNumber: number | null }
    check("s3: needs-resign carries prior signed version v1", d3docB.signedVersionNumber === 1)
    check("s3: docA not-started", itemStatus(d3, "HR8 Doc A") === "not-started")
    check("s3: docC not-started", itemStatus(d3, "HR8 Doc C") === "not-started")
    check("s3: training overdue", itemStatus(d3, "HR8 Training M1") === "overdue")
    check("s3: pct 0", d3.pct === 0)

    check("s5 (no store): docC does NOT apply — 2 required", d5.requiredTotal === 2, `got ${d5.requiredTotal}`)
    check("s4 (terminated): detail still computed, active=false", d4.active === false && d4.requiredTotal === 3)

    // 2. Summaries map (the /staff column) — terminated → pct null.
    const summaries = await getStaffComplianceSummaries(org.id, [s1.id, s2.id, s4.id])
    check("summaries: s1 → 100", summaries.get(s1.id)?.pct === 100)
    check("summaries: s2 → 33", summaries.get(s2.id)?.pct === 33)
    check("summaries: terminated s4 → pct null", summaries.get(s4.id)?.pct === null)

    // 3. Single-staff detail (the Compliance tab) for a terminated member.
    const s4detail = await getStaffComplianceDetail(org.id, s4.id)
    check("terminated detail: items auditable (3 items)", s4detail?.items.length === 3)

    // 4. Org rollup (ADMIN, whole org).
    const rollup = await getOrgComplianceRollup(org.id, { storeIds: null })
    check("rollup: 4 ACTIVE staff (terminated excluded)", rollup.totals.staffCount === 4)
    check("rollup: required 12 (3+3+4+2)", rollup.totals.requiredTotal === 12, `got ${rollup.totals.requiredTotal}`)
    check("rollup: completed 4 (3+1+0+0)", rollup.totals.completedCount === 4, `got ${rollup.totals.completedCount}`)
    check("rollup: pct 33", rollup.totals.pct === 33)
    check("rollup: fullyCompliant 1", rollup.totals.fullyCompliant === 1)
    check("rollup: overdue 1 · needs-resign 1", rollup.totals.overdueCount === 1 && rollup.totals.needsResignCount === 1)

    const storeRollA = rollup.stores.find((s) => s.storeId === storeA.id)
    const storeRollB = rollup.stores.find((s) => s.storeId === storeB.id)
    const unassigned = rollup.stores.find((s) => s.storeId === null)
    check("store A: 2 staff, 4/6 = 67%", storeRollA?.staffCount === 2 && storeRollA?.pct === 67, `got ${storeRollA?.staffCount} staff, ${storeRollA?.pct}%`)
    check("store B: 1 staff, 0/4 = 0%", storeRollB?.staffCount === 1 && storeRollB?.pct === 0)
    check("unassigned bucket: s5 only", unassigned?.staffCount === 1)
    const sumStaff = rollup.stores.reduce((n, s) => n + s.staffCount, 0)
    check("store rollups sum to totals", sumStaff === rollup.totals.staffCount)

    // 5. Manager scope (Store A only).
    const scoped = await getOrgComplianceRollup(org.id, { storeIds: [storeA.id] })
    check("manager scope: 2 staff (s1, s2)", scoped.totals.staffCount === 2 && scoped.staff.every((s) => [s1.id, s2.id].includes(s.staffId)))
    check("manager scope: required 6, completed 4", scoped.totals.requiredTotal === 6 && scoped.totals.completedCount === 4)
    check("manager scope: single store row", scoped.stores.length === 1 && scoped.stores[0].storeId === storeA.id)

    // 6. Agreements — outside the pct; pending limited to ACTIVE staff in scope.
    const formRoll = rollup.agreements.forms.find((f) => f.documentId === form.id)
    check("agreements: executed 1 (s1)", formRoll?.executedCount === 1, `got ${formRoll?.executedCount}`)
    check("agreements: pending count 1 (s2; terminated s4 excluded)", formRoll?.pendingCount === 1, `got ${formRoll?.pendingCount}`)
    check("agreements: pending list = s2 only", rollup.agreements.pending.length === 1 && rollup.agreements.pending[0].staffId === s2.id)
    check("agreements: form absent from any required denominator", details.every((d) => d.items.every((i) => i.kind !== "document" || i.title !== "HR8 Key Agreement")))
  } finally {
    // Leaf-first cleanup (signed records / acks / submissions have no cascade).
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.formSubmission.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.trainingAssignment.deleteMany({ where: { trainingModule: { organizationId: org.id } } })
    await prisma.trainingModule.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
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
