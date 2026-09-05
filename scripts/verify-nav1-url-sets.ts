/**
 * NAV-1 — the done criterion of the sidebar restructure, computed rather than
 * eyeballed.
 *
 *   npx tsx scripts/verify-nav1-url-sets.ts [baseline-rev]
 *
 * NAV-1 regrouped a flat sidebar into accordions. The whole risk of that change
 * is that a destination quietly stops being reachable for some role, so the
 * phase's done criterion was never "the groups look right" — it was that THE SET
 * OF DESTINATION URLs EACH ROLE CAN REACH IS UNCHANGED, with exactly one
 * sanctioned exception (/settings/labor disappears without labor.access, which
 * was already true before the phase and is now ratified in docs/DECISIONS.md).
 *
 * HOW IT WORKS. The item literals are parsed out of TWO revisions of
 * sidebar.tsx — the pinned pre-NAV-1 baseline and the working tree — by the SAME
 * parser, and both are filtered by the REAL can() from src/lib/permissions.ts.
 * So the comparison consults the actual capability grants, not a copy of them:
 * a grant edited in permissions.ts moves both sides together and is correctly
 * NOT reported as a nav regression, while an item that loses its capability,
 * its href or its place in the file is.
 *
 * WHY THE BASELINE IS A PINNED SHA AND NOT `HEAD`. During the NAV-1 session the
 * before-side was HEAD. The moment the work committed, HEAD became the after
 * side and the comparison would have gone vacuously green forever — a fixture
 * that cannot fail. BASELINE_REV is the last commit before the restructure.
 * DO NOT "UPDATE" IT TO A NEWER SHA to make a red run go green; a red run means
 * a URL left some role's nav, which is the thing this file exists to catch.
 *
 * WHAT IT CANNOT DETECT, so a green run is not over-read: it proves nothing
 * about what a browser renders. Group nesting, the auto-open behaviour, the
 * Messages treatment and the Daily Tasks button are all invisible to it — it
 * sees URLs and capabilities. It is also blind to server-side enforcement,
 * which is the actual gate; the nav is UX (see the caveat in sidebar.tsx).
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { can, overridesFrom, type Capability } from "../src/lib/permissions"

type Item = {
  href: string
  capability: Capability
  requiresInstagram: boolean
  requiresHr: boolean
  requiresLabor: boolean
}

const LINE = /\{\s*href:\s*"([^"]+)",\s*label:\s*"[^"]*",(.*?)\},?\s*$/

function parse(src: string): Item[] {
  const out: Item[] = []
  for (const line of src.split("\n")) {
    const m = LINE.exec(line.trim())
    if (!m) continue
    const [, href, rest] = m
    const cap = /capability:\s*"([^"]+)"/.exec(rest)
    if (!cap) continue
    out.push({
      href,
      capability: cap[1] as Capability,
      requiresInstagram: /requiresInstagram:\s*true/.test(rest),
      requiresHr: /requiresHr:\s*true/.test(rest),
      requiresLabor: /requiresLabor:\s*true/.test(rest),
    })
  }
  // The Settings entry is hand-written JSX in both revisions, not a literal.
  out.push({
    href: "/settings",
    capability: "settings.access" as Capability,
    requiresInstagram: false,
    requiresHr: false,
    requiresLabor: false,
  })
  return out
}

type Env = {
  instagramEnabled: boolean
  hrEnabled: boolean
  laborEnabled: boolean
  inventoryModule: boolean
  staffHasChecklists: boolean
}

function visible(items: Item[], role: string, denied: string[], env: Env): string[] {
  const actor = { role, overrides: overridesFrom(denied) }
  return items
    .filter(
      (i) =>
        can(actor, i.capability) &&
        (!i.requiresInstagram || env.instagramEnabled) &&
        (!i.requiresHr || env.hrEnabled) &&
        (!i.requiresLabor || env.laborEnabled) &&
        (!i.href.startsWith("/inventory/") || env.inventoryModule) &&
        !(role === "STAFF" && i.href === "/checklists" && !env.staffHasChecklists)
    )
    .map((i) => (role === "STAFF" && i.href === "/hr" ? "/my/documents" : i.href))
    .sort()
}

// The last commit BEFORE the NAV-1 restructure. See the header — this is pinned
// on purpose and is not a value to refresh.
const BASELINE_REV = process.argv[2] ?? "10439b3"

const before = parse(
  execFileSync("git", ["show", `${BASELINE_REV}:src/components/layout/sidebar.tsx`], { encoding: "utf-8" })
)
const after = parse(readFileSync("src/components/layout/sidebar.tsx", "utf-8"))

// A parser that silently matches nothing would report two empty sets as
// identical — the failure mode that makes a green run worthless.
if (before.length < 20 || after.length < 20) {
  console.error(`parser matched too little: before=${before.length} after=${after.length} — the item literals moved`)
  process.exit(1)
}

console.log(`baseline ${BASELINE_REV} — parsed: before=${before.length} entries, after=${after.length} entries\n`)

const ROLES = ["ADMIN", "MANAGER", "STORE", "STAFF"]
const env: Env = {
  instagramEnabled: true,
  hrEnabled: true,
  laborEnabled: true,
  inventoryModule: true,
  staffHasChecklists: true,
}

let failures = 0

// ─── NAV-1 SANCTIONED ADDITIONS ──────────────────────────────────────────────
//
// The URL-set comparison is otherwise ABSOLUTE: a gained URL is a defect. This
// list is the one exception, and it exists because HELP-1a adds a pinned Help
// entry to every role's nav — a GAIN FOR ALL FOUR ROLES BY DESIGN.
//
// IT CANNOT BE EXPRESSED AS A SCENARIO, which is why a new mechanism was
// needed rather than a fifth compare() call. The /settings/labor exception
// works by applying the SAME denial to BOTH revisions, so the URL drops out of
// the before set and the after set together and they stay identical. That
// symmetry is unavailable here: the baseline revision has no Help item under
// any env, any denied list, any scenario, so no symmetric condition makes it
// appear on the before side. compare() had no vocabulary for "this URL is new
// and that is correct."
//
// THIS LIST IS NOT A PLACE TO PUT A URL THAT WENT MISSING. It suppresses
// GAINED and never LOST — see the filter below, where `lost` is deliberately
// untouched. A lost URL still fails, which is the regression this fixture was
// built to catch, and that asymmetry is the whole safety of the mechanism.
//
// Adding an entry here is a RULING, not a fix: it asserts that a human decided
// this destination should appear for these roles. One line per URL, naming the
// phase that sanctioned it.
//
// BASELINE_REV is NOT touched by this mechanism and must not be edited to make
// a run go green — moving the baseline forward would retire every regression
// the fixture currently protects, silently.
const SANCTIONED_ADDITIONS: Record<string, string> = {
  "/help": "HELP-1a — pinned help entry, all four roles, docs/DECISIONS.md 2026-09-04",
}

function compare(label: string, denied: string[], e: Env) {
  console.log(`── ${label} ─────────────────────────────────────────`)
  for (const role of ROLES) {
    const b = visible(before, role, denied, e)
    const a = visible(after, role, denied, e)
    const lost = b.filter((u) => !a.includes(u))
    const gained = a.filter((u) => !b.includes(u) && !(u in SANCTIONED_ADDITIONS))
    const ok = lost.length === 0 && gained.length === 0
    if (!ok) failures++
    console.log(
      `${role.padEnd(8)} before=${String(b.length).padStart(2)} after=${String(a.length).padStart(2)}  ${
        ok ? "IDENTICAL" : `LOST ${JSON.stringify(lost)} GAINED ${JSON.stringify(gained)}`
      }`
    )
  }
  console.log()
}

compare("all modules on, Instagram connected", [], env)
compare("Instagram not connected (staging today)", [], { ...env, instagramEnabled: false })
compare("STAFF with no open checklist", [], { ...env, staffHasChecklists: false })
compare("labor.access DENIED per-user (the sanctioned drop)", ["labor.access"], env)

console.log("── full sets, all modules on ──────────────────────────")
for (const role of ROLES) {
  console.log(`\n${role} (${visible(after, role, [], env).length}):`)
  for (const u of visible(after, role, [], env)) console.log(`  ${u}`)
}

console.log(`\n${failures === 0 ? "PASS — every role's URL set is identical" : `FAIL — ${failures} role/scenario differ`}`)
process.exit(failures === 0 ? 0 : 1)
