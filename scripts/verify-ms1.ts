/**
 * MS-1 — Staff Milestones foundation, pinned.
 *
 *   npx tsx scripts/verify-ms1.ts
 *
 * FOUR KINDS OF CHECK, and the kind says what a green run proves:
 *
 *   A. PURE MATH — tenureProgress / localDateStr in EACH STORE'S OWN ZONE:
 *      Pacific and Mountain at late evening, both DST crossings, whose zone a
 *      member is counted in, terminated members, future start dates, and
 *      archived milestones keeping achievements reached before the archive.
 *   B. CAPABILITY TIERS — milestones.manage is ADMIN-only, not grantable, not
 *      deniable; STORE/STAFF fail staff.view, so they never reach /staff/[id].
 *   C. GATES — milestonesActive() over every combination of its three inputs,
 *      the 404 mapping, and STRUCTURAL reads of the route/page source: every
 *      milestone API asks requireMilestones("milestones.manage") first; the tab
 *      trigger sits behind canSeeHrTabs && milestonesActive; the page 404s an
 *      out-of-scope manager before the tab is computed.
 *   D. DATABASE (dev branch) — the duplicate-dayCount rule, archived milestones
 *      not counted, a manual start date surviving a simulated Square resync,
 *      the @db.Date round trip, and the wage-snapshot "only when it differs"
 *      rule. Every row is created under a fixture org named "MS-1 Fixture Org"
 *      and deleted in `finally`.
 *
 * WHAT IT CANNOT DETECT: that a ROUTE refuses BY REQUEST. No fixture here holds
 * a Clerk session, so C is structural. The by-request evidence is staging:
 * toggle off → GET /api/milestones/tenure 404; Tommy (STORE) → no tab.
 */
import "dotenv/config"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../src/lib/prisma"
import { can, isGrantable, ENFORCED_CAPABILITIES, type PermissionRole } from "../src/lib/permissions"
import { tenureProgress, isValidDateStr, dayCountLabel, dateColumnStr, daysBetween, addDays as addDaysStr } from "../src/lib/milestones"
import { milestonesActive, milestonesDenialStatus } from "../src/lib/milestones-access"
import { createTenureMilestone, updateTenureMilestone } from "../src/lib/milestones-db"
import { startDateFromSquare, squareStartDateData } from "../src/lib/milestones-square"
import { localDateStr } from "../src/lib/reports"
import { displayTimeZone } from "../src/lib/hr"
import { wageChanged, writeWageSnapshots } from "../src/lib/labor-roster"

let failures = 0
let passes = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const LA = "America/Los_Angeles"
const M = (id: string, dayCount: number) => ({ id, dayCount, title: `T${dayCount}`, recognition: "r", employeeMessage: "m" })

