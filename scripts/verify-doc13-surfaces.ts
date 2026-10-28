/**
 * DOC-13 acceptance fixture — due dates on /my/documents and the /staff/[id]
 * Documents tab, ordered the way /my orders them.
 *
 *   npx tsx scripts/verify-doc13-surfaces.ts
 *
 * Draft rulings 1–5 (docs/DECISIONS.md, DOC-13 — awaiting Gary's ratification;
 * Gary chose "Ruling 3, all three" 2026-10-28, so /my takes the same order).
 * EXPECTED values are written from the rulings and the DOC-8 clock, not read
 * back from the code under test.
 *
 * One member, six documents and two training assignments, in a throwaway org.
 * Every principal is named "DOC-13-…" (CLAUDE.md § Name every test principal).
 * Titles are chosen so TITLE ORDER IS THE OPPOSITE OF DUE ORDER — a surface that
 * ignored the due sort fails visibly rather than passing by alphabet.
 *
 * NOT HERE, said rather than implied: the /staff/[id] Documents tab builds its
 * rows inline in a server page this script cannot import. It is exercised
 * through the same attach + sort it calls (lib/hr-due-order.ts), over rows from
 * /my/documents' own query (its twin, by audience rule and completion
 * predicate). The rendered badge and wording are on Gary's staging test plan.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { getStaffComplianceDetail, openComplianceItems, type ComplianceDocItem } from "../src/lib/hr-compliance"
import { documentDueLabel } from "../src/lib/hr-due-wording"
import { attachDocumentDue, documentDueKey, openItemsInDueOrder, sortByDue } from "../src/lib/hr-due-order"
import { requiredDocumentRows } from "../src/app/(my)/my/documents/data"
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
const eq = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b)

const TZ = "America/Los_Angeles"
const FILE = {
  fileUrl: "https://example.invalid/doc13.pdf",
  fileName: "doc13.pdf",
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

  const tag = Math.random().toString(36).slice(2, 8)
  const now = new Date()
  const today = localDateStr(now, TZ)
  const at = (n: number) => zonedInstant(addDays(today, -n), "12:00", TZ)!
  const civil = (n: number) => new Date(`${addDays(today, -n)}T00:00:00.000Z`)
  const monthDay = (n: number) =>
    new Date(`${addDays(today, n)}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-doc13-${tag}`,
      name: "ZZ DOC-13 Fixture Org (safe to delete)",
      activeModules: ["hr"],
      timezone: TZ,
    },
  })
  console.log(`Fixture org ${org.id} · today ${today} (${TZ})\n`)

  try {
    const store = await prisma.store.create({
      data: { organizationId: org.id, name: "ZZ DOC-13 Store", timezone: TZ },
    })
    const member = await prisma.staffMember.create({
      data: {
        organizationId: org.id,
        displayName: "DOC-13-Member",
        fullName: "DOC-13-Member Fixture",
        startDate: civil(200),
        createdAt: at(300),
        storeAssignments: { create: { storeId: store.id, isPrimary: true } },
      },
      include: { storeAssignments: { select: { storeId: true } } },
    })

    // Clock start = the latest of hire (200d), grant (100d) and set stamp, so
    // the set stamp decides every due date: due = today - setDaysAgo + N.
    const mkDoc = (title: string, n: number | null, setDaysAgo: number | null) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title: `DOC-13 ${title}`,
          category: "Other",
          appliesTo: "selected",
          requiresAcknowledgment: true,
          isActive: true,
          signWithinDays: n,
          signWithinDaysSetAt: setDaysAgo === null ? null : at(setDaysAgo),
          createdAt: at(100),
          versions: {
            create: [{ versionNumber: 1, isCurrent: true, fileHash: `doc13-${title}-v1`, createdAt: at(100), ...FILE }],
          },
          checkpoints: {
            create: [0, 1].map((i) => ({ name: `DOC-13 ${title} ck${i + 1}`, type: "Signature", orderIndex: i })),
          },
        },
        include: { versions: true },
      })

    const D = {
      noN: await mkDoc("A NoN", null, null), //                 no due date
      soon7: await mkDoc("B Soon7", 10, 3), //                  due in 7 days
      late5: await mkDoc("C Late5", 5, 10), //                  5 days overdue
      late15: await mkDoc("D Late15", 5, 20), //                15 days overdue
      soon2: await mkDoc("E Soon2", 10, 8), //                  due in 2 days
      signed: await mkDoc("F Signed", 5, 20), //                would be overdue; signed
    }
    await prisma.hrDocumentGrant.createMany({
      data: Object.values(D).map((d) => ({
        hrDocumentId: d.id,
        granteeType: "STAFF",
        staffMemberId: member.id,
        createdAt: at(100),
      })),
    })
    await prisma.hrSignedRecord.create({
      data: {
        hrDocumentVersionId: D.signed.versions[0].id,
        staffMemberId: member.id,
        completedAt: at(15),
        signedPdfPathname: "hr/fixture/doc13-sig.pdf",
        signedPdfHash: "doc13-sig-f",
        signingCycle: 1,
      },
    })

    // Training: one overdue 10 days (it must land BETWEEN the -15 and -5
    // documents on /my), one with no due date (it stays in the status tail).
    const mod = (title: string) =>
      prisma.trainingModule.create({ data: { organizationId: org.id, title: `DOC-13 ${title}` } })
    const [tLate, tOpen] = await Promise.all([mod("T1 Late10"), mod("T2 Open")])
    await prisma.trainingAssignment.createMany({
      data: [
        { trainingModuleId: tLate.id, staffMemberId: member.id, assignedByUserId: "fixture", dueDate: at(10) },
        { trainingModuleId: tOpen.id, staffMemberId: member.id, assignedByUserId: "fixture" },
      ],
    })

    const detail = await getStaffComplianceDetail(org.id, member.id)
    check("compliance detail resolves in the store's zone", detail?.timeZone === TZ, String(detail?.timeZone))
    const docItem = (id: string) =>
      detail?.items.find((i): i is ComplianceDocItem => i.kind === "document" && i.documentId === id)

    // ── 1. The compliance items (the source both surfaces copy from) ─────────
    console.log("\n── 1. Compliance items — DOC-8's clock, unchanged ──")
    const expectLabel: [keyof typeof D, string | null][] = [
      ["late15", `Was due ${monthDay(-15)}`],
      ["late5", `Was due ${monthDay(-5)}`],
      ["soon2", "Due in 2 days"],
      ["soon7", "Due in 7 days"],
      ["noN", null],
      ["signed", null],
    ]
    for (const [k, label] of expectLabel) {
      const it = docItem(D[k].id)
      check(`${D[k].title} → ${label ?? "no due wording"}`, !!it && documentDueLabel(it) === label, String(it && documentDueLabel(it)))
    }

    // ── 2. /my — ruling 3 applied to the existing status rank ──────────────
    console.log("\n── 2. /my order ──")
    const myOrder = openItemsInDueOrder(openComplianceItems(detail), detail!.timeZone).map((i) =>
      i.kind === "document" ? i.title : i.moduleTitle
    )
    const expectedMy = [
      "DOC-13 D Late15",
      "DOC-13 T1 Late10",
      "DOC-13 C Late5",
      "DOC-13 E Soon2",
      "DOC-13 B Soon7",
      "DOC-13 A NoN",
      "DOC-13 T2 Open",
    ]
    check("overdue most-overdue first (training interleaved), due soonest next, rest in status order", eq(myOrder, expectedMy), myOrder.join(" | "))

    // ── 3. /my/documents — its own rows, the compliance dates copied on ──────
    console.log("\n── 3. /my/documents ──")
    const rows = attachDocumentDue(await requiredDocumentRows(member), detail)
    const pending = sortByDue(
      rows.filter((r) => r.status !== "signed"),
      documentDueKey
    )
    const expectedDocs = expectedMy.filter((t) => !t.includes(" T"))
    check("To sign order = /my's document order", eq(pending.map((r) => r.title), expectedDocs), pending.map((r) => r.title).join(" | "))
    for (const r of rows) {
      const it = docItem(r.documentId)
      check(
        `${r.title}: label equals the compliance item's`,
        !!it && documentDueLabel(r) === documentDueLabel(it),
        `${documentDueLabel(r)} vs ${it && documentDueLabel(it)}`
      )
      check(
        `${r.title}: red Overdue exactly when compliance says overdue`,
        !!it && documentDueKey(r).overdue === (it.status === "overdue")
      )
    }
    const signedRow = rows.find((r) => r.documentId === D.signed.id)
    check("signed document: Completed, no due date (ruling 4)", signedRow?.status === "signed" && signedRow.dueDate === null)
    const noNRow = rows.find((r) => r.documentId === D.noN.id)
    check("no-N document: no due fields, not overdue (ruling 4)", noNRow?.dueDate === null && noNRow.daysUntilDue === null)

    // ── 4. /staff/[id] Documents tab — the same attach + sort, all rows ──────
    console.log("\n── 4. /staff/[id] Documents tab ──")
    const tab = sortByDue(attachDocumentDue(await requiredDocumentRows(member), detail), documentDueKey)
    check(
      "tab order = /my's documents, then the signed one in title order",
      eq(tab.map((r) => r.title), [...expectedDocs, "DOC-13 F Signed"]),
      tab.map((r) => r.title).join(" | ")
    )
    check(
      "tab labels = /my/documents labels",
      eq(
        tab.map((r) => documentDueLabel(r)),
        tab.map((r) => documentDueLabel(rows.find((x) => x.documentId === r.documentId)!))
      )
    )
    check("no due dates anywhere → title order untouched", eq(
      sortByDue([{ t: "a", dueDate: null, daysUntilDue: null }, { t: "b", dueDate: null, daysUntilDue: null }], documentDueKey).map((x) => x.t),
      ["a", "b"]
    ))
  } finally {
    await prisma.trainingAssignment.deleteMany({ where: { trainingModule: { organizationId: org.id } } })
    await prisma.trainingModule.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentGrant.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── 5. Fixture removal (re-queried) ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "DOC-13-" } } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "DOC-13 " } } }),
      prisma.trainingModule.count({ where: { title: { startsWith: "DOC-13 " } } }),
      prisma.store.count({ where: { name: { startsWith: "ZZ DOC-13 " } } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: { startsWith: "doc13-sig-" } } }),
    ])
    check("all DOC-13 fixtures removed", leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
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
