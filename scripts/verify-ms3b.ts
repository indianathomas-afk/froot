/**
 * MS-3b acceptance fixture — raise detection, the manual last-raise date, the
 * cooldown, the daily wage sync, and COMP-1 redaction of raise dates.
 *
 *   npx tsx scripts/verify-ms3b.ts
 *
 * Rulings: docs/prompts/2026-10-16_MS-3b_AUDIT.md (G1–G5, "approved as your
 * leans") and docs/DECISIONS.md 2026-10-16 — MS-3 (F5, F6, F7, F10, F15).
 *
 *   A. Detection, pure — increase only; baseline never a raise; decrease then
 *      increase; 15 → 14 → 15; job change at a higher rate; null rates; salaried
 *      off; the latest raise wins; the date in the MEMBER'S zone across both DST
 *      changes and late evening.
 *   B. Cooldown and redaction, pure — the later of detected and manual (F6);
 *      the day before is in cooldown, the day itself is not; "cooldown" beats
 *      red (G5); no raise on record leaves an MS-3a result unchanged;
 *      redactForViewer DELETES both date keys and no criterion text carries a
 *      date.
 *   C. Gates and structure — milestones.manage is ADMIN-only (MANAGER, STORE,
 *      STAFF refused), off = 404; the route's gate order; StaffLastRaise named
 *      only by raise-history.ts and never `include`d; no src/app file names the
 *      snapshot table; both pages redact before rendering; the cron's wage sync
 *      in its own try and outside `ok`.
 *   D. Database (dev branch) — seeded snapshots end to end through
 *      getRaiseEligibility; set / clear / foreign-org refusal of the manual date;
 *      the RAW JSON per viewer: a MANAGER without labor.costs.view, a MANAGER
 *      on a compConfidential member and a MANAGER on a member with NO wage row
 *      each get the status and no date key or date string; an ADMIN gets both
 *      keys; no result carries a rate; cleanup. Every fixture row is named
 *      "MS-3b …" (CLAUDE.md § Name every test principal).
 */
import "dotenv/config"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Organization } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { can, overridesFrom, type PermissionUser } from "../src/lib/permissions"
import { milestonesDenialStatus } from "../src/lib/milestones-access"
import { getMilestoneSettings } from "../src/lib/attendance"
import { localDateStr } from "../src/lib/reports"
import { addDaysStr } from "../src/lib/labor-schedule"
import { DEFAULT_RAISE_SETTINGS } from "../src/lib/raise-settings"
import {
  applyCooldown,
  effectiveRaise,
  getRaiseEligibility,
  getRaiseSettings,
  redactForViewer,
  type RaiseEligibility,
} from "../src/lib/raise-eligibility"
import {
  detectRaises,
  getManualRaiseDates,
  getRaiseDetailVisibility,
  latestRaise,
  setLastRaiseDate,
  type WageHistoryRow,
} from "../src/lib/raise-history"

let passes = 0
let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const LA = "America/Los_Angeles"
const DEN = "America/Denver"
/// verify-ms3's pattern: a rate or amount reaching an eligibility result.
const PAY_PATTERN = /rate|wage|salary|annual|hourly|amount|pay|\$/i

// ─── A. DETECTION ────────────────────────────────────────────────────────────
console.log("A. Detection (pure)")
const at = (iso: string) => new Date(iso)
const row = (rate: number | null, iso: string, payType: string | null = "HOURLY"): WageHistoryRow => ({ payType, hourlyRate: rate, capturedAt: at(iso) })
const date = (rows: WageHistoryRow[], zone = LA) => latestRaise(rows, zone)?.date ?? null

