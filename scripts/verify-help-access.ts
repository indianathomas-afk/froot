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
// anything about browser rendering, and anything about the image route's BYTES
// (scripts/verify-guide-image.ts covers that against the real Blob store). A
// green run here is evidence about the policy, not about the pixels.

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
const scopeFor = (role: string, org = ORG_ALL) =>
  helpScope(actor(role), org, ARTICLES, { surface: "app" })

// The gated-section article. hr-documents replaced inv-ingredients on
// 2026-09-04: the inventory module is on hold and has no data in any
// environment, so the Ingredients article documented a feature nobody runs and
// its screenshot would have been of an empty page.
//
// The replacement is a STRICTER exerciser, not merely an available one. Its
// entry (hr.documents.view) is ALL while its sub-route /hr/documents/[id] is
// ADMIN-only, so the section is hidden from THREE roles rather than one, and
// the per-role table stops having a zero row.
const ARTICLE = "hr-documents"
const GATED_SECTION = "versions-and-fields"
const GATED_HEADING = "Versions, detected fields and audience"

// Terms that appear ONLY inside the gated section. Verified against the
// generated article: none of these occur in the summary, keywords, body or
// surviving routes. Two of them had to be REMOVED from the article during the
// swap — "audience" was in the frontmatter keywords and the summary said "set
// who it goes to" — which is the same leak class as the route disclosure below,
// arriving through fields nobody thinks of as permission surfaces.
const SECTION_ONLY = ["audience", "Version", "version", "detected", "ceremony", "pinned"]

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
for (const role of ROLES) sets.set(role, scopeFor(role).articles.map((a) => a.id))

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
  "STORE sees only hr-documents (reports.view and staff.view are MANAGE)",
  sets.get("STORE")!.length === 1 && sets.get("STORE")![0] === ARTICLE,
  sets.get("STORE")!.join(", ")
)
assert(
  "STAFF sees only hr-documents (hr.documents.view is ALL)",
  sets.get("STAFF")!.length === 1 && sets.get("STAFF")![0] === ARTICLE,
  sets.get("STAFF")!.join(", ")
)

// The (my) surface is empty for every role this phase — all three articles are
// (app) articles. This is the assertion behind the portal's empty state, and it
// still holds after the swap: hr-documents' entry is /hr/documents, not /my/*.
for (const role of ROLES) {
  const my = helpScope(actor(role), ORG_ALL, ARTICLES, { surface: "my" })
  assert(`(my) surface is empty for ${role} (no /my/* articles ship in HELP-1a)`, my.articles.length === 0)
}

// ─── EVIDENCE 2 — the gated section is absent from a non-ADMIN payload ───────

console.log("\n── Evidence 2: the gated section is absent from non-ADMIN article payloads ──\n")

const adminArticle = scopeFor("ADMIN").article(ARTICLE)
assert("ADMIN can read the article", adminArticle !== null)
assert(
  "ADMIN payload CONTAINS the gated section",
  adminArticle!.sections.some((s) => s.id === GATED_SECTION),
  `sections: ${adminArticle!.sections.map((s) => s.id).join(", ") || "(none)"}`
)

// THREE roles, not one. This is what the swap bought: the section is gated on
// hr.documents.manage (ADMIN_ONLY), so MANAGER, STORE and STAFF must each be
// refused it while still reading the article that contains it.
for (const role of ["MANAGER", "STORE", "STAFF"]) {
  const scope = scopeFor(role)
  const article = scope.article(ARTICLE)
  assert(`${role} can read the article itself`, article !== null)
  assert(
    `${role} payload does NOT contain the gated section`,
    !article!.sections.some((s) => s.id === GATED_SECTION),
    `sections: ${article!.sections.map((s) => s.id).join(", ") || "(none)"}`
  )
  // Absent, not merely unrendered. A section dropped from `sections` but left
  // in `body` would pass the check above and still fail the ruling.
  const json = JSON.stringify(article)
  for (const term of [GATED_HEADING, ...SECTION_ONLY]) {
    assert(`${role} payload contains no "${term}" anywhere in the serialized article`, !json.includes(term))
  }
  assert(`canReadSection: ${role} no`, !scope.canReadSection(ARTICLE, GATED_SECTION))
}

assert(
  "ADMIN payload DOES contain the gated prose (both directions checked)",
  JSON.stringify(adminArticle).includes("pinned")
)
assert("canReadSection: ADMIN yes", scopeFor("ADMIN").canReadSection(ARTICLE, GATED_SECTION))

