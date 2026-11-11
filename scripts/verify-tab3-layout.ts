/**
 * TAB-3 — the Display settings layout: merge, validation, packing, pinned.
 *
 *   npx tsx scripts/verify-tab3-layout.ts
 *
 * PURE, in the verify-tab1-today.ts style. Everything here is
 * src/lib/display-layout.ts — the same functions the /settings/display page,
 * PUT /api/display/settings, the desktop dashboard and the tablet strip call —
 * so a failure is about the rule and not about whatever an org row holds.
 *
 * WHAT THIS CAN DETECT:
 *   - A NULL LAYOUT RENDERING DIFFERENTLY FROM TODAY. The default order, packed,
 *     must reproduce today's rows (dashboard-client.tsx at 1487091) exactly,
 *     with and without the labor pair. Cases 1–3.
 *   - A saved reorder or a disable lost on read. Cases 4–5.
 *   - An unknown key surviving the merge. Case 6.
 *   - A card added to Froot after a layout was saved landing anywhere but its
 *     default position, or in anything but its default state. Cases 7–8.
 *   - A LOCKED TABLET COLUMN switched off or moved by saved data. Case 9.
 *   - The strip's tiles out of the saved order, or the strip present with no
 *     tile on. Cases 10–11.
 *   - THE SAVE ROUTE ACCEPTING: zero desktop cards on (12), only
 *     module-gated cards on — F6 as refined by Gary, e.g. only Inventory count
 *     (12b; 12c is the accepted counterpart), a locked tablet
 *     column off (13), an unknown key (14), a partial or duplicated list
 *     (15–16), or a non-ADMIN (17). A valid save is stored normalised (18), and
 *     null is the reset (19).
 *   - Packing a reordered layout: no row over capacity, full-width cards alone.
 *     Case 20.
 *
 *   - PART 7, AGAINST THE APPLIED SCHEMA (dev), inside a transaction that is
 *     ALWAYS rolled back: the two new columns exist, hold a layout, read back
 *     through resolveLayout(), store Prisma.DbNull as SQL NULL for a reset, and
 *     the migration file only ADDS. Cases 21–26. This part is why the fixture
 *     cannot pass until Gary has applied 20261110200000_tab3_display_layouts
 *     to dev — which is the gate (CLAUDE.md § A migration STOPS the session).
 *     The branch is printed from `neon.branch_id`, never typed.
 *
 * WHAT IT CANNOT DETECT: per-viewer gates. Whether Tommy sees a tile is the
 * payload of GET /api/dashboard/summary (labor absent without
 * labor.actuals.view), which this fixture never calls — that is staging
 * test 5. Nor the route's HTTP shape or the pages' rendering: staging tests
 * 2–4 and 6.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { Prisma } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import {
  ANCHOR_KEYS,
  ANCHOR_REQUIRED_ERROR,
  canEditDisplayLayout,
  dashboardSpan,
  defaultLayout,
  enabledKeys,
  packRows,
  resolveLayout,
  stripTileKeys,
  validateLayout,
  type LayoutEntry,
} from "../src/lib/display-layout"

let failures = 0
let total = 0

function check(label: string, actual: unknown, expected: unknown) {
  total++
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

const LABOR = new Set(["labor-coverage", "labor-budget"])
const pack = (keys: string[]) => packRows(keys, dashboardSpan)
const flip = (l: LayoutEntry[], key: string, enabled: boolean) => l.map((e) => (e.key === key ? { ...e, enabled } : e))

console.log("\n1 · Null means today")
check(
  "1. null dashboard layout → every card, today's order, all on",
  resolveLayout("dashboard", null),
  [
    "sales-performance", "monthly-goal", "labor-coverage", "labor-budget", "team-messages",
    "corporate-update", "shift-checklist", "instagram", "inventory-count",
  ].map((key) => ({ key, enabled: true }))
)
check(
  "2. null, packed, labor on → today's five blocks",
  pack(enabledKeys("dashboard", null)),
  [
    { kind: "row", keys: ["sales-performance", "monthly-goal"] },
    { kind: "row", keys: ["labor-coverage", "labor-budget"] },
    { kind: "row", keys: ["team-messages", "corporate-update", "shift-checklist"] },
    { kind: "full", key: "instagram" },
    { kind: "full", key: "inventory-count" },
  ]
)
check(
  "3. null, packed, labor module off → the labor row is simply absent",
  pack(enabledKeys("dashboard", null).filter((k) => !LABOR.has(k))),
  [
    { kind: "row", keys: ["sales-performance", "monthly-goal"] },
    { kind: "row", keys: ["team-messages", "corporate-update", "shift-checklist"] },
    { kind: "full", key: "instagram" },
    { kind: "full", key: "inventory-count" },
  ]
)

console.log("\n2 · Saved layouts are read back")
const reordered = defaultLayout("dashboard")
// Move Team messages up two places (staging test 3): above Labor budget and Labor coverage.
const tm = reordered.splice(4, 1)[0]
reordered.splice(2, 0, tm)
check("4. reorder survives the merge", resolveLayout("dashboard", reordered).map((e) => e.key), reordered.map((e) => e.key))
const disabled = flip(defaultLayout("dashboard"), "instagram", false)
check(
  "5. disable survives the merge, and drops out of the enabled keys",
  [resolveLayout("dashboard", disabled).find((e) => e.key === "instagram"), enabledKeys("dashboard", disabled).includes("instagram")],
  [{ key: "instagram", enabled: false }, false]
)
check(
  "6. unknown key, duplicate and junk entries are dropped",
  resolveLayout("dashboard", [{ key: "retired-card", enabled: true }, { key: "monthly-goal", enabled: false }, { key: "monthly-goal", enabled: true }, "junk", null, { key: "sales-performance", enabled: true }, ...defaultLayout("dashboard").slice(2)]).map((e) => `${e.key}:${e.enabled}`).slice(0, 3),
  ["monthly-goal:false", "sales-performance:true", "labor-coverage:true"]
)

console.log("\n3 · Cards Froot adds later")
// A layout saved before labor-budget and inventory-count existed, reordered and with a card off.
const old = [
  { key: "team-messages", enabled: true },
  { key: "sales-performance", enabled: true },
  { key: "monthly-goal", enabled: false },
  { key: "labor-coverage", enabled: true },
  { key: "corporate-update", enabled: true },
  { key: "shift-checklist", enabled: true },
  { key: "instagram", enabled: true },
]
check(
  "7. a missing key lands right after its default predecessor, in its default state",
  resolveLayout("dashboard", old).map((e) => `${e.key}:${e.enabled}`),
  [
    "team-messages:true", "sales-performance:true", "monthly-goal:false", "labor-coverage:true",
    "labor-budget:true", "corporate-update:true", "shift-checklist:true", "instagram:true", "inventory-count:true",
  ]
)
check(
  "8. a missing tablet tile comes back OFF (its default), at its default place",
  resolveLayout("tablet", [{ key: "labor-pct", enabled: true }, { key: "sales", enabled: true }]).map((e) => `${e.key}:${e.enabled}`),
  ["tasks:true", "messages:true", "labor-pct:true", "sales:true", "monthly-goal:false"]
)

console.log("\n4 · Tablet: locked columns and the strip")
check(
  "9. locked keys are forced on and pinned to the front, Tasks left",
  resolveLayout("tablet", [
    { key: "sales", enabled: true },
    { key: "messages", enabled: false },
    { key: "monthly-goal", enabled: false },
    { key: "labor-pct", enabled: false },
    { key: "tasks", enabled: false },
  ]).map((e) => `${e.key}:${e.enabled}`),
  ["tasks:true", "messages:true", "sales:true", "monthly-goal:false", "labor-pct:false"]
)
check("10. null tablet layout → no strip tiles at all", stripTileKeys(null), [])
check(
  "11. Labor % first then Sales (staging test 4) → strip in that order, Goal off",
  stripTileKeys([
    { key: "tasks", enabled: true },
    { key: "messages", enabled: true },
    { key: "labor-pct", enabled: true },
    { key: "sales", enabled: true },
    { key: "monthly-goal", enabled: false },
  ]),
  ["labor-pct", "sales"]
)

console.log("\n5 · The save route's validation")
const allOff = defaultLayout("dashboard").map((e) => ({ ...e, enabled: false }))
check("12. zero desktop cards on → refused", validateLayout("dashboard", allOff), { ok: false, error: ANCHOR_REQUIRED_ERROR })
// F6 as refined by Gary (2026-11-10): only cards that are never module-gated count.
const only = (key: string) => defaultLayout("dashboard").map((e) => ({ ...e, enabled: e.key === key }))
check(
  "12b. only Inventory count on (module-gated) → refused; so are Labor coverage, Instagram, Corporate update alone",
  ["inventory-count", "labor-coverage", "labor-budget", "instagram", "corporate-update"].map((k) => validateLayout("dashboard", only(k)).ok),
  [false, false, false, false, false]
)
check(
  "12c. any ONE of the four never-gated cards on → accepted",
  [ANCHOR_KEYS, ["sales-performance", "monthly-goal", "team-messages", "shift-checklist"].map((k) => validateLayout("dashboard", only(k)).ok)],
  [["sales-performance", "monthly-goal", "team-messages", "shift-checklist"], [true, true, true, true]]
)
check(
  "13. Messages off on Tablet → refused",
  validateLayout("tablet", flip(defaultLayout("tablet"), "messages", false)),
  { ok: false, error: "Messages is always on in Tablet mode." }
)
check(
  "14. an unknown key → refused (the merge would drop it; the route says so)",
  validateLayout("dashboard", [...defaultLayout("dashboard"), { key: "retired-card", enabled: true }]),
  { ok: false, error: "Unknown card: retired-card" }
)
check(
  "15. a partial list → refused",
  validateLayout("dashboard", defaultLayout("dashboard").slice(1)),
  { ok: false, error: "The layout must list every card exactly once." }
)
check(
  "16. a duplicated key → refused",
  validateLayout("dashboard", [...defaultLayout("dashboard"), { key: "instagram", enabled: false }]),
  { ok: false, error: "Card listed twice: instagram" }
)
check(
  "17. only ADMIN may save (MANAGER, STORE, STAFF, none refused)",
  ["ADMIN", "MANAGER", "STORE", "STAFF", undefined, null].map((r) => canEditDisplayLayout(r)),
  [true, false, false, false, false, false]
)
check(
  "18. a valid tablet save is stored normalised (locked keys pinned first)",
  validateLayout("tablet", [
    { key: "labor-pct", enabled: true },
    { key: "tasks", enabled: true },
    { key: "sales", enabled: true },
    { key: "messages", enabled: true },
    { key: "monthly-goal", enabled: false },
  ]),
  {
    ok: true,
    layout: [
      { key: "tasks", enabled: true },
      { key: "messages", enabled: true },
      { key: "labor-pct", enabled: true },
      { key: "sales", enabled: true },
      { key: "monthly-goal", enabled: false },
    ],
  }
)
check("19. null is the reset, and is accepted", validateLayout("dashboard", null), { ok: true, layout: null })

console.log("\n6 · Packing a reordered layout")
const mixed = ["monthly-goal", "instagram", "team-messages", "sales-performance", "labor-budget", "labor-coverage", "shift-checklist"]
check(
  "20. greedy rows of 3, full-width cards alone, nothing over capacity",
  pack(mixed),
  [
    { kind: "row", keys: ["monthly-goal"] },
    { kind: "full", key: "instagram" },
    { kind: "row", keys: ["team-messages", "sales-performance"] },
    { kind: "row", keys: ["labor-budget", "labor-coverage"] },
    { kind: "row", keys: ["shift-checklist"] },
  ]
)

// ─── 7. Against the applied schema (dev), rolled back ─────────────────────────
console.log("\n7 · Against the applied schema (rolled back)")
const sql = readFileSync("prisma/migrations/20261110200000_tab3_display_layouts/migration.sql", "utf8")
check(
  "21. the migration only ADDS two nullable JSONB columns (no DROP, no NOT NULL, no default)",
  [/\bDROP\b/i.test(sql), /NOT NULL/i.test(sql), /DEFAULT/i.test(sql), (sql.match(/ADD COLUMN/g) ?? []).length, /"dashboardLayout" JSONB/.test(sql), /"tabletLayout" JSONB/.test(sql)],
  [false, false, false, 2, true, true]
)

class Rollback extends Error {}
async function dbPart() {
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`  (database part on neon.branch_id = ${branch ?? "null"})`)
  try {
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { clerkOrgId: `tab3-fixture-${Date.now()}`, name: "TAB-3 Fixture Org" } })
      const fresh = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { dashboardLayout: true, tabletLayout: true } })
      check("22. a new org has both layouts NULL — today's defaults", [fresh.dashboardLayout, fresh.tabletLayout, resolveLayout("dashboard", fresh.dashboardLayout)], [null, null, defaultLayout("dashboard")])

      const dash = validateLayout("dashboard", disabled)
      const tab = validateLayout("tablet", [
        { key: "tasks", enabled: true },
        { key: "messages", enabled: true },
        { key: "labor-pct", enabled: true },
        { key: "sales", enabled: true },
        { key: "monthly-goal", enabled: false },
      ])
      if (!dash.ok || !tab.ok || !dash.layout || !tab.layout) throw new Error("validateLayout refused a valid fixture layout")
      await tx.organization.update({
        where: { id: org.id },
        data: { dashboardLayout: dash.layout as Prisma.InputJsonValue, tabletLayout: tab.layout as Prisma.InputJsonValue },
      })
      const saved = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { dashboardLayout: true, tabletLayout: true } })
      check("23. a saved dashboard layout reads back unchanged through resolveLayout", resolveLayout("dashboard", saved.dashboardLayout), dash.layout)
      check("24. a saved tablet layout gives the strip Labor %, then Sales", stripTileKeys(saved.tabletLayout), ["labor-pct", "sales"])

      await tx.organization.update({ where: { id: org.id }, data: { tabletLayout: Prisma.DbNull } })
      const reset = await tx.organization.findUniqueOrThrow({ where: { id: org.id }, select: { dashboardLayout: true, tabletLayout: true } })
      check("25. reset stores SQL NULL on that column only (the other tab untouched)", [reset.tabletLayout, stripTileKeys(reset.tabletLayout), reset.dashboardLayout !== null], [null, [], true])
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  const leaked = await prisma.organization.count({ where: { name: "TAB-3 Fixture Org" } })
  check("26. rolled back: no fixture org left behind", leaked, 0)
}

dbPart()
  .catch((e) => {
    failures++
    total++
    console.log(`  ✗ 7. database part threw: ${e instanceof Error ? e.message : e}`)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? `\n✓ ALL PASS (${total}/${total})\n` : `\n✗ ${failures} of ${total} CHECK(S) FAILED\n`)
    process.exit(failures === 0 ? 0 : 1)
  })