check("A1. no history → no raise", latestRaise([], LA), null)
check("A2. the baseline snapshot alone is never a raise", latestRaise([row(15, "2026-09-01T18:00:00Z")], LA), null)
check(
  "A3. an increase is a raise, with from/to rates and the capture date",
  latestRaise([row(15, "2026-09-01T18:00:00Z"), row(16.5, "2026-09-20T18:00:00Z")], LA),
  { date: "2026-09-20", capturedAt: at("2026-09-20T18:00:00Z"), fromRate: 15, toRate: 16.5 }
)
check("A4. a decrease is not a raise and resets nothing", date([row(16, "2026-09-01T18:00:00Z"), row(15, "2026-09-10T18:00:00Z")]), null)
check(
  "A5. an earlier raise survives a later decrease",
  date([row(15, "2026-08-01T18:00:00Z"), row(16, "2026-08-10T18:00:00Z"), row(15.5, "2026-09-10T18:00:00Z")]),
  "2026-08-10"
)
check(
  "A6. decrease then increase: the increase is the raise",
  date([row(16, "2026-08-01T18:00:00Z"), row(15, "2026-08-10T18:00:00Z"), row(17, "2026-09-10T18:00:00Z")]),
  "2026-09-10"
)
check(
  "A7. dip and restore 15 → 14 → 15 counts (F5, accepted)",
  date([row(15, "2026-08-01T18:00:00Z"), row(14, "2026-08-10T18:00:00Z"), row(15, "2026-09-10T18:00:00Z")]),
  "2026-09-10"
)
check(
  "A8. a job change at a higher rate is a raise (the snapshot only sees the rate)",
  date([row(15, "2026-08-01T18:00:00Z"), row(18, "2026-09-01T18:00:00Z")]),
  "2026-09-01"
)
check(
  "A9. null on either side is never a raise",
  [date([row(null, "2026-08-01T18:00:00Z"), row(15, "2026-09-01T18:00:00Z")]), date([row(15, "2026-08-01T18:00:00Z"), row(null, "2026-09-01T18:00:00Z")])],
  [null, null]
)
check("A10. a sub-cent difference is not a raise (compared to the cent)", date([row(15, "2026-08-01T18:00:00Z"), row(15.004, "2026-09-01T18:00:00Z")]), null)
check(
  "A11. latest snapshot SALARY → detection off, even with an earlier hourly raise (F5)",
  latestRaise([row(15, "2026-08-01T18:00:00Z"), row(16, "2026-08-10T18:00:00Z"), row(null, "2026-09-01T18:00:00Z", "SALARY")], LA),
  null
)
check(
  "A12. the LATEST of two raises wins",
  date([row(15, "2026-06-01T18:00:00Z"), row(16, "2026-07-01T18:00:00Z"), row(17, "2026-09-01T18:00:00Z")]),
  "2026-09-01"
)
const lateEvening = [row(15, "2026-09-01T18:00:00Z"), row(16, "2026-10-16T05:00:00Z")]
check("A13. late evening: 05:00 UTC is the previous day in LA and Denver, never UTC's", [date(lateEvening, LA), date(lateEvening, DEN), date(lateEvening, "UTC")], ["2026-10-15", "2026-10-15", "2026-10-16"])
check("A14. DST end: 2026-11-02 07:30 UTC is Nov 1 in LA (PST)", date([row(15, "2026-10-01T18:00:00Z"), row(16, "2026-11-02T07:30:00Z")]), "2026-11-01")
check("A15. DST start: 2026-03-08 07:30 UTC is Mar 7 in LA (PST)", date([row(15, "2026-02-01T18:00:00Z"), row(16, "2026-03-08T07:30:00Z")]), "2026-03-07")

// ─── B. COOLDOWN AND REDACTION ───────────────────────────────────────────────
console.log("\nB. Cooldown and redaction (pure)")
check("B1. no raise on record → null", effectiveRaise(null, null), null)
check("B2. detected only", effectiveRaise("2026-09-01", null), { date: "2026-09-01", source: "detected" })
check("B3. manual only (also the salaried case, G4)", effectiveRaise(null, "2026-09-01"), { date: "2026-09-01", source: "manual" })
check("B4. manual LATER than detected → manual (F6)", effectiveRaise("2026-09-01", "2026-09-15"), { date: "2026-09-15", source: "manual" })
check("B5. manual EARLIER than detected → detected (F6)", effectiveRaise("2026-09-15", "2026-09-01"), { date: "2026-09-15", source: "detected" })
check("B6. the same day reads as detected", effectiveRaise("2026-09-15", "2026-09-15"), { date: "2026-09-15", source: "detected" })

