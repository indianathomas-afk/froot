// SEARCH-1 evidence. Route-level assertions against the real policy functions,
// not claims in prose and not observations in a browser.
//
// In the shape of scripts/verify-perm8-grants.ts and verify-help-access.ts:
// build scenarios, run the REAL policy against them, print the sets, exit
// non-zero when an assertion fails. There is no second implementation of any
// policy here — helpScope(), can(), canReadTrainingModule() and the library
// WHERE fragments are the ones the route uses.
//
// TWO GROUPS, NOT THREE. The "Go to" nav group was dropped from SEARCH-1 by
// Gary on 2026-09-06, so there is no isVisible() assertion in this file and its
// absence is not an omission. See DEBT-91 for the nav lift that would restore
// the group, and src/lib/search.ts's header for why it could not be built here.
//
// WHAT THIS PROVES: which rows each role may be offered, that a gated help
// section's vocabulary does not reach the global payload, and that search.ts
// never names a personal-data source. WHAT IT DOES NOT PROVE: the ILIKE itself.
// The text match runs in Postgres, not in TypeScript, so this file exercises
// the WHERE FRAGMENT and the policy filter around it and leaves the SQL to the
// request-level pass on staging. Saying so here is cheaper than a fixture that
// re-implements ILIKE and then proves only that the re-implementation agrees
// with itself.

import { readFileSync } from "node:fs"
import { helpScope, searchIndex, type GuideArticle } from "../src/lib/help-access"
import { GUIDE_ARTICLES } from "../src/generated/guide"
import { STORE_LIBRARY_WHERE, managerLibraryWhere } from "../src/lib/training"
import { helpRows, trainingLibraryWhere, trainingRows, type SearchableTrainingModule } from "../src/lib/search"
import type { PermissionUser } from "../src/lib/permissions"
import { GATED } from "./help-gated-table"

const ROLES = ["ADMIN", "MANAGER", "STORE"] as const
const ARTICLES = GUIDE_ARTICLES as GuideArticle[]
const ORG_ALL = { activeModules: ["inventory", "hr", "labor", "nutrition"] }
const ORG_DB_ID = "org_fixture"
const MANAGER_STORES = ["store_a"]

const actor = (role: string): PermissionUser => ({ role })
const scopeFor = (role: string) => helpScope(actor(role), ORG_ALL, ARTICLES, { surface: "app" })

const storeIdsFor = (role: string) => (role === "MANAGER" ? MANAGER_STORES : [])

// Fixture library. Deliberately covers the three axes the policy turns on:
// lifecycle (draft/archived), applicability (all vs selected), and store match.
const MODULES: SearchableTrainingModule[] = [
  {
    id: "m-live-all", title: "Cleaning and sanitation", subject: "MODULE 3", description: null,
    organizationId: ORG_DB_ID, isActive: true, isArchived: false, appliesTo: "all",
    storeAssignments: [], lessons: [],
  },
  {
    id: "m-live-mine", title: "Water heater procedure", subject: null, description: "What to do",
    organizationId: ORG_DB_ID, isActive: true, isArchived: false, appliesTo: "selected",
    storeAssignments: [{ storeId: "store_a" }], lessons: [{ id: "l1", title: "Relight the pilot" }],
  },
  {
    id: "m-live-theirs", title: "Opening the second store", subject: null, description: null,
    organizationId: ORG_DB_ID, isActive: true, isArchived: false, appliesTo: "selected",
    storeAssignments: [{ storeId: "store_b" }], lessons: [],
  },
  {
    id: "m-draft", title: "Unpublished draft", subject: null, description: null,
    organizationId: ORG_DB_ID, isActive: false, isArchived: false, appliesTo: "all",
    storeAssignments: [], lessons: [],
  },
  {
    id: "m-archived", title: "Retired procedure", subject: null, description: null,
    organizationId: ORG_DB_ID, isActive: true, isArchived: true, appliesTo: "all",
    storeAssignments: [], lessons: [],
  },
  {
    id: "m-other-org", title: "Another org's module", subject: null, description: null,
    organizationId: "org_other", isActive: true, isArchived: false, appliesTo: "all",
    storeAssignments: [], lessons: [],
  },
]

