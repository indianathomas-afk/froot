// HELP-1a evidence. Route-level assertions against the real helpScope(), not
// claims in prose and not observations in a browser.
//
// Modelled on scripts/verify-nav1-url-sets.ts: build scenarios, run the REAL
// policy against them, print the sets, and exit non-zero when an assertion
// fails. It calls can() through helpScope() exactly as the routes do — there is
// no second implementation of the policy here, which is the whole point of the
// helper this script is checking.
//
// WHAT THIS PROVES: what a given actor may see. WHAT IT DOES NOT PROVE:
// anything about browser rendering, and anything about the image route (which
// needs a Blob store and is covered separately). A green run here is evidence
// about the policy, not about the pixels.

import { helpScope, searchIndex, type GuideArticle } from "../src/lib/help-access"
import { GUIDE_ARTICLES } from "../src/generated/guide"
import type { PermissionUser } from "../src/lib/permissions"

const ROLES = ["ADMIN", "MANAGER", "STORE", "STAFF"] as const
const ARTICLES = GUIDE_ARTICLES as GuideArticle[]

// Every module on. Ruling 2 means the module is not a filter, so this changes
// the `preview` flag and nothing about visibility — asserted below.
const ORG_ALL = { activeModules: ["inventory", "hr", "labor", "nutrition"] }
const ORG_NONE = { activeModules: [] as string[] }

const actor = (role: string): PermissionUser => ({ role })

