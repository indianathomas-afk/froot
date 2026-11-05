/**
 * DEBT-125 — baseline squash of prisma/migrations (closes BUG-25).
 *
 *   npx tsx scripts/verify-debt125.ts
 *
 * Rulings: docs/DECISIONS.md 2026-11-05 DEBT-125 (R1–R4, DRAFT); audit
 * docs/prompts/DEBT-125_AUDIT.md.
 *
 * PURE: reads files only, no database. Every check is on the repo.
 *
 * WHAT THIS CAN DETECT:
 *   - prisma/migrations/ holds anything besides 0_init and migration_lock.toml
 *     (a folder moved back from the archive would re-run on top of 0_init).
 *   - The archive lost or gained a folder (86, first and last names pinned),
 *     or a folder without its migration.sql.
 *   - 0_init's CREATE TABLE count drifts from the schema's model count.
 *   - One of the 8 hand-written objects (R3) is missing, appears twice, or
 *     no longer matches its archived source verbatim.
 *   - One of the 20 BUG-25 tables is not created.
 *   - Either F6 column (receivedAt on PurchaseOrder / PurchaseOrderLine) is
 *     missing from 0_init.
 *   - 0_init was edited after its checksum was handed out. The INSERT that
 *     marks dev, staging and production carries this sha256; an edited file
 *     no longer matches the rows already written.
 *
 * WHAT IT CANNOT DETECT: whether 0_init actually builds a database (Phase 3 A,
 * Gary: deploy to an empty `squash_test`, then diff against the schema), and
 * whether `migrate deploy` accepts a marked branch with its old rows (Phase 3 B).
 */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..")
const MIGRATIONS = join(ROOT, "prisma/migrations")
const ARCHIVE = join(ROOT, "prisma/migrations_archive")
const INIT = join(MIGRATIONS, "0_init/migration.sql")

// sha256 of 0_init/migration.sql as committed. This is the checksum in the
// Neon-console INSERT (DEBT-125 R2). Never "fix" this pin by updating it: an
// edit to 0_init after a branch is marked breaks that branch's ledger row.
const INIT_SHA256 = "0e7d39aa0030e9c7adf485a92e7adc3f5038580a521b2ef707b9b6a752e4c717"

const ARCHIVE_COUNT = 86
const ARCHIVE_FIRST = "20260627002005_init"
const ARCHIVE_LAST = "20261104020000_tpl3_task_retired_at"

// The 8 objects `migrate diff` can't express, each with its archived source.
const PROTECTED: { name: string; source: string }[] = [
  { name: "LaborSettings_org_default_key", source: "20260720000000_labor0_positions_settings_forecast" },
  { name: "StoreStaffAssignment_one_primary_key", source: "20260729145504_build2_staff_one_primary_store" },
  { name: "HrDocumentStoreAssignment_staff_grant_key", source: "20260812171500_doc1a_document_audience_grants" },
  { name: "hrdoc_grant_shape", source: "20260812171500_doc1a_document_audience_grants" },
  { name: "hrdoc_link_shape", source: "20260824193000_doc3_document_links_and_instructions" },
  { name: "NotificationRecipientPick_one_target_check", source: "20261023200000_notify12_recipients" },
  { name: "LaborAssignment_minutes_check", source: "20261030200242_l4a_labor_assignment" },
  { name: "IngredientNutrition_basis_together", source: "20261102220000_n1d_proof_only_nutrition" },
]

// BUG-25: the 20 tables no archived migration ever created.
const BUG25_TABLES = [
  "TaskAttachment", "CatalogCategory", "CatalogItem", "CatalogItemVariation", "Vendor",
  "PurchaseOrder", "PurchaseOrderLine", "VendorIngredient", "SquareCategory", "SalesItem",
  "IngredientCategory", "Ingredient", "IngredientCostLog", "IngredientDuplicateDismissal",
  "IngredientStorageMapping", "InventoryCountCorrection", "SalesPeriodCache", "SalesLineCache",
  "SalesHourlyCache", "StoreMonthlyGoal",
]

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