let failures = 0
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`)
  }
}

// ─── EVIDENCE 1 — per-role visible result sets ───────────────────────────────

console.log("\n── Evidence 1: training rows offered per role (real canReadTrainingModule) ──\n")

const trainingSets = new Map<string, string[]>()
for (const role of ROLES) {
  const rows = trainingRows(MODULES, { orgDbId: ORG_DB_ID, role, storeIds: storeIdsFor(role) })
  trainingSets.set(role, rows.map((r) => r.id))
}

const modIds = MODULES.map((m) => m.id)
const width = Math.max(...modIds.map((id) => id.length), 8)
console.log(`  ${"module".padEnd(width)}  ${ROLES.map((r) => r.padEnd(9)).join("")}`)
console.log(`  ${"-".repeat(width)}  ${ROLES.map((r) => "-".repeat(r.length).padEnd(9)).join("")}`)
for (const id of modIds) {
  const cells = ROLES.map((r) => (trainingSets.get(r)!.includes(id) ? "✓" : "·").padEnd(9)).join("")
  console.log(`  ${id.padEnd(width)}  ${cells}`)
}
console.log(`  ${"TOTAL".padEnd(width)}  ${ROLES.map((r) => String(trainingSets.get(r)!.length).padEnd(9)).join("")}`)
console.log("")

// ADMIN owns the builder: drafts and archives included, org-wide.
assert("ADMIN is offered every module in the org, drafts and archives included",
  trainingSets.get("ADMIN")!.length === 5 && !trainingSets.get("ADMIN")!.includes("m-other-org"),
  trainingSets.get("ADMIN")!.join(", "))

// R-h option (i), Gary 2026-08-11: STORE is org-wide, NOT store-scoped.
assert("STORE is offered the live library org-wide — R-h(i), not store-scoped",
  trainingSets.get("STORE")!.join(",") === "m-live-all,m-live-mine,m-live-theirs",
  trainingSets.get("STORE")!.join(", "))
assert("STORE is offered a module applying to a store it is not assigned to (R-h(i))",
  trainingSets.get("STORE")!.includes("m-live-theirs"))
assert("STORE is offered no draft and no archive",
  !trainingSets.get("STORE")!.some((id) => id === "m-draft" || id === "m-archived"))

// MANAGER is NARROWER than STORE, deliberately — HR-26 preserving HR-17.
assert("MANAGER is store-scoped and therefore narrower than STORE",
  trainingSets.get("MANAGER")!.join(",") === "m-live-all,m-live-mine",
  trainingSets.get("MANAGER")!.join(", "))
assert("MANAGER is NOT offered another store's selected module",
  !trainingSets.get("MANAGER")!.includes("m-live-theirs"))
assert("MANAGER's set is a strict subset of STORE's — the documented asymmetry",
  trainingSets.get("MANAGER")!.every((id) => trainingSets.get("STORE")!.includes(id)) &&
    trainingSets.get("MANAGER")!.length < trainingSets.get("STORE")!.length)

// No role reaches another org, at the policy level and not merely by the WHERE.
for (const role of ROLES) {
  assert(`${role} is never offered another org's module`,
    !trainingSets.get(role)!.includes("m-other-org"))
}

// A lesson hit rolls up to its module, and the subtitle names the lesson.
const storeRows = trainingRows(MODULES, { orgDbId: ORG_DB_ID, role: "STORE", storeIds: [] })
const rolled = storeRows.find((r) => r.id === "m-live-mine")!
assert("a lesson hit rolls up to its module — href is the module's read page",
  rolled.href === "/hr/training/m-live-mine/preview", rolled.href)
assert("...and the matched lesson names itself in the subtitle",
  rolled.subtitle === "Lesson: Relight the pilot", rolled.subtitle)

