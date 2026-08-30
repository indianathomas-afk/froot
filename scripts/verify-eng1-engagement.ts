/**
 * ENG-1 — engagement tracking, pinned.
 *
 *   npx tsx scripts/verify-eng1-engagement.ts
 *
 * PURE, like verify-perm8-grants.ts and verify-comp-confidential.ts, and for the
 * same reason: what this checks is not a query. It is a capability's tier, a
 * total function over strings, and two structural facts about the schema and the
 * source tree. A database-backed fixture would be green on the dev branch's
 * empty UsageDaily table and would prove nothing.
 *
 * It reads two files off disk (prisma/schema.prisma and the src/app tree) but
 * opens no connection and imports nothing that does.
 *
 * WHAT THIS CAN DETECT, stated so a green run means something:
 *   - engagement.view WIDENING. If it is ever moved off ADMIN_ONLY, cases 1-4
 *     fail. The /staff link and the /stores icon both drop `isAdmin &&` and rely
 *     entirely on that tier to stay admin-only.
 *   - THE CAPABILITY BECOMING GRANTABLE. Gary ruled it is not (2026-08-30).
 *     Cases 5-8 fail if it is appended to GRANTABLE_CAPABILITIES for any role —
 *     which the header of permissions.ts calls a security change, not a config
 *     change.
 *   - THE D1 RULING BEING REVERSED SILENTLY. Case 9 fails if engagement.view is
 *     added to ENFORCED_CAPABILITIES, which would make it deniable admin-to-
 *     admin from the /users grid without a ruling.
 *   - NORMALIZATION LEAKING AN ENTITY ID INTO A KEY. Cases 10-24. This is the
 *     one that matters most: normalizePath is the only thing between a
 *     client-supplied string and a UsageDaily row, so if it ever returns its
 *     input, the table stops being bounded and starts being an event log.
 *   - THE ROLLUP BECOMING AN EVENT LOG. Case 25 reads the schema and fails if
 *     @@unique([userId, path, date]) is gone. Without that key the upsert
 *     inserts instead of incrementing and every visit is a row.
 *   - THE ROUTE LIST DRIFTING FROM THE APP. Case 26 derives the pattern list
 *     from the filesystem and diffs it. A page added without an entry rolls up
 *     as "/other" — green everywhere, wrong on the report.
 *   - AN IP ADDRESS ENTERING THIS PHASE'S CODE. Case 27 greps the files ENG-1
 *     added for requestIp/x-forwarded-for. ENG-1 ruling 1 says the raw IP is
 *     never stored; this makes that a test rather than a promise.
 *
 * WHAT IT CANNOT DETECT: that the ROUTE actually calls can(). No unit fixture
 * can — that is the 403-by-request evidence, and this file is not a substitute
 * for it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  can,
  isGrantable,
  ENFORCED_CAPABILITIES,
  type Capability,
  type PermissionRole,
} from "../src/lib/permissions"
import { normalizePath, ROUTE_PATTERNS, OTHER_PATH } from "../src/lib/engagement"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const VIEW: Capability = "engagement.view"
const ROLES: PermissionRole[] = ["ADMIN", "MANAGER", "STORE", "STAFF"]

console.log("\nengagement.view is ADMIN baseline — and the tier IS the gate")
// Both link sites (staff/page.tsx, stores/page.tsx) deliberately omit
// `isAdmin &&`, so these four cases are what keeps the affordance admin-only.
check("1. ADMIN", can({ role: "ADMIN" }, VIEW), true)
check("2. MANAGER", can({ role: "MANAGER" }, VIEW), false)
check("3. STORE", can({ role: "STORE" }, VIEW), false)
check("4. STAFF", can({ role: "STAFF" }, VIEW), false)

console.log("\nNOT GRANTABLE to anyone (Gary, 2026-08-30)")
for (const [i, role] of ROLES.entries()) {
  check(`${5 + i}. isGrantable for ${role}`, isGrantable(VIEW, role), false)
}
// A hand-rolled grant in the column must therefore do nothing at all.
check("8b. MANAGER holding a stored grant is still refused", can({ role: "MANAGER", grants: new Set([VIEW]) }, VIEW), false)

console.log("\nNOT DENIABLE from the /users grid (D1 ruling)")
check("9. absent from ENFORCED_CAPABILITIES", ENFORCED_CAPABILITIES.some((e) => e.capability === VIEW), false)

console.log("\nnormalizePath collapses dynamic segments")
check("10. a staff profile", normalizePath("/staff/clx0abc123def456ghi789jkl"), "/staff/[id]")
check("11. a different staff profile lands on the SAME key", normalizePath("/staff/clzZZZ999zzz888yyy777xxx"), "/staff/[id]")
check("12. numeric id", normalizePath("/templates/12345"), "/templates/[id]")
check("13. nested dynamic + literal tail", normalizePath("/hr/forms/clx1/submit"), "/hr/forms/[id]/submit")
check("14. two-deep dynamic", normalizePath("/my/documents/records/clx9"), "/my/documents/records/[recordId]")

console.log("\nstatic segments beat dynamic ones (as Next itself resolves them)")
check("15. /templates/new is not /templates/[id]", normalizePath("/templates/new"), "/templates/new")
check("16. /inventory/purchase-orders/new", normalizePath("/inventory/purchase-orders/new"), "/inventory/purchase-orders/new")
// The sharpest case in the file: without static-wins, the engagement page would
// report visits to ITSELF as visits to a staff profile.
check("17. /staff/engagement is not /staff/[id]", normalizePath("/staff/engagement"), "/staff/engagement")

console.log("\nthe function is TOTAL — it never returns its input")
check("18. unknown path", normalizePath("/nope/not/a/route"), OTHER_PATH)
check("19. query string is stripped, not keyed", normalizePath("/staff/engagement?store=clx1"), "/staff/engagement")
check("20. hash is stripped", normalizePath("/dashboard#top"), "/dashboard")
check("21. traversal", normalizePath("/staff/../../etc/passwd"), OTHER_PATH)
check("22. empty", normalizePath(""), OTHER_PATH)
check("23. null", normalizePath(null), OTHER_PATH)
check("24. an absurdly long path", normalizePath("/" + "a".repeat(5000)), OTHER_PATH)
// Every output is a member of the closed set — the bounded-growth claim itself.
const probes = ["/staff/x", "/nope", "", "/dashboard", "/staff/engagement?store=1", "/a/b/c/d/e/f"]
const closed = probes.every((p) => {
  const out = normalizePath(p)
  return out === OTHER_PATH || ROUTE_PATTERNS.includes(out)
})
check("24b. every output is in ROUTE_PATTERNS or /other", closed, true)

console.log("\nthe rollup is a rollup — the unique key makes duplicates unrepresentable")
const schema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8")
const usageModel = schema.slice(schema.indexOf("model UsageDaily {"))
const modelBody = usageModel.slice(0, usageModel.indexOf("\n}"))
check("25. @@unique([userId, path, date]) on UsageDaily", modelBody.includes("@@unique([userId, path, date])"), true)

console.log("\nROUTE_PATTERNS matches the app's actual pages")
function pagePatterns(dir: string, prefix = ""): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // Route groups contribute no URL segment.
      const seg = /^\(.+\)$/.test(entry) ? "" : `/${entry}`
      out.push(...pagePatterns(full, prefix + seg))
    } else if (entry === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix)
    }
  }
  return out
}
const onDisk = pagePatterns(join(__dirname, "..", "src", "app")).sort()
const listed = [...ROUTE_PATTERNS].sort()
const missing = onDisk.filter((p) => !listed.includes(p))
const extra = listed.filter((p) => !onDisk.includes(p))
if (missing.length) console.log(`        pages with no ROUTE_PATTERNS entry: ${missing.join(", ")}`)
if (extra.length) console.log(`        ROUTE_PATTERNS entries with no page: ${extra.join(", ")}`)
check("26. every page.tsx has an entry, and vice versa", missing.length + extra.length, 0)

console.log("\nENG-1 ruling 1 — no raw IP anywhere in this phase's code")
const ENG1_FILES = [
  "src/lib/engagement.ts",
  "src/app/api/usage/route.ts",
  "src/app/api/staff/engagement/route.ts",
  "src/app/api/cron/engagement-prune/route.ts",
  "src/components/usage-beacon.tsx",
  "src/app/(app)/staff/engagement/page.tsx",
  "src/app/(app)/staff/engagement/engagement-client.tsx",
]
// "requestIp" appears in engagement.ts and usage/route.ts inside comments that
// say NOT to use it, so the probe is for a CALL and for the header name.
const BANNED = [/requestIp\s*\(/, /x-forwarded-for/i, /x-real-ip/i, /\bipAddress\b/]
const offenders: string[] = []
for (const f of ENG1_FILES) {
  const src = readFileSync(join(__dirname, "..", f), "utf8")
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  for (const re of BANNED) if (re.test(code)) offenders.push(`${f} :: ${re}`)
}
if (offenders.length) console.log(`        ${offenders.join("\n        ")}`)
check("27. no IP read or column in any ENG-1 file", offenders.length, 0)

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
