// HELP-1 evidence. Route-level assertions against the real helpScope(), not
// claims in prose and not observations in a browser.
//
// Modelled on scripts/verify-nav1-url-sets.ts: build scenarios, run the REAL
// policy against them, print the sets, and exit non-zero when an assertion
// fails. It calls can() through helpScope() exactly as the routes do — there is
// no second implementation of the policy here, which is the whole point of the
// helper this script is checking.
//
// TABLE-DRIVEN FROM HELP-1b ONWARDS. Every gated section is a row in GATED
// below, and a batch extends this file by adding rows rather than by rewriting
// assertions. Twenty more articles are coming; a script that has to be
// hand-edited per article is a script that stops being extended.
//
// WHAT THIS PROVES: what a given actor may see. WHAT IT DOES NOT PROVE:
// anything about browser rendering, and anything about the image route's BYTES
// (scripts/verify-guide-image.ts covers that against the real Blob store).

import { helpScope, searchIndex, type GuideArticle } from "../src/lib/help-access"
import { GUIDE_ARTICLES } from "../src/generated/guide"
import type { PermissionUser } from "../src/lib/permissions"

const ROLES = ["ADMIN", "MANAGER", "STORE", "STAFF"] as const
const ARTICLES = GUIDE_ARTICLES as GuideArticle[]

const ORG_ALL = { activeModules: ["inventory", "hr", "labor", "nutrition"] }
const ORG_NONE = { activeModules: [] as string[] }

const actor = (role: string): PermissionUser => ({ role })
const scopeFor = (role: string, org = ORG_ALL) =>
  helpScope(actor(role), org, ARTICLES, { surface: "app" })

// Expected visible article counts per role. Updated per batch; a wrong number
// here fails loudly rather than drifting, which is the point of writing it down
// instead of printing whatever comes out.
const EXPECTED: Record<string, number> = { ADMIN: 9, MANAGER: 8, STORE: 3, STAFF: 3 }

// ─── THE GATED-SECTION TABLE ─────────────────────────────────────────────────
//
// `terms` is the section's own vocabulary, and the assertions below prove none
// of it reaches a reader who cannot see the section — not through the payload,
// not through the search-index row.
//
// THIS EXISTS BECAUSE THREE SEPARATE ARTICLE-LEVEL FIELDS HAVE LEAKED A GATED
// SECTION, and none of them looks like a permission surface while you type it:
// `routes` shipped /inventory/ingredients/deleted to STORE readers, `keywords`
// carried the word "audience", and `summary` said "set who it goes to" in
// prose. Two of those three were caught by this script rather than by review.
//
// `deniedRoles` is roles that CAN see the article but CANNOT see the section —
// stated rather than computed, so a wrong expectation fails instead of
// quietly agreeing with the code.
const GATED = [
  {
    article: "hr-documents",
    section: "versions-and-fields",
    heading: "Versions, detected fields and audience",
    deniedRoles: ["MANAGER", "STORE", "STAFF"],
    terms: ["audience", "Version", "version", "detected", "ceremony", "pinned"],
    reachableRoutes: ["/hr/documents"],
    allRoutes: 2,
  },
  {
    article: "hr-training",
    section: "authoring",
    heading: "Building and changing a module",
    // The article is hr.training.manage (MANAGE), so STORE and STAFF cannot see
    // it at all and are not part of this test — they are covered by the
    // per-role counts above.
    deniedRoles: ["MANAGER"],
    terms: ["Building", "New Module", "Duplicate", "Duplicat", "clone", "author"],
    reachableRoutes: ["/hr/training", "/hr/training/[id]/preview"],
    allRoutes: 4,
  },
] as const

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
for (const role of ROLES) {
  assert(
    `${role} sees exactly ${EXPECTED[role]} articles`,
    sets.get(role)!.length === EXPECTED[role],
    sets.get(role)!.join(", ")
  )
}

// The (my) surface is still empty for every role — no /my/* article has been
// written yet. This is the assertion behind the portal's empty state.
for (const role of ROLES) {
  const my = helpScope(actor(role), ORG_ALL, ARTICLES, { surface: "my" })
  assert(`(my) surface is empty for ${role} (no /my/* articles written yet)`, my.articles.length === 0)
}

// ─── EVIDENCE 2 + 3 — gated sections, per row of the table ───────────────────