// The WHERE fragment is the one lib/training owns, per role.
console.log("")
assert("ADMIN's library WHERE is unfiltered (the builder reaches drafts)",
  JSON.stringify(trainingLibraryWhere("ADMIN", [])) === "{}")
assert("STORE's library WHERE is STORE_LIBRARY_WHERE verbatim — lifecycle only",
  JSON.stringify(trainingLibraryWhere("STORE", [])) === JSON.stringify(STORE_LIBRARY_WHERE))
assert("STORE's library WHERE mentions neither appliesTo nor storeAssignments",
  !JSON.stringify(trainingLibraryWhere("STORE", ["store_a"])).includes("appliesTo") &&
    !JSON.stringify(trainingLibraryWhere("STORE", ["store_a"])).includes("storeAssignments"))
assert("MANAGER's library WHERE is managerLibraryWhere verbatim — lifecycle AND applicability",
  JSON.stringify(trainingLibraryWhere("MANAGER", MANAGER_STORES)) ===
    JSON.stringify(managerLibraryWhere(MANAGER_STORES)))
assert("an unknown role falls back to the narrowest live filter, never to {}",
  JSON.stringify(trainingLibraryWhere("STAFF", [])) === JSON.stringify(STORE_LIBRARY_WHERE))

// Help rows come through the real helpScope, per role.
console.log("\n── Evidence 1b: help rows offered per role (real helpScope) ─────────────────\n")
for (const role of ROLES) {
  const rows = helpRows(scopeFor(role), "training")
  console.log(`  ${role.padEnd(8)} "training" → ${rows.length} row(s): ${rows.map((r) => r.id).join(", ") || "(none)"}`)
}
console.log("")
assert("help rows never exceed the reader's own scoped index",
  ROLES.every((role) => {
    const ids = new Set(searchIndex(scopeFor(role)).map((r) => r.id))
    return helpRows(scopeFor(role), "a").every((r) => ids.has(r.id))
  }))
// PERM-5: a per-user denial must move the GLOBAL search row with the page, not
// only the help page's own list. Same actor shape verify-help-access.ts uses.
const deniedManager: PermissionUser = {
  role: "MANAGER",
  overrides: { loaded: true, denied: new Set(["staff.view"] as never[]) } as never,
}
assert("a MANAGER denied staff.view gets no staff help row from global search",
  helpRows(helpScope(deniedManager, ORG_ALL, ARTICLES, { surface: "app" }), "staff")
    .every((r) => r.id !== "staff"))

// ─── EVIDENCE 2 — gated sections, against the GLOBAL payload ─────────────────
//
// Without this the search bar is a second door around the HELP-1 section
// ruling: a section hidden on the help page but findable by typing its heading
// into the sidebar is not hidden. The table is shared with
// verify-help-access.ts (scripts/help-gated-table.ts) so the two cannot drift.

console.log("\n── Evidence 2: gated-section vocabulary never reaches a global result ───────\n")

for (const g of GATED) {
  const adminGlobal = JSON.stringify(helpRows(scopeFor("ADMIN"), g.heading))
  assert(`ADMIN's global payload DOES surface "${g.heading}" (both directions checked)`,
    adminGlobal.includes(g.article))

  for (const role of g.deniedRoles) {
    if (!ROLES.includes(role as (typeof ROLES)[number])) continue
    const scope = scopeFor(role)

    // The heading itself, typed into the sidebar, must return nothing.
    assert(`${role}: the gated heading returns no global row for ${g.article}`,
      !helpRows(scope, g.heading).some((r) => r.id === g.article),
      JSON.stringify(helpRows(scope, g.heading).map((r) => r.id)))

    // And the heading must be absent from the payload however it is reached —
    // absent, not merely unmatched.
    const anyRow = JSON.stringify(helpRows(scope, "a"))
    assert(`${role}: the gated heading is absent from the whole global payload`,
      !anyRow.includes(g.heading))

    // Each term the section owns, in turn.
    for (const term of g.terms) {
      const hit = helpRows(scope, term).find((r) => r.id === g.article)
      assert(`${role}: "${term}" never reaches ${g.article} through the gated section`,
        !hit || (!hit.title.includes(g.heading) && !hit.subtitle.includes(g.heading)),
        hit ? `${hit.title} / ${hit.subtitle}` : "")
    }
  }
}

