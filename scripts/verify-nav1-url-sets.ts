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

function compare(label: string, denied: string[], e: Env) {
  console.log(`── ${label} ─────────────────────────────────────────`)
  for (const role of ROLES) {
    const b = visible(before, role, denied, e)
    const a = visible(after, role, denied, e)
    const lost = b.filter((u) => !a.includes(u))
    const gained = a.filter((u) => !b.includes(u))
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
