/**
 * DOC-6 acceptance fixture — the key holder register.
 *
 *   npx tsx scripts/verify-doc6-key-register.ts
 *
 * Creates a throwaway org (2 stores, a MANAGER user on store A, 10 staff, 3
 * documents) and asserts the holding rule and its guards against EXPECTED
 * VALUES WRITTEN FROM THE RULINGS (Gary 2026-09-28, docs/prompts/DOC-6_AUDIT.md),
 * not read back from the code under test:
 *
 *   F4  holding is per person per document across ALL versions and cycles
 *   R1  latest issue (signature or Reissued) vs latest Returned, by createdAt
 *   F7  terminated holders appear, flagged
 *   R2  an archived tracks-return document keeps its holders; Reissue refused
 *   F2  a non-tracksReturn document never appears
 *   F5  out-of-scope MANAGER, STAFF, STORE → refused (the route's 403)
 *   F3  duplicate events refused; no update or delete route exists
 *   —   compliance math unchanged by the register
 *
 * THE 403s ARE ASSERTED ON THE SHIPPED DECISION FUNCTION, NOT OVER HTTP. Clerk's
 * auth() cannot run outside a request, so — like verify-doc5-categories.ts and
 * verify-perm8-grants.ts — the fixture calls canRecordReturn (what the route
 * calls) with real rows from this org, and reads the route source to confirm it
 * calls it and answers 403. The HTTP 403 is staging test 5 (Tommy, STORE).
 *
 * Everything is deleted afterwards and the removal is asserted by RE-QUERY.
 */
import "dotenv/config"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../src/lib/prisma"
import {
  canRecordReturn,
  getReturnRegister,
  isHolding,
  loadReturnItems,
  returnEventConflict,
  type ReturnItem,
} from "../src/lib/hr-returns"
import { getOrgComplianceRollup } from "../src/lib/hr-compliance"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const FILE = {
  fileUrl: "https://example.invalid/doc6.pdf",
  fileName: "doc6.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
}

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY)

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