let failures = 0
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`)
  }
}

// ─── EVIDENCE 1 — per-role visible article sets ──────────────────────────────

console.log("\n── Evidence 1: visible article sets per role (surface: app) ─────────────────\n")

const sets = new Map<string, string[]>()
for (const role of ROLES) {
  const scope = helpScope(actor(role), ORG_ALL, ARTICLES, { surface: "app" })
  sets.set(role, scope.articles.map((a) => a.id))
}

const allIds = ARTICLES.map((a) => a.id).sort()
const width = Math.max(...allIds.map((id) => id.length), 8)
console.log(`  ${"article".padEnd(width)}  ${ROLES.map((r) => r.padEnd(9)).join("")}`)
console.log(`  ${"-".repeat(width)}  ${ROLES.map((r) => "-".repeat(r.length).padEnd(9)).join("")}`)
for (const id of allIds) {
  const cells = ROLES.map((r) => (sets.get(r)!.includes(id) ? "✓" : "·").padEnd(9)).join("")
  console.log(`  ${id.padEnd(width)}  ${cells}`)
}
console.log(`  ${"TOTAL".padEnd(width)}  ${ROLES.map((r) => String(sets.get(r)!.length).padEnd(9)).join("")}`)

console.log("")
assert("ADMIN sees all 3 articles", sets.get("ADMIN")!.length === 3, sets.get("ADMIN")!.join(", "))
assert("MANAGER sees all 3 articles", sets.get("MANAGER")!.length === 3, sets.get("MANAGER")!.join(", "))
assert(
  "STORE sees only inv-ingredients (inventory.nav.view is OPERATIONAL)",
  sets.get("STORE")!.length === 1 && sets.get("STORE")![0] === "inv-ingredients",
  sets.get("STORE")!.join(", ")
)
assert("STAFF sees none of the three (all are MANAGE or OPERATIONAL)", sets.get("STAFF")!.length === 0)

// The (my) surface is empty for every role this phase — all three articles are
// (app) articles. This is the assertion behind the portal's empty state.
for (const role of ROLES) {
  const my = helpScope(actor(role), ORG_ALL, ARTICLES, { surface: "my" })
  assert(`(my) surface is empty for ${role} (no /my/* articles ship in HELP-1a)`, my.articles.length === 0)
}

// ─── EVIDENCE 2 — the gated section is absent from a STORE payload ───────────

console.log("\n── Evidence 2: the gated section is absent from a STORE article payload ─────\n")

const GATED_SECTION = "housekeeping"
const GATED_HEADING = "Duplicates and deleted ingredients"

const storeArticle = helpScope(actor("STORE"), ORG_ALL, ARTICLES, { surface: "app" }).article("inv-ingredients")
const adminArticle = helpScope(actor("ADMIN"), ORG_ALL, ARTICLES, { surface: "app" }).article("inv-ingredients")

assert("STORE can read the Ingredients article at all", storeArticle !== null)
assert("ADMIN can read the Ingredients article", adminArticle !== null)
assert(
  "ADMIN payload CONTAINS the gated section",
  adminArticle!.sections.some((s) => s.id === GATED_SECTION),
  `sections: ${adminArticle!.sections.map((s) => s.id).join(", ") || "(none)"}`
)
assert(
  "STORE payload does NOT contain the gated section",
  !storeArticle!.sections.some((s) => s.id === GATED_SECTION),
  `sections: ${storeArticle!.sections.map((s) => s.id).join(", ") || "(none)"}`
)

// Absent, not merely unrendered. The heading and the prose must not be anywhere
// in the serialized payload — a section removed from `sections` but still
// present in `body` would pass the check above and fail the ruling.
const storeJson = JSON.stringify(storeArticle)
const adminJson = JSON.stringify(adminArticle)
for (const term of [GATED_HEADING, "Restore", "restored", "View Deleted", "Duplicates"]) {
  assert(
    `STORE payload contains no "${term}" anywhere in the serialized article`,
    !storeJson.includes(term)
  )
}
assert("ADMIN payload DOES contain the restore prose (both directions checked)", adminJson.includes("restored"))
assert("canReadSection: ADMIN yes", helpScope(actor("ADMIN"), ORG_ALL, ARTICLES, { surface: "app" }).canReadSection("inv-ingredients", GATED_SECTION))
assert("canReadSection: STORE no", !helpScope(actor("STORE"), ORG_ALL, ARTICLES, { surface: "app" }).canReadSection("inv-ingredients", GATED_SECTION))

// ─── EVIDENCE 3 — the gated section's text is absent from the SEARCH INDEX ───
//
// THE ASSERTION THAT PROVES RULING 6 END TO END. A hidden section that is still
// findable by search is defeated silently: the prose is absent from the page
// and the search box says it exists anyway. Findable-but-invisible fails the
// ruling exactly as loudly as visible would, and much more quietly.

console.log("\n── Evidence 3: the gated section's text is absent from a STORE search index ──\n")

const storeIndex = searchIndex(helpScope(actor("STORE"), ORG_ALL, ARTICLES, { surface: "app" }))
const adminIndex = searchIndex(helpScope(actor("ADMIN"), ORG_ALL, ARTICLES, { surface: "app" }))
const storeIndexJson = JSON.stringify(storeIndex)
const adminIndexJson = JSON.stringify(adminIndex)

console.log(`  STORE index: ${storeIndex.length} rows, ${Buffer.byteLength(storeIndexJson)} bytes`)
console.log(`  ADMIN index: ${adminIndex.length} rows, ${Buffer.byteLength(adminIndexJson)} bytes\n`)

for (const term of [GATED_HEADING, "deleted", "Deleted", "duplicates", "Duplicates", "restore", "Restore"]) {
  assert(`STORE search index contains no "${term}"`, !storeIndexJson.includes(term))
}
assert(
  "ADMIN search index DOES contain the gated section heading (both directions checked)",
  adminIndexJson.includes(GATED_HEADING),
  `keywords: ${JSON.stringify(adminIndex.find((r) => r.id === "inv-ingredients")?.keywords)}`
)
// Named explicitly because this was a REGRESSION CAUGHT BY THIS SCRIPT, not by
// review: adding `routes` to the index row for the contextual "?" shipped
// /inventory/ingredients/deleted to STORE readers. A route string discloses
// that a page exists just as a section heading does.
const storeRow = storeIndex.find((r) => r.id === "inv-ingredients")
const adminRow = adminIndex.find((r) => r.id === "inv-ingredients")
assert(
  "STORE index row carries ONLY the routes STORE can reach",
  JSON.stringify(storeRow?.routes) === JSON.stringify(["/inventory/ingredients"]),
  JSON.stringify(storeRow?.routes)
)
assert(
  "ADMIN index row carries all three routes",
  (adminRow?.routes.length ?? 0) === 3,
  JSON.stringify(adminRow?.routes)
)
assert(
  "no article BODY reaches the search index",
  !storeIndexJson.includes("What you buy and count — the raw goods") &&
    !adminIndexJson.includes("What you buy and count — the raw goods")
)

// ─── EVIDENCE 4 (policy half) — image access by narrowest enclosing scope ────
//
// The image sits INSIDE the gated section, so it is governed by the SECTION's
// capability, not the article's. STORE can read the Ingredients article and
// must still be refused this image — which is the case gating at the article
// level would get wrong, and the only case ruling 7's "narrowest enclosing
// scope" wording exists for.
//
// WHAT THIS DOES NOT PROVE: that the route returns bytes. That needs the
// froot-guide Blob store, which is not provisioned. See the report.

console.log("\n── Evidence 4 (policy half): image access resolves to the narrowest scope ────\n")

const GATED_IMAGE = "inv-ingredients/deleted-01.png"
const adminScope = helpScope(actor("ADMIN"), ORG_ALL, ARTICLES, { surface: "app" })
const storeScope = helpScope(actor("STORE"), ORG_ALL, ARTICLES, { surface: "app" })

assert("ADMIN may read the image inside the gated section", adminScope.canReadImage(GATED_IMAGE))
assert(
  "STORE may NOT read it — even though STORE may read the article that contains it",
  !storeScope.canReadImage(GATED_IMAGE) && storeScope.canReadArticle("inv-ingredients"),
  "if this fails in the second clause the test is checking the wrong thing"
)
assert("an unknown image id is refused for everyone", !adminScope.canReadImage("nope/none.png"))
assert(
  "the image is absent from the STORE payload entirely",
  !JSON.stringify(storeScope.article("inv-ingredients")).includes(GATED_IMAGE)
)
assert(
  "and present in the ADMIN payload",
  JSON.stringify(adminScope.article("inv-ingredients")).includes(GATED_IMAGE)
)

// ─── RULING 2 — the module is not a filter ───────────────────────────────────

console.log("\n── Ruling 2: a module the org has not bought previews, it does not hide ─────\n")

const noModules = helpScope(actor("ADMIN"), ORG_NONE, ARTICLES, { surface: "app" })
assert(
  "ADMIN with NO modules still sees all 3 articles",
  noModules.articles.length === 3,
  noModules.articles.map((a) => a.id).join(", ")
)
assert(
  "the inventory article is flagged as a preview when inventory is not active",
  noModules.articles.find((a) => a.id === "inv-ingredients")?.preview === true
)
assert(
  "it is NOT a preview when inventory IS active",
  helpScope(actor("ADMIN"), ORG_ALL, ARTICLES, { surface: "app" }).articles.find(
    (a) => a.id === "inv-ingredients"
  )?.preview === false
)
assert(
  "a non-module article is never a preview",
  helpScope(actor("ADMIN"), ORG_NONE, ARTICLES, { surface: "app" }).articles.find((a) => a.id === "staff")
    ?.preview === false
)

// ─── PERM-5 / PERM-8 — per-user overrides move the article with the page ─────

console.log("\n── Per-user overrides (PERM-5 denial) move the article with the page ────────\n")

const deniedManager: PermissionUser = {
  role: "MANAGER",
  overrides: { loaded: true, denied: new Set(["staff.view"] as never[]) } as never,
}
const deniedScope = helpScope(deniedManager, ORG_ALL, ARTICLES, { surface: "app" })
assert(
  "a MANAGER denied staff.view loses the staff article",
  !deniedScope.articles.some((a) => a.id === "staff"),
  deniedScope.articles.map((a) => a.id).join(", ")
)
assert("...and the body route refuses it too", deniedScope.article("staff") === null)
assert(
  "...and it is absent from their search index",
  !JSON.stringify(searchIndex(deniedScope)).includes("staff directory")
)

console.log(failures === 0 ? "\nPASS — all assertions held\n" : `\nFAIL — ${failures} assertion(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
