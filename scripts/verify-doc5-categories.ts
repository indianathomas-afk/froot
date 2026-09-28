/**
 * DOC-5 — document categories as a managed per-org entity, pinned.
 *
 *   npx tsx scripts/verify-doc5-categories.ts
 *
 * DEV ONLY. Refuses to run unless neon.branch_id is br-broad-wave-*.
 *
 * SIX CLAIMS (docs/prompts/DOC-5.md, Phase 2 item 5), each tested against the
 * SHIPPED code or SQL, never a re-typed copy:
 *
 *   1. SEED IDEMPOTENCY — the migration's own data block, read out of
 *      prisma/migrations/…_doc5_document_category_entity/migration.sql and
 *      replayed twice; plus ensureStarterDocumentCategories (the webhook seed)
 *      called repeatedly, including after a rename and a delete. The constant
 *      is also compared to the migration's VALUES list (they MUST MATCH).
 *   2. BACKFILL COMPLETENESS — a fixture org holding the five legacy strings
 *      plus one unknown string ends with ZERO null categoryId, each mapped to
 *      the right name, the unknown given its own gray row.
 *   3. RENAME — the displayed (joined) name changes; the legacy string does not.
 *   4. DELETE IN USE (F4) — the FK RESTRICT backstop refuses; the route's count
 *      covers archived rows and forms; reassign moves categoryId only, then
 *      delete succeeds.
 *   5. NON-ADMIN 403 — STRUCTURAL, like verify-perm8-grants.ts and
 *      verify-labor-schedule.ts: every write handler calls
 *      requireHrDocumentAccess({ admin: true }) before any prisma call, and that
 *      guard 403s any non-ADMIN role. Clerk's auth() cannot run outside a
 *      request, so this fixture CANNOT prove the HTTP response itself; the
 *      staging test plan's Tommy (STORE) step is that proof.
 *   6. CREATE WRITES THE LEGACY STRING (F3) — via categoryWriteFields, the one
 *      mapping both create routes call.
 *
 * WHERE IT WRITES. Claims 1–2 run inside an interactive transaction that is
 * ROLLED BACK, because the migration block is org-global: replaying it
 * committed would backfill any intentionally-uncategorized dev document. The
 * rest uses a throwaway org, deleted afterwards, removal asserted by re-query.
 */
import "dotenv/config"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../src/lib/prisma"
import {
  STARTER_DOCUMENT_CATEGORIES,
  categoryWriteFields,
  ensureStarterDocumentCategories,
  resolveDocumentCategoryId,
} from "../src/lib/document-categories"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const ROOT = join(__dirname, "..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

const migrationDir = readdirSync(join(ROOT, "prisma/migrations")).find((d) =>
  d.endsWith("_doc5_document_category_entity")
)!
const MIGRATION_SQL = read(`prisma/migrations/${migrationDir}/migration.sql`)

// The data block = everything after the DATA MIGRATION banner, split into its
// statements with comment lines removed. No statement contains a ';' inside a
// literal, which the count assertion below would catch if that ever changed.
function migrationDataStatements(): string[] {
  const block = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("-- DATA MIGRATION"))
  return block
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
}

class Rollback extends Error {}