async function main() {
  const branch = await prisma.$queryRawUnsafe<{ branch: string | null; db: string }[]>(
    `select current_setting('neon.branch_id', true) as branch, current_database()::text as db`
  )
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH ${branch[0]?.branch ?? "(null)"} / ${branch[0]?.db}\n`)

  const tag = Math.random().toString(36).slice(2, 8)
  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-doc6-${tag}`,
      name: "ZZ DOC-6 Fixture Org (safe to delete)",
      activeModules: ["hr"],
    },
  })
  console.log(`Fixture org ${org.id}\n`)

  try {
    const [storeA, storeB] = await Promise.all(
      ["A", "B"].map((n) =>
        prisma.store.create({
          data: { organizationId: org.id, name: `ZZ DOC-6 Store ${n}`, timezone: "America/Los_Angeles" },
        })
      )
    )
    const manager = await prisma.user.create({
      data: {
        clerkUserId: `fixture-doc6-mgr-${tag}`,
        organizationId: org.id,
        email: `doc6-mgr-${tag}@example.invalid`,
        name: "DOC-6 Manager",
        role: "MANAGER",
        storeAssignments: { create: [{ storeId: storeA.id }] },
      },
      include: { storeAssignments: true },
    })

    const mkStaff = (name: string, opts: { status?: string; signingCycle?: number } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: name,
          fullName: `${name} Fixture`,
          status: opts.status ?? "ACTIVE",
          signingCycle: opts.signingCycle ?? 1,
        },
      })
    const [held, returned, reissued, v1Signer, rehire, terminated, resigned, backdated, storeB1, unsigned] =
      await Promise.all([
        mkStaff("DOC-6-Held"), // signed v3, nothing since → holding
        mkStaff("DOC-6-Returned"), // signed, Returned → not holding
        mkStaff("DOC-6-Reissued"), // signed, Returned, Reissued → holding
        mkStaff("DOC-6-V1Signer"), // signed v1 only while v3 is current → holding (F4)
        mkStaff("DOC-6-Rehire", { signingCycle: 2 }), // cycle-1 record only → holding (F4)
        mkStaff("DOC-6-Terminated", { status: "TERMINATED" }), // → holding, flagged (F7)
        mkStaff("DOC-6-Resigned"), // Returned, THEN signed again → holding (R1)
        mkStaff("DOC-6-Backdated"), // Returned recorded after signing, dated before → not holding (R1)
        mkStaff("DOC-6-StoreB"), // store B, holding — outside the manager's scope
        mkStaff("DOC-6-Unsigned"), // no record at all
      ])
    const inA = [held, returned, reissued, v1Signer, rehire, terminated, resigned, backdated, unsigned]
    await prisma.storeStaffAssignment.createMany({
      data: [
        ...inA.map((s) => ({ staffMemberId: s.id, storeId: storeA.id, isPrimary: true })),
        { staffMemberId: storeB1.id, storeId: storeB.id, isPrimary: true },
      ],
    })

    const mkDoc = (title: string, opts: { tracksReturn: boolean; isActive?: boolean; versions: number; field?: boolean }) =>
      prisma.hrDocument.create({
        data: {
          organizationId: org.id,
          kind: "Acknowledgment",
          title,
          category: "Other",
          appliesTo: "all",
          requiresAcknowledgment: true,
          isActive: opts.isActive ?? true,
          tracksReturn: opts.tracksReturn,
          returnItemLabel: opts.tracksReturn ? "Key" : null,
          versions: {
            create: Array.from({ length: opts.versions }, (_, i) => ({
              versionNumber: i + 1,
              isCurrent: i + 1 === opts.versions,
              fileHash: `doc6-${title}-v${i + 1}`,
              ...FILE,
            })),
          },
          checkpoints: {
            create: [
              { name: "Signature", type: "Signature", orderIndex: 0 },
              ...(opts.field ? [{ name: "Key Number", type: "Field" as const, orderIndex: 1 }] : []),
            ],
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } }, checkpoints: true },
      })
    const [keyDoc, plainDoc, archivedDoc] = await Promise.all([
      mkDoc("DOC-6 Key Agreement", { tracksReturn: true, versions: 3, field: true }),
      mkDoc("DOC-6 Plain Policy", { tracksReturn: false, versions: 1 }),
      mkDoc("DOC-6 Old Key Agreement", { tracksReturn: true, isActive: false, versions: 1 }),
    ])
    const [kv1, , kv3] = keyDoc.versions

    let n = 0
    const record = (versionId: string, staffId: string, completedAt: Date, signingCycle = 1) =>
      prisma.hrSignedRecord.create({
        data: {
          hrDocumentVersionId: versionId,
          staffMemberId: staffId,
          completedAt,
          signedPdfPathname: `hr/fixture/doc6-${n}.pdf`,
          signedPdfHash: `doc6-sig-${n++}`,
          signingCycle,
        },
      })
    await Promise.all([
      record(kv3.id, held.id, ago(30)),
      record(kv3.id, returned.id, ago(30)),
      record(kv3.id, reissued.id, ago(30)),
      record(kv1.id, v1Signer.id, ago(300)),
      record(kv3.id, rehire.id, ago(200), 1),
      record(kv3.id, terminated.id, ago(30)),
      record(kv1.id, resigned.id, ago(60)),
      record(kv3.id, backdated.id, ago(2)),
      record(kv3.id, storeB1.id, ago(30)),
      record(plainDoc.versions[0].id, held.id, ago(30)), // non-tracksReturn: must never appear
      record(archivedDoc.versions[0].id, held.id, ago(400)), // archived tracks-return (R2)
    ])
    // Key number on Held's v3 signature (audit §1: shown when a Field checkpoint exists).
    const fieldCk = keyDoc.checkpoints.find((c) => c.type === "Field")!
    await prisma.hrDocumentAcknowledgment.create({
      data: {
        checkpointId: fieldCk.id,
        hrDocumentVersionId: kv3.id,
        staffMemberId: held.id,
        checkpointName: "Key Number",
        checkpointType: "Field",
        documentTitle: keyDoc.title,
        documentVersionNumber: 3,
        documentFileHash: kv3.fileHash,
        staffName: held.displayName,
        method: "Field",
        fieldValue: "14",
        authMethod: "ClerkSession",
        consentGiven: true,
      },
    })

    // Compliance BEFORE any return event exists — the register must not move it.
    const complianceBefore = (await getOrgComplianceRollup(org.id, { storeIds: null })).totals

    // Events. createdAt is set explicitly so the R1 ordering is deterministic.
    const event = (staffId: string, type: "Returned" | "Reissued", createdAt: Date, occurredOn: Date, docId = keyDoc.id) =>
      prisma.hrReturnEvent.create({
        data: {
          organizationId: org.id,
          hrDocumentId: docId,
          staffMemberId: staffId,
          type,
          occurredOn,
          recordedByUserId: manager.id,
          recordedByName: "DOC-6 Manager",
          createdAt,
        },
      })
    await event(returned.id, "Returned", ago(10), ago(10))
    await event(reissued.id, "Returned", ago(10), ago(10))
    await event(reissued.id, "Reissued", ago(5), ago(5))
    await event(resigned.id, "Returned", ago(40), ago(40))
    await record(kv3.id, resigned.id, ago(20)) // signs the new version AFTER returning (R1)
    await event(backdated.id, "Returned", ago(1), ago(90)) // recorded AFTER signing, typed as BEFORE

    // ── 1. The pure predicate, from the ruling's sentence ──
    console.log("── 1. isHolding (R1) ──")
    const t = (d: number) => ago(d)
    check("no signature → not holding, even with a Reissued", !isHolding([], [{ type: "Reissued", createdAt: t(1) }]))
    check("signature only → holding", isHolding([t(5)], []))
    check("signature then Returned → not holding", !isHolding([t(5)], [{ type: "Returned", createdAt: t(3) }]))
    check(
      "Returned then Reissued → holding",
      isHolding([t(5)], [{ type: "Returned", createdAt: t(3) }, { type: "Reissued", createdAt: t(2) }])
    )
    check("Returned then a NEW signature → holding (R1)", isHolding([t(9), t(2)], [{ type: "Returned", createdAt: t(5) }]))

    // ── 2. The register, org-wide ──
    console.log("\n── 2. Register (ADMIN scope) ──")
    const all = await loadReturnItems(org.id)
    const on = (s: { id: string }, docId = keyDoc.id) =>
      all.find((i) => i.staffId === s.id && i.documentId === docId)
    const holdingOf = (s: { id: string }, docId?: string) => on(s, docId)?.holding
    check("signed, not returned → holding", holdingOf(held) === true)
    check("returned → not holding", holdingOf(returned) === false)
    check("returned then reissued → holding", holdingOf(reissued) === true)
    check("v1 signer while v3 is current → holding (F4)", holdingOf(v1Signer) === true && on(v1Signer)?.latestVersionNumber === 1)
    check("rehire, prior-cycle record only → holding (F4)", holdingOf(rehire) === true)
    check("returned, then signed again → holding (R1)", holdingOf(resigned) === true)
    check("Returned recorded after signing but dated before → not holding (createdAt orders)", holdingOf(backdated) === false)
    check("never signed → absent", on(unsigned) === undefined)
    const term = on(terminated)
    check("terminated holder appears, flagged (F7)", term?.holding === true && term.terminated === true)
    check(
      "key number shown from the Field checkpoint",
      on(held)?.fields.length === 1 && on(held)?.fields[0].label === "Key Number" && on(held)?.fields[0].value === "14",
      JSON.stringify(on(held)?.fields)
    )
    check("item label is the document's (\"Key\")", on(held)?.itemLabel === "Key")
    check("non-tracksReturn document never appears (loader)", all.every((i) => i.documentId !== plainDoc.id))
    const arch = on(held, archivedDoc.id)
    check("archived tracks-return document keeps its holder (R2)", arch?.holding === true && arch.documentActive === false)

    const register = await getReturnRegister(org.id, null)
    check("non-tracksReturn document never appears (register)", register.every((d) => d.documentId !== plainDoc.id))
    const keyRow = register.find((d) => d.documentId === keyDoc.id)
    const expectedHolders = [held, reissued, v1Signer, rehire, terminated, resigned, storeB1].map((s) => s.id).sort()
    check(
      "Key Agreement: 7 holding, exactly the expected people",
      JSON.stringify(keyRow?.holders.map((h) => h.staffId).sort()) === JSON.stringify(expectedHolders),
      `${keyRow?.holders.length} holding`
    )
    check("archived document listed as archived", register.find((d) => d.documentId === archivedDoc.id)?.active === false)

    // ── 3. Manager scope ──
    console.log("\n── 3. Register (MANAGER, store A) ──")
    const mgrStoreIds = manager.storeAssignments.map((a) => a.storeId)
    const mgrKey = (await getReturnRegister(org.id, mgrStoreIds)).find((d) => d.documentId === keyDoc.id)
    check(
      "manager sees 6 holders, store B's excluded",
      mgrKey?.holders.length === 6 && mgrKey.holders.every((h) => h.staffId !== storeB1.id),
      `${mgrKey?.holders.length}`
    )

    // ── 4. Who may record (F5) — the route's decision function ──
    console.log("\n── 4. canRecordReturn (F5) ──")
    const staffFacts = async (s: { id: string }) => {
      const a = await prisma.storeStaffAssignment.findMany({ where: { staffMemberId: s.id } })
      return { organizationId: org.id, staffMemberId: s.id, staffStoreIds: a.map((x) => x.storeId) }
    }
    const viewer = (role: string, storeIds: string[]) => ({ orgDbId: org.id, role, storeIds })
    check("ADMIN → allowed", canRecordReturn(await staffFacts(storeB1), viewer("ADMIN", [])))
    check("MANAGER, in scope → allowed", canRecordReturn(await staffFacts(held), viewer("MANAGER", mgrStoreIds)))
    check("MANAGER, out of scope → refused (403)", !canRecordReturn(await staffFacts(storeB1), viewer("MANAGER", mgrStoreIds)))
    check("STAFF → refused (403)", !canRecordReturn(await staffFacts(held), viewer("STAFF", [storeA.id])))
    check("STORE → refused (403)", !canRecordReturn(await staffFacts(held), viewer("STORE", [storeA.id])))
    check("other org → refused", !canRecordReturn(await staffFacts(held), { orgDbId: "other", role: "ADMIN", storeIds: [] }))

    const route = readFileSync("src/app/api/hr/returns/route.ts", "utf8")
    check(
      "route: STAFF/STORE refused with 403 before any lookup",
      /dbUser\?\.role !== "ADMIN" && dbUser\?\.role !== "MANAGER"\) \{\s*return NextResponse\.json\([^)]*\{ status: 403 \}\)/.test(route)
    )
    check(
      "route: calls canRecordReturn and 403s on false",
      /const allowed = canRecordReturn\(/.test(route) && /if \(!allowed\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\)/.test(route)
    )

    // ── 5. Duplicates and archived (F3, R2) ──
    console.log("\n── 5. returnEventConflict ──")
    const st = (i: ReturnItem | undefined, active = true) => ({
      hasSignedRecord: !!i,
      holding: i?.holding ?? false,
      documentActive: active,
    })
    check("Returned while holding → allowed", returnEventConflict(st(on(held)), "Returned") === null)
    check("Returned while not holding → refused", returnEventConflict(st(on(returned)), "Returned") !== null)
    check("Reissued while holding → refused", returnEventConflict(st(on(held)), "Reissued") !== null)
    check("Reissued while not holding → allowed", returnEventConflict(st(on(returned)), "Reissued") === null)
    check("no signed record → refused", returnEventConflict(st(on(unsigned)), "Returned") !== null)
    check("archived: Mark returned still works (R2)", returnEventConflict(st(arch, false), "Returned") === null)
    check(
      "archived: Reissue refused (R2)",
      returnEventConflict({ hasSignedRecord: true, holding: false, documentActive: false }, "Reissued") !== null
    )
    check("route: 409 on a conflict", /if \(conflict\) return NextResponse\.json\(\{ error: conflict \}, \{ status: 409 \}\)/.test(route))

    // ── 6. Append-only: no update or delete path (read from source) ──
    console.log("\n── 6. Append-only (source read) ──")
    const exported = [...route.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    check("route exports POST only", JSON.stringify(exported) === '["POST"]', exported.join(","))
    const writers = walk("src")
      .filter((p) => /\.(ts|tsx)$/.test(p) && !p.startsWith("src/generated"))
      .filter((p) => /hrReturnEvent\.(update|updateMany|upsert|delete|deleteMany)\b/.test(readFileSync(p, "utf8")))
    check("no update/upsert/delete of hrReturnEvent anywhere in src/", writers.length === 0, writers.join(", "))

    // ── 7. Compliance math untouched ──
    console.log("\n── 7. Compliance unchanged ──")
    const complianceAfter = (await getOrgComplianceRollup(org.id, { storeIds: null })).totals
    check(
      "compliance totals identical before and after return events",
      JSON.stringify(complianceBefore) === JSON.stringify(complianceAfter),
      `${complianceBefore.completedCount}/${complianceBefore.requiredTotal} vs ${complianceAfter.completedCount}/${complianceAfter.requiredTotal}`
    )
  } finally {
    await prisma.hrReturnEvent.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrSignedRecord.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { version: { hrDocument: { organizationId: org.id } } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeStaffAssignment.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.storeUserAssignment.deleteMany({ where: { user: { organizationId: org.id } } })
    await prisma.user.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── 8. Fixture removal (re-queried) ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "DOC-6-" } } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "DOC-6 " } } }),
      prisma.store.count({ where: { name: { startsWith: "ZZ DOC-6 " } } }),
      prisma.user.count({ where: { clerkUserId: { startsWith: "fixture-doc6-" } } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: { startsWith: "doc6-sig-" } } }),
      prisma.hrReturnEvent.count({ where: { recordedByName: "DOC-6 Manager" } }),
      prisma.hrDocumentAcknowledgment.count({ where: { documentTitle: { startsWith: "DOC-6 " } } }),
    ])
    check("all DOC-6 fixtures removed", leftovers.every((x) => x === 0), `residual counts ${leftovers.join(",")}`)
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
