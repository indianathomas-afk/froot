/**
 * DOC-8 acceptance fixture — document due dates ("sign within N days").
 *
 *   npx tsx scripts/verify-doc8-due-dates.ts
 *
 * Rulings: Gary 2026-10-26, F1–F9 (docs/DECISIONS.md; forks in
 * docs/prompts/DOC-8_AUDIT.md § 9(a)). Every EXPECTED value below is written
 * from those rulings, not read back from the code under test.
 *
 * Creates a throwaway org (2 stores in America/Los_Angeles, 16 staff, 6
 * documents), every principal named "DOC-8-…" (CLAUDE.md § Name every test
 * principal). Dates are placed relative to today IN THE STORE'S ZONE, at local
 * noon, so a run at any hour lands every anchor on the intended calendar day.
 * Everything is deleted afterwards and removal is asserted by RE-QUERY.
 *
 * What is NOT here, said rather than implied: the admin ROUTES (category-default
 * inheritance at create, N refused on non-Acknowledgment kinds, the set stamp on
 * PATCH) need a Clerk session this script cannot hold. They are on Gary's
 * staging test plan. The pure clock is exercised directly in section 1.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import {
  documentDueState,
  getOrgComplianceRollup,
  summarizeOwed,
  type ComplianceDocItem,
  type OrgComplianceRollup,
} from "../src/lib/hr-compliance"
import { documentDueLabel } from "../src/lib/hr-due-wording"
import { addDays } from "../src/lib/milestones"
import { localDateStr } from "../src/lib/reports"
import { zonedInstant } from "../src/lib/checklist-lifecycle"

let failures = 0
let checks = 0
function check(label: string, ok: boolean, detail = "") {
  checks += 1
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const TZ = "America/Los_Angeles"
const FILE = {
  fileUrl: "https://example.invalid/doc8.pdf",
  fileName: "doc8.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}

async function main() {
  const branch = await prisma.$queryRawUnsafe<{ branch: string | null; db: string }[]>(
    `select current_setting('neon.branch_id', true) as branch, current_database()::text as db`
  )
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH ${branch[0]?.branch ?? "(null)"} / ${branch[0]?.db}\n`)

  // ── 1. The pure clock — today pinned, no database ─────────────────────────
  console.log("── 1. documentDueState (pure, today pinned) ──")
  const member = { startDate: new Date("2026-01-05T00:00:00.000Z"), createdAt: new Date("2026-01-05T18:00:00Z"), rehiredAt: null, signingCycle: 1 }
  const base = {
    signWithinDays: 7,
    timeZone: TZ,
    member,
    appliesAt: new Date("2026-02-01T18:00:00Z"),
    caseAVersionCreatedAt: null,
  }
  // Set at 2026-10-27 05:00 UTC = Oct 26 22:00 PDT: the MEMBER-LOCAL day is the
  // 26th. A UTC reading would start the clock on the 27th.
  const lateEvening = new Date("2026-10-27T05:00:00.000Z")
  const onDue = documentDueState({ ...base, signWithinDaysSetAt: lateEvening, today: "2026-11-02" })
  check("set 22:00 PDT counts from the LOCAL day: due = Oct 26 + 7 = Nov 2", onDue?.dueDate === "2026-11-02", onDue?.dueDate)
  check("on the due day itself: daysUntilDue 0, NOT overdue (the whole day is theirs)", onDue?.daysUntilDue === 0 && onDue.overdue === false)
  const dayAfter = documentDueState({ ...base, signWithinDaysSetAt: lateEvening, today: "2026-11-03" })
  check("the next local day: overdue, daysUntilDue -1", dayAfter?.overdue === true && dayAfter.daysUntilDue === -1)
  check("N null → null (pre-DOC-8)", documentDueState({ ...base, signWithinDays: null, signWithinDaysSetAt: lateEvening, today: "2026-11-02" }) === null)
  check("N without a set stamp → null (never a guessed clock)", documentDueState({ ...base, signWithinDaysSetAt: null, today: "2026-11-02" }) === null)
  check(
    "rehire on cycle 2 anchors to rehiredAt (ruling 6)",
    documentDueState({
      ...base,
      signWithinDaysSetAt: new Date("2026-03-01T18:00:00Z"),
      member: { ...member, signingCycle: 2, rehiredAt: new Date("2026-10-20T18:00:00Z") },
      today: "2026-10-21",
    })?.dueDate === "2026-10-27"
  )
  check(
    "rehiredAt on cycle 1 is IGNORED (only a bumped cycle is a rehire)",
    documentDueState({
      ...base,
      signWithinDaysSetAt: new Date("2026-03-01T18:00:00Z"),
      member: { ...member, signingCycle: 1, rehiredAt: new Date("2026-10-20T18:00:00Z") },
      today: "2026-10-21",
    })?.dueDate === "2026-03-08"
  )
  check(
    "wording: 5 → \"Due in 5 days\", 1 → \"Due tomorrow\", 0 → \"Due today\", -1 → \"Was due Nov 2\", null → null",
    documentDueLabel({ dueDate: "2026-11-02", daysUntilDue: 5 }) === "Due in 5 days" &&
      documentDueLabel({ dueDate: "2026-11-02", daysUntilDue: 1 }) === "Due tomorrow" &&
      documentDueLabel({ dueDate: "2026-11-02", daysUntilDue: 0 }) === "Due today" &&
      documentDueLabel({ dueDate: "2026-11-02", daysUntilDue: -1 }) === "Was due Nov 2" &&
      documentDueLabel({ dueDate: null, daysUntilDue: null }) === null
  )

  // ── 2+. The engine against real rows ──────────────────────────────────────
  const tag = Math.random().toString(36).slice(2, 8)
  const now = new Date()
  const today = localDateStr(now, TZ)
  // Local noon n days ago, as an instant; and the civil date n days ago.
  const at = (n: number) => zonedInstant(addDays(today, -n), "12:00", TZ)!
  const civil = (n: number) => new Date(`${addDays(today, -n)}T00:00:00.000Z`)

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-doc8-${tag}`,
      name: "ZZ DOC-8 Fixture Org (safe to delete)",
      activeModules: ["hr"],
      timezone: TZ,
    },
  })
  console.log(`\nFixture org ${org.id} · today ${today} (${TZ})\n`)

  try {
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((n) =>
        prisma.store.create({ data: { organizationId: org.id, name: `ZZ DOC-8 Store ${n}`, timezone: TZ } })
      )
    )

    const mkStaff = (
      name: string,
      store: { id: string },
      opts: { startDaysAgo?: number; signingCycle?: number; rehiredDaysAgo?: number; isCorporate?: boolean } = {}
    ) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: `DOC-8-${name}`,
          fullName: `DOC-8-${name} Fixture`,
          startDate: civil(opts.startDaysAgo ?? 200),
          signingCycle: opts.signingCycle ?? 1,
          rehiredAt: opts.rehiredDaysAgo !== undefined ? at(opts.rehiredDaysAgo) : null,
          isCorporate: opts.isCorporate ?? false,
          createdAt: at(300),
          storeAssignments: { create: { storeId: store.id, isPrimary: true } },
        },
      })

    const P = {
      nullN: await mkStaff("P1 NullN", storeA),
      window: await mkStaff("P2 DueIn7", storeA),
      late: await mkStaff("P3 Overdue", storeA),
      newHire: await mkStaff("P4 NewHire", storeA, { startDaysAgo: 2 }),
      lateGrant: await mkStaff("P5 LateGrant", storeA),
      signed: await mkStaff("P6 Signed", storeA),
      recordMissing: await mkStaff("P7 RecordMissing", storeA),
      rehireRecent: await mkStaff("P8 RehireRecent", storeA, { signingCycle: 2, rehiredDaysAgo: 1 }),
      rehireLate: await mkStaff("P9 RehireLate", storeA, { signingCycle: 2, rehiredDaysAgo: 10 }),
      caseASigner: await mkStaff("P10 CaseASigner", storeA),
      caseANever: await mkStaff("P11 CaseANever", storeA),
      launch: await mkStaff("P12 Launch", storeA),
      storeGrant: await mkStaff("P13 StoreGrant", storeB),
      storeNewHire: await mkStaff("P14 StoreNewHire", storeB, { startDaysAgo: 1 }),
      storePlusStaff: await mkStaff("P15 StorePlusStaffGrant", storeB),
      corporate: await mkStaff("P16 Corporate", storeB, { isCorporate: true }),
    }

    const mkDoc = (
      title: string,
      opts: { n: number | null; setDaysAgo: number | null; caseA?: { v2DaysAgo: number } }
    ) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title: `DOC-8 ${title}`,
          category: "Other",
          appliesTo: "selected",
          requiresAcknowledgment: true,
          isActive: true,
          signWithinDays: opts.n,
          signWithinDaysSetAt: opts.setDaysAgo === null ? null : opts.setDaysAgo === 0 ? now : at(opts.setDaysAgo),
          createdAt: at(100),
          versions: {
            create: opts.caseA
              ? [
                  { versionNumber: 1, isCurrent: false, fileHash: `doc8-${title}-v1`, createdAt: at(100), ...FILE },
                  {
                    versionNumber: 2,
                    isCurrent: true,
                    requiresReacknowledgment: true,
                    fileHash: `doc8-${title}-v2`,
                    createdAt: at(opts.caseA.v2DaysAgo),
                    ...FILE,
                  },
                ]
              : [{ versionNumber: 1, isCurrent: true, fileHash: `doc8-${title}-v1`, createdAt: at(100), ...FILE }],
          },
          checkpoints: {
            create: [0, 1].map((i) => ({ name: `DOC-8 ${title} ck${i + 1}`, type: "Signature", orderIndex: i })),
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } }, checkpoints: { orderBy: { orderIndex: "asc" } } },
      })

    const D = {
      nullN: await mkDoc("NullN", { n: null, setDaysAgo: null }),
      window: await mkDoc("Window", { n: 10, setDaysAgo: 3 }),
      late: await mkDoc("Late", { n: 5, setDaysAgo: 20 }),
      caseA: await mkDoc("CaseA", { n: 5, setDaysAgo: 30, caseA: { v2DaysAgo: 1 } }),
      launch: await mkDoc("Launch", { n: 5, setDaysAgo: 0 }),
      store: await mkDoc("Store", { n: 5, setDaysAgo: 30 }),
    }

    const staffGrant = (docId: string, staffId: string, daysAgo = 100) => ({
      hrDocumentId: docId,
      granteeType: "STAFF",
      staffMemberId: staffId,
      createdAt: at(daysAgo),
    })
    await prisma.hrDocumentGrant.createMany({
      data: [
        staffGrant(D.nullN.id, P.nullN.id),
        staffGrant(D.window.id, P.window.id),
        ...[P.late, P.newHire, P.signed, P.recordMissing, P.rehireRecent, P.rehireLate].map((p) => staffGrant(D.late.id, p.id)),
        staffGrant(D.late.id, P.lateGrant.id, 2), // F1: the grant is the latest anchor
        staffGrant(D.caseA.id, P.caseASigner.id),
        staffGrant(D.caseA.id, P.caseANever.id),
        staffGrant(D.launch.id, P.launch.id),
        // F1 store path: the store's grant date, never the person's join date.
        { hrDocumentId: D.store.id, granteeType: "STORE", storeId: storeB.id, createdAt: at(20) },
        // P15 is ALSO individually granted, earlier: the EARLIEST reaching grant wins.
        staffGrant(D.store.id, P.storePlusStaff.id, 40),
      ],
    })

    const lateV = D.late.versions[0]
    const record = (versionId: string, staffId: string, hash: string, signingCycle = 1) =>
      prisma.hrSignedRecord.create({
        data: {
          hrDocumentVersionId: versionId,
          staffMemberId: staffId,
          completedAt: at(50),
          signedPdfPathname: `hr/fixture/${hash}.pdf`,
          signedPdfHash: hash,
          signingCycle,
        },
      })
    await Promise.all([
      record(lateV.id, P.signed.id, "doc8-sig-p6"),
      record(lateV.id, P.rehireRecent.id, "doc8-sig-p8-c1", 1), // previous tenure
      record(lateV.id, P.rehireLate.id, "doc8-sig-p9-c1", 1), // previous tenure
      record(D.caseA.versions[0].id, P.caseASigner.id, "doc8-sig-p10-v1"), // v1, this cycle
    ])
    // P7: every required checkpoint acknowledged, no record minted (R1).
    for (const ck of D.late.checkpoints) {
      await prisma.hrDocumentAcknowledgment.create({
        data: {
          checkpointId: ck.id,
          hrDocumentVersionId: lateV.id,
          staffMemberId: P.recordMissing.id,
          checkpointName: ck.name,
          checkpointType: "Signature",
          documentTitle: D.late.title,
          documentVersionNumber: 1,
          documentFileHash: lateV.fileHash,
          staffName: P.recordMissing.displayName,
          method: "Signature",
          authMethod: "ManagerAttested",
          consentGiven: true,
        },
      })
    }

    const rollup = await getOrgComplianceRollup(org.id, { storeIds: null })
    const item = (staffId: string, docId: string): ComplianceDocItem | undefined =>
      rollup.staff
        .find((s) => s.staffId === staffId)
        ?.items.find((i): i is ComplianceDocItem => i.kind === "document" && i.documentId === docId)

    // ═══════════════════════════════════════════════════════════════════════
    // EXPECTED — from the rulings. Hire anchor is 200 days ago unless noted.
    //   P1  no N                         → no due date, not-started
    //   P2  N10, set 3 ago               → start 3 ago, due in 7, not-started (ruling 5: still owed)
    //   P3  N5, set 20 ago, grant 100    → start 20 ago, due 15 ago: OVERDUE
    //   P4  hired 2 ago                  → start 2 ago, due in 3
    //   P5  STAFF grant 2 ago (F1)       → start 2 ago, due in 3
    //   P6  signed                       → complete, no due date
    //   P7  all acked, no record (R1)    → in-progress, recordMissing, NO due date, never overdue (F4)
    //   P8  rehired 1 ago, cycle-1 record→ needs-resign, due in 4 (ruling 6)
    //   P9  rehired 10 ago, cycle-1 rec  → due 5 ago: OVERDUE, not needs-resign (F4)
    //   P10 Case A, signed v1 this cycle → clock from v2 upload 1 ago: due in 4, needs-resign (F3)
    //   P11 Case A, never signed         → clock from set 30 ago: due 25 ago, OVERDUE (F3: no reset)
    //   P12 N set just now (ruling 3)    → due in 5 — nobody overdue overnight
    //   P13 STORE grant 20 ago (F1)      → start 20 ago (set 30 is earlier): due 15 ago, OVERDUE
    //   P14 store, hired 1 ago           → due in 4
    //   P15 store 20 + STAFF grant 40    → earliest reaching = 40; latest of (200,40,30) = 30 ago: due 25 ago
    //   P16 corporate on store B         → D.store not an item at all (R3, unchanged)
    // ═══════════════════════════════════════════════════════════════════════
    console.log("\n── 2. Null N = today's behaviour ──")
    const p1 = item(P.nullN.id, D.nullN.id)
    check("P1 no N: status not-started", p1?.status === "not-started", p1?.status)
    check("P1 no N: dueDate and daysUntilDue null", p1?.dueDate === null && p1?.daysUntilDue === null)
    check("P1 no N: banner nearestDueDate null (the 2026-09-07 ruling, still in force without N)", summarizeOwed(rollup.staff.find((s) => s.staffId === P.nullN.id)!).nearestDueDate === null)
    check("P1 no N: wording null — surfaces render exactly what they did", documentDueLabel(p1!) === null)

    console.log("\n── 3. Inside the window (ruling 5) ──")
    const p2 = item(P.window.id, D.window.id)
    check("P2: due in 7, not-started", p2?.daysUntilDue === 7 && p2.status === "not-started", `${p2?.daysUntilDue} ${p2?.status}`)
    check("P2: dueDate = today + 7", p2?.dueDate === addDays(today, 7), p2?.dueDate ?? "")
    const s2 = rollup.staff.find((s) => s.staffId === P.window.id)!
    check("P2: still counted — requiredTotal 1, completed 0, pct 0", s2.requiredTotal === 1 && s2.completedCount === 0 && s2.pct === 0)
    check("P2: not in overdueCount", s2.overdueCount === 0)
    const owed2 = summarizeOwed(s2)
    check(
      "P2: banner nearestDueDate = local noon of the due day",
      owed2.nearestDueDate === zonedInstant(addDays(today, 7), "12:00", TZ)!.toISOString(),
      owed2.nearestDueDate ?? "null"
    )

    console.log("\n── 4. Overdue (F4) ──")
    const p3 = item(P.late.id, D.late.id)
    check("P3: overdue, due 15 days ago", p3?.status === "overdue" && p3.daysUntilDue === -15, `${p3?.status} ${p3?.daysUntilDue}`)
    const s3 = rollup.staff.find((s) => s.staffId === P.late.id)!
    check("P3: overdueCount 1", s3.overdueCount === 1)
    check("P3: banner overdueCount 1", summarizeOwed(s3).overdueCount === 1)

    console.log("\n── 5. Clock anchors ──")
    check("P4 new hire (2 days ago): due in 3", item(P.newHire.id, D.late.id)?.daysUntilDue === 3, String(item(P.newHire.id, D.late.id)?.daysUntilDue))
    check("P5 STAFF grant 2 days ago: due in 3 (F1)", item(P.lateGrant.id, D.late.id)?.daysUntilDue === 3, String(item(P.lateGrant.id, D.late.id)?.daysUntilDue))
    check("P12 N set just now: due in 5, not overdue (ruling 3)", item(P.launch.id, D.launch.id)?.daysUntilDue === 5 && item(P.launch.id, D.launch.id)?.status === "not-started")

    console.log("\n── 6. Complete and record-missing ──")
    const p6 = item(P.signed.id, D.late.id)
    check("P6 signed: complete, no due date", p6?.status === "complete" && p6.dueDate === null)
    const p7 = item(P.recordMissing.id, D.late.id)
    check(
      "P7 record missing: in-progress + recordMissing, no due date, NOT overdue (F4)",
      p7?.status === "in-progress" && p7.recordMissing && p7.dueDate === null,
      `${p7?.status} rm=${p7?.recordMissing} due=${p7?.dueDate}`
    )

    console.log("\n── 7. Rehire (ruling 6) ──")
    const p8 = item(P.rehireRecent.id, D.late.id)
    check("P8 rehired 1 day ago: needs-resign, due in 4", p8?.status === "needs-resign" && p8.daysUntilDue === 4, `${p8?.status} ${p8?.daysUntilDue}`)
    const p9 = item(P.rehireLate.id, D.late.id)
    check("P9 rehired 10 days ago: OVERDUE (not needs-resign), due 5 ago", p9?.status === "overdue" && p9.daysUntilDue === -5, `${p9?.status} ${p9?.daysUntilDue}`)

    console.log("\n── 8. Case A (F3) ──")
    const p10 = item(P.caseASigner.id, D.caseA.id)
    check("P10 signed v1: needs-resign, clock from v2's upload → due in 4", p10?.status === "needs-resign" && p10.daysUntilDue === 4, `${p10?.status} ${p10?.daysUntilDue}`)
    const p11 = item(P.caseANever.id, D.caseA.id)
    check("P11 never signed: NO reset → overdue, due 25 ago", p11?.status === "overdue" && p11.daysUntilDue === -25, `${p11?.status} ${p11?.daysUntilDue}`)

    console.log("\n── 9. STORE audience (F1) ──")
    check("P13 store grant 20 ago: overdue, due 15 ago", item(P.storeGrant.id, D.store.id)?.daysUntilDue === -15, String(item(P.storeGrant.id, D.store.id)?.daysUntilDue))
    check("P14 store, hired 1 ago: due in 4", item(P.storeNewHire.id, D.store.id)?.daysUntilDue === 4, String(item(P.storeNewHire.id, D.store.id)?.daysUntilDue))
    check("P15 earliest reaching grant (STAFF 40 > STORE 20) → set 30 is latest: due 25 ago", item(P.storePlusStaff.id, D.store.id)?.daysUntilDue === -25, String(item(P.storePlusStaff.id, D.store.id)?.daysUntilDue))
    check("P16 corporate: the STORE-granted doc is not an item (R3 untouched)", item(P.corporate.id, D.store.id) === undefined)

    console.log("\n── 10. Totals and the DOC-2 invariant ──")
    const inv = invariant(rollup)
    check("Σ audienceCount = document items across staff", inv.pivotY === inv.itemsY, `${inv.pivotY} vs ${inv.itemsY}`)
    check("Σ signedCount = complete document items", inv.pivotX === inv.itemsX, `${inv.pivotX} vs ${inv.itemsX}`)
    // Overdue: P3, P9, P11, P13, P15 = 5. Needs-resign: P8, P10 = 2.
    check("KPI overdueCount = 5 (P3 P9 P11 P13 P15)", rollup.totals.overdueCount === 5, String(rollup.totals.overdueCount))
    check("KPI needsResignCount = 2 (P8 P10 — P9 moved to overdue)", rollup.totals.needsResignCount === 2, String(rollup.totals.needsResignCount))
    // Ruling 5: due dates move NO denominator. 15 items (P1..P15 one each), 1 complete.
    check("requiredTotal 15, completed 1 — not-yet-due still owed", rollup.totals.requiredTotal === 15 && rollup.totals.completedCount === 1, `${rollup.totals.requiredTotal}/${rollup.totals.completedCount}`)
    const lateRow = rollup.byDocument.documents.find((d) => d.documentId === D.late.id)
    const p3Person = lateRow?.people.find((p) => p.staffId === P.late.id)
    check("By Document carries status + due through unchanged", p3Person?.status === "overdue" && p3Person.daysUntilDue === -15)
  } finally {
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentGrant.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── 11. Fixture removal (re-queried) ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "DOC-8-" } } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "DOC-8 " } } }),
      prisma.store.count({ where: { name: { startsWith: "ZZ DOC-8 " } } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: { startsWith: "doc8-sig-" } } }),
      prisma.hrDocumentAcknowledgment.count({ where: { documentTitle: { startsWith: "DOC-8 " } } }),
    ])
    check("all DOC-8 fixtures removed", leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
  }

  console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} of ${checks} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

function invariant(r: OrgComplianceRollup) {
  const docItems = r.staff.flatMap((s) => s.items.filter((i) => i.kind === "document"))
  return {
    itemsY: docItems.length,
    itemsX: docItems.filter((i) => i.status === "complete").length,
    pivotY: r.byDocument.documents.reduce((n, d) => n + d.audienceCount, 0),
    pivotX: r.byDocument.documents.reduce((n, d) => n + d.signedCount, 0),
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
