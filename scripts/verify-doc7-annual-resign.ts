/**
 * DOC-7 acceptance fixture — annual re-sign ("re-sign every N months").
 *
 *   npx tsx scripts/verify-doc7-annual-resign.ts
 *
 * Rulings: Gary 2026-10-28, F1–F10 and the ordering FIX NOW (docs/DECISIONS.md;
 * forks in docs/prompts/DOC-7_AUDIT.md § 11(a)). Every EXPECTED value is written
 * from those rulings. Section 1 pins the month arithmetic against the audit's
 * table first, so later sections may derive anniversaries with it.
 *
 * ORDERING (Gary: "every lookup in ensureSignedRecord, the compliance engine and
 * /staff/[id] must always pick the newest renewal, with a fixture check that
 * proves it"). Records are INSERTED NEWEST FIRST, so a last-write-wins map over
 * an unordered read, or a `[0]` over an ascending one, picks the OLD record and
 * fails. Section 4 asks all three by name.
 *
 * Throwaway org, every principal named "DOC-7-…" (CLAUDE.md § Name every test
 * principal). Dates are local noon in the store's zone, relative to today.
 * Everything is deleted afterwards and removal is asserted by RE-QUERY.
 *
 * NOT HERE, said rather than implied: the PATCH route's HTTP behaviour (400 on a
 * non-Acknowledgment, the zod 6/12/24 refusal) needs a Clerk session — the
 * stamp rule it writes is reSignStampData, asserted in section 1; the HTTP half
 * is on Gary's staging plan. ensureSignedRecord is exercised on its lookup and
 * refusal paths only: a successful mint uploads to Blob, which a fixture must
 * not do.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { getOrgComplianceRollup, type ComplianceDocItem, type OrgComplianceRollup } from "../src/lib/hr-compliance"
import { documentCompletion } from "../src/lib/hr-completion"
import { loadRenewalView, newestRenewal, reSignAnniversary, renewalView } from "../src/lib/hr-resign"
import { reSignStampData } from "../src/lib/hr-resign-choices"
import { documentDueLabel, reSignNoticeLabel } from "../src/lib/hr-due-wording"
import { ensureSignedRecord, SignedRecordError } from "../src/lib/hr-signed-pdf"
import { loadReturnItems } from "../src/lib/hr-returns"
import { docDigestView } from "../src/lib/hr-doc-digest"
import { requiredDocumentRows } from "../src/app/(my)/my/documents/data"
import { staffDocumentRows } from "../src/app/(app)/staff/[id]/document-rows"
import { addDays, addMonthsClamped, daysBetween } from "../src/lib/milestones"
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
  fileUrl: "https://example.invalid/doc7.pdf",
  fileName: "doc7.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}

async function main() {
  const branch = await prisma.$queryRawUnsafe<{ branch: string | null; db: string }[]>(
    `select current_setting('neon.branch_id', true)::text as branch, current_database()::text as db`
  )
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH ${branch[0]?.branch ?? "(null)"} / ${branch[0]?.db}\n`)

  // ── 1. Pure rules — today pinned, no database ─────────────────────────────
  console.log("── 1. Pure rules (today pinned) ──")
  const table: [string, number, string][] = [
    ["2026-01-31", 6, "2026-07-31"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2027-08-31", 6, "2028-02-29"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2028-02-29", 24, "2030-02-28"],
    ["2026-01-31", 12, "2027-01-31"],
    ["2026-01-31", 1, "2026-02-28"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-12-15", 1, "2027-01-15"],
  ]
  for (const [d, n, want] of table) {
    const got = addMonthsClamped(d, n)
    check(`addMonthsClamped(${d}, ${n}) = ${want}`, got === want, got)
  }
  // Member-local day, not the UTC day: 07:30 UTC on Jan 31 is still Jan 30 in LA.
  check(
    "anniversary counts from the MEMBER-LOCAL signing day",
    reSignAnniversary({ completedAt: new Date("2026-01-31T07:30:00Z"), everyMonths: 12, setAt: null, timeZone: TZ }) ===
      "2027-01-30"
  )
  check(
    "ruling 6 floor: set date + 30 wins over an old signature + N",
    reSignAnniversary({
      completedAt: new Date("2024-01-10T20:00:00Z"),
      everyMonths: 12,
      setAt: new Date("2026-10-01T20:00:00Z"),
      timeZone: TZ,
    }) === "2026-10-31"
  )

  const T = "2026-10-28"
  const rec = (renewal: number, day: string) => ({ renewal, completedAt: zonedInstant(day, "12:00", TZ)! })
  const view = (records: { renewal: number; completedAt: Date }[], everyMonths: number | null, today = T, setAt: Date | null = new Date("2020-01-01T00:00:00Z")) =>
    renewalView({ records, everyMonths, setAt, timeZone: TZ, today })
  const vNo = view([rec(0, "2020-01-01")], null)
  check("no setting: never expires, no window, counted = owed = 0", !vNo.expired && !vNo.inWindow && vNo.countedRenewal === 0 && vNo.owedRenewal === 0 && vNo.anniversary === null)
  const v20 = view([rec(0, addMonthsClamped(addDays(T, 20), -12))], 12)
  check("20 days out: in window, still counts renewal 0, owes renewal 1 (ruling 4)", v20.inWindow && !v20.expired && v20.countedRenewal === 0 && v20.owedRenewal === 1 && v20.daysToAnniversary === 20, JSON.stringify(v20))
  const v0 = view([rec(0, addMonthsClamped(T, -12))], 12)
  check("F10: ON the anniversary day — still valid, in window, 0 days", !v0.expired && v0.inWindow && v0.daysToAnniversary === 0)
  const vPast = view([rec(0, addMonthsClamped(addDays(T, -1), -12))], 12)
  check("F10: the day after — expired; counted = owed = 1", vPast.expired && vPast.countedRenewal === 1 && vPast.owedRenewal === 1)
  const v31 = view([rec(0, addMonthsClamped(addDays(T, 31), -12))], 12)
  check("F9: 31 days out — outside the window, owes renewal 0 (no early re-sign)", !v31.inWindow && !v31.expired && v31.owedRenewal === 0)
  const vNoStamp = view([rec(0, "2020-01-01")], 12, T, null)
  check("a setting without its set stamp never expires (not written by Froot)", !vNoStamp.expired && vNoStamp.anniversary === null)
  // Ordering, pure: the newest renewal whatever the array order; ties → later completedAt.
  const r0 = rec(0, "2025-01-01")
  const r1 = rec(1, "2025-12-20")
  check("newestRenewal: [r0, r1] → r1", newestRenewal([r0, r1]) === r1)
  check("newestRenewal: [r1, r0] → r1", newestRenewal([r1, r0]) === r1)
  const tieA = rec(0, "2025-01-01")
  const tieB = rec(0, "2025-06-01")
  check("newestRenewal tie on renewal → the later completedAt", newestRenewal([tieB, tieA]) === tieB && newestRenewal([tieA, tieB]) === tieB)
  // Ruling 6, the 30-day promise: setting turned on today over a 3-year-old signature.
  const setToday = zonedInstant(T, "09:00", TZ)!
  const vFloor = view([rec(0, "2023-06-01")], 12, T, setToday)
  check("ruling 6: an old signature on launch day → notice in 30 days, not overdue", vFloor.inWindow && vFloor.daysToAnniversary === 30 && !vFloor.expired)
  const vFloor31 = view([rec(0, "2023-06-01")], 12, addDays(T, 31), setToday)
  check("ruling 6: 31 days after launch → overdue", vFloor31.expired)

  check("notice wording 20", reSignNoticeLabel({ reSignDueDate: "x", reSignDaysUntilDue: 20 }) === "Re-sign due in 20 days")
  check("notice wording 1", reSignNoticeLabel({ reSignDueDate: "x", reSignDaysUntilDue: 1 }) === "Re-sign due tomorrow")
  check("notice wording 0", reSignNoticeLabel({ reSignDueDate: "x", reSignDaysUntilDue: 0 }) === "Re-sign due today")
  check("notice wording null", reSignNoticeLabel({ reSignDueDate: null, reSignDaysUntilDue: null }) === null)

  const stampNow = new Date("2026-10-28T18:00:00Z")
  const old = new Date("2026-01-01T18:00:00Z")
  check("F6 null → 12 stamps now", JSON.stringify(reSignStampData({ reSignEveryMonths: null, reSignEveryMonthsSetAt: null }, 12, stampNow)) === JSON.stringify({ reSignEveryMonths: 12, reSignEveryMonthsSetAt: stampNow }))
  check("F6 12 → 24 keeps the stamp", reSignStampData({ reSignEveryMonths: 12, reSignEveryMonthsSetAt: old }, 24, stampNow).reSignEveryMonthsSetAt === old)
  check("F6 12 → null clears both", JSON.stringify(reSignStampData({ reSignEveryMonths: 12, reSignEveryMonthsSetAt: old }, null, stampNow)) === JSON.stringify({ reSignEveryMonths: null, reSignEveryMonthsSetAt: null }))
  check("F6 absent → writes nothing", Object.keys(reSignStampData({ reSignEveryMonths: 12, reSignEveryMonthsSetAt: old }, undefined, stampNow)).length === 0)

  const base = {
    hasCurrentCycleRecord: false,
    hasPriorCycleRecordOnCurrentVersion: false,
    hasCurrentCycleRecordOnEarlierVersion: false,
    hasPriorCycleRecordOnEarlierVersion: false,
    currentVersionRequiresReacknowledgment: false,
    requiredCount: 2,
    ackedCount: 0,
    allRequiredAcked: false,
  }
  const cExp = documentCompletion({ ...base, hasExpiredRecord: true })
  check("F3 predicate: expired → needs-current + renewalDue", cExp.status === "needs-current" && cExp.renewalDue)
  const cExpPart = documentCompletion({ ...base, hasExpiredRecord: true, ackedCount: 1 })
  check("F3 predicate: expired + partial re-sign → still needs-current", cExpPart.status === "needs-current" && cExpPart.ackedCount === 1)
  const cRehire = documentCompletion({ ...base, hasExpiredRecord: true, hasPriorCycleRecordOnCurrentVersion: true })
  check("F3 predicate: a rehire outranks expiry (renewalDue false)", cRehire.status === "needs-current" && !cRehire.renewalDue)
  const cMissing = documentCompletion({ ...base, hasExpiredRecord: true, ackedCount: 2, allRequiredAcked: true })
  check("F3 predicate: a re-sign fully acked, no record → recordMissing", cMissing.status === "in-progress" && cMissing.recordMissing && !cMissing.renewalDue)
  const cNone = documentCompletion(base)
  check("F3 predicate: fact absent → pre-DOC-7 result", cNone.status === "not-started" && !cNone.renewalDue)

  // ── 2+. The engine and every reader, against real rows ────────────────────
  const tag = Math.random().toString(36).slice(2, 8)
  const now = new Date()
  const today = localDateStr(now, TZ)
  const noonOn = (day: string) => zonedInstant(day, "12:00", TZ)!
  const at = (n: number) => noonOn(addDays(today, -n))
  // Signed on the day whose 12-month anniversary is `ahead` days from today.
  const signedForAnniversary = (ahead: number) => addMonthsClamped(addDays(today, ahead), -12)
  const annivOf = (signedDay: string) => addMonthsClamped(signedDay, 12)

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-doc7-${tag}`,
      name: "ZZ DOC-7 Fixture Org (safe to delete)",
      activeModules: ["hr"],
      timezone: TZ,
    },
  })
  console.log(`\nFixture org ${org.id} · today ${today} (${TZ})\n`)

  try {
    const store = await prisma.store.create({ data: { organizationId: org.id, name: "ZZ DOC-7 Store", timezone: TZ } })
    const mkStaff = (name: string, opts: { signingCycle?: number; rehiredDaysAgo?: number } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: `DOC-7-${name}`,
          fullName: `DOC-7-${name} Fixture`,
          startDate: new Date(`${addDays(today, -1500)}T00:00:00.000Z`),
          signingCycle: opts.signingCycle ?? 1,
          rehiredAt: opts.rehiredDaysAgo !== undefined ? at(opts.rehiredDaysAgo) : null,
          createdAt: at(1500),
          storeAssignments: { create: { storeId: store.id, isPrimary: true } },
        },
        include: { storeAssignments: true },
      })
    const S = {
      noSetting: await mkStaff("S1 NoSetting"),
      inWindow: await mkStaff("S2 InWindow"),
      expired: await mkStaff("S3 Expired"),
      early: await mkStaff("S4 EarlyResign"),
      partial: await mkStaff("S5 ExpiredPartial"),
      missing: await mkStaff("S6 ExpiredRecordMissing"),
      floor: await mkStaff("S7 Floor"),
      rehireOwed: await mkStaff("S8 RehireOwed", { signingCycle: 2, rehiredDaysAgo: 3 }),
      rehireSigned: await mkStaff("S9 RehireSigned", { signingCycle: 2, rehiredDaysAgo: 3 }),
      caseA: await mkStaff("S10 CaseAExpired"),
      caseASigned: await mkStaff("S11 CaseASignedNew"),
      key: await mkStaff("S12 KeyHolder"),
      // Two earlier tenures, one with a re-sign: the cross-cycle pick on
      // /staff/[id] must take the newest CYCLE, then the newest RENEWAL in it.
      thirdTenure: await mkStaff("S13 ThirdTenure", { signingCycle: 3, rehiredDaysAgo: 1 }),
    }

    const mkDoc = (
      title: string,
      opts: {
        every: number | null
        setAt: Date | null
        caseA?: { v2DaysAgo: number }
        signWithin?: { n: number; setAt: Date }
        key?: boolean
      }
    ) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title: `DOC-7 ${title}`,
          category: "Other",
          appliesTo: "selected",
          requiresAcknowledgment: true,
          isActive: true,
          reSignEveryMonths: opts.every,
          reSignEveryMonthsSetAt: opts.setAt,
          signWithinDays: opts.signWithin?.n ?? null,
          signWithinDaysSetAt: opts.signWithin?.setAt ?? null,
          tracksReturn: opts.key ?? false,
          returnItemLabel: opts.key ? "Key" : null,
          createdAt: at(1400),
          versions: {
            create: opts.caseA
              ? [
                  { versionNumber: 1, isCurrent: false, fileHash: `doc7-${title}-v1`, createdAt: at(1400), ...FILE },
                  {
                    versionNumber: 2,
                    isCurrent: true,
                    requiresReacknowledgment: true,
                    fileHash: `doc7-${title}-v2`,
                    createdAt: at(opts.caseA.v2DaysAgo),
                    ...FILE,
                  },
                ]
              : [{ versionNumber: 1, isCurrent: true, fileHash: `doc7-${title}-v1`, createdAt: at(1400), ...FILE }],
          },
          checkpoints: {
            create: opts.key
              ? [
                  { name: `DOC-7 ${title} Key Number`, type: "Field", orderIndex: 0 },
                  { name: `DOC-7 ${title} signature`, type: "Signature", orderIndex: 1 },
                ]
              : [0, 1].map((i) => ({ name: `DOC-7 ${title} ck${i + 1}`, type: "Signature" as const, orderIndex: i })),
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } }, checkpoints: { orderBy: { orderIndex: "asc" } } },
      })
    const D = {
      none: await mkDoc("NoSetting", { every: null, setAt: null }),
      annual: await mkDoc("Annual", { every: 12, setAt: at(400) }),
      floor: await mkDoc("Floor", { every: 12, setAt: now }),
      caseA: await mkDoc("CaseA", {
        every: 12,
        setAt: at(800),
        caseA: { v2DaysAgo: 5 },
        signWithin: { n: 10, setAt: at(800) },
      }),
      key: await mkDoc("Key", { every: 12, setAt: at(800), key: true }),
    }
    const grant = (docId: string, staffId: string) => ({
      hrDocumentId: docId,
      granteeType: "STAFF",
      staffMemberId: staffId,
      createdAt: at(1400),
    })
    await prisma.hrDocumentGrant.createMany({
      data: [
        grant(D.none.id, S.noSetting.id),
        ...[S.inWindow, S.expired, S.early, S.partial, S.missing, S.rehireOwed, S.rehireSigned, S.thirdTenure].map((s) =>
          grant(D.annual.id, s.id)
        ),
        grant(D.floor.id, S.floor.id),
        grant(D.caseA.id, S.caseA.id),
        grant(D.caseA.id, S.caseASigned.id),
        grant(D.key.id, S.key.id),
      ],
    })

    const record = (
      versionId: string,
      staffId: string,
      hash: string,
      completedAt: Date,
      renewal = 0,
      signingCycle = 1
    ) =>
      prisma.hrSignedRecord.create({
        data: {
          hrDocumentVersionId: versionId,
          staffMemberId: staffId,
          completedAt,
          signedPdfPathname: `hr/fixture/${hash}.pdf`,
          signedPdfHash: hash,
          signingCycle,
          renewal,
        },
      })
    const acksFor = async (
      doc: (typeof D)[keyof typeof D],
      versionId: string,
      staff: { id: string; displayName: string },
      renewal: number,
      count: number,
      fieldValue?: string
    ) => {
      for (const ck of doc.checkpoints.slice(0, count)) {
        await prisma.hrDocumentAcknowledgment.create({
          data: {
            checkpointId: ck.id,
            hrDocumentVersionId: versionId,
            staffMemberId: staff.id,
            checkpointName: ck.name,
            checkpointType: ck.type,
            documentTitle: doc.title,
            documentVersionNumber: 1,
            documentFileHash: "doc7",
            staffName: staff.displayName,
            method: ck.type === "Field" ? "Field" : "Signature",
            fieldValue: ck.type === "Field" ? (fieldValue ?? null) : null,
            authMethod: "ManagerAttested",
            consentGiven: true,
            renewal,
          },
        })
      }
    }

    const aV = D.annual.versions[0].id
    // S1: no setting, signed long ago.
    await record(D.none.versions[0].id, S.noSetting.id, "doc7-sig-s1", at(1000))
    // S2: anniversary 20 days out.
    const s2Day = signedForAnniversary(20)
    await record(aV, S.inWindow.id, "doc7-sig-s2", noonOn(s2Day))
    // S3: anniversary 5 days ago.
    const s3Day = signedForAnniversary(-5)
    await record(aV, S.expired.id, "doc7-sig-s3", noonOn(s3Day))
    // S4: re-signed TODAY inside the window — the NEWER record inserted FIRST.
    const s4r1 = await record(aV, S.early.id, "doc7-sig-s4-r1", at(0), 1)
    const s4r0 = await record(aV, S.early.id, "doc7-sig-s4-r0", noonOn(signedForAnniversary(10)), 0)
    await acksFor(D.annual, aV, S.early, 1, 2)
    await acksFor(D.annual, aV, S.early, 0, 2)
    // S5: expired 3 days ago; renewal 0's full ack set on file; 1 of 2 at renewal 1.
    await record(aV, S.partial.id, "doc7-sig-s5", noonOn(signedForAnniversary(-3)))
    await acksFor(D.annual, aV, S.partial, 0, 2)
    await acksFor(D.annual, aV, S.partial, 1, 1)
    // S6: expired; renewal 1 fully acked, never minted.
    await record(aV, S.missing.id, "doc7-sig-s6", noonOn(signedForAnniversary(-3)))
    await acksFor(D.annual, aV, S.missing, 1, 2)
    // S7: 900-day-old signature on a document whose setting went on just now.
    await record(D.floor.versions[0].id, S.floor.id, "doc7-sig-s7", at(900))
    // S8: rehire, cycle 1 record only (would long since have expired).
    await record(aV, S.rehireOwed.id, "doc7-sig-s8-c1", at(600), 0, 1)
    // S9: rehire who signed in cycle 2, two days ago — cycle 2 inserted FIRST.
    const s9c2 = await record(aV, S.rehireSigned.id, "doc7-sig-s9-c2", at(2), 0, 2)
    await record(aV, S.rehireSigned.id, "doc7-sig-s9-c1", at(600), 0, 1)
    // S13: cycle 3, unsigned; cycle 2 holds renewals 0 and 1, cycle 1 renewal 0.
    // NEWEST INSERTED FIRST.
    const s13c2r1 = await record(aV, S.thirdTenure.id, "doc7-sig-s13-c2r1", at(30), 1, 2)
    await record(aV, S.thirdTenure.id, "doc7-sig-s13-c2r0", at(395), 0, 2)
    await record(aV, S.thirdTenure.id, "doc7-sig-s13-c1r0", at(1200), 0, 1)
    // S10: signed v1 400 days ago (expired 35 days ago); v2 Case A uploaded 5 days ago.
    const [cv1, cv2] = D.caseA.versions
    await record(cv1.id, S.caseA.id, "doc7-sig-s10", at(400))
    // S11: same, but has signed v2 two days ago — renewal 0 on a new version.
    await record(cv2.id, S.caseASigned.id, "doc7-sig-s11-v2", at(2))
    await record(cv1.id, S.caseASigned.id, "doc7-sig-s11-v1", at(400))
    // S12: key issued 400 days ago, returned 100 days ago, re-signed 2 days ago.
    const kV = D.key.versions[0].id
    await record(kV, S.key.id, "doc7-sig-s12-r1", at(2), 1)
    await record(kV, S.key.id, "doc7-sig-s12-r0", at(400), 0)
    await acksFor(D.key, kV, S.key, 0, 2, "14")
    await acksFor(D.key, kV, S.key, 1, 2, "14")
    await prisma.hrReturnEvent.create({
      data: {
        organizationId: org.id,
        hrDocumentId: D.key.id,
        staffMemberId: S.key.id,
        type: "Returned",
        occurredOn: new Date(`${addDays(today, -100)}T00:00:00.000Z`),
        recordedByUserId: "fixture",
        recordedByName: "DOC-7 Fixture",
        createdAt: at(100),
      },
    })

    const rollup = await getOrgComplianceRollup(org.id, { storeIds: null })
    const item = (staffId: string, docId: string) =>
      rollup.staff
        .find((s) => s.staffId === staffId)
        ?.items.find((i): i is ComplianceDocItem => i.kind === "document" && i.documentId === docId)

    console.log("\n── 2. No setting = today ──")
    const i1 = item(S.noSetting.id, D.none.id)!
    check("S1 1000-day-old signature, no setting → complete", i1.status === "complete")
    check("S1 no notice, no due date, not renewalDue", i1.reSignDueDate === null && i1.reSignDaysUntilDue === null && i1.dueDate === null && !i1.renewalDue)

    console.log("\n── 3. Rulings 3–6 and F7 on real rows ──")
    const i2 = item(S.inWindow.id, D.annual.id)!
    const s2Want = daysBetween(today, annivOf(s2Day))
    check("S2 in window: still COMPLETE (ruling 3)", i2.status === "complete")
    check(`S2 notice "${reSignNoticeLabel(i2)}" (${s2Want} days)`, i2.reSignDaysUntilDue === s2Want && i2.reSignDueDate === annivOf(s2Day))
    check("S2 dueDate stays null — no total, banner or digest sees it", i2.dueDate === null && i2.daysUntilDue === null)
    const s2Detail = rollup.staff.find((s) => s.staffId === S.inWindow.id)!
    check("S2 pct 100 — nothing moved early (MS-3 gate reads status)", s2Detail.pct === 100 && s2Detail.overdueCount === 0)

    const i3 = item(S.expired.id, D.annual.id)!
    const s3Want = daysBetween(today, annivOf(s3Day))
    check("S3 anniversary passed → overdue (ruling 5)", i3.status === "overdue" && i3.renewalDue)
    check(`S3 dueDate = the anniversary, ${s3Want} days`, i3.dueDate === annivOf(s3Day) && i3.daysUntilDue === s3Want)
    check(`S3 wording "${documentDueLabel(i3)}"`, documentDueLabel(i3)?.startsWith("Was due ") === true)
    check("S3 bound to the version of the expired record", i3.signedVersionNumber === 1)

    const i4 = item(S.early.id, D.annual.id)!
    check("S4 early re-sign → complete, notice gone (anniversary renewed from today)", i4.status === "complete" && i4.reSignDueDate === null)

    const i5 = item(S.partial.id, D.annual.id)!
    check("S5 expired + part-done re-sign → overdue, 1 of 2 (renewal 0's acks NOT counted)", i5.status === "overdue" && i5.ackedCount === 1, `${i5.status} ${i5.ackedCount}`)
    const i6 = item(S.missing.id, D.annual.id)!
    check("S6 re-sign fully acked, no record → recordMissing, no due date", i6.recordMissing && i6.status === "in-progress" && i6.dueDate === null)

    const i7 = item(S.floor.id, D.floor.id)!
    check("S7 ruling 6: 900-day-old signature, setting on today → complete, 30-day notice", i7.status === "complete" && i7.reSignDaysUntilDue === 30, `${i7.status} ${i7.reSignDaysUntilDue}`)

    const i8 = item(S.rehireOwed.id, D.annual.id)!
    check("S8 rehire: prior-cycle record → needs-resign, NOT renewalDue, no anniversary", i8.status === "needs-resign" && !i8.renewalDue && i8.dueDate === null)
    const i9 = item(S.rehireSigned.id, D.annual.id)!
    check("S9 rehire signed in cycle 2 → complete, clock restarted (no notice)", i9.status === "complete" && i9.reSignDueDate === null)

    const i10 = item(S.caseA.id, D.caseA.id)!
    const s10Anniv = annivOf(addDays(today, -400))
    check("S10 expired + Case A pending → overdue on the EARLIER date (F7: the anniversary)", i10.status === "overdue" && i10.dueDate === s10Anniv, `${i10.dueDate} vs ${s10Anniv}`)
    const i11 = item(S.caseASigned.id, D.caseA.id)!
    check("S11 Case A version signed → complete, clock restarted from it", i11.status === "complete" && i11.reSignDueDate === null && !i11.signedOnEarlierVersion)

    console.log("\n── 4. Newest renewal wins — engine, ensureSignedRecord, /staff/[id], /my/documents ──")
    check("engine: S4 completedAt is the renewal-1 record's (inserted FIRST)", i4.completedAt === s4r1.completedAt.toISOString(), `${i4.completedAt}`)
    const lv4 = await loadRenewalView(D.annual.id, S.early.id)
    check("loadRenewalView: S4 governing renewal 1, owes renewal 1 (no-op)", lv4?.governing?.renewal === 1 && lv4.owedRenewal === 1)
    const e4 = await ensureSignedRecord(aV, S.early.id, lv4!.owedRenewal)
    check("ensureSignedRecord(owed) returns the renewal-1 record, not renewal 0", e4.id === s4r1.id)
    const e4r0 = await ensureSignedRecord(aV, S.early.id, 0)
    check("ensureSignedRecord(…, 0) returns renewal 0's own record", e4r0.id === s4r0.id)
    const lv2 = await loadRenewalView(D.annual.id, S.inWindow.id)
    let refused = false
    try {
      await ensureSignedRecord(aV, S.inWindow.id, lv2!.owedRenewal)
    } catch (e) {
      refused = e instanceof SignedRecordError
    }
    check("ensureSignedRecord at S2's owed renewal 1 does NOT hand back renewal 0 — refuses (no acks)", lv2?.owedRenewal === 1 && refused)

    const staffRows = async (s: (typeof S)[keyof typeof S]) =>
      staffDocumentRows({ ...s, storeAssignments: s.storeAssignments })
    const sr4 = (await staffRows(S.early)).find((r) => r.documentId === D.annual.id)!
    check("/staff/[id]: S4 download link is the renewal-1 record", sr4.signedRecordId === s4r1.id && sr4.status === "signed")
    check("/staff/[id]: S4 date is the renewal-1 record's", sr4.completedAt === s4r1.completedAt.toISOString())
    const sr3 = (await staffRows(S.expired)).find((r) => r.documentId === D.annual.id)!
    check("/staff/[id]: S3 expired → needs-current, link to the expired record", sr3.status === "needs-current" && sr3.signedRecordId !== null && sr3.signedVersionNumber === 1)
    const sr9 = (await staffRows(S.rehireSigned)).find((r) => r.documentId === D.annual.id)!
    check("/staff/[id]: S9 link is the cycle-2 record (inserted FIRST)", sr9.signedRecordId === s9c2.id)
    const sr8 = (await staffRows(S.rehireOwed)).find((r) => r.documentId === D.annual.id)!
    check("/staff/[id]: S8 rehire still reads needs-current via the prior cycle", sr8.status === "needs-current")
    const sr13 = (await staffRows(S.thirdTenure)).find((r) => r.documentId === D.annual.id)!
    check("/staff/[id]: S13 prior tenures → link is cycle 2, renewal 1 (newest cycle, then renewal)", sr13.signedRecordId === s13c2r1.id && sr13.status === "needs-current")
    const my4 = (await requiredDocumentRows(S.early)).find((r) => r.documentId === D.annual.id)!
    check("/my/documents: S4 signed, dated by renewal 1", my4.status === "signed" && my4.completedAt === s4r1.completedAt.toISOString())
    const my3 = (await requiredDocumentRows(S.expired)).find((r) => r.documentId === D.annual.id)!
    check("/my/documents: S3 expired → To sign (needs-current)", my3.status === "needs-current")
    const my5 = (await requiredDocumentRows(S.partial)).find((r) => r.documentId === D.annual.id)!
    check("/my/documents: S5 progress counts renewal 1 only", my5.ackedCount === 1)

    console.log("\n── 5. DOC-6 key register (F5) ──")
    const keys = await loadReturnItems(org.id, { documentId: D.key.id })
    const k = keys.find((x) => x.staffId === S.key.id)
    check("S12 a re-sign after a Returned does NOT re-issue the key", k !== undefined && k.holding === false, JSON.stringify(k?.holding))
    check("S12 the key number is listed once, not twice", k?.fields.length === 1 && k.fields[0].value === "14", JSON.stringify(k?.fields))

    console.log("\n── 6. NOTIFY-14 digest (F4) ──")
    const digest = await docDigestView(org.id, null)
    const lines = digest.groups.flatMap((g) => g.lines)
    check("S2 upcoming re-sign is NOT in the digest", !lines.some((l) => l.staffId === S.inWindow.id))
    check("S7 launch-day notice is NOT in the digest", !lines.some((l) => l.staffId === S.floor.id))
    const l3 = lines.find((l) => l.staffId === S.expired.id)
    check("S3 expired re-sign IS in the digest as overdue", !!l3 && l3.daysUntilDue === s3Want)

    console.log("\n── 7. Totals and the DOC-2 invariant ──")
    const inv = invariant(rollup)
    check("Σ audienceCount = document items across staff", inv.pivotY === inv.itemsY, `${inv.pivotY} vs ${inv.itemsY}`)
    check("Σ signedCount = complete document items", inv.pivotX === inv.itemsX, `${inv.pivotX} vs ${inv.itemsX}`)
    // 13 people, one item each. Complete: S1 S2 S4 S7 S9 S11 S12 = 7.
    // Overdue: S3 S5 S10 = 3. Needs-resign: S8 S13 = 2. In progress: S6.
    check("requiredTotal 13, completed 7", rollup.totals.requiredTotal === 13 && rollup.totals.completedCount === 7, `${rollup.totals.requiredTotal}/${rollup.totals.completedCount}`)
    check("overdueCount 3 (S3 S5 S10), needsResign 2 (S8 S13)", rollup.totals.overdueCount === 3 && rollup.totals.needsResignCount === 2, `${rollup.totals.overdueCount}/${rollup.totals.needsResignCount}`)
    const annualRow = rollup.byDocument.documents.find((d) => d.documentId === D.annual.id)
    const p2 = annualRow?.people.find((p) => p.staffId === S.inWindow.id)
    check("By Document carries the notice through unchanged", p2?.status === "complete" && p2.reSignDaysUntilDue === s2Want)
  } finally {
    await prisma.hrReturnEvent.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentGrant.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── 8. Fixture removal (re-queried) ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "DOC-7-" } } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "DOC-7 " } } }),
      prisma.store.count({ where: { name: { startsWith: "ZZ DOC-7 " } } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: { startsWith: "doc7-sig-" } } }),
      prisma.hrDocumentAcknowledgment.count({ where: { documentTitle: { startsWith: "DOC-7 " } } }),
      prisma.hrReturnEvent.count({ where: { recordedByName: "DOC-7 Fixture" } }),
    ])
    check("all DOC-7 fixtures removed", leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
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