// ─── A. PURE MATH ────────────────────────────────────────────────────────────
console.log("\nA. Tenure math, store-local (the UTC trap)")
// 2026-10-16T05:30Z is 22:30 PDT on Oct 15. A UTC slice says the 16th.
const lateEvening = new Date("2026-10-16T05:30:00Z")
check("A1. localDateStr LA at 22:30 PDT is still the 15th", localDateStr(lateEvening, LA), "2026-10-15")
check("A2. …and UTC would say the 16th (the trap exists)", localDateStr(lateEvening, "UTC"), "2026-10-16")
// Start 2026-07-17 + 90 days = 2026-10-15.
const p90 = tenureProgress({ startDate: "2026-07-17", today: localDateStr(lateEvening, LA), terminatedOn: null, milestones: [M("a", 90)] })
check("A3. 90-day milestone achieved on its own Pacific evening", p90.state === "ok" ? p90.achieved.map((a) => a.achievedOn) : null, ["2026-10-15"])
const lateEveningBefore = new Date("2026-10-15T06:30:00Z") // 23:30 PDT Oct 14
const p89 = tenureProgress({ startDate: "2026-07-17", today: localDateStr(lateEveningBefore, LA), terminatedOn: null, milestones: [M("a", 90)] })
check("A4. at 23:30 PDT the day before: not achieved, 1 day to go", p89.state === "ok" ? [p89.achieved.length, p89.next?.daysToGo] : null, [0, 1])
check(
  "A5. a UTC 'today' would have announced it a day early",
  tenureProgress({ startDate: "2026-07-17", today: localDateStr(lateEveningBefore, "UTC"), terminatedOn: null, milestones: [M("a", 90)] }).state === "ok"
    ? (tenureProgress({ startDate: "2026-07-17", today: localDateStr(lateEveningBefore, "UTC"), terminatedOn: null, milestones: [M("a", 90)] }) as { achieved: unknown[] }).achieved.length
    : null,
  1
)
const pst = new Date("2026-12-01T07:30:00Z") // 23:30 PST Nov 30
check("A6. PST boundary: 23:30 PST Nov 30 is Nov 30", localDateStr(pst, LA), "2026-11-30")
check("A7. daysBetween across the DST change is whole days", daysBetween("2026-10-31", "2026-11-02"), 2)
check("A8. no start date", tenureProgress({ startDate: null, today: "2026-10-15", terminatedOn: null, milestones: [M("a", 90)] }).state, "no-start-date")
const future = tenureProgress({ startDate: "2026-10-20", today: "2026-10-15", terminatedOn: null, milestones: [M("a", 90)] })
check("A9. future start: nothing achieved, 95 days to go", future.state === "ok" ? [future.daysEmployed, future.achieved.length, future.next?.daysToGo, future.progressPct] : null, [-5, 0, 95, 0])
const term = tenureProgress({ startDate: "2025-01-01", today: "2026-10-15", terminatedOn: "2025-06-01", milestones: [M("a", 90), M("b", 365)] })
check("A10. terminated: counted to termination, no next (F4)", term.state === "ok" ? [term.asOf, term.achieved.map((a) => a.dayCount), term.next, term.terminated] : null, ["2025-06-01", [90], null, true])
const all = tenureProgress({ startDate: "2020-01-01", today: "2026-10-15", terminatedOn: null, milestones: [M("a", 90), M("b", 365)] })
check("A11. every milestone reached: next null, pct null", all.state === "ok" ? [all.achieved.length, all.next, all.progressPct] : null, [2, null, null])
const mid = tenureProgress({ startDate: "2026-01-01", today: "2026-06-30", terminatedOn: null, milestones: [M("b", 365), M("a", 90)] })
check("A12. progress measured from the last achieved milestone", mid.state === "ok" ? [mid.daysEmployed, mid.next?.dayCount, mid.progressPct] : null, [180, 365, 33])
check("A13. isValidDateStr rejects 2026-02-30", isValidDateStr("2026-02-30"), false)
check("A14. isValidDateStr accepts 2028-02-29", isValidDateStr("2028-02-29"), true)
check("A15. dayCountLabel", [dayCountLabel(90), dayCountLabel(365), dayCountLabel(730), dayCountLabel(1)], ["90 days", "1 year", "2 years", "1 day"])
check(
  "A16. Square created_at 18:15 PST Mar 1 → start date Mar 1, not Mar 2",
  startDateFromSquare("2026-03-02T02:15:00Z", LA)?.toISOString().slice(0, 10),
  "2026-03-01"
)
check("A17. unparseable created_at → no date", startDateFromSquare("not a date", LA), null)