// ─── EVIDENCE 3 — the excluded sources, made testable ────────────────────────
//
// The structural guarantee: search reads two sources, so it CANNOT leak a wage
// or a manager note, because it never queries the tables they live in. This is
// that promise as an assertion rather than a sentence.
//
// A GREP AND NOT A BLOCKLIST, and the difference is the whole point. A blocklist
// in src/lib/search.ts would imply the query could reach those tables and has
// been talked out of it. This asserts the names never appear at all — which is
// also why search.ts's own comments must not spell them out, and why this list
// lives here rather than there.

console.log("\n── Evidence 3: src/lib/search.ts names no excluded source ──────────────────\n")

const FORBIDDEN = [
  "staffMember",          // people
  "hrDocument",           // HR documents
  "managerNote",          // manager notes
  "squareTeamMemberWage", // wages, and anything comp-adjacent
  "staffDocument",        // staff uploads
  "trainingAssignment",   // who was assigned what
  "trainingQuizAttempt",  // who passed
  "teamMessage",          // messages
  // SEARCH-1 addition (Gary, 2026-09-06): STORE gets filesServed=false and
  // linkedDocsServed=false on the preview page, and search must not
  // reintroduce what that page suppresses.
  "linkedHrDocument",
]

const SEARCH_SRC = readFileSync("src/lib/search.ts", "utf-8")
// A file that failed to load would pass every assertion below vacuously.
assert("search.ts loaded and is non-trivial", SEARCH_SRC.length > 500, `${SEARCH_SRC.length} bytes`)
for (const name of FORBIDDEN) {
  assert(`src/lib/search.ts never references ${name}`, !SEARCH_SRC.includes(name))
}

// ─── EVIDENCE 4 — the result row shape ───────────────────────────────────────
//
// Two field VALUES being right is not the row shape being right. Without this,
// an extra key added to either mapping passes every other assertion in this
// file. `preview` is help-only and optional, so the rule is: every key present
// must be in the allowed set, and the five required keys must all be there.

console.log("\n── Evidence 4: result rows carry the declared shape and nothing else ───────\n")

const ALLOWED_ROW_KEYS = ["group", "id", "title", "subtitle", "href", "preview"]
const REQUIRED_ROW_KEYS = ["group", "id", "title", "subtitle", "href"]

const shapeRows = [
  ...trainingRows(MODULES, { orgDbId: ORG_DB_ID, role: "ADMIN", storeIds: [] }),
  ...ROLES.flatMap((role) => helpRows(scopeFor(role), "a")),
]
assert("there are rows to check the shape of", shapeRows.length > 0, `${shapeRows.length} rows`)

const strayKeys = new Set<string>()
let missingKeys = 0
for (const row of shapeRows) {
  for (const k of Object.keys(row)) if (!ALLOWED_ROW_KEYS.includes(k)) strayKeys.add(k)
  if (!REQUIRED_ROW_KEYS.every((k) => k in row)) missingKeys++
}
assert(`every row's keys are within {${ALLOWED_ROW_KEYS.join(",")}} (${shapeRows.length} rows)`,
  strayKeys.size === 0, `stray: ${[...strayKeys].join(", ")}`)
assert("every row carries all five required keys", missingKeys === 0, `${missingKeys} row(s) short`)
assert("a training row carries no preview key — it is help-only",
  !("preview" in trainingRows(MODULES, { orgDbId: ORG_DB_ID, role: "STORE", storeIds: [] })[0]))

// ─── EVIDENCE 5 — the training query's select, and search.ts's import surface ─
//
// WHY THE SELECT IS PARSED FROM SOURCE RATHER THAN EXECUTED. The query needs a
// database; this file is pure by design. Parsing the select block asserts the
// same property the returned objects would: no key outside the expected set.
// It also closes the gap the FORBIDDEN grep cannot see — a widened select shows
// up as an EXTRA KEY whatever the relation is named, and Prisma relation keys
// (`assignments`, `quizzes`) do not match the model names on that list.