const FILE = {
  fileUrl: "https://example.invalid/doc5.pdf",
  fileName: "doc5.pdf",
  contentType: "application/pdf",
  sizeBytes: 1000,
  uploadedByUserId: "fixture",
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

  // ── 1a. The constant MUST MATCH the migration's seed ─────────────────────
  console.log("── 1a. STARTER_DOCUMENT_CATEGORIES vs the migration's VALUES ──")
  const values = [...MIGRATION_SQL.matchAll(/\('([^']+)',\s*'([a-z]+)',\s*(\d+)\)/g)].map((m) => ({
    name: m[1],
    colorKey: m[2],
    sortOrder: Number(m[3]),
  }))
  check(
    "migration seed == constant (names, colours, sortOrder, order)",
    JSON.stringify(values) === JSON.stringify(STARTER_DOCUMENT_CATEGORIES),
    JSON.stringify(values)
  )
  check("Handbook is orange (F1)", STARTER_DOCUMENT_CATEGORIES[0]?.colorKey === "orange")

  // ── 1b + 2. Replay the migration data block, twice, then roll back ───────
  console.log("\n── 1b/2. Migration seed + backfill replayed (transaction, ROLLED BACK) ──")
  const statements = migrationDataStatements()
  check("data block has exactly 3 statements (seed, unknowns, backfill)", statements.length === 3, `${statements.length}`)

  const LEGACY = ["Handbook", "PayAgreement", "Policy", "HRManagement", "Other", "Food Safety Posters"]
  const EXPECT: Record<string, string> = {
    Handbook: "Handbook",
    PayAgreement: "Pay Agreement",
    Policy: "Policy",
    HRManagement: "HR Management",
    Other: "Other",
    "Food Safety Posters": "Food Safety Posters",
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        const org = await tx.organization.create({
          data: { clerkOrgId: `fixture-doc5-mig-${Date.now()}`, name: "ZZ DOC-5 Migration Fixture (rolled back)", activeModules: ["hr"] },
        })
        // One document per legacy string, plus an archived one and a form, all
        // with categoryId NULL — the pre-migration state.
        for (const c of LEGACY) {
          await tx.hrDocument.create({
            data: { organizationId: org.id, kind: "Reference", title: `DOC-5 ${c}`, category: c, versions: { create: { versionNumber: 1, isCurrent: true, fileHash: `doc5-${c}`, ...FILE } } },
          })
        }
        await tx.hrDocument.create({ data: { organizationId: org.id, kind: "Reference", title: "DOC-5 archived", category: "Policy", isActive: false } })
        await tx.hrDocument.create({ data: { organizationId: org.id, kind: "FillableForm", title: "DOC-5 form", category: "HRManagement" } })

        for (const sql of statements) await tx.$executeRawUnsafe(sql)
        const afterOne = await tx.hrDocumentCategory.findMany({ where: { organizationId: org.id }, orderBy: { sortOrder: "asc" } })
        for (const sql of statements) await tx.$executeRawUnsafe(sql)
        const afterTwo = await tx.hrDocumentCategory.findMany({ where: { organizationId: org.id }, orderBy: { sortOrder: "asc" } })

        check("seeded 5 starters + 1 unknown = 6 rows", afterOne.length === 6, afterOne.map((c) => `${c.name}:${c.colorKey}:${c.sortOrder}`).join(", "))
        check(
          "unknown string got its own gray row, sorted after the five",
          afterOne.some((c) => c.name === "Food Safety Posters" && c.colorKey === "gray" && c.sortOrder === 5)
        )
        check("replay is idempotent — same rows, same ids", JSON.stringify(afterOne.map((c) => c.id)) === JSON.stringify(afterTwo.map((c) => c.id)))

        const docs = await tx.hrDocument.findMany({ where: { organizationId: org.id }, include: { docCategory: true } })
        check("ZERO null categoryId after backfill (incl. archived + form)", docs.every((d) => d.categoryId !== null), `${docs.filter((d) => !d.categoryId).length} null of ${docs.length}`)
        const wrong = docs.filter((d) => d.docCategory?.name !== EXPECT[d.category])
        check("every legacy string mapped to the right name", wrong.length === 0, wrong.map((d) => `${d.category}→${d.docCategory?.name}`).join(", "))

        // An org that already has categories is NOT re-seeded (zero-count guard).
        const renamed = afterTwo.find((c) => c.name === "Other")!
        await tx.hrDocumentCategory.update({ where: { id: renamed.id }, data: { name: "Misc" } })
        await tx.$executeRawUnsafe(statements[0])
        const afterGuard = await tx.hrDocumentCategory.findMany({ where: { organizationId: org.id } })
        check("zero-count guard: a renamed starter is not re-added", !afterGuard.some((c) => c.name === "Other") && afterGuard.length === 6)

        throw new Rollback()
      },
      { timeout: 60_000 }
    )
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
  const leaked = await prisma.organization.count({ where: { name: "ZZ DOC-5 Migration Fixture (rolled back)" } })
  check("the replay was rolled back (fixture org absent)", leaked === 0)

  // ── Committed fixture org for claims 1c, 3, 4, 6 ─────────────────────────
  const org = await prisma.organization.create({
    data: { clerkOrgId: `fixture-doc5-${Math.random().toString(36).slice(2, 8)}`, name: "ZZ DOC-5 Fixture Org (safe to delete)", activeModules: ["hr"] },
  })
  console.log(`\nFixture org ${org.id}`)

  try {
    // ── 1c. The webhook seed ────────────────────────────────────────────────
    console.log("\n── 1c. ensureStarterDocumentCategories (the Clerk-webhook seed) ──")
    await ensureStarterDocumentCategories(org.id)
    await ensureStarterDocumentCategories(org.id)
    let cats = await prisma.hrDocumentCategory.findMany({ where: { organizationId: org.id }, orderBy: { sortOrder: "asc" } })
    check("two calls → exactly the five starters", cats.length === 5 && cats.map((c) => c.name).join("|") === STARTER_DOCUMENT_CATEGORIES.map((c) => c.name).join("|"))
    const byName = (n: string) => cats.find((c) => c.name === n)!

    // ── 6. Create writes the legacy string (F3) ─────────────────────────────
    console.log("\n── 6. Create writes the legacy string via categoryWriteFields (F3) ──")
    const policy = await resolveDocumentCategoryId(org.id, byName("Policy").id)
    check("resolve own category → row", typeof policy === "object" && policy?.name === "Policy")
    const policyFields = categoryWriteFields(policy as { id: string; name: string })
    check("chosen category → legacy string is its name", policyFields.category === "Policy" && policyFields.categoryId === byName("Policy").id)
    const noneFields = categoryWriteFields(null)
    check('uncategorized → legacy "Other", categoryId null', noneFields.category === "Other" && noneFields.categoryId === null)

    const docPolicy = await prisma.hrDocument.create({ data: { organizationId: org.id, kind: "Reference", title: "DOC-5 policy doc", ...policyFields } })
    const docNone = await prisma.hrDocument.create({ data: { organizationId: org.id, kind: "Reference", title: "DOC-5 no category", ...noneFields } })
    check("created row carries both columns", docPolicy.category === "Policy" && docPolicy.categoryId === byName("Policy").id && docNone.categoryId === null)

    const foreign = await prisma.hrDocumentCategory.findFirst({ where: { organizationId: { not: org.id } }, select: { id: true } })
    check("another org's category id → invalid", foreign ? (await resolveDocumentCategoryId(org.id, foreign.id)) === "invalid" : false)
    check("unknown id → invalid", (await resolveDocumentCategoryId(org.id, "nope")) === "invalid")
    check("absent → undefined, null → null", (await resolveDocumentCategoryId(org.id, undefined)) === undefined && (await resolveDocumentCategoryId(org.id, null)) === null)

    // ── 3. Rename ───────────────────────────────────────────────────────────
    console.log("\n── 3. Rename changes the displayed name, not the legacy string ──")
    // The same update PATCH /api/hr/documents/categories/[id] performs.
    await prisma.hrDocumentCategory.update({ where: { id: byName("Policy").id }, data: { name: "Policies" } })
    const afterRename = await prisma.hrDocument.findUnique({ where: { id: docPolicy.id }, include: { docCategory: true } })
    check("displayed name is the new one", afterRename?.docCategory?.name === "Policies")
    check("legacy string untouched", afterRename?.category === "Policy")
    const created = categoryWriteFields((await resolveDocumentCategoryId(org.id, byName("Policy").id)) as { id: string; name: string })
    check("a NEW create after rename writes the new name", created.category === "Policies")

    // The webhook seed does not resurrect a renamed or deleted starter.
    await prisma.hrDocumentCategory.delete({ where: { id: byName("Other").id } })
    await ensureStarterDocumentCategories(org.id)
    cats = await prisma.hrDocumentCategory.findMany({ where: { organizationId: org.id } })
    check("re-seed after rename + delete adds nothing back", cats.length === 4 && !cats.some((c) => c.name === "Policy" || c.name === "Other"))

    // ── 4. Delete in use (F4) ───────────────────────────────────────────────
    console.log("\n── 4. Delete while in use (F4 — HR-20's block + reassign) ──")
    const handbook = cats.find((c) => c.name === "Handbook")!
    const hr = cats.find((c) => c.name === "HR Management")!
    await prisma.hrDocument.create({ data: { organizationId: org.id, kind: "Reference", title: "DOC-5 archived handbook", category: "Handbook", categoryId: handbook.id, isActive: false } })
    await prisma.hrDocument.create({ data: { organizationId: org.id, kind: "FillableForm", title: "DOC-5 form on handbook", category: "Handbook", categoryId: handbook.id } })
    // The DELETE route's own count query — no isActive, no kind filter.
    const inUse = await prisma.hrDocument.count({ where: { categoryId: handbook.id, organizationId: org.id } })
    check("in-use count covers the archived doc AND the form", inUse === 2, `${inUse}`)
    const delRoute = read("src/app/api/hr/documents/categories/[id]/route.ts")
    check(
      "DELETE route counts with no isActive/kind filter and 409s",
      /hrDocument\.count\(\{\s*where: \{ categoryId: id, organizationId: access\.org\.id \},?\s*\}\)/.test(delRoute) && /status: 409/.test(delRoute)
    )
    let restricted = false
    try {
      await prisma.hrDocumentCategory.delete({ where: { id: handbook.id } })
    } catch {
      restricted = true
    }
    check("FK ON DELETE RESTRICT refuses the in-use delete (backstop)", restricted)

    // The reassign route's own write.
    const moved = await prisma.hrDocument.updateMany({ where: { categoryId: handbook.id, organizationId: org.id }, data: { categoryId: hr.id } })
    check("reassign moved both rows", moved.count === 2)
    const legacyAfter = await prisma.hrDocument.findMany({ where: { organizationId: org.id, categoryId: hr.id }, select: { category: true } })
    check("reassign left the legacy strings alone", legacyAfter.every((d) => d.category === "Handbook"))
    await prisma.hrDocumentCategory.delete({ where: { id: handbook.id } })
    check("delete succeeds once empty", (await prisma.hrDocumentCategory.count({ where: { id: handbook.id } })) === 0)

    // ── 5. Non-ADMIN 403 — structural ───────────────────────────────────────
    console.log("\n── 5. Every write route is ADMIN-guarded (structural; HTTP proof is staging) ──")
    const guard = read("src/app/api/hr/documents/access.ts")
    check(
      "requireHrDocumentAccess({admin:true}) 403s any role but ADMIN",
      /if \(admin && viewer\.dbUser\?\.role !== "ADMIN"\) \{\s*return fail\("Admin access required", 403\)/.test(guard)
    )
    const WRITE_ROUTES: [string, string[]][] = [
      ["src/app/api/hr/documents/categories/route.ts", ["GET", "POST"]],
      ["src/app/api/hr/documents/categories/[id]/route.ts", ["PATCH", "DELETE"]],
      ["src/app/api/hr/documents/categories/[id]/reassign/route.ts", ["POST"]],
      ["src/app/api/hr/documents/route.ts", ["POST"]],
      ["src/app/api/hr/documents/[id]/route.ts", ["PATCH"]],
      ["src/app/api/hr/forms/route.ts", ["POST"]],
      ["src/app/api/hr/forms/[id]/route.ts", ["PATCH"]],
    ]
    for (const [file, methods] of WRITE_ROUTES) {
      const src = read(file)
      for (const m of methods) {
        const start = src.indexOf(`export async function ${m}(`)
        const next = src.indexOf("export async function", start + 1)
        const body = src.slice(start, next === -1 ? undefined : next)
        const g = body.indexOf("requireHrDocumentAccess({ admin: true })")
        const p = body.search(/prisma\.|resolveDocumentCategoryId|createFillableForm/)
        check(`${m} ${file.replace("src/app/api/", "")} guards before any DB access`, start >= 0 && g >= 0 && (p === -1 || g < p))
      }
    }
    const client = read("src/app/(app)/hr/documents/documents-client.tsx")
    check("Manage Categories button + dialog render only for ADMIN", /\{isAdmin && \(\s*<div[^]*?Manage Categories/.test(client) && /\{isAdmin && \(\s*<DocumentCategoryManagerDialog/.test(client))

    // F3 structural: the edit paths cannot write the legacy column.
    const patchSrc = read("src/app/api/hr/documents/[id]/route.ts") + read("src/app/api/hr/forms/[id]/route.ts")
    check("PATCH schemas no longer accept `category`", !/\bcategory: z\./.test(patchSrc))
  } finally {
    await prisma.hrDocumentVersion.deleteMany({ where: { hrDocument: { organizationId: org.id } } })
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } })
    await prisma.hrDocumentCategory.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })

    console.log("\n── Fixture removal ──")
    const leftovers = await Promise.all([
      prisma.organization.count({ where: { id: org.id } }),
      prisma.hrDocument.count({ where: { organizationId: org.id } }),
      prisma.hrDocumentCategory.count({ where: { organizationId: org.id } }),
      prisma.hrDocument.count({ where: { title: { startsWith: "DOC-5 " } } }),
    ])
    check("all DOC-5 fixtures removed", leftovers.every((n) => n === 0), `residual counts ${leftovers.join(",")}`)
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