console.log("\nA. Each store's own zone — Mountain time (Gary, 2026-10-15)")
const DEN = "America/Denver"
// 2026-10-16T06:30Z is 00:30 MDT Oct 16 in Colorado — and still 23:30 PDT Oct 15
// in California. A milestone due Oct 16 is reached in Denver, not yet in LA.
const midnightMtn = new Date("2026-10-16T06:30:00Z")
check("A18. Denver says Oct 16 while LA says Oct 15", [localDateStr(midnightMtn, DEN), localDateStr(midnightMtn, LA)], ["2026-10-16", "2026-10-15"])
const due16 = (tz: string) => tenureProgress({ startDate: "2026-07-18", today: localDateStr(midnightMtn, tz), terminatedOn: null, milestones: [M("a", 90)] })
check("A19. Denver store at 00:30 MDT: 90-day milestone reached", (due16(DEN) as { achieved: unknown[] }).achieved.length, 1)
check("A20. same instant read as Pacific would say not yet", (due16(LA) as { achieved: unknown[] }).achieved.length, 0)
const lateMtn = new Date("2026-10-16T05:30:00Z") // 23:30 MDT Oct 15
const late = tenureProgress({ startDate: "2026-07-18", today: localDateStr(lateMtn, DEN), terminatedOn: null, milestones: [M("a", 90)] })
check("A21. Denver store at 23:30 MDT the night before: 1 day to go", late.state === "ok" ? [late.achieved.length, late.next?.daysToGo] : null, [0, 1])
check("A22. …where UTC would already say it was reached", localDateStr(lateMtn, "UTC"), "2026-10-16")
console.log("\nA. Across a DST change (Mountain)")
// Fall back: Sun 2026-11-01. Start 2026-10-01 (MDT) + 60 days = 2026-11-30 (MST).
const fbBefore = new Date("2026-11-30T06:30:00Z") // 23:30 MST Nov 29
const fbOn = new Date("2026-12-01T06:30:00Z") // 23:30 MST Nov 30
const fb = (at: Date) => tenureProgress({ startDate: "2026-10-01", today: localDateStr(at, DEN), terminatedOn: null, milestones: [M("a", 60)] })
check("A23. fall-back crossing: 23:30 MST Nov 29 → 1 day to go", (fb(fbBefore) as { next: { daysToGo: number } }).next.daysToGo, 1)
check("A24. fall-back crossing: 23:30 MST Nov 30 → reached on Nov 30", (fb(fbOn) as { achieved: { achievedOn: string }[] }).achieved.map((a) => a.achievedOn), ["2026-11-30"])
// Spring forward: Sun 2027-03-14. Start 2027-03-01 + 30 days = 2027-03-31 (MDT).
const sf = tenureProgress({ startDate: "2027-03-01", today: localDateStr(new Date("2027-04-01T05:30:00Z"), DEN), terminatedOn: null, milestones: [M("a", 30)] })
check("A25. spring-forward crossing: 23:30 MDT Mar 31 → reached, 30 whole days", sf.state === "ok" ? [sf.daysEmployed, sf.achieved.length] : null, [30, 1])
console.log("\nA. Whose zone a member is counted in")
const denverStore = { isPrimary: true, store: { timezone: DEN, name: "MS-1 Colorado Springs" } }
const laStore = { isPrimary: false, store: { timezone: LA, name: "MS-1 Reno" } }
check("A26. primary store in Denver → Denver", displayTimeZone({ isCorporate: false, storeAssignments: [laStore, denverStore] }, { timezone: LA }), DEN)
check("A27. corporate member → the org's zone", displayTimeZone({ isCorporate: true, storeAssignments: [denverStore] }, { timezone: LA }), LA)
check("A28. Square created_at 22:30 MST → that Mountain date", startDateFromSquare("2026-01-10T05:30:00Z", DEN)?.toISOString().slice(0, 10), "2026-01-09")

console.log("\nA. Archived milestones keep past achievements (Gary, 2026-10-15)")
const arch = (id: string, dayCount: number, archivedOn: string | null) => ({ ...M(id, dayCount), isArchived: true, archivedOn })
const hist = tenureProgress({
  startDate: "2026-01-01",
  today: "2026-10-15",
  terminatedOn: null,
  milestones: [arch("old90", 90, "2026-05-01"), arch("old200", 200, "2026-05-01"), arch("nodate", 30, null), M("a365", 365)],
})
check("A29. reached BEFORE archive (Apr 1 ≤ May 1) → kept, marked archived", hist.state === "ok" ? hist.achieved.map((a) => [a.id, a.archived]) : null, [["old90", true]])
check("A30. reached AFTER archive (Jul 20) → not counted", hist.state === "ok" ? hist.achieved.some((a) => a.id === "old200") : null, false)
check("A31. archived with no archive date → counts for nobody", hist.state === "ok" ? hist.achieved.some((a) => a.id === "nodate") : null, false)
check("A32. next is the ACTIVE 365, never an archived row", hist.state === "ok" ? hist.next?.id : null, "a365")
const onDay = tenureProgress({ startDate: "2026-01-01", today: "2026-10-15", terminatedOn: null, milestones: [arch("x", 90, "2026-04-01")] })
check("A33. reached ON the archive date → kept", onDay.state === "ok" ? onDay.achieved.length : null, 1)
const newHire = tenureProgress({ startDate: "2026-09-01", today: "2026-10-15", terminatedOn: null, milestones: [arch("old30", 30, "2026-05-01"), M("a90", 90)] })
check("A34. someone hired after the archive never gets it", newHire.state === "ok" ? [newHire.achieved.length, newHire.next?.id] : null, [0, "a90"])