// ─── EVIDENCE 3 — the gated section's text is absent from the SEARCH INDEX ───
//
// THE ASSERTION THAT PROVES RULING 6 END TO END. A hidden section that is still
// findable by search is defeated silently: the prose is absent from the page and
// the search box says it exists anyway. Findable-but-invisible fails the ruling
// exactly as loudly as visible would, and much more quietly.

console.log("\n── Evidence 3: the gated section's text is absent from non-ADMIN indexes ────\n")

const adminIndex = searchIndex(scopeFor("ADMIN"))
const adminIndexJson = JSON.stringify(adminIndex)
console.log(`  ADMIN index: ${adminIndex.length} rows, ${Buffer.byteLength(adminIndexJson)} bytes`)
for (const role of ["MANAGER", "STORE", "STAFF"]) {
  const index = searchIndex(scopeFor(role))
  const json = JSON.stringify(index)
  console.log(`  ${role.padEnd(7)} index: ${index.length} rows, ${Buffer.byteLength(json)} bytes`)
  for (const term of [GATED_HEADING, ...SECTION_ONLY]) {
    assert(`${role} search index contains no "${term}"`, !json.includes(term))
  }
  // Named explicitly because this was a REGRESSION CAUGHT BY THIS SCRIPT, not by
  // review: adding `routes` to the index row for the contextual "?" shipped the
  // gated sub-route to readers who cannot reach it. A route string discloses
  // that a page exists just as a section heading does.
  const row = index.find((r) => r.id === ARTICLE)
  assert(
    `${role} index row carries ONLY the routes ${role} can reach`,
    JSON.stringify(row?.routes) === JSON.stringify(["/hr/documents"]),
    JSON.stringify(row?.routes)
  )
}
assert(
  "ADMIN search index DOES contain the gated section heading (both directions checked)",
  adminIndexJson.includes(GATED_HEADING),
  `keywords: ${JSON.stringify(adminIndex.find((r) => r.id === ARTICLE)?.keywords)}`
)
assert(
  "ADMIN index row carries both routes",
  (adminIndex.find((r) => r.id === ARTICLE)?.routes.length ?? 0) === 2,
  JSON.stringify(adminIndex.find((r) => r.id === ARTICLE)?.routes)
)
assert(
  "no article BODY reaches the search index",
  !adminIndexJson.includes("everything your team is expected to read or sign")
)

// ─── EVIDENCE 4 (policy half) — image access by narrowest enclosing scope ────
//
// The image sits INSIDE the gated section, so it is governed by the SECTION's
// capability, not the article's. Every non-ADMIN role can read the article and
// must still be refused this image — the case that gating at the article level
// would get wrong, and the only case ruling 7's "narrowest enclosing scope"
// wording exists for.
//
// The BYTES half needs the real Blob store: scripts/verify-guide-image.ts.

console.log("\n── Evidence 4 (policy half): image access resolves to the narrowest scope ────\n")

const GATED_IMAGE = "hr-documents/document-detail-01.png"
assert("ADMIN may read the image inside the gated section", scopeFor("ADMIN").canReadImage(GATED_IMAGE))
for (const role of ["MANAGER", "STORE", "STAFF"]) {
  const scope = scopeFor(role)
  assert(
    `${role} may NOT read it — though ${role} may read the article containing it`,
    !scope.canReadImage(GATED_IMAGE) && scope.canReadArticle(ARTICLE)
  )
}
assert("an unknown image id is refused for everyone", !scopeFor("ADMIN").canReadImage("nope/none.png"))
assert(
  "the image is absent from a STORE payload entirely",
  !JSON.stringify(scopeFor("STORE").article(ARTICLE)).includes(GATED_IMAGE)
)
assert(
  "and present in the ADMIN payload",
  JSON.stringify(adminArticle).includes(GATED_IMAGE)
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
  "the hr article is flagged as a preview when hr is not active",
  noModules.articles.find((a) => a.id === ARTICLE)?.preview === true
)
assert(
  "it is NOT a preview when hr IS active",
  scopeFor("ADMIN").articles.find((a) => a.id === ARTICLE)?.preview === false
)
assert(
  "a non-module article is never a preview",
  noModules.articles.find((a) => a.id === "staff")?.preview === false
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
