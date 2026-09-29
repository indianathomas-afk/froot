/**
 * SIGNED-1 — /hr/signed-records filters, sort and cursor paging, pinned.
 *
 *   npx tsx scripts/verify-signed1-filters.ts
 *
 * DEV ONLY. Refuses to run unless neon.branch_id is br-broad-wave-*.
 *
 * Tests the SHIPPED loader (src/lib/hr-signed-records-list.ts) — the same
 * functions the page's first load and GET /api/hr/signed-records call — against
 * a throwaway org holding more than 50 records across two categories, an
 * archived document, an uncategorized document, a terminated signer and
 * deliberate completedAt ties. Ground truth for every check is a direct prisma
 * query on the fixture rows, never the loader itself.
 *
 * The org is deleted afterwards and its removal asserted by re-query.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import {
  SIGNED_RECORDS_PAGE_SIZE,
  UNCATEGORIZED_FILTER,
  filteredTotal,
  loadSignedRecordFacets,
  loadSignedRecordsPage,
  parseSignedRecordFilters,
  signedRecordWhere,
  type SignedRecordFilters,
  type SignedRecordRow,
} from "../src/lib/hr-signed-records-list"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const FILE = {
  fileUrl: "https://example.invalid/signed1.pdf",
  fileName: "signed1.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  fileHash: "signed1",
  uploadedByUserId: "fixture",
}

type Org = { id: string; timezone: string }

// Walk every page for a filter the way "Load more" does.
async function walk(org: Org, filters: SignedRecordFilters) {
  const pages: SignedRecordRow[][] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 20; guard++) {
    const page = await loadSignedRecordsPage(org, filters, cursor)
    pages.push(page.rows)
    cursor = page.nextCursor
    if (!cursor) break
  }
  return { pages, rows: pages.flat() }
}

function isOrdered(rows: SignedRecordRow[], dir: "asc" | "desc") {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]
    const b = rows[i]
    const cmp = a.completedAtIso < b.completedAtIso ? -1 : a.completedAtIso > b.completedAtIso ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (dir === "asc" ? cmp >= 0 : cmp <= 0) return false
  }
  return true
}

async function main() {
  const [b] = await prisma.$queryRawUnsafe<{ branch: string | null; db: string }[]>(
    `select current_setting('neon.branch_id', true) as branch, current_database()::text as db`
  )
  // CLAUDE.md § Database Evidence: the branch travels with the result.
  console.log(`BRANCH ${b?.branch ?? "(null)"} / ${b?.db}\n`)
  if (!b?.branch?.startsWith("br-broad-wave")) {
    console.log("✗ REFUSING: not the dev branch (br-broad-wave). Nothing was written.")
    process.exitCode = 1
    return
  }

  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `fixture-signed1-${Math.random().toString(36).slice(2, 8)}`,
      name: "ZZ SIGNED-1 Fixture Org (safe to delete)",
      activeModules: ["hr"],
    },
  })
  console.log(`Fixture org ${org.id}`)

  try {
    // ── Fixture ────────────────────────────────────────────────────────────
    const [catA, catB] = await Promise.all([
      prisma.hrDocumentCategory.create({ data: { organizationId: org.id, name: "SIGNED-1 Handbook", colorKey: "orange", sortOrder: 0 } }),
      prisma.hrDocumentCategory.create({ data: { organizationId: org.id, name: "SIGNED-1 Logs", colorKey: "gray", sortOrder: 1 } }),
    ])
    const mkDoc = (title: string, categoryId: string | null, isActive = true) =>
      prisma.hrDocument.create({
        data: { organizationId: org.id, kind: "Acknowledgment", title, category: "Other", categoryId, isActive },
      })
    const docA1 = await mkDoc("SIGNED-1 Handbook", catA.id)
    const docA2 = await mkDoc("SIGNED-1 Old Handbook", catA.id, false) // archived
    const docB = await mkDoc("SIGNED-1 Key Agreement", catB.id)
    const docU = await mkDoc("SIGNED-1 Loose Form", null)
    const mkVer = (hrDocumentId: string, versionNumber: number) =>
      prisma.hrDocumentVersion.create({ data: { hrDocumentId, versionNumber, ...FILE } })
    const vA1a = await mkVer(docA1.id, 1)
    const vA1b = await mkVer(docA1.id, 2)
    const vA2 = await mkVer(docA2.id, 1)
    const vB = await mkVer(docB.id, 1)
    const vU = await mkVer(docU.id, 1)

    const staff = await Promise.all(
      Array.from({ length: 45 }, (_, i) =>
        prisma.staffMember.create({
          data: {
            organizationId: org.id,
            displayName: `SIGNED-1 Staff ${String(i).padStart(2, "0")}`,
            ...(i === 0 ? { status: "TERMINATED", terminatedAt: new Date("2026-09-01T00:00:00Z") } : {}),
          },
        })
      )
    )
    const terminated = staff[0]

    // 40 + 20 + 5 = 65 in category A (> one page), 30 in B, 7 uncategorized.
    const plan: [string, number][] = [[vA1a.id, 40], [vA1b.id, 20], [vA2.id, 5], [vB.id, 30], [vU.id, 7]]
    const base = Date.parse("2026-01-01T12:00:00Z")
    let n = 0
    const data: { hrDocumentVersionId: string; staffMemberId: string; completedAt: Date; signedPdfPathname: string; signedPdfHash: string }[] = []
    for (const [versionId, count] of plan) {
      for (let i = 0; i < count; i++) {
        // Every third record shares its predecessor's millisecond: the id
        // tie-break is what keeps those pages from overlapping or skipping.
        const minute = n % 3 === 2 ? n - 1 : n
        data.push({
          hrDocumentVersionId: versionId,
          staffMemberId: staff[i % staff.length].id,
          completedAt: new Date(base + minute * 60_000),
          signedPdfPathname: `hr/${org.id}/signed1-${n}.pdf`,
          signedPdfHash: `signed1${String(n).padStart(4, "0")}`,
        })
        n++
      }
    }
    // vA1a has 40 records over 45 staff; nothing repeats a (version, staff) pair.
    await prisma.hrSignedRecord.createMany({ data })
    const ties = new Set(data.map((d) => d.completedAt.getTime())).size
    console.log(`Fixture: ${data.length} records, ${data.length - ties} same-millisecond ties\n`)

    const truth = async (f: Pick<SignedRecordFilters, "category" | "document">) =>
      prisma.hrSignedRecord.findMany({ where: signedRecordWhere(org.id, f), select: { id: true } })

    // ── 1. Volume ──────────────────────────────────────────────────────────
    console.log("── 1. More than 50 records across two categories ──")
    const all = await truth({ category: null, document: null })
    const inA = await truth({ category: catA.id, document: null })
    const inB = await truth({ category: catB.id, document: null })
    check("org holds > 50 records", all.length > SIGNED_RECORDS_PAGE_SIZE, `${all.length}`)
    check("category A alone exceeds one page", inA.length > SIGNED_RECORDS_PAGE_SIZE, `${inA.length}`)
    check("category B has records too", inB.length === 30, `${inB.length}`)

    // ── 2. Category filter, across pages ───────────────────────────────────
    console.log("\n── 2. Category filter returns only matches, past the first 50 ──")
    for (const sort of ["newest", "oldest"] as const) {
      const { pages, rows } = await walk(org, { category: catA.id, document: null, sort })
      const ids = rows.map((r) => r.id)
      check(`[${sort}] pages are 50 then 15`, pages.map((p) => p.length).join(",") === "50,15", pages.map((p) => p.length).join(","))
      check(`[${sort}] no duplicate across pages`, new Set(ids).size === ids.length)
      check(`[${sort}] exactly the category-A records (none skipped)`, ids.length === inA.length && inA.every((r) => ids.includes(r.id)))
      check(`[${sort}] every row carries category A's badge`, rows.every((r) => r.categoryName === catA.name && r.categoryColorKey === "orange"))
      check(`[${sort}] page 2 reaches records beyond the first 50`, pages[1].length > 0 && pages[1].every((r) => !pages[0].some((p) => p.id === r.id)))
    }
    const bRows = (await walk(org, { category: catB.id, document: null, sort: "newest" })).rows
    check("category B: only B records", bRows.length === 30 && bRows.every((r) => r.categoryName === catB.name))

    // ── 3. Sort order + cursor seams ───────────────────────────────────────
    console.log("\n── 3. Newest / oldest order and cursor seams ──")
    const desc = (await walk(org, { category: null, document: null, sort: "newest" })).rows
    const asc = (await walk(org, { category: null, document: null, sort: "oldest" })).rows
    check("newest: strictly descending by (completedAt, id)", isOrdered(desc, "desc"))
    check("oldest: strictly ascending by (completedAt, id)", isOrdered(asc, "asc"))
    check("oldest is exactly newest reversed", asc.map((r) => r.id).join() === [...desc].reverse().map((r) => r.id).join())
    check("full walk covers every record once", desc.length === all.length && new Set(desc.map((r) => r.id)).size === all.length)
    const earliest = await prisma.hrSignedRecord.findFirst({
      where: signedRecordWhere(org.id, { category: null, document: null }),
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    })
    check("oldest first row is the earliest signature", asc[0]?.id === earliest?.id)

    // ── 4. Uncategorized ───────────────────────────────────────────────────
    console.log("\n── 4. Uncategorized ──")
    const unc = (await walk(org, { category: UNCATEGORIZED_FILTER, document: null, sort: "newest" })).rows
    check("uncategorized returns the 7 null-category records", unc.length === 7 && unc.every((r) => r.categoryName === null && r.documentTitle === docU.title))
    check('"uncategorized" parses from the query string', parseSignedRecordFilters({ category: "uncategorized" }).category === UNCATEGORIZED_FILTER)

    // ── 5. Archived document + terminated signer ───────────────────────────
    console.log("\n── 5. Records never disappear ──")
    const archived = (await walk(org, { category: null, document: docA2.id, sort: "newest" })).rows
    check("archived document's records filter by document", archived.length === 5)
    check("archived document's records stay in its category", archived.every((r) => r.categoryName === catA.name))
    const facets = await loadSignedRecordFacets(org.id)
    const archOpt = facets.documents.find((d) => d.id === docA2.id)
    check("document select lists the archived document, marked inactive", archOpt?.isActive === false && archOpt.count === 5)
    const termCount = await prisma.hrSignedRecord.count({ where: { staffMemberId: terminated.id } })
    check("terminated signer's records are all listed", termCount > 0 && desc.filter((r) => r.staffMemberId === terminated.id).length === termCount, `${termCount}`)

    // ── 6. Counts ──────────────────────────────────────────────────────────
    console.log("\n── 6. Server counts match the filtered totals ──")
    check("facets.total = all records", facets.total === all.length)
    check("chip count A = filtered total", facets.categoryCounts[catA.id] === inA.length)
    check("chip count B = filtered total", facets.categoryCounts[catB.id] === inB.length)
    check("chip count Uncategorized = filtered total", facets.categoryCounts[UNCATEGORIZED_FILTER] === 7)
    const cases: Pick<SignedRecordFilters, "category" | "document">[] = [
      { category: null, document: null },
      { category: catA.id, document: null },
      { category: catA.id, document: docA1.id },
      { category: null, document: docA1.id },
      { category: UNCATEGORIZED_FILTER, document: null },
      { category: catB.id, document: docA1.id }, // mismatch → 0
    ]
    for (const c of cases) {
      const expected = await prisma.hrSignedRecord.count({ where: signedRecordWhere(org.id, c) })
      const got = filteredTotal(facets, { ...c, sort: "newest" })
      check(`header total for ${JSON.stringify(c)}`, got === expected, `${got} vs ${expected}`)
    }
    check("document spanning two versions counts both", facets.documents.find((d) => d.id === docA1.id)?.count === 60)

    // ── 7. Cursor hygiene ──────────────────────────────────────────────────
    console.log("\n── 7. A cursor from another filter seeds nothing ──")
    const bFirst = await loadSignedRecordsPage(org, { category: catB.id, document: null, sort: "newest" })
    const crossed = await loadSignedRecordsPage(org, { category: catA.id, document: null, sort: "newest" }, bFirst.rows[0].id)
    check("B's row as a cursor under filter A → empty page", crossed.rows.length === 0 && crossed.nextCursor === null)
  } finally {
    await prisma.hrSignedRecord.deleteMany({ where: { staffMember: { organizationId: org.id } } })
    await prisma.hrDocumentVersion.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrDocumentCategory.deleteMany({ where: { organizationId: org.id } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── Fixture removal ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.hrSignedRecord.count({ where: { signedPdfHash: { startsWith: "signed1" } } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "SIGNED-1 " } } }),
      prisma.hrDocumentCategory.count({ where: { organizationId: org.id } }),
      prisma.staffMember.count({ where: { displayName: { startsWith: "SIGNED-1 " } } }),
    ])
    check("all SIGNED-1 fixtures removed", leftovers.every((x) => x === 0), `residual counts ${leftovers.join(",")}`)
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`)
  if (failures > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