// ─── B. CAPABILITIES ─────────────────────────────────────────────────────────
console.log("\nB. milestones.manage — ADMIN only, not grantable, not deniable")
const ROLES: PermissionRole[] = ["ADMIN", "MANAGER", "STORE", "STAFF"]
for (const role of ROLES) check(`B. can ${role}`, can({ role }, "milestones.manage"), role === "ADMIN")
for (const role of ROLES) check(`B. isGrantable ${role}`, isGrantable("milestones.manage", role), false)
check("B. MANAGER with a stored grant is still refused", can({ role: "MANAGER", grants: new Set(["milestones.manage"]) }, "milestones.manage"), false)
check("B. absent from ENFORCED_CAPABILITIES", (ENFORCED_CAPABILITIES as readonly { capability?: string }[]).some((e) => (typeof e === "string" ? e : e.capability) === "milestones.manage"), false)
check("B. STORE fails staff.view (bounced by /staff layout)", can({ role: "STORE" }, "staff.view"), false)
check("B. STAFF fails staff.view (bounced by /staff layout)", can({ role: "STAFF" }, "staff.view"), false)

// ─── C. GATES ────────────────────────────────────────────────────────────────
console.log("\nC. Milestones ON = HR available + HR on + toggle (F5)")
const savedHr = process.env.HR_MODULE_AVAILABLE
const savedInternal = process.env.HR_INTERNAL_ORG_IDS
process.env.HR_MODULE_AVAILABLE = "true"
const on = { clerkOrgId: "org_x", activeModules: ["hr"], milestonesEnabled: true }
check("C1. all three on", milestonesActive(on), true)
check("C2. toggle off → off", milestonesActive({ ...on, milestonesEnabled: false }), false)
check("C3. HR off for the org → off", milestonesActive({ ...on, activeModules: [] }), false)
delete process.env.HR_MODULE_AVAILABLE
delete process.env.HR_INTERNAL_ORG_IDS
check("C4. HR unavailable in this environment → off", milestonesActive(on), false)
if (savedHr !== undefined) process.env.HR_MODULE_AVAILABLE = savedHr
if (savedInternal !== undefined) process.env.HR_INTERNAL_ORG_IDS = savedInternal
check("C5. disabled → 404 (not 403)", milestonesDenialStatus("disabled"), 404)
check("C6. forbidden → 403", milestonesDenialStatus("forbidden"), 403)