const baseResult = (status: RaiseEligibility["status"]): RaiseEligibility => ({
  status,
  criteria: [{ key: "compliance", label: "Compliance", state: status === "red" ? "blocked" : "met", detail: "x" }],
  weeks: { from: "2026-09-21", to: "2026-10-11" },
})
const raised = { date: "2026-09-01", source: "detected" as const }
// 2026-09-01 + 90 days = 2026-11-30, the first eligible day.
check("B7. cooldownUntil = raise date + cooldown days", applyCooldown(baseResult("green"), raised, 90, "2026-10-16").cooldownUntil, "2026-11-30")
check("B8. the day BEFORE is still in cooldown", applyCooldown(baseResult("green"), raised, 90, "2026-11-29").status, "cooldown")
check("B9. the day itself is eligible — back to the MS-3a colour", applyCooldown(baseResult("green"), raised, 90, "2026-11-30").status, "green")
check("B10. G5: cooldown beats red", applyCooldown(baseResult("red"), raised, 90, "2026-10-16").status, "cooldown")
check("B11. no raise on record → the MS-3a result unchanged (no cooldown criterion)", applyCooldown(baseResult("yellow"), null, 90, "2026-10-16"), baseResult("yellow"))
check(
  "B12. the cooldown criterion: in cooldown / after it",
  [applyCooldown(baseResult("green"), raised, 90, "2026-10-16").criteria.at(-1), applyCooldown(baseResult("green"), raised, 90, "2026-12-01").criteria.at(-1)],
  [
    { key: "cooldown", label: "90 days since the last raise", state: "cooldown", detail: "Recent raise — in cooldown." },
    { key: "cooldown", label: "90 days since the last raise", state: "met", detail: "No raise in the last 90 days." },
  ]
)
const full = applyCooldown(baseResult("green"), raised, 90, "2026-10-16")
const hidden = redactForViewer(full, false)
check("B13. redacted: both date keys ABSENT, not null", ["lastRaise" in hidden, "cooldownUntil" in hidden], [false, false])
check("B14. redacted: neither date appears anywhere in the raw JSON", [JSON.stringify(hidden).includes("2026-09-01"), JSON.stringify(hidden).includes("2026-11-30")], [false, false])
check("B15. redacted: the colour survives", hidden.status, "cooldown")
check("B16. visible: the result is untouched", redactForViewer(full, true), full)
check("B17. redaction does not mutate the original", ["lastRaise" in full, "cooldownUntil" in full], [true, true])
check("B18. no criterion text carries a date (redaction is key deletion only)", full.criteria.some((c) => /\d{4}-\d{2}-\d{2}/.test(c.label + c.detail)), false)

// ─── C. GATES AND STRUCTURE ──────────────────────────────────────────────────
console.log("\nC. Gates and structure")
check(
  "C1. milestones.manage: ADMIN only — MANAGER, STORE and STAFF refused (F15)",
  (["ADMIN", "MANAGER", "STORE", "STAFF"] as const).map((role) => can({ role }, "milestones.manage")),
  [true, false, false, false]
)
check("C2. refused = 403, Milestones off = 404", [milestonesDenialStatus("forbidden"), milestonesDenialStatus("disabled")], [403, 404])

