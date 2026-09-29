/**
 * DOC-2 acceptance fixture — the By Document pivot on /hr/compliance.
 *
 *   npx tsx scripts/verify-doc2-by-document.ts
 *
 * Creates a throwaway org (2 stores, 9 staff, 5 documents, 2 categories) and
 * asserts that the By Document section is a PIVOT of the per-person items and
 * nothing more:
 *   - per document, "X of Y signed" matches counts written from the RULINGS
 *     (DOC-1 C's rulings of 2026-08-12, R2 of 2026-08-15, HR-15 Policy B), not
 *     read back from the code under test;
 *   - THE INVARIANT: summed over documents, Y equals the number of document
 *     items across all staff in the rollup, and X equals the complete ones;
 *   - MANAGER scope: a store subset shrinks X and Y together, and the
 *     invariant holds inside the scope too;
 *   - zero-audience and archived documents are absent, and the excluded note
 *     counts the zero-audience one.
 *
 * Roster shapes reuse DOC-1 C's (in-audience signer, transferred signer,
 * non-signer, TERMINATED, corporate holding an assignment on the granted
 * store) plus DOC-2's two: a prior-version signer and a rehire.
 *
 * A throwaway org so no real dev data is touched. Everything is deleted
 * afterwards and the removal is asserted by RE-QUERY, not by a delete count.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { getOrgComplianceRollup, type OrgComplianceRollup } from "../src/lib/hr-compliance"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const FILE = {
  fileUrl: "https://example.invalid/doc2.pdf",
  fileName: "doc2.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}

const T = {
  all: "DOC-2 Doc All",
  store: "DOC-2 Doc Store (Key Agreement)",
  staff: "DOC-2 Doc Staff",
  zero: "DOC-2 Doc Zero-audience",
  archived: "DOC-2 Doc Archived",
}

// The invariant, measured off the rollup's OWN per-person items (which the KPI
// cards sum) and off the pivot, independently.
function invariant(r: OrgComplianceRollup) {
  const docItems = r.staff.flatMap((s) => s.items.filter((i) => i.kind === "document"))
  return {
    itemsY: docItems.length,
    itemsX: docItems.filter((i) => i.status === "complete").length,
    pivotY: r.byDocument.documents.reduce((n, d) => n + d.audienceCount, 0),
    pivotX: r.byDocument.documents.reduce((n, d) => n + d.signedCount, 0),
  }
}

async function main() {
  const branch = await prisma.$queryRawUnsafe<{ branch: string | null; db: string }[]>(
    `select current_setting('neon.branch_id', true) as branch, current_database()::text as db`
  )
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH ${branch[0]?.branch ?? "(null)"} / ${branch[0]?.db}\n`)

  const tag = Math.random().toString(36).slice(2, 8)
  const now = new Date()

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-doc2-${tag}`,
      name: "ZZ DOC-2 Fixture Org (safe to delete)",
      activeModules: ["hr"],
    },
  })
  console.log(`Fixture org ${org.id}\n`)

  try {
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((n) =>
        prisma.store.create({
          data: { organizationId: org.id, name: `ZZ DOC-2 Store ${n}`, timezone: "America/Los_Angeles" },
        })
      )
    )
    const [catLogs, catPolicy] = await Promise.all([
      prisma.hrDocumentCategory.create({ data: { organizationId: org.id, name: "DOC-2 Logs", colorKey: "blue", sortOrder: 0 } }),
      prisma.hrDocumentCategory.create({ data: { organizationId: org.id, name: "DOC-2 Policy", colorKey: "green", sortOrder: 1 } }),
    ])

    const mkStaff = (name: string, opts: { status?: string; isCorporate?: boolean; signingCycle?: number } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: name,
          fullName: `${name} Fixture`,
          status: opts.status ?? "ACTIVE",
          isCorporate: opts.isCorporate ?? false,
          signingCycle: opts.signingCycle ?? 1,
        },
      })

    const [s1, s2, s3, s4, s5, s6, s7, s8, s9] = await Promise.all([
      mkStaff("DOC-2-S1 Signer"), // Store A, signs docStore on the current version
      mkStaff("DOC-2-S2 Moved"), // Store A → B AFTER signing docStore
      mkStaff("DOC-2-S3 Unsigned"), // Store A, never signs docStore
      mkStaff("DOC-2-S4 Terminated", { status: "TERMINATED" }), // Store A, out of every count
      mkStaff("DOC-2-S5 Corporate", { isCorporate: true }), // assigned to BOTH stores
      mkStaff("DOC-2-S6 OtherStore"), // Store B
      mkStaff("DOC-2-S7 StaffGrant"), // Store B, individual STAFF grant
      mkStaff("DOC-2-S8 PriorVersion"), // Store A, signed docStore v1 this cycle
      mkStaff("DOC-2-S9 Rehire", { signingCycle: 2 }), // Store A, signed v2 in cycle 1
    ])

    await prisma.storeStaffAssignment.createMany({
      data: [
        { staffMemberId: s1.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s2.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s3.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s4.id, storeId: storeA.id, isPrimary: true },
        // R3's premise: a corporate member holds an assignment on the granted
        // store. Without it the corporate assertion passes vacuously.
        { staffMemberId: s5.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s5.id, storeId: storeB.id, isPrimary: false },
        { staffMemberId: s6.id, storeId: storeB.id, isPrimary: true },
        { staffMemberId: s7.id, storeId: storeB.id, isPrimary: true },
        { staffMemberId: s8.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: s9.id, storeId: storeA.id, isPrimary: true },
      ],
    })

    const mkDoc = (
      title: string,
      opts: { appliesTo: string; isActive?: boolean; categoryId: string | null; hash: string; versions?: number }
    ) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title,
          category: "Handbook",
          categoryId: opts.categoryId,
          appliesTo: opts.appliesTo,
          requiresAcknowledgment: true,
          isActive: opts.isActive ?? true,
          versions: {
            create: Array.from({ length: opts.versions ?? 1 }, (_, i) => ({
              versionNumber: i + 1,
              isCurrent: i + 1 === (opts.versions ?? 1),
              requiresReacknowledgment: false,
              fileHash: `${opts.hash}-v${i + 1}`,
              ...FILE,
            })),
          },
          checkpoints: {
            create: [0, 1].map((i) => ({ name: `${title} ck${i + 1}`, type: "Signature", orderIndex: i })),
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } }, checkpoints: { orderBy: { orderIndex: "asc" } } },
      })

    const [docAll, docStore, docStaff, docZero, docArchived] = await Promise.all([
      mkDoc(T.all, { appliesTo: "all", categoryId: catPolicy.id, hash: "doc2-all" }),
      mkDoc(T.store, { appliesTo: "selected", categoryId: catLogs.id, hash: "doc2-store", versions: 2 }),
      mkDoc(T.staff, { appliesTo: "selected", categoryId: catLogs.id, hash: "doc2-staff" }),
      mkDoc(T.zero, { appliesTo: "selected", categoryId: catLogs.id, hash: "doc2-zero" }),
      mkDoc(T.archived, { appliesTo: "all", isActive: false, categoryId: catPolicy.id, hash: "doc2-arch" }),
    ])
    await prisma.hrDocumentGrant.createMany({
      data: [
        { hrDocumentId: docStore.id, granteeType: "STORE", storeId: storeA.id },
        { hrDocumentId: docStaff.id, granteeType: "STAFF", staffMemberId: s7.id },
      ],
    })

    const [storeV1, storeV2] = docStore.versions
    const allV1 = docAll.versions[0]
    const record = (versionId: string, staffId: string, hash: string, signingCycle = 1) =>
      prisma.hrSignedRecord.create({
        data: {
          hrDocumentVersionId: versionId,
          staffMemberId: staffId,
          completedAt: now,
          signedPdfPathname: `hr/fixture/${hash}.pdf`,
          signedPdfHash: hash,
          signingCycle,
        },
      })

    await Promise.all([
      record(storeV2.id, s1.id, "doc2-sig-s1-store"), // current version, current cycle
      record(storeV2.id, s2.id, "doc2-sig-s2-store"), // then transferred
      record(storeV1.id, s8.id, "doc2-sig-s8-store-v1"), // R2: earlier version, this cycle
      record(storeV2.id, s9.id, "doc2-sig-s9-store-c1", 1), // HR-15: a previous tenure
      record(allV1.id, s1.id, "doc2-sig-s1-all"),
      record(allV1.id, s5.id, "doc2-sig-s5-all"),
      record(docStaff.versions[0].id, s7.id, "doc2-sig-s7-staff"),
    ])
    // S3 is part-way through docAll: one of two checkpoints.
    await prisma.hrDocumentAcknowledgment.create({
      data: {
        checkpointId: docAll.checkpoints[0].id,
        hrDocumentVersionId: allV1.id,
        staffMemberId: s3.id,
        checkpointName: docAll.checkpoints[0].name,
        checkpointType: "Signature",
        documentTitle: docAll.title,
        documentVersionNumber: 1,
        documentFileHash: allV1.fileHash,
        staffName: s3.displayName,
        method: "Signature",
        authMethod: "ManagerAttested",
        consentGiven: true,
      },
    })

    // THE TRANSFER: S2 leaves Store A for Store B after signing.
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMemberId: s2.id, storeId: storeA.id } })
    await prisma.storeStaffAssignment.create({ data: { staffMemberId: s2.id, storeId: storeB.id, isPrimary: true } })

    // ═══════════════════════════════════════════════════════════════════════
    // EXPECTED — written from the rulings, not read from the code.
    //   ACTIVE population: S1 S2 S3 S5 S6 S7 S8 S9 (S4 terminated) = 8.
    //   docAll   company-wide → all 8 active. Signed: S1, S5 (corporate is
    //            reached by company-wide). S3 in progress 1 of 2.   X 2 / Y 8
    //   docStore STORE grant A → non-corporate active staff CURRENTLY on A:
    //            S1, S3, S8, S9. S2 transferred out (ruling 4, record kept);
    //            S5 corporate (R3); S4 terminated. Signed: S1 (current),
    //            S8 (v1, R2 → complete "Signed v1"). S9 needs re-sign
    //            (HR-15). S3 not started.                          X 2 / Y 4
    //   docStaff STAFF grant → S7 only, signed.                    X 1 / Y 1
    //   docZero  no audience → absent; counted as Unassigned (1).
    //   docArchived isActive false → absent; not a compliance document.
    //   Totals: Y 13, X 5.
    // Manager scope [Store A]: non-corporate ACTIVE staff with an assignment
    //   on A: S1 S3 S8 S9.
    //   docAll X 1 (S1) / Y 4 · docStore X 2 / Y 4 · docStaff absent (S7 is on
    //   B) → unreached 1. Totals Y 8, X 3.
    // ═══════════════════════════════════════════════════════════════════════
    const EXPECT_ORG: Record<string, [number, number]> = { [T.all]: [2, 8], [T.store]: [2, 4], [T.staff]: [1, 1] }
    const EXPECT_MGR: Record<string, [number, number]> = { [T.all]: [1, 4], [T.store]: [2, 4] }

    console.log("── 1. Org scope (ADMIN): X of Y per document ──")
    const org1 = await getOrgComplianceRollup(org.id, { storeIds: null })
    const docsOrg = org1.byDocument.documents
    check(
      "exactly the three counted documents are listed",
      docsOrg.map((d) => d.title).sort().join("|") === Object.keys(EXPECT_ORG).sort().join("|"),
      docsOrg.map((d) => d.title).join(", ")
    )
    for (const [title, [x, y]] of Object.entries(EXPECT_ORG)) {
      const d = docsOrg.find((r) => r.title === title)
      check(`${title}: ${x} of ${y} signed`, d?.signedCount === x && d?.audienceCount === y, `got ${d?.signedCount} of ${d?.audienceCount}`)
    }
    check("zero-audience document absent", !docsOrg.some((d) => d.title === T.zero))
    check("archived document absent", !docsOrg.some((d) => d.title === T.archived))
    check("excluded note: 1 Unassigned document", org1.byDocument.unassignedExcluded === 1, `${org1.byDocument.unassignedExcluded}`)
    check("excluded note: 0 unreached documents at org scope", org1.byDocument.unreachedExcluded === 0, `${org1.byDocument.unreachedExcluded}`)

    console.log("\n── 2. The people under the Key Agreement ──")
    const store = docsOrg.find((d) => d.title === T.store)!
    const byName = new Map(store.people.map((p) => [p.name, p]))
    check(
      "audience is S1 S3 S8 S9 — transferred, corporate and terminated absent",
      [...byName.keys()].sort().join("|") === [s1, s3, s8, s9].map((s) => s.displayName).sort().join("|"),
      [...byName.keys()].join(", ")
    )
    check("S1: Signed on the current version", byName.get(s1.displayName)?.status === "complete" && !byName.get(s1.displayName)?.signedOnEarlierVersion)
    const p8 = byName.get(s8.displayName)
    check("S8: Signed v1 (R2, complete)", p8?.status === "complete" && p8.signedOnEarlierVersion && p8.signedVersionNumber === 1)
    check("S9: Needs re-sign (rehire)", byName.get(s9.displayName)?.status === "needs-resign")
    check("S3: Not started", byName.get(s3.displayName)?.status === "not-started")
    check(
      "sorted outstanding first, then by name",
      store.people.map((p) => p.name).join("|") ===
        [s3, s9].map((s) => s.displayName).sort().concat([s1, s8].map((s) => s.displayName).sort()).join("|"),
      store.people.map((p) => p.name).join(", ")
    )
    check("grouped under Store A (primary store)", store.people.every((p) => p.groupId === storeA.id && p.groupName === storeA.name))
    check("category carried: Logs id + colour", store.categoryId === catLogs.id && store.categoryColorKey === "blue" && store.categoryName === catLogs.name)
    check("current version is v2", store.currentVersionNumber === 2)
    const all = docsOrg.find((d) => d.title === T.all)!
    const p3all = all.people.find((p) => p.staffId === s3.id)
    check("docAll S3: In progress, 1 of 2 checkpoints", p3all?.status === "in-progress" && p3all.ackedCount === 1 && p3all.requiredCount === 2)
    check("docAll: corporate member grouped as Corporate", all.people.find((p) => p.staffId === s5.id)?.groupName === "Corporate")
    check("docAll: transferred member grouped under Store B", all.people.find((p) => p.staffId === s2.id)?.groupId === storeB.id)
    const survived = await prisma.hrSignedRecord.count({ where: { staffMemberId: s2.id, hrDocumentVersionId: storeV2.id } })
    check("transferred signer's record survives", survived === 1)

    console.log("\n── 3. THE INVARIANT (org scope) ──")
    const inv1 = invariant(org1)
    check("Σ Y over documents = document items across all staff", inv1.pivotY === inv1.itemsY, `${inv1.pivotY} vs ${inv1.itemsY}`)
    check("Σ X over documents = complete document items", inv1.pivotX === inv1.itemsX, `${inv1.pivotX} vs ${inv1.itemsX}`)
    check("and both equal the rulings' totals (Y 13, X 5)", inv1.pivotY === 13 && inv1.pivotX === 5)
    // The KPI cards are untouched: totals still equal the per-staff sums, and
    // the document share of them is exactly what the pivot shows.
    check(
      "KPI requiredTotal = Σ per-staff requiredTotal (unchanged contract)",
      org1.totals.requiredTotal === org1.staff.reduce((n, s) => n + s.requiredTotal, 0)
    )

    console.log("\n── 4. MANAGER scope [Store A] ──")
    const mgr = await getOrgComplianceRollup(org.id, { storeIds: [storeA.id] })
    const docsMgr = mgr.byDocument.documents
    check(
      "only docAll and docStore are listed",
      docsMgr.map((d) => d.title).sort().join("|") === Object.keys(EXPECT_MGR).sort().join("|"),
      docsMgr.map((d) => d.title).join(", ")
    )
    for (const [title, [x, y]] of Object.entries(EXPECT_MGR)) {
      const d = docsMgr.find((r) => r.title === title)
      check(`${title}: ${x} of ${y} signed`, d?.signedCount === x && d?.audienceCount === y, `got ${d?.signedCount} of ${d?.audienceCount}`)
    }
    const inv2 = invariant(mgr)
    check("invariant holds in scope (Y)", inv2.pivotY === inv2.itemsY, `${inv2.pivotY} vs ${inv2.itemsY}`)
    check("invariant holds in scope (X)", inv2.pivotX === inv2.itemsX, `${inv2.pivotX} vs ${inv2.itemsX}`)
    check("X and Y shrink together (Y 13→8, X 5→3)", inv2.pivotY === 8 && inv2.pivotX === 3, `Y ${inv2.pivotY} X ${inv2.pivotX}`)
    check(
      "no out-of-scope person appears (S2, S5, S6, S7 absent)",
      docsMgr.every((d) => d.people.every((p) => ![s2.id, s5.id, s6.id, s7.id].includes(p.staffId)))
    )
    check("excluded note: docStaff counted as unreached in this scope", mgr.byDocument.unreachedExcluded === 1 && mgr.byDocument.unassignedExcluded === 1)
  } finally {
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentGrant.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrDocumentCategory.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── 5. Fixture removal (re-queried) ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "DOC-2-" } } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "DOC-2 " } } }),
      prisma.hrDocumentCategory.count({ where: { name: { startsWith: "DOC-2 " } } }),
      prisma.store.count({ where: { name: { startsWith: "ZZ DOC-2 " } } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: { startsWith: "doc2-sig-" } } }),
      prisma.hrDocumentAcknowledgment.count({ where: { documentTitle: { startsWith: "DOC-2 " } } }),
    ])
    check("all DOC-2 fixtures removed", leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