// 1. prisma/migrations holds exactly 0_init + the lock file. Dotfiles
// (.DS_Store, git-ignored) are not migrations and Prisma skips them.
const live = readdirSync(MIGRATIONS).filter((d) => !d.startsWith(".")).sort()
check(
  "prisma/migrations holds exactly 0_init and migration_lock.toml",
  JSON.stringify(live) === JSON.stringify(["0_init", "migration_lock.toml"]),
  live.join(", "),
)
check("0_init/migration.sql exists", existsSync(INIT))

// 2. The archive holds all 86, each with its migration.sql.
const archived = readdirSync(ARCHIVE)
  .filter((d) => statSync(join(ARCHIVE, d)).isDirectory())
  .sort()
check(`archive holds ${ARCHIVE_COUNT} folders`, archived.length === ARCHIVE_COUNT, String(archived.length))
check("archive first folder", archived[0] === ARCHIVE_FIRST, archived[0])
check("archive last folder", archived[archived.length - 1] === ARCHIVE_LAST, archived[archived.length - 1])
const noSql = archived.filter((d) => !existsSync(join(ARCHIVE, d, "migration.sql")))
check("every archived folder has migration.sql", noSql.length === 0, noSql.join(", "))
check("archive README exists", existsSync(join(ARCHIVE, "README.md")))

// 3. CREATE TABLE count == model count.
const sql = readFileSync(INIT, "utf8")
const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const tables = [...sql.matchAll(/^CREATE TABLE "(\w+)" \(/gm)].map((m) => m[1])
// A model's table is its @@map name when it has one (HrDocumentGrant maps to
// "HrDocumentStoreAssignment"), otherwise the model name.
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(
  (m) => m[2].match(/@@map\("(\w+)"\)/)?.[1] ?? m[1],
)
check(`0_init CREATE TABLE count equals model count`, tables.length === models.length, `${tables.length} tables, ${models.length} models`)
const missingModels = models.filter((m) => !tables.includes(m))
check("every model's table (after @@map) has its CREATE TABLE", missingModels.length === 0, missingModels.join(", "))

// 4. The 8 protected objects: present once, verbatim from the archive.
const part2 = sql.slice(sql.indexOf("-- PART 2"))
check("0_init has a PART 2 (hand-written objects)", sql.includes("-- PART 2"))
for (const { name, source } of PROTECTED) {
  const stmt = part2.match(new RegExp(`^(?:CREATE UNIQUE INDEX|ALTER TABLE)[^;]*"${name}"[^;]*;`, "m"))?.[0]
  const count = sql.split(`"${name}"`).length - 1
  const archivedSql = readFileSync(join(ARCHIVE, source, "migration.sql"), "utf8")
  check(`${name}: present once`, Boolean(stmt) && count === 1, `${count} occurrence(s)`)
  check(`${name}: verbatim from ${source}`, Boolean(stmt) && archivedSql.includes(stmt!))
  check(`${name}: source comment names its migration`, part2.includes(`prisma/migrations_archive/${source}`))
}

// 5. All 20 BUG-25 tables created.
const missing25 = BUG25_TABLES.filter((t) => !tables.includes(t))
check("all 20 BUG-25 tables are created", BUG25_TABLES.length === 20 && missing25.length === 0, missing25.join(", "))

// 6. F6: the two columns staging was missing.
for (const t of ["PurchaseOrder", "PurchaseOrderLine"]) {
  const body = sql.match(new RegExp(`CREATE TABLE "${t}" \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? ""
  check(`${t}."receivedAt" TIMESTAMP(3), nullable`, /\n\s+"receivedAt" TIMESTAMP\(3\),/.test(body))
}

// 7. Checksum pin.
const sha = createHash("sha256").update(readFileSync(INIT)).digest("hex")
check("0_init sha256 matches the marking INSERT's checksum", sha === INIT_SHA256, sha)

console.log(failures === 0 ? "\nALL CHECKS PASS" : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