console.log("\n── Evidence 5: the training select, and the import surface ─────────────────\n")

/** Top-level keys of the object literal starting at the first `{` after `from`. */
function topLevelKeys(src: string, from: number): string[] {
  const open = src.indexOf("{", from)
  let depth = 0
  let end = open
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++
    else if (src[i] === "}" || src[i] === "]") {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  const inner = src.slice(open + 1, end).replace(/\/\/[^\n]*/g, "")
  const keys: string[] = []
  depth = 0
  let buf = ""
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === "{" || c === "[") depth++
    else if (c === "}" || c === "]") depth--
    else if (depth === 0 && c === ":") { const m = /([A-Za-z_$][\w$]*)\s*$/.exec(buf); if (m) keys.push(m[1]); buf = "" }
    else if (depth === 0 && c === ",") buf = ""
    else if (depth === 0) buf += c
  }
  return keys
}

const EXPECTED_SELECT = [
  "id", "title", "subject", "description", "organizationId",
  "isActive", "isArchived", "appliesTo", "storeAssignments", "lessons",
]
const findManyAt = SEARCH_SRC.indexOf("prisma.trainingModule.findMany")
assert("the training query was located in source", findManyAt > -1)
const selectKeys = topLevelKeys(SEARCH_SRC, SEARCH_SRC.indexOf("select: {", findManyAt))
console.log(`  select keys parsed: ${selectKeys.join(", ")}\n`)
assert("the parser found a non-trivial select", selectKeys.length >= 8, selectKeys.join(", "))
assert(`the training select carries no key outside the expected ${EXPECTED_SELECT.length}`,
  selectKeys.every((k) => EXPECTED_SELECT.includes(k)),
  `stray: ${selectKeys.filter((k) => !EXPECTED_SELECT.includes(k)).join(", ")}`)
assert("...and every expected key is still there",
  EXPECTED_SELECT.every((k) => selectKeys.includes(k)),
  `missing: ${EXPECTED_SELECT.filter((k) => !selectKeys.includes(k)).join(", ")}`)

// THE IMPORT SURFACE. The FORBIDDEN grep reads one file and cannot see what a
// helper does. Pinning the exact bindings search.ts imports is the short,
// honest half of that: reaching personal data through a helper requires
// importing that helper, and this fails when the list changes. It does NOT
// prove transitive purity — see the row filed alongside SEARCH-1 for the full
// graph walk, which needs per-symbol call-graph reachability, not a grep.
const EXPECTED_IMPORTS: Record<string, string[]> = {
  "@/lib/prisma": ["prisma"],
  "@/lib/help-access": ["searchIndex", "HelpScope"],
  "@/lib/training": ["STORE_LIBRARY_WHERE", "canReadTrainingModule", "managerLibraryWhere"],
}
const found: Record<string, string[]> = {}
for (const m of SEARCH_SRC.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
  found[m[2]] = m[1].split(",").map((x) => x.replace(/\btype\b/g, "").trim()).filter(Boolean).sort()
}
for (const [mod, names] of Object.entries(found)) {
  console.log(`  imports ${mod} → ${names.join(", ")}`)
}
console.log("")
assert("search.ts imports exactly the three expected modules and no others",
  Object.keys(found).sort().join(",") === Object.keys(EXPECTED_IMPORTS).sort().join(","),
  Object.keys(found).join(", "))
for (const [mod, names] of Object.entries(EXPECTED_IMPORTS)) {
  assert(`...and from ${mod} exactly {${names.join(", ")}}`,
    (found[mod] ?? []).join(",") === [...names].sort().join(","),
    (found[mod] ?? []).join(", "))
}

console.log(failures === 0 ? "\nPASS — all assertions held\n" : `\nFAIL — ${failures} assertion(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