for (const g of GATED) {
  console.log(`\n── ${g.article} / ${g.section} — absence in every direction ${"─".repeat(20)}\n`)

  const adminScope = scopeFor("ADMIN")
  const adminArticle = adminScope.article(g.article)
  assert(`ADMIN can read ${g.article}`, adminArticle !== null)
  assert(
    "ADMIN payload CONTAINS the gated section",
    adminArticle!.sections.some((s) => s.id === g.section),
    `sections: ${adminArticle!.sections.map((s) => s.id).join(", ") || "(none)"}`
  )
  assert(
    `ADMIN sees all ${g.allRoutes} claimed routes`,
    adminArticle!.routes.length === g.allRoutes,
    JSON.stringify(adminArticle!.routes)
  )
  assert(`canReadSection: ADMIN yes`, adminScope.canReadSection(g.article, g.section))

  const adminIndexJson = JSON.stringify(searchIndex(adminScope))
  assert(
    "the section heading IS in the ADMIN index (both directions checked)",
    adminIndexJson.includes(g.heading)
  )

  for (const role of g.deniedRoles) {
    const scope = scopeFor(role)
    const article = scope.article(g.article)
    assert(`${role} can read the article itself`, article !== null)
    assert(
      `${role} payload does NOT contain the gated section`,
      !article!.sections.some((s) => s.id === g.section),
      `sections: ${article!.sections.map((s) => s.id).join(", ") || "(none)"}`
    )
    assert(`canReadSection: ${role} no`, !scope.canReadSection(g.article, g.section))

    // Absent, not merely unrendered. A section dropped from `sections` but left
    // in `body` would pass the check above and still fail the ruling.
    const payload = JSON.stringify(article)
    for (const term of [g.heading, ...g.terms]) {
      assert(`${role} payload of ${g.article} contains no "${term}"`, !payload.includes(term))
    }

    // The search-index row for THIS article — scoped deliberately rather than
    // scanning the whole index, so an unrelated article using the same ordinary
    // word (another summary saying "version") cannot make this assertion lie in
    // either direction.
    const row = searchIndex(scope).find((r) => r.id === g.article)
    const rowJson = JSON.stringify(row)
    for (const term of [g.heading, ...g.terms]) {
      assert(`${role} index row for ${g.article} contains no "${term}"`, !rowJson.includes(term))
    }
    assert(
      `${role} index row carries ONLY the routes ${role} can reach`,
      JSON.stringify(row?.routes) === JSON.stringify(g.reachableRoutes),
      JSON.stringify(row?.routes)
    )
    // The heading is unique enough to be checked against the WHOLE index, which
    // catches it leaking through some other article's fields.
    assert(
      `"${g.heading}" is absent from ${role}'s entire index`,
      !JSON.stringify(searchIndex(scope)).includes(g.heading)
    )
  }
}

// ─── EVIDENCE 4 (policy half) — image access by narrowest enclosing scope ────

console.log("\n── Evidence 4 (policy half): image access resolves to the narrowest scope ────\n")

const GATED_IMAGE = "hr-documents/document-detail-01.png"
assert("ADMIN may read the image inside the gated section", scopeFor("ADMIN").canReadImage(GATED_IMAGE))
for (const role of ["MANAGER", "STORE", "STAFF"]) {
  const scope = scopeFor(role)
  assert(
    `${role} may NOT read it — though ${role} may read the article containing it`,
    !scope.canReadImage(GATED_IMAGE) && scope.canReadArticle("hr-documents")
  )
}
assert("an unknown image id is refused for everyone", !scopeFor("ADMIN").canReadImage("nope/none.png"))

// The form-builder image sits at ARTICLE level in an ADMIN-only article, so it
// is governed by the article rather than a section — the other half of ruling
// 7's "narrowest enclosing scope".
const FORMS_IMAGE = "hr-forms/form-builder-01.png"
assert("ADMIN may read the article-level form-builder image", scopeFor("ADMIN").canReadImage(FORMS_IMAGE))
for (const role of ["MANAGER", "STORE", "STAFF"]) {
  assert(
    `${role} may NOT read it — hr-forms is ADMIN-only, so the ARTICLE governs`,
    !scopeFor(role).canReadImage(FORMS_IMAGE)
  )
}

// ─── RULING 2 — the module is not a filter ───────────────────────────────────

console.log("\n── Ruling 2: a module the org has not bought previews, it does not hide ─────\n")

const noModules = helpScope(actor("ADMIN"), ORG_NONE, ARTICLES, { surface: "app" })
assert(
  `ADMIN with NO modules still sees all ${EXPECTED.ADMIN} articles`,
  noModules.articles.length === EXPECTED.ADMIN,
  noModules.articles.map((a) => a.id).join(", ")
)
for (const id of ["hr-documents", "hr-training", "hr-hub"]) {
  assert(`${id} is flagged as a preview when hr is not active`, noModules.articles.find((a) => a.id === id)?.preview === true)
  assert(`${id} is NOT a preview when hr IS active`, scopeFor("ADMIN").articles.find((a) => a.id === id)?.preview === false)
}
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