console.log("\nC. Structural — every milestone API asks the gate first")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const apiFiles = walk("src/app/api/milestones").filter((f) => f.endsWith("route.ts"))
// MS-2 added src/app/api/milestones/attendance/route.ts — four since 2026-10-16;
// it carries the same gate and is checked in scripts/verify-ms2.ts.
check("C7. four milestone route files (tenure ×2, toggle, MS-2 attendance)", apiFiles.length, 4)
for (const f of apiFiles.filter((f) => f.includes("tenure"))) {
  const src = readFileSync(f, "utf8")
  const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([\s\S]*?\n}/g)]
  check(`C8. ${f}: every handler opens with requireMilestones("milestones.manage")`,
    handlers.length > 0 && handlers.every((h) => /^export async function \w+\([^)]*\)[^{]*{\s*const access = await requireMilestones\("milestones\.manage"\)\s*if \(!access\.ok\) return/.test(h[0])),
    true)
}
const toggleSrc = readFileSync("src/app/api/milestones/toggle/route.ts", "utf8")
check("C9. toggle route: ADMIN inline + HR 404 (F5)", /requireAdmin\(\)/.test(toggleSrc) && /hrModuleAvailable\(org\.clerkOrgId\) \|\| !org\.activeModules\.includes\("hr"\)/.test(toggleSrc), true)
const setupSrc = readFileSync("src/app/(app)/staff/milestones/page.tsx", "utf8")
check("C10. /staff/milestones: requireMilestones(manage) and notFound() when disabled", /requireMilestones\("milestones\.manage"\)/.test(setupSrc) && /access\.reason === "disabled"[^\n]*notFound\(\)/.test(setupSrc), true)
const pageSrc = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8")
check("C11. tab gate is canSeeHrTabs && milestonesActive(org)", /const showMilestonesTab = canSeeHrTabs && milestonesActive\(org\)/.test(pageSrc), true)
check("C12. canSeeHrTabs is ADMIN || MANAGER only", /const canSeeHrTabs = dbUser\?\.role === "ADMIN" \|\| dbUser\?\.role === "MANAGER"/.test(pageSrc), true)
check("C13. trigger renders only behind showMilestonesTab", /\{showMilestonesTab && <TabsTrigger value="milestones">/.test(pageSrc), true)
check("C14. out-of-scope MANAGER: getStaffMember returns null → notFound()", /if \(!isAdmin && !member\.storeAssignments\.some\(\(a\) => storeIds\.includes\(a\.storeId\)\)\) return null/.test(pageSrc) && /if \(!member\) notFound\(\)/.test(pageSrc), true)
check("C15. the scope 404 precedes the tab computation", pageSrc.indexOf("if (!member) notFound()") < pageSrc.indexOf("const showMilestonesTab"), true)
const staffListSrc = readFileSync("src/app/(app)/staff/page.tsx", "utf8")
check("C16. /staff link needs milestonesActive && milestones.manage", /canSetUpMilestones = milestonesActive\(org\) && can\(actor, "milestones\.manage"\)/.test(staffListSrc), true)
const patchSrc = readFileSync("src/app/api/staff/[id]/route.ts", "utf8")
check("C17. a hand edit of startDate sets startDateManual", /fieldData\.startDate = [^\n]+\n\s+fieldData\.startDateManual = true/.test(patchSrc), true)

console.log("\nC. Wage history is visible to nobody (Gary, 2026-10-15: confirm)")
// WageSnapshot has NO reader in MS-1, so no role and no store can see it. The
// only file in src/ allowed to name the table is its writer. MS-3's reader
// must arrive with canSeeWages + store scope + COMP-1, and will fail this check
// until it is added here deliberately.
const touching = walk("src")
  .filter((f) => !f.startsWith(join("src", "generated")))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => /wageSnapshot|"WageSnapshot"/.test(readFileSync(f, "utf8")))
check("C18. only src/lib/labor-roster.ts touches WageSnapshot", touching, [join("src", "lib", "labor-roster.ts")])
const rosterSrc = readFileSync("src/lib/labor-roster.ts", "utf8")
check("C19. the writer returns a COUNT, never snapshot rows", /export async function writeWageSnapshots\([\s\S]*?\): Promise<number>/.test(rosterSrc), true)
check("C20. no API route or page names the table", touching.some((f) => f.includes(join("src", "app"))), false)

