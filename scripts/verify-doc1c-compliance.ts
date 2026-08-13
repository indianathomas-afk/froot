/**
 * DOC-1 Phase C acceptance fixture — audience-scoped compliance counters.
 *
 *   npx tsx scripts/verify-doc1c-compliance.ts
 *
 * Creates a throwaway org (2 stores, 7 staff, 5 documents, 2 forms) and asserts
 * that compliance denominators now answer the AUDIENCE question, per Gary's
 * rulings of 2026-08-12:
 *   1. denominator = the document's CURRENT audience
 *   2. ACTIVE staff only, applied at the counting layer (the policy module has
 *      no employment-status test and must not gain one)
 *   3. STORE grants never reach corporate staff (R3); company-wide ones do
 *   4. numerator drawn from the same population as the denominator — a
 *      signature from someone who has LEFT the audience stops counting, and
 *      their record survives untouched
 *   5. counting reads; nothing is deleted or altered
 *   Q4: zero-audience documents are excluded from every denominator
 *   Q5: archived documents leave active compliance, records untouched
 *   Q2: the agreements panel stays UNFILTERED
 *
 * EVERY COUNT IS ASSERTED AGAINST AN INDEPENDENTLY-COMPUTED EXPECTED SET —
 * expectedTitles() below is written from the ruling text, not from the code
 * under test, so a bug in grantedToStaff cannot make its own test pass.
 *
 * A throwaway org (not fixtures inside the real dev org) so the six real dev
 * staff and three real dev documents are never touched. Everything is deleted
 * afterwards and the removal is asserted by re-query, not assumed from a
 * delete count.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { computeStaffComplianceDetails, getOrgComplianceRollup, getStaffComplianceDetail } from "../src/lib/hr-compliance"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}
const sorted = (xs: string[]) => [...xs].sort().join(" | ") || "(none)"

const FILE = {
  fileUrl: "https://example.invalid/doc1c.pdf",
  fileName: "doc1c.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}

const T = {
  all: "DOC-1C Doc All",
  store: "DOC-1C Doc Store",
  staff: "DOC-1C Doc Staff",
  zero: "DOC-1C Doc Zero-audience",
  archived: "DOC-1C Doc Archived",
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
      clerkOrgId: `fixture-doc1c-${tag}`,
      name: "ZZ DOC-1C Fixture Org (safe to delete)",
      activeModules: ["hr"],
    },
  })
  console.log(`Fixture org ${org.id}\n`)

  try {
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((n) =>
        prisma.store.create({
          data: { organizationId: org.id, name: `ZZ DOC-1C Store ${n}`, timezone: "America/Los_Angeles" },
        })
      )
    )

    const mkStaff = (name: string, opts: { status?: string; isCorporate?: boolean } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: name,
          fullName: `${name} Fixture`,
          status: opts.status ?? "ACTIVE",
          isCorporate: opts.isCorporate ?? false,
        },
      })

    const [inAud, moved, unsigned, term, corp, otherStore, staffGrant] = await Promise.all([
      mkStaff("DOC-1C-S1"), // Store A, in audience, signs → complete
      mkStaff("DOC-1C-S2"), // Store A → transferred to Store B AFTER signing
      mkStaff("DOC-1C-S3"), // Store A, in audience, never signs
      mkStaff("DOC-1C-S4", { status: "TERMINATED" }), // Store A, out of every denominator
      mkStaff("DOC-1C-S5", { isCorporate: true }), // corporate, assigned to BOTH stores
      mkStaff("DOC-1C-S6"), // Store B, outside the store audience
      mkStaff("DOC-1C-S7"), // Store B, individual STAFF grant
    ])

    await prisma.storeStaffAssignment.createMany({
      data: [
        { staffMemberId: inAud.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: moved.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: unsigned.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: term.id, storeId: storeA.id, isPrimary: true },
        // R3's premise: Square expands a corporate member to EVERY store. If
        // this row is missing the corporate assertion passes vacuously.
        { staffMemberId: corp.id, storeId: storeA.id, isPrimary: true },
        { staffMemberId: corp.id, storeId: storeB.id, isPrimary: false },
        { staffMemberId: otherStore.id, storeId: storeB.id, isPrimary: true },
        { staffMemberId: staffGrant.id, storeId: storeB.id, isPrimary: true },
      ],
    })

    // ── Documents ────────────────────────────────────────────────────────────
    const mkDoc = (
      title: string,
      opts: { appliesTo: string; isActive?: boolean; checkpoints: number; hash: string }
    ) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title,
          category: "Handbook",
          appliesTo: opts.appliesTo,
          requiresAcknowledgment: true,
          isActive: opts.isActive ?? true,
          versions: { create: { versionNumber: 1, fileHash: opts.hash, ...FILE } },
          checkpoints: {
            create: Array.from({ length: opts.checkpoints }, (_, i) => ({
              name: `${title} ck${i + 1}`,
              type: "Signature",
              orderIndex: i,
            })),
          },
        },
        include: { versions: true, checkpoints: { orderBy: { orderIndex: "asc" } } },
      })

    const [docAll, docStore, docStaff, docZero, docArchived] = await Promise.all([
      mkDoc(T.all, { appliesTo: "all", checkpoints: 1, hash: "doc1c-all" }),
      mkDoc(T.store, { appliesTo: "selected", checkpoints: 2, hash: "doc1c-store" }),
      mkDoc(T.staff, { appliesTo: "selected", checkpoints: 1, hash: "doc1c-staff" }),
      mkDoc(T.zero, { appliesTo: "selected", checkpoints: 1, hash: "doc1c-zero" }),
      mkDoc(T.archived, { appliesTo: "all", isActive: false, checkpoints: 1, hash: "doc1c-arch" }),
    ])

    // Grants. docZero deliberately gets none; docArchived is company-wide and
    // relies on isActive alone, so Q5 is tested independently of the audience.
    await prisma.hrDocumentGrant.createMany({
      data: [
        { hrDocumentId: docStore.id, granteeType: "STORE", storeId: storeA.id },
        { hrDocumentId: docStaff.id, granteeType: "STAFF", staffMemberId: staffGrant.id },
      ],
    })

    const ackSnap = (
      doc: { title: string },
      ck: { id: string; name: string; type: string },
      version: { id: string; versionNumber: number; fileHash: string },
      staff: { id: string; displayName: string }
    ) => ({
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

    const storeV1 = docStore.versions[0]
    const allV1 = docAll.versions[0]

    // inAud acknowledges every required checkpoint on docStore → complete.
    await prisma.hrDocumentAcknowledgment.createMany({
      data: docStore.checkpoints.map((ck) => ackSnap(docStore, ck, storeV1, inAud)),
    })
    // `moved` signs docStore the heavier way — a real HrSignedRecord AND the
    // acknowledgment rows — so "the record survives" is asserted against the
    // table that actually matters legally, not just the progress rows.
    await prisma.hrDocumentAcknowledgment.createMany({
      data: docStore.checkpoints.map((ck) => ackSnap(docStore, ck, storeV1, moved)),
    })
    await prisma.hrSignedRecord.create({
      data: {
        hrDocumentVersionId: storeV1.id,
        staffMemberId: moved.id,
        completedAt: now,
        signedPdfPathname: "hr/fixture/doc1c-moved-store.pdf",
        signedPdfHash: "doc1c-sig-moved",
      },
    })
    // Everyone signs docAll so it is a live control rather than dead weight.
    await prisma.hrDocumentAcknowledgment.createMany({
      data: [inAud, moved, unsigned, corp, otherStore, staffGrant].map((s) =>
        ackSnap(docAll, docAll.checkpoints[0], allV1, s)
      ),
    })

    // ── THE TRANSFER (scenario 1) ────────────────────────────────────────────
    // `moved` leaves Store A for Store B AFTER signing. Ruling 1: the audience
    // change moves the denominator, never the signature rows.
    await prisma.storeStaffAssignment.deleteMany({
      where: { staffMemberId: moved.id, storeId: storeA.id },
    })
    await prisma.storeStaffAssignment.create({
      data: { staffMemberId: moved.id, storeId: storeB.id, isPrimary: true },
    })

    // ── Forms ────────────────────────────────────────────────────────────────
    const mkForm = (title: string, appliesTo: string, hash: string) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "FillableForm",
          title,
          category: "PayAgreement",
          appliesTo,
          versions: {
            create: {
              versionNumber: 1,
              fileHash: hash,
              ...FILE,
              fileUrl: "",
              contentType: "application/x-froot-form-definition",
            },
          },
        },
        include: { versions: true },
      })
    // formDark is the STRANDED SHAPE Q2 turns on: appliesTo "selected" with no
    // grants, which no application code can ever give an audience. Measured as
    // empty on dev, on staging (dark_forms=0, neondb / ep-odd-rain, 2026-08-12)
    // and impossible in production — but if the panel is ever filtered, THIS is
    // the row that would vanish, so the ruling is tested rather than trusted.
    const [formLive, formDark] = await Promise.all([
      mkForm("DOC-1C Form Live", "all", "doc1c-form-live"),
      mkForm("DOC-1C Form Dark", "selected", "doc1c-form-dark"),
    ])
    await prisma.formSubmission.createMany({
      data: [
        { hrDocumentVersionId: formLive.versions[0].id, staffMemberId: inAud.id, values: {}, status: "Completed", formTitle: formLive.title, employeeSignedAt: now, supervisorSignedAt: now },
        { hrDocumentVersionId: formLive.versions[0].id, staffMemberId: unsigned.id, values: {}, status: "PendingSupervisor", formTitle: formLive.title, employeeSignedAt: now },
        { hrDocumentVersionId: formLive.versions[0].id, staffMemberId: term.id, values: {}, status: "PendingSupervisor", formTitle: formLive.title, employeeSignedAt: now },
        { hrDocumentVersionId: formDark.versions[0].id, staffMemberId: inAud.id, values: {}, status: "Completed", formTitle: formDark.title, employeeSignedAt: now, supervisorSignedAt: now },
      ],
    })

    // ═══════════════════════════════════════════════════════════════════════
    // THE INDEPENDENT EXPECTATION — written from the RULINGS, not from the
    // code under test. If this function and grantedToStaff ever agree by
    // accident it is because both are right.
    // ═══════════════════════════════════════════════════════════════════════
    const ROSTER = [
      { m: inAud, stores: [storeA.id], isCorporate: false, active: true },
      { m: moved, stores: [storeB.id], isCorporate: false, active: true }, // post-transfer
      { m: unsigned, stores: [storeA.id], isCorporate: false, active: true },
      { m: term, stores: [storeA.id], isCorporate: false, active: false },
      { m: corp, stores: [storeA.id, storeB.id], isCorporate: true, active: true },
      { m: otherStore, stores: [storeB.id], isCorporate: false, active: true },
      { m: staffGrant, stores: [storeB.id], isCorporate: false, active: true },
    ]
    function expectedTitles(r: (typeof ROSTER)[number], storeDocIsCompanyWide = false): string[] {
      const t: string[] = [T.all] // company-wide + active → everyone
      // docStore: STORE grant on Store A. Ruling 3 — corporate staff are never
      // reached by a store grant however many assignments Square gave them.
      if (storeDocIsCompanyWide) t.push(T.store)
      else if (!r.isCorporate && r.stores.includes(storeA.id)) t.push(T.store)
      // docStaff: an individual STAFF grant reaches exactly one person.
      if (r.m.id === staffGrant.id) t.push(T.staff)
      // docZero: zero-audience → nobody (Q4). docArchived: isActive false →
      // nobody (Q5). Neither ever appears.
      return t.sort()
    }

    // ═══ Assertions ═══
    console.log("\n── 1. Per-staff document sets (audience adoption) ──")
    const details = await computeStaffComplianceDetails(org.id, ROSTER.map((r) => r.m.id))
    const byId = new Map(details.map((d) => [d.staffId, d]))
    const titlesOf = (staffId: string) =>
      (byId.get(staffId)?.items ?? []).flatMap((i) => (i.kind === "document" ? [i.title] : [])).sort()

    for (const r of ROSTER) {
      const got = titlesOf(r.m.id)
      const want = expectedTitles(r)
      check(
        `${r.m.displayName}: document set matches the independently-derived audience`,
        sorted(got) === sorted(want),
        `got ${sorted(got)} · want ${sorted(want)}`
      )
    }

    console.log("\n── 2. Ruling 4: the transferred signer ──")
    check(
      "moved: docStore has LEFT their compliance items",
      !titlesOf(moved.id).includes(T.store)
    )
    const survivingRecord = await prisma.hrSignedRecord.findFirst({
      where: { hrDocumentVersionId: storeV1.id, staffMemberId: moved.id },
    })
    const survivingAcks = await prisma.hrDocumentAcknowledgment.count({
      where: { hrDocumentVersionId: storeV1.id, staffMemberId: moved.id },
    })
    check("moved: their HrSignedRecord SURVIVES the audience change", !!survivingRecord)
    check(
      "moved: their acknowledgment rows survive",
      survivingAcks === docStore.checkpoints.length,
      `${survivingAcks} of ${docStore.checkpoints.length}`
    )
    const movedDetail = byId.get(moved.id)!
    check(
      "moved: numerator and denominator fell TOGETHER (same population)",
      movedDetail.requiredTotal === expectedTitles(ROSTER[1]).length &&
        movedDetail.completedCount === movedDetail.items.filter((i) => i.status === "complete").length
    )

    console.log("\n── 3. Ruling 3: the corporate exclusion ──")
    const corpAssignments = await prisma.storeStaffAssignment.count({ where: { staffMemberId: corp.id } })
    check(
      "corp: holds a StoreStaffAssignment on the granted store (the test is not vacuous)",
      corpAssignments === 2
    )
    check("corp: the STORE-granted document does NOT reach them", !titlesOf(corp.id).includes(T.store))
    check("corp: the company-wide document DOES reach them", titlesOf(corp.id).includes(T.all))

    console.log("\n── 4. STAFF grants (the defect with no prior test) ──")
    check("staffGrant: their individually-granted document IS counted", titlesOf(staffGrant.id).includes(T.staff))
    check(
      "everyone else: the individually-granted document is NOT counted",
      ROSTER.filter((r) => r.m.id !== staffGrant.id).every((r) => !titlesOf(r.m.id).includes(T.staff))
    )

    console.log("\n── 5. Q4 zero-audience · Q5 archived ──")
    check(
      "zero-audience document appears in NOBODY's items",
      ROSTER.every((r) => !titlesOf(r.m.id).includes(T.zero))
    )
    check(
      "archived document appears in NOBODY's items",
      ROSTER.every((r) => !titlesOf(r.m.id).includes(T.archived))
    )
    const zeroStillThere = await prisma.hrDocument.findUnique({ where: { id: docZero.id } })
    const archivedStillThere = await prisma.hrDocument.findUnique({ where: { id: docArchived.id } })
    check("counting wrote nothing: the zero-audience document row is untouched", !!zeroStillThere)
    check("counting wrote nothing: the archived document row is untouched", !!archivedStillThere)

    console.log("\n── 6. Ruling 2: ACTIVE only, at the counting layer ──")
    const rollup = await getOrgComplianceRollup(org.id, { storeIds: null })
    check(
      "org rollup: the TERMINATED member is absent from the denominator population",
      !rollup.staff.some((s) => s.staffId === term.id),
      `staffCount ${rollup.totals.staffCount}`
    )
    check(
      "org rollup: staffCount equals the ACTIVE roster",
      rollup.totals.staffCount === ROSTER.filter((r) => r.active).length
    )
    const termDetail = await getStaffComplianceDetail(org.id, term.id)
    check(
      "the terminated member's OWN profile still returns auditable items (:173 ruling preserved)",
      !!termDetail && termDetail.items.length > 0,
      `${termDetail?.items.length ?? 0} items`
    )

    console.log("\n── 7. Aggregates re-derived independently ──")
    const expectedRequired = rollup.staff.reduce((n, s) => n + s.requiredTotal, 0)
    const expectedCompleted = rollup.staff.reduce((n, s) => n + s.completedCount, 0)
    check("org totals.requiredTotal is the sum of its per-staff parts", rollup.totals.requiredTotal === expectedRequired)
    check("org totals.completedCount is the sum of its per-staff parts", rollup.totals.completedCount === expectedCompleted)
    const wantOrgRequired = ROSTER.filter((r) => r.active).reduce((n, r) => n + expectedTitles(r).length, 0)
    check(
      "org requiredTotal matches the audience computed from the rulings",
      rollup.totals.requiredTotal === wantOrgRequired,
      `got ${rollup.totals.requiredTotal} · want ${wantOrgRequired}`
    )

    console.log("\n── 8. Q2: the agreements panel is UNFILTERED ──")
    const formTitles = rollup.agreements.forms.map((f) => f.title).sort()
    check(
      "both forms are listed — including the appliesTo 'selected' stranded shape",
      formTitles.includes("DOC-1C Form Live") && formTitles.includes("DOC-1C Form Dark"),
      sorted(formTitles)
    )
    const live = rollup.agreements.forms.find((f) => f.title === "DOC-1C Form Live")!
    const dark = rollup.agreements.forms.find((f) => f.title === "DOC-1C Form Dark")!
    check("form Live: executed 1, pending 1 (terminated's submission is not in scope)", live.executedCount === 1 && live.pendingCount === 1, `${live.executedCount}/${live.pendingCount}`)
    check("form Dark: executed 1", dark.executedCount === 1)
    check(
      "pending countersign list names the ACTIVE staff member only",
      rollup.agreements.pending.length === 1 && rollup.agreements.pending[0].staffId === unsigned.id
    )
    const agreementsBefore = JSON.stringify(rollup.agreements)

    console.log("\n── 9. Flip docStore to company-wide ──")
    await prisma.hrDocument.update({ where: { id: docStore.id }, data: { appliesTo: "all" } })
    const after = await computeStaffComplianceDetails(org.id, ROSTER.map((r) => r.m.id))
    const afterById = new Map(after.map((d) => [d.staffId, d]))
    const afterTitles = (staffId: string) =>
      (afterById.get(staffId)?.items ?? []).flatMap((i) => (i.kind === "document" ? [i.title] : [])).sort()
    for (const r of ROSTER) {
      const got = afterTitles(r.m.id)
      const want = expectedTitles(r, true)
      check(
        `${r.m.displayName}: company-wide flip reaches them per the rulings`,
        sorted(got) === sorted(want),
        `got ${sorted(got)} · want ${sorted(want)}`
      )
    }
    check("flip: corporate staff ARE reached by a company-wide document", afterTitles(corp.id).includes(T.store))
    const movedAfter = afterById.get(moved.id)!
    const movedStoreItem = movedAfter.items.find((i) => i.kind === "document" && i.title === T.store)
    check(
      "flip: the transferred signer's EXISTING signature counts again",
      !!movedStoreItem && movedStoreItem.status === "complete"
    )
    const rollupAfter = await getOrgComplianceRollup(org.id, { storeIds: null })
    check(
      "flip: the agreements panel is untouched by any document-audience change",
      JSON.stringify(rollupAfter.agreements) === agreementsBefore
    )

    console.log("\n── 10. The pre-Phase-C rule, run side by side ──")
    // The rule this phase replaced, reimplemented verbatim, to demonstrate the
    // three defects were real rather than theoretical.
    await prisma.hrDocument.update({ where: { id: docStore.id }, data: { appliesTo: "selected" } })
    const rawDocs = await prisma.hrDocument.findMany({
      where: { organizationId: org.id, kind: "Acknowledgment", isActive: true, requiresAcknowledgment: true },
      include: { grants: { select: { granteeType: true, storeId: true, staffMemberId: true } } },
    })
    const oldRule = (r: (typeof ROSTER)[number]) =>
      rawDocs
        .filter(
          (d) =>
            d.appliesTo === "all" ||
            d.grants.some((g) => g.granteeType === "STORE" && g.storeId !== null && r.stores.includes(g.storeId))
        )
        .map((d) => d.title)
        .sort()
    check(
      "OLD rule swept corporate staff into the store grant (defect ii was real)",
      oldRule(ROSTER[4]).includes(T.store) && !expectedTitles(ROSTER[4]).includes(T.store),
      `old ${sorted(oldRule(ROSTER[4]))}`
    )
    check(
      "OLD rule missed the STAFF grant entirely (defect i was real)",
      !oldRule(ROSTER[6]).includes(T.staff) && expectedTitles(ROSTER[6]).includes(T.staff),
      `old ${sorted(oldRule(ROSTER[6]))}`
    )
  } finally {
    // Leaf-first cleanup — signed records, acknowledgments and submissions carry
    // no cascade and block deletion by design (records do not cascade).
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.formSubmission.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentGrant.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    // REMOVAL ASSERTED, not assumed from a delete count.
    console.log("\n── 11. Fixture removal ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.staffMember.count({ where: { organizationId: org.id } }),
      prisma.hrDocument.count({ where: { organizationId: org.id } }),
      prisma.store.count({ where: { organizationId: org.id } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: "doc1c-sig-moved" } }),
      prisma.hrDocumentAcknowledgment.count({ where: { documentTitle: { startsWith: "DOC-1C " } } }),
    ])
    check(`all DOC-1C fixtures removed`, leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
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