const routeSrc = readFileSync("src/app/api/staff/[id]/last-raise/route.ts", "utf8")
const order = [
  'requireMilestones("milestones.manage")',
  "where: { id, organizationId: org.id }",
  "if (!laborOverlayOn(org))",
  "getRaiseDetailVisibility(org, access.actor, [member])",
  "if (!visible.has(member.id))",
].map((s) => routeSrc.indexOf(s))
check("C3. route gate order: milestones.manage → member in org → overlay → pay visibility", order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), true)
check("C4. both handlers run the gate before writing", (routeSrc.match(/const g = await gate\(ctx\)\s*\n\s*if \("error" in g\) return g\.error/g) ?? []).length, 2)
check("C5. a future date is refused on PUT", /date > localDateStr\(new Date\(\), displayTimeZone\(g\.member, g\.org\)\)/.test(routeSrc), true)

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? (n === "generated" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
const srcFiles = walk("src")
check("C6. only raise-history.ts names StaffLastRaise (G1)", srcFiles.filter((f) => /staffLastRaise|StaffLastRaise/.test(readFileSync(f, "utf8"))), [join("src", "lib", "raise-history.ts")])
check("C7. nothing in src includes the StaffMember.lastRaise relation", srcFiles.filter((f) => /lastRaise:\s*(true|\{)/.test(readFileSync(f, "utf8"))), [])
check("C8. no src/app file names the snapshot table (verify-ms1 C20)", srcFiles.filter((f) => f.startsWith(join("src", "app")) && /wageSnapshot|"WageSnapshot"/.test(readFileSync(f, "utf8"))), [])
const eligSrc = readFileSync("src/lib/raise-eligibility.ts", "utf8")
check("C9. the eligibility module still names no wage table or rate column", /wageSnapshot|squareTeamMemberWage|hourlyRate|annualRate|getPayForStaff/.test(eligSrc), false)

const listSrc = readFileSync("src/app/(app)/staff/page.tsx", "utf8")
check(
  "C10. /staff: the raise map is built ONLY from redactForViewer output",
  /raise = new Map\(\[\.\.\.computed\]\.map\(\(\[id, r\]\) => \[id, redactForViewer\(r, raiseVisible\.has\(id\)\)\]\)\)/.test(listSrc) && !/raise = await getRaiseEligibility/.test(listSrc),
  true
)
check("C11. /staff: visibility comes from getRaiseDetailVisibility over the SCOPED roster", /getRaiseDetailVisibility\(org, actor, staff\)/.test(listSrc), true)
const profileSrc = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8")
check(
  "C12. profile: raise is assigned ONLY from redactForViewer output",
  /raise = redactForViewer\(computed, raiseVisible\)/.test(profileSrc) && !/raise = raiseResults/.test(profileSrc),
  true
)
check(
  "C13. profile: the ADMIN control needs pay visibility AND milestones.manage",
  /if \(raiseVisible && can\(actor, "milestones\.manage"\)\) {\s*lastRaiseControl = /.test(profileSrc),
  true
)
check("C14. compact badge renders nothing in cooldown (F7)", /if \(result\.status === "cooldown"\) return null/.test(readFileSync("src/app/(app)/staff/raise-badge.tsx", "utf8")), true)

const cronSrc = readFileSync("src/app/api/cron/labor-timecards/route.ts", "utf8")
check("C15. cron: the wage sync is inside its own try", /try {\s*const w = await syncTeamMemberWages\(org, "ACTIVE"\)/.test(cronSrc), true)
check("C16. cron: it runs after the stores loop, inside the per-org loop", cronSrc.indexOf("const w = await syncTeamMemberWages(org") > cronSrc.indexOf("for (const store of stores)"), true)
check("C17. cron: `ok` still counts timecard failures only", /ok: failed === 0, stores: results\.length, failed, results, wages/.test(cronSrc) && /const failed = results\.filter/.test(cronSrc), true)
const rosterRouteSrc = readFileSync("src/app/api/square/labor/roster/sync/route.ts", "utf8")
check("C18. roster route header no longer claims a debounced refresh exists", /CORRECTED 2026-10-16 \(MS-3b\)/.test(rosterRouteSrc) && !/^\/\/ Freshness rests on this route plus the debounced refresh/m.test(rosterRouteSrc), true)

async function overlayOff() {
  const offOrg = { id: "no-such-org", clerkOrgId: "org_ms3b_off", activeModules: ["hr", "labor"], squareLaborEnabled: false } as unknown as Organization
  const v = await getRaiseDetailVisibility(offOrg, { role: "ADMIN" }, [{ id: "m1", squareTeamMemberId: "TM1" }])
  check("C19. overlay off → no dates for anyone, ADMIN included", v.size, 0)
}

// ─── D. DATABASE ─────────────────────────────────────────────────────────────
async function db() {
  console.log("\nD. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
  console.log(`      branch id: ${branch[0]?.b ?? "(null)"}`)

  const saved = { L: process.env.LABOR_MODULE_AVAILABLE, Q: process.env.SQUARE_LABOR_AVAILABLE }
  process.env.LABOR_MODULE_AVAILABLE = "true"
  process.env.SQUARE_LABOR_AVAILABLE = "true"
  const stamp = Date.now()
  const USER = `ms3b-fixture-user-${stamp}`
  const org = await prisma.organization.create({
    data: { clerkOrgId: `ms3b-fixture-${stamp}`, name: "MS-3b Fixture Org", activeModules: ["hr", "labor"], squareLaborEnabled: true, timezone: LA },
  })
  const other = await prisma.organization.create({ data: { clerkOrgId: `ms3b-fixture-other-${stamp}`, name: "MS-3b Fixture Other Org" } })
  try {
    const now = new Date()
    const today = localDateStr(now, LA)
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)
    const store = await prisma.store.create({ data: { organizationId: org.id, name: "MS-3b Pacific", timezone: LA, squareLocationId: `ms3b-loc-${stamp}` } })
    const tm = (name: string) => `ms3b-tm-${name}-${stamp}`
    const mk = (name: string, linked: boolean, orgId = org.id) =>
      prisma.staffMember.create({
        data: {
          organizationId: orgId,
          displayName: `MS-3b ${name}`,
          squareTeamMemberId: linked ? tm(name) : null,
          startDate: new Date("2025-01-06T00:00:00.000Z"),
          ...(orgId === org.id ? { storeAssignments: { create: [{ storeId: store.id, isPrimary: true }] } } : {}),
        },
      })
    const wageRow = (name: string, compConfidential: boolean, payType = "HOURLY") =>
      prisma.squareTeamMemberWage.create({
        data: { organizationId: org.id, squareTeamMemberId: tm(name), status: "ACTIVE", locationIds: [], payType, hourlyRate: 16, compConfidential, syncedAt: now },
      })
    const snaps = (name: string, list: [number | null, number, string?][]) =>
      prisma.wageSnapshot.createMany({
        data: list.map(([rate, ago, payType]) => ({ organizationId: org.id, squareTeamMemberId: tm(name), payType: payType ?? "HOURLY", hourlyRate: rate, capturedAt: daysAgo(ago) })),
      })

    const R = await mk("Raised", true) // open wage row, raise 10 days ago
    const C = await mk("Confidential", true) // compConfidential wage row, raise 10 days ago
    const U = await mk("Unlinked", false) // no wage row at all; manual date
    const S = await mk("Salaried", true) // hourly raise, then SALARY
    const M = await mk("Manual", true) // detected 10 days ago + manual dates
    const O = await mk("Old", true) // raise 200 days ago — cooldown over
    const N = await mk("Never", true) // baseline only
    const T = await mk("Terminated", true)
    const F = await mk("Foreign", false, other.id)
    await prisma.staffMember.update({ where: { id: T.id }, data: { status: "TERMINATED", terminatedAt: now } })
    await wageRow("Raised", false)
    await wageRow("Confidential", true)
    await wageRow("Salaried", true, "SALARY")
    await wageRow("Manual", false)
    await wageRow("Old", false)
    await wageRow("Never", false)
    await wageRow("Terminated", false)
    await snaps("Raised", [[15, 40], [16, 10]])
    await snaps("Confidential", [[15, 40], [16, 10]])
    await snaps("Salaried", [[15, 60], [16, 30], [null, 5, "SALARY"]])
    await snaps("Manual", [[15, 40], [16, 10]])
    await snaps("Old", [[15, 300], [16, 200]])
    await snaps("Never", [[15, 40]])
    await snaps("Terminated", [[15, 40], [16, 10]])
    const raisedOn = localDateStr(daysAgo(10), LA)

    // ── detectRaises ──
    const zoneOf = (m: { id: string; squareTeamMemberId: string | null }) => ({ id: m.id, squareTeamMemberId: m.squareTeamMemberId, zone: LA })
    const det = await detectRaises(org, [R, C, U, S, M, O, N].map(zoneOf))
    check("D1. detected on the increase, dated in the member's zone", [det.get(R.id)?.date, det.get(R.id)?.fromRate, det.get(R.id)?.toRate], [raisedOn, 15, 16])
    check("D2. baseline only / unlinked / salaried now → nothing detected", [det.has(N.id), det.has(U.id), det.has(S.id)], [false, false, false])
    const detOther = await detectRaises(other, [R].map(zoneOf))
    check("D3. org-scoped: another org reads none of this org's history", detOther.size, 0)

    // ── the manual date write ──
    check("D4. a member of ANOTHER org is refused, nothing written", [await setLastRaiseDate(org.id, F.id, today, USER), await prisma.staffLastRaise.count({ where: { staffMemberId: F.id } })], [{ ok: false, error: "not-found" }, 0])
    await setLastRaiseDate(org.id, U.id, addDaysStr(today, -5), USER)
    await setLastRaiseDate(org.id, M.id, addDaysStr(today, -30), USER) // EARLIER than the detected raise
    check("D5. manual dates read back (org-scoped)", Object.fromEntries(await getManualRaiseDates(org.id, [U.id, M.id, R.id])), { [U.id]: addDaysStr(today, -5), [M.id]: addDaysStr(today, -30) })
    check("D6. ...and not from another org", (await getManualRaiseDates(other.id, [U.id, M.id])).size, 0)

    const fullOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    const settings = await getRaiseSettings(org.id)
    check("D7. default cooldown is 90 days (F13)", settings.raiseCooldownDays, DEFAULT_RAISE_SETTINGS.raiseCooldownDays)
    const members = [R, C, U, S, M, O, N, T]
    const input = members.map((m) => ({ id: m.id, squareTeamMemberId: m.squareTeamMemberId, assignedStoreIds: [store.id], startDate: m.startDate, status: m.id === T.id ? "TERMINATED" : "ACTIVE", zone: LA }))
    const run = async () => getRaiseEligibility(fullOrg, input, settings, await getMilestoneSettings(org.id), { now })
    let res = await run()

    check("D8. raised 10 days ago → cooldown, from the detected date", [res.get(R.id)?.status, res.get(R.id)?.lastRaise, res.get(R.id)?.cooldownUntil], ["cooldown", { date: raisedOn, source: "detected" }, addDaysStr(raisedOn, 90)])
    check("D9. manual EARLIER than detected → the detected date counts", res.get(M.id)?.lastRaise, { date: raisedOn, source: "detected" })
    check("D10. no wage row, manual date 5 days ago → cooldown from the manual date", [res.get(U.id)?.status, res.get(U.id)?.lastRaise], ["cooldown", { date: addDaysStr(today, -5), source: "manual" }])
    check("D11. salaried, no manual date → no raise on record, no cooldown criterion", [res.get(S.id)?.status === "cooldown", "lastRaise" in (res.get(S.id) ?? {}), res.get(S.id)?.criteria.some((c) => c.key === "cooldown")], [false, false, false])
    check("D12. raise 200 days ago → cooldown over, criterion met, MS-3a colour back", [res.get(O.id)?.status === "cooldown", res.get(O.id)?.criteria.find((c) => c.key === "cooldown")?.state], [false, "met"])
    check("D13. baseline only → no cooldown criterion", res.get(N.id)?.criteria.some((c) => c.key === "cooldown"), false)
    check("D14. terminated → no result at all", res.has(T.id), false)

    await setLastRaiseDate(org.id, M.id, addDaysStr(today, -2), USER) // now LATER than detected
    await setLastRaiseDate(org.id, S.id, addDaysStr(today, -3), USER) // G4: a salaried manual date counts
    res = await run()
    check("D15. manual LATER than detected → the manual date counts", res.get(M.id)?.lastRaise, { date: addDaysStr(today, -2), source: "manual" })
    check("D16. G4: salaried + manual date → cooldown", [res.get(S.id)?.status, res.get(S.id)?.lastRaise?.source], ["cooldown", "manual"])
    await setLastRaiseDate(org.id, M.id, null, USER)
    res = await run()
    const cleared = await prisma.staffLastRaise.findUniqueOrThrow({ where: { staffMemberId: M.id } })
    check("D17. cleared → the detected raise is back; the row keeps who cleared it", [res.get(M.id)?.lastRaise, cleared.lastRaiseDate, cleared.setByUserId], [{ date: raisedOn, source: "detected" }, null, USER])

    // ── COMP-1: the raw JSON each viewer gets ──
    const ADMIN: PermissionUser = { role: "ADMIN", overrides: overridesFrom([]) }
    const MANAGER: PermissionUser = { role: "MANAGER", overrides: overridesFrom([]) }
    const NO_PAY_MANAGER: PermissionUser = { role: "MANAGER", overrides: overridesFrom(["labor.costs.view"]) }
    const STORE: PermissionUser = { role: "STORE", overrides: overridesFrom([]) }
    const asSeenBy = async (viewer: PermissionUser) => {
      const visible = await getRaiseDetailVisibility(fullOrg, viewer, members)
      return new Map([...res].map(([id, r]) => [id, redactForViewer(r, visible.has(id))]))
    }
    // `weeks` is the MS-3a judged window — civil dates that are not pay data and
    // can coincide with a raise date (today − 5 can be the last judged Sunday).
    // It is dropped before the date-string search; the KEY check covers it.
    const raw = (m: Map<string, RaiseEligibility>, id: string) => JSON.stringify({ ...m.get(id), weeks: undefined })
    const leaks = (json: string, dates: string[]) => /lastRaise|cooldownUntil/.test(json) || dates.some((d) => json.includes(d))
    const rDates = [raisedOn, addDaysStr(raisedOn, 90)]
    const uDates = [addDaysStr(today, -5), addDaysStr(addDaysStr(today, -5), 90)]

    const asNoPay = await asSeenBy(NO_PAY_MANAGER)
    check("D18. MANAGER denied labor.costs.view: colour, NO date key or date string", [asNoPay.get(R.id)?.status, leaks(raw(asNoPay, R.id), rDates)], ["cooldown", false])
    const asManager = await asSeenBy(MANAGER)
    check("D19. MANAGER on a compConfidential member: colour, NO date key or date string", [asManager.get(C.id)?.status, leaks(raw(asManager, C.id), rDates)], ["cooldown", false])
    check("D20. MANAGER on a member with NO wage row: colour, NO date (fails closed)", [asManager.get(U.id)?.status, leaks(raw(asManager, U.id), uDates)], ["cooldown", false])
    check("D21. MANAGER with pay access on an open member: both date keys", [asManager.get(R.id)?.lastRaise?.date, asManager.get(R.id)?.cooldownUntil], rDates)
    const asAdmin = await asSeenBy(ADMIN)
    check(
      "D22. ADMIN: both keys — the confidential member and the no-wage-row member included (G3)",
      [asAdmin.get(C.id)?.cooldownUntil, asAdmin.get(U.id)?.lastRaise?.date],
      [addDaysStr(raisedOn, 90), addDaysStr(today, -5)]
    )
    const asStore = await asSeenBy(STORE)
    check("D23. STORE: no member's dates visible", [...asStore.values()].some((r) => "lastRaise" in r || "cooldownUntil" in r), false)
    check("D24. no result for ANY viewer carries a rate or amount (F7)", [asAdmin, asManager, asNoPay].some((m) => PAY_PATTERN.test(JSON.stringify([...m.values()]))), false)
    check("D25. ADMIN visibility covers every member passed, wage row or not", (await getRaiseDetailVisibility(fullOrg, ADMIN, members)).size, members.length)
  } finally {
    await prisma.staffLastRaise.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } })
    await prisma.wageSnapshot.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } })
    await prisma.squareTeamMemberWage.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } })
    await prisma.store.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, other.id] } } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "ms3b-fixture" } } })
    check("D26. cleanup: no MS-3b fixture orgs left", left, 0)
    if (saved.L === undefined) delete process.env.LABOR_MODULE_AVAILABLE
    else process.env.LABOR_MODULE_AVAILABLE = saved.L
    if (saved.Q === undefined) delete process.env.SQUARE_LABOR_AVAILABLE
    else process.env.SQUARE_LABOR_AVAILABLE = saved.Q
  }
}

overlayOff()
  .then(db)
  .catch((e) => {
    failures++
    console.error("FAIL  async section threw:", e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\n${passes} passed, ${failures} failed`)
    process.exit(failures === 0 ? 0 : 1)
  })