// ─── D. DATABASE ─────────────────────────────────────────────────────────────
async function db() {
  console.log("\nD. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
  console.log(`      branch id: ${branch[0]?.b ?? "(null)"}`)

  const stamp = Date.now()
  const org = await prisma.organization.create({ data: { clerkOrgId: `ms1-fixture-${stamp}`, name: "MS-1 Fixture Org" } })
  const other = await prisma.organization.create({ data: { clerkOrgId: `ms1-fixture-other-${stamp}`, name: "MS-1 Fixture Org (other)" } })
  try {
    const f = (dayCount: number) => ({ dayCount, title: `MS-1 ${dayCount}`, recognition: "r", employeeMessage: "m" })

    const a90 = await createTenureMilestone(org.id, f(90))
    check("D1. create 90", typeof a90 === "object", true)
    check("D2. duplicate 90 refused", await createTenureMilestone(org.id, f(90)), "clash")
    const a365 = await createTenureMilestone(org.id, f(365))
    check("D3. create 365", typeof a365 === "object", true)
    const a180 = await createTenureMilestone(org.id, f(180))
    if (typeof a90 !== "object" || typeof a365 !== "object" || typeof a180 !== "object") throw new Error("setup failed")
    check("D4. editing 365 → 90 refused", await updateTenureMilestone(org.id, a365.id, { dayCount: 90 }), "clash")
    const arch = await updateTenureMilestone(org.id, a90.id, { isArchived: true })
    check("D5. archive 90", typeof arch === "object" && arch.isArchived, true)
    const new90 = await createTenureMilestone(org.id, f(90))
    check("D6. archived 90 no longer blocks a new 90", typeof new90 === "object", true)
    check("D7. unarchiving the old 90 now clashes", await updateTenureMilestone(org.id, a90.id, { isArchived: false }), "clash")
    check("D8. another org's id is not-found (no cross-tenant write)", await updateTenureMilestone(other.id, a365.id, { title: "x" }), "not-found")
    check("D9. same dayCount in ANOTHER org is fine", typeof (await createTenureMilestone(other.id, f(365))), "object")

    await updateTenureMilestone(org.id, a180.id, { isArchived: true })
    const a180row = await prisma.tenureMilestone.findUniqueOrThrow({ where: { id: a180.id } })
    check("D10. archiving stamps archivedAt", a180row.archivedAt instanceof Date, true)
    await updateTenureMilestone(org.id, a180.id, { title: "MS-1 180 renamed", isArchived: true })
    const a180again = await prisma.tenureMilestone.findUniqueOrThrow({ where: { id: a180.id } })
    check("D11. re-saving an archived row does not move archivedAt", a180again.archivedAt?.getTime(), a180row.archivedAt?.getTime())
    // The page's exact query and mapping.
    const rows = await prisma.tenureMilestone.findMany({
      where: { organizationId: org.id },
      select: { id: true, dayCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true, archivedAt: true },
    })
    const today = localDateStr(new Date(), LA)
    const asInput = rows.map((r) => ({ ...r, archivedOn: r.isArchived && r.archivedAt ? localDateStr(r.archivedAt, LA) : null }))
    const veteran = tenureProgress({ startDate: "2025-01-01", today, terminatedOn: null, milestones: asInput })
    check(
      "D12. veteran: archived 90 and 180 (reached before today's archive) kept as history",
      veteran.state === "ok"
        ? veteran.achieved.map((m) => [m.dayCount, m.archived]).sort((x, y) => Number(x[0]) - Number(y[0]) || Number(y[1]) - Number(x[1]))
        : null,
      [[90, true], [90, false], [180, true], [365, false]]
    )
    const recent = tenureProgress({ startDate: addDaysStr(today, -30), today, terminatedOn: null, milestones: asInput })
    check("D13. 30-day hire: archived rows never become their next", recent.state === "ok" && typeof new90 === "object" ? recent.next?.id === new90.id : null, true)
    const restored = await updateTenureMilestone(org.id, a180.id, { isArchived: false })
    check("D14. restore clears archivedAt", typeof restored === "object" ? restored.archivedAt : "x", null)

    // Start date: @db.Date round trip and the manual lock.
    const manual = await prisma.staffMember.create({
      data: { organizationId: org.id, displayName: "MS-1 Manual", squareTeamMemberId: `ms1-sq-manual-${stamp}`, startDate: new Date("2020-01-15T00:00:00.000Z"), startDateManual: true },
    })
    const auto = await prisma.staffMember.create({
      data: { organizationId: org.id, displayName: "MS-1 Auto", squareTeamMemberId: `ms1-sq-auto-${stamp}` },
    })
    const readBack = await prisma.staffMember.findUniqueOrThrow({ where: { id: manual.id } })
    check("D15. @db.Date round trip keeps the calendar date", readBack.startDate ? dateColumnStr(readBack.startDate) : null, "2020-01-15")
    // Simulated resync: the exact rule both routes apply.
    const createdAt = "2024-05-05T03:00:00Z" // 20:00 PDT May 4
    for (const m of [manual, auto]) {
      await prisma.staffMember.update({ where: { id: m.id }, data: { ...squareStartDateData(m.startDateManual, createdAt, LA) } })
    }
    const [m2, a2] = await Promise.all([
      prisma.staffMember.findUniqueOrThrow({ where: { id: manual.id } }),
      prisma.staffMember.findUniqueOrThrow({ where: { id: auto.id } }),
    ])
    check("D16. manual start date survives a resync", m2.startDate ? dateColumnStr(m2.startDate) : null, "2020-01-15")
    check("D17. unlocked start date filled from created_at, Pacific date", a2.startDate ? dateColumnStr(a2.startDate) : null, "2024-05-04")
    check("D18. manual member: Square's date still recorded beside it", m2.squareStartDate ? dateColumnStr(m2.squareStartDate) : null, "2024-05-04")
    check("D19. unlocked member: squareStartDate equals startDate", a2.squareStartDate ? dateColumnStr(a2.squareStartDate) : null, "2024-05-04")

    // Wage snapshots — only when the wage differs (F3).
    console.log("\nD. Wage snapshots")
    check("D20. wageChanged: none before → changed", wageChanged(null, { payType: "HOURLY", hourlyRate: 15, annualRate: null }), true)
    check("D21. wageChanged: same to the cent → not", wageChanged({ payType: "HOURLY", hourlyRate: 15.0, annualRate: null }, { payType: "HOURLY", hourlyRate: 15.001, annualRate: null }), false)
    const sq = `ms1-sq-wage-${stamp}`
    const member = (cents: number, version: number) => ({
      id: sq,
      wage_setting: { version, job_assignments: [{ pay_type: "HOURLY", hourly_rate: { amount: cents, currency: "USD" }, job_id: "J1" }] },
    })
    check("D22. first sync (baseline for everyone, Gary 2026-10-15) writes a baseline snapshot", await writeWageSnapshots(org.id, [member(1500, 1)], new Map()), 1)
    check("D23. same wage, next sync → nothing", await writeWageSnapshots(org.id, [member(1500, 1)], new Map()), 0)
    check("D24. version bump, same pay → nothing (not a raise)", await writeWageSnapshots(org.id, [member(1500, 2)], new Map()), 0)
    check("D25. raise to $16.50 → one snapshot", await writeWageSnapshots(org.id, [member(1650, 3)], new Map()), 1)
    const snaps = await prisma.wageSnapshot.findMany({ where: { organizationId: org.id, squareTeamMemberId: sq }, orderBy: { capturedAt: "asc" } })
    check("D26. history reads 15.00 → 16.50", snaps.map((s) => Number(s.hourlyRate)), [15, 16.5])
    const noWage = { id: `ms1-sq-fb-${stamp}` }
    const twoMembers = [{ id: `ms1-sq-base1-${stamp}`, wage_setting: { job_assignments: [{ pay_type: "HOURLY", hourly_rate: { amount: 1800 } }] } }, { id: `ms1-sq-base2-${stamp}`, wage_setting: { job_assignments: [{ pay_type: "SALARY", annual_rate: { amount: 5200000 } }] } }]
    check("D28a. first sync gives EVERY member a baseline row, even with pay that never changes", await writeWageSnapshots(org.id, twoMembers, new Map()), 2)
    check("D28b. …and the next sync adds none", await writeWageSnapshots(org.id, twoMembers, new Map()), 0)
    check(
      "D27. no wage_setting: the ListTeamMemberWages fallback rate is snapshotted",
      await writeWageSnapshots(org.id, [noWage], new Map([[noWage.id, { hourlyRate: 17.25, jobTitle: null, jobId: "J2" }]])),
      1
    )
  } finally {
    for (const o of [org.id, other.id]) {
      await prisma.wageSnapshot.deleteMany({ where: { organizationId: o } })
      await prisma.tenureMilestone.deleteMany({ where: { organizationId: o } })
      await prisma.staffMember.deleteMany({ where: { organizationId: o } })
      await prisma.organization.delete({ where: { id: o } })
    }
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: `ms1-fixture` } } })
    check("D29. cleanup: no MS-1 fixture orgs left", left, 0)
  }
}

db()
  .catch((e) => {
    failures++
    console.error("FAIL  database section threw:", e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\n${passes} passed, ${failures} failed`)
    process.exit(failures === 0 ? 0 : 1)
  })
