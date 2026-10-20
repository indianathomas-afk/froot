/**
 * MS-3a acceptance fixture — Staff Milestones raise eligibility: settings,
 * criteria and the Raise badge. (Raise detection, the manual last-raise date and
 * the cooldown are MS-3b and have their own fixture.)
 *
 *   npx tsx scripts/verify-ms3.ts
 *
 * Rulings: docs/prompts/2026-10-16_MS-3_AUDIT.md and Gary's 2026-10-16 fork
 * rulings (DECISIONS draft, 2026-10-16 — MS-3).
 *
 *   A. Settings — code defaults equal the schema @defaults (F13: 20 h, 3 weeks,
 *      90%, 90 days, gate on), the validator's bounds and refusals, F14.
 *   B. The pure rule — completed weeks only (partial current week ignored),
 *      hours X-1/X, weeks Y-1/Y, on-time at the minimum, thin data never green
 *      (F9), compliance gate (b) on/off, trainings and documents required vs
 *      not and "N/A — not assigned" (F11), every colour (F1), all-off (F14),
 *      and no pay field anywhere in a result.
 *   C. Gates — the settings route is milestones.manage on both handlers,
 *      STORE/STAFF refused, toggle off = 404, the Raise badge rides the On-Time
 *      gate on both pages (ADMIN/MANAGER, Milestones on, MANAGER scope via the
 *      roster), overlay off returns nothing (F12), and the eligibility module
 *      reads no wage table (the MS-3a/MS-3b split). MS-3c: the amber
 *      "Raise in progress" compact badge renders nothing on /staff; green and
 *      red still do, and the tab shows every state.
 *   D. Database (dev branch) — settings save/refuse/read-back, archived and
 *      foreign ids refused, then the batched read end to end on seeded Square
 *      rows, trainings and documents: one member per colour, store-zone dating,
 *      thin data, N/A, terminated, overlay off, raw-JSON pay check, cleanup.
 *      Every fixture row is named "MS-3 …" (CLAUDE.md § Name every test
 *      principal).
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Organization } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { can, type PermissionRole } from "../src/lib/permissions"
import { milestonesDenialStatus } from "../src/lib/milestones-access"
import { DEFAULT_MILESTONE_SETTINGS, getMilestoneSettings, type OnTimeResult } from "../src/lib/attendance"
import { localDateStr } from "../src/lib/reports"
import { addDaysStr, localMidnightUtc } from "../src/lib/labor-schedule"
import type { StaffComplianceDetail } from "../src/lib/hr-compliance"
import {
  COOLDOWN_CHOICES,
  DEFAULT_RAISE_SETTINGS,
  everyCriterionOff,
  raiseSettingsProblem,
  type RaiseSettingsValues,
} from "../src/lib/raise-settings"
import {
  assembleRaise,
  completedWeeks,
  getRaiseEligibility,
  getRaiseSettings,
  saveRaiseSettings,
  type RaiseEligibility,
  type RaiseMemberInputs,
} from "../src/lib/raise-eligibility"
import { RaiseBadge, RaiseCard } from "../src/app/(app)/staff/raise-badge"

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
/// Any key or text that would mean pay data reached a result. MS-3a reads no
/// wage table at all, so a result must contain none of these.
const PAY_PATTERN = /rate|wage|salary|annual|hourly|amount|pay|\$/i

// ─── A. SETTINGS ─────────────────────────────────────────────────────────────
console.log("A. Settings")
const schema = readFileSync("prisma/schema.prisma", "utf8")
const ms = schema.slice(schema.indexOf("model MilestoneSettings {"))
const msBody = ms.slice(0, ms.indexOf("\n}"))
const schemaDefault = (field: string) => {
  const m = msBody.match(new RegExp(`\\n\\s+${field}\\s+\\w+\\s+@default\\(([^)]+)\\)`))
  return m ? (m[1] === "true" ? true : m[1] === "false" ? false : Number(m[1])) : null
}
check(
  "A1. code defaults equal the schema @defaults (F13)",
  ["raiseComplianceGate", "raiseMinHoursPerWeek", "raiseConsecutiveWeeks", "raiseMinOnTimePct", "raiseCooldownDays"].map(schemaDefault),
  [true, 20, 3, 90, 90]
)
check(
  "A2. ...and the code object says the same",
  [DEFAULT_RAISE_SETTINGS.raiseComplianceGate, DEFAULT_RAISE_SETTINGS.raiseMinHoursPerWeek, DEFAULT_RAISE_SETTINGS.raiseConsecutiveWeeks, DEFAULT_RAISE_SETTINGS.raiseMinOnTimePct, DEFAULT_RAISE_SETTINGS.raiseCooldownDays],
  [true, 20, 3, 90, 90]
)
check("A3. cooldown presets are ruling 4's", [...COOLDOWN_CHOICES], [30, 60, 90, 180])
const V = (o: Partial<RaiseSettingsValues> = {}): RaiseSettingsValues => ({ ...DEFAULT_RAISE_SETTINGS, ...o })
check("A4. defaults valid", raiseSettingsProblem(V()), null)
check("A5. hours 61 refused", raiseSettingsProblem(V({ raiseMinHoursPerWeek: 61 })) !== null, true)
check("A6. hours -1 refused, 0 (off) and 60 allowed", [raiseSettingsProblem(V({ raiseMinHoursPerWeek: -1 })) !== null, raiseSettingsProblem(V({ raiseMinHoursPerWeek: 0 })), raiseSettingsProblem(V({ raiseMinHoursPerWeek: 60 }))], [true, null, null])
check("A7. weeks 0 and 27 refused, 1 and 26 allowed", [0, 27, 1, 26].map((w) => raiseSettingsProblem(V({ raiseConsecutiveWeeks: w })) === null), [false, false, true, true])
check("A8. on-time 101 refused, 0 (off) and 100 allowed", [101, 0, 100].map((p) => raiseSettingsProblem(V({ raiseMinOnTimePct: p })) === null), [false, true, true])
check("A9. custom cooldown 0 and 731 refused, 1, 45 and 730 allowed", [0, 731, 1, 45, 730].map((d) => raiseSettingsProblem(V({ raiseCooldownDays: d })) === null), [false, false, true, true, true])
check("A10. fractional hours refused", raiseSettingsProblem(V({ raiseMinHoursPerWeek: 19.5 })), "Every number must be a whole number.")
check("A11. a duplicated training id refused", raiseSettingsProblem(V({ requiredTrainingIds: ["a", "a"] })), "A training or document is listed twice.")
check("A12. F14: every criterion off detected", [everyCriterionOff(V()), everyCriterionOff(V({ raiseComplianceGate: false, raiseMinHoursPerWeek: 0, raiseMinOnTimePct: 0 }))], [false, true])

// ─── B. THE PURE RULE ────────────────────────────────────────────────────────
console.log("\nB. The pure rule")
// Friday 2026-10-16: the current week began Monday 10-12 and is never counted.
const WEEKS = ["2026-09-21", "2026-09-28", "2026-10-05"]
check("B1. last 3 completed weeks from a Friday", completedWeeks("2026-10-16", 3), WEEKS)
check("B2. from that week's Monday — still excludes the current week", completedWeeks("2026-10-12", 3), WEEKS)
check("B3. from that week's Sunday — still excludes the current week", completedWeeks("2026-10-18", 3), WEEKS)
check("B4. from the next Monday — the window moves by one", completedWeeks("2026-10-19", 3), ["2026-09-28", "2026-10-05", "2026-10-12"])

const onTimeOk = (percent: number, onTime = 18, total = 20): OnTimeResult => ({
  status: percent >= 90 ? "green" : percent >= 80 ? "amber" : "red",
  reason: null,
  onTime,
  total,
  percent,
  displayPercent: Math.floor(percent),
  range: { from: WEEKS[0], to: "2026-10-11" },
})
const compliance = (items: StaffComplianceDetail["items"]): StaffComplianceDetail =>
  ({ staffId: "m", items, pct: items.length ? 0 : null } as unknown as StaffComplianceDetail)
const doc = (documentId: string, status: string) => ({ kind: "document", documentId, status }) as unknown as StaffComplianceDetail["items"][number]
const training = (status: string) => ({ kind: "training", status }) as unknown as StaffComplianceDetail["items"][number]
const H = (h: number) => h * 60
const base = (o: Partial<RaiseMemberInputs> = {}): RaiseMemberInputs => ({
  settings: V(),
  weeks: WEEKS,
  minutesByWeek: new Map(WEEKS.map((w) => [w, H(25)])),
  dataStart: "2026-01-01",
  startDate: "2025-01-01",
  linked: true,
  compliance: compliance([]),
  onTime: onTimeOk(95),
  requiredTrainings: [],
  trainingStatus: new Map(),
  requiredDocuments: [],
  ...o,
})
const st = (r: RaiseEligibility, key: string) => r.criteria.find((c) => c.key === key)?.state ?? "absent"

check("B5. everything met → green", assembleRaise(base()).status, "green")
check("B6. weeks judged: Monday of the first to Sunday of the last", assembleRaise(base()).weeks, { from: "2026-09-21", to: "2026-10-11" })
const hoursAt = (minutes: number) => base({ minutesByWeek: new Map([[WEEKS[0], H(25)], [WEEKS[1], minutes], [WEEKS[2], H(25)]]) })
check("B7. hours X-1 minute (19:59) in one week → not met, yellow", [st(assembleRaise(hoursAt(H(20) - 1)), "hours"), assembleRaise(hoursAt(H(20) - 1)).status], ["not-met", "yellow"])
check("B8. hours exactly X (20:00) → met, green", [st(assembleRaise(hoursAt(H(20))), "hours"), assembleRaise(hoursAt(H(20))).status], ["met", "green"])
const twoGood = base({ minutesByWeek: new Map([[WEEKS[1], H(25)], [WEEKS[2], H(25)]]) })
check("B9. Y-1 weeks at the minimum (oldest week empty but covered) → not met", st(assembleRaise(twoGood), "hours"), "not-met")
check("B10. Y weeks at the minimum → met", st(assembleRaise(base()), "hours"), "met")
check(
  "B11. setting weeks to 2 judges only the last two completed weeks",
  st(assembleRaise({ ...twoGood, settings: V({ raiseConsecutiveWeeks: 2 }), weeks: completedWeeks("2026-10-16", 2) }), "hours"),
  "met"
)
check(
  "B12. hours in the CURRENT week never count (only the judged Mondays are read)",
  st(assembleRaise(base({ minutesByWeek: new Map([[WEEKS[1], H(25)], [WEEKS[2], H(25)], ["2026-10-12", H(80)]]) })), "hours"),
  "not-met"
)
check("B13. F9: Froot's timecards start mid-window → no data, yellow, never green", [st(assembleRaise(base({ dataStart: "2026-09-22" })), "hours"), assembleRaise(base({ dataStart: "2026-09-22" })).status], ["no-data", "yellow"])
check("B14. F9: dataStart exactly the first Monday → covered", st(assembleRaise(base({ dataStart: WEEKS[0] })), "hours"), "met")
check("B15. F9: started after the first Monday → no data, yellow", [st(assembleRaise(base({ startDate: "2026-09-23" })), "hours"), assembleRaise(base({ startDate: "2026-09-23" })).status], ["no-data", "yellow"])
check("B16. F9: no timecards at all at their stores → no data", st(assembleRaise(base({ dataStart: null })), "hours"), "no-data")
check("B17. a covered SHORT week beats missing data: not met", st(assembleRaise(base({ dataStart: "2026-09-22", minutesByWeek: new Map([[WEEKS[1], H(5)], [WEEKS[2], H(25)]]) })), "hours"), "not-met")
check("B18. not linked to Square → hours no data", st(assembleRaise(base({ linked: false })), "hours"), "no-data")

check("B19. on-time exactly at the minimum (90.0%) → met, green", [st(assembleRaise(base({ onTime: onTimeOk(90) })), "onTime"), assembleRaise(base({ onTime: onTimeOk(90) })).status], ["met", "green"])
check("B20. on-time 89.99% with enough shifts → blocked, RED", [st(assembleRaise(base({ onTime: onTimeOk(89.99) })), "onTime"), assembleRaise(base({ onTime: onTimeOk(89.99) })).status], ["blocked", "red"])
const grey = (status: OnTimeResult["status"]): OnTimeResult => ({ status, reason: null, onTime: 1, total: 2, percent: 50, displayPercent: 50, range: { from: WEEKS[0], to: "2026-10-11" } })
check(
  "B21. F4: not enough shifts / no schedule / not linked → no data, YELLOW not red",
  (["not-enough", "no-schedule", "not-linked"] as const).map((s) => [st(assembleRaise(base({ onTime: grey(s) })), "onTime"), assembleRaise(base({ onTime: grey(s) })).status]),
  [["no-data", "yellow"], ["no-data", "yellow"], ["no-data", "yellow"]]
)

check("B22. gate (b): an OVERDUE training → blocked, RED", assembleRaise(base({ compliance: compliance([training("overdue")]) })).status, "red")
check("B23. gate (b): a training in progress but not overdue → gate met", st(assembleRaise(base({ compliance: compliance([training("in-progress"), training("not-started")]) })), "compliance"), "met")
check("B24. gate (b): ANY unsigned required document → RED", ["in-progress", "not-started", "needs-resign"].map((s) => assembleRaise(base({ compliance: compliance([doc("d", s)]) })).status), ["red", "red", "red"])
check("B25. gate (b): signed document and completed training → met", st(assembleRaise(base({ compliance: compliance([doc("d", "complete"), training("complete")]) })), "compliance"), "met")
check("B26. gate: nothing assigned → met", st(assembleRaise(base({ compliance: compliance([]) })), "compliance"), "met")
check(
  "B27. gate OFF: an overdue training is not judged (criterion absent) → green",
  [st(assembleRaise(base({ settings: V({ raiseComplianceGate: false }), compliance: compliance([training("overdue")]) })), "compliance"), assembleRaise(base({ settings: V({ raiseComplianceGate: false }), compliance: compliance([training("overdue")]) })).status],
  ["absent", "green"]
)

const T1 = { id: "t1", title: "MS-3 Food Safety" }
const D1 = { id: "d1", title: "MS-3 Handbook" }
check("B28. no trainings/documents required → neither criterion shown", [st(assembleRaise(base()), "trainings"), st(assembleRaise(base()), "documents")], ["absent", "absent"])
check("B29. required training Completed → met", st(assembleRaise(base({ requiredTrainings: [T1], trainingStatus: new Map([["t1", "Completed"]]) })), "trainings"), "met")
check("B30. required training InProgress → not met, yellow", [st(assembleRaise(base({ requiredTrainings: [T1], trainingStatus: new Map([["t1", "InProgress"]]) })), "trainings"), assembleRaise(base({ requiredTrainings: [T1], trainingStatus: new Map([["t1", "InProgress"]]) })).status], ["not-met", "yellow"])
const naT = assembleRaise(base({ requiredTrainings: [T1] }))
check("B31. F11: required training NOT ASSIGNED → N/A, not yellow → green", [st(naT, "trainings"), naT.status, naT.criteria.find((c) => c.key === "trainings")?.detail], ["na", "green", "N/A — not assigned: MS-3 Food Safety."])
check("B32. required document signed → met", st(assembleRaise(base({ requiredDocuments: [D1], compliance: compliance([doc("d1", "complete")]) })), "documents"), "met")
check(
  "B33. required document unsigned (gate OFF) → documents not met, yellow",
  [st(assembleRaise(base({ settings: V({ raiseComplianceGate: false }), requiredDocuments: [D1], compliance: compliance([doc("d1", "in-progress")]) })), "documents"), assembleRaise(base({ settings: V({ raiseComplianceGate: false }), requiredDocuments: [D1], compliance: compliance([doc("d1", "in-progress")]) })).status],
  ["not-met", "yellow"]
)
const naD = assembleRaise(base({ requiredDocuments: [D1], compliance: compliance([]) }))
check("B34. F11: required document NOT ASSIGNED (outside their audience) → N/A, green", [st(naD, "documents"), naD.status], ["na", "green"])

check("B35. F1: red beats yellow (overdue training AND short hours)", assembleRaise({ ...hoursAt(H(1)), compliance: compliance([training("overdue")]) }).status, "red")
check("B36. F1: yellow beats green (one no-data among mets)", assembleRaise(base({ onTime: grey("not-enough") })).status, "yellow")
const allOff = assembleRaise(base({ settings: V({ raiseComplianceGate: false, raiseMinHoursPerWeek: 0, raiseMinOnTimePct: 0 }), linked: false, onTime: undefined }))
check("B37. F14: every criterion off → no criteria, green", [allOff.criteria.length, allOff.status], [0, "green"])
check("B38. on-time switched off (0) → not judged", st(assembleRaise(base({ settings: V({ raiseMinOnTimePct: 0 }), onTime: onTimeOk(10) })), "onTime"), "absent")
const everyResult = [base(), hoursAt(H(1)), base({ onTime: onTimeOk(50) }), base({ requiredTrainings: [T1], requiredDocuments: [D1] })].map(assembleRaise)
check("B39. no pay key or value in any result (MS-3a reads no wage data)", PAY_PATTERN.test(JSON.stringify(everyResult)), false)

// ─── C. GATES ────────────────────────────────────────────────────────────────
console.log("\nC. Gates")
check("C1. Milestones off → the settings route answers 404", milestonesDenialStatus("disabled"), 404)
const ROLES: PermissionRole[] = ["ADMIN", "MANAGER", "STORE", "STAFF"]
for (const role of ROLES) check(`C2. raise settings capability: ${role}`, can({ role }, "milestones.manage"), role === "ADMIN")
check("C3. MANAGER on the settings route → 403", milestonesDenialStatus("forbidden"), 403)
check("C4. STORE and STAFF never reach /staff (staff.view)", [can({ role: "STORE" }, "staff.view"), can({ role: "STAFF" }, "staff.view")], [false, false])
const routeSrc = readFileSync("src/app/api/milestones/raise/route.ts", "utf8")
const handlers = [...routeSrc.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([\s\S]*?\n}/g)]
check("C5. raise route: GET and PUT only", handlers.map((h) => h[1]), ["GET", "PUT"])
check(
  'C6. every handler opens with requireMilestones("milestones.manage")',
  handlers.every((h) => /^export async function \w+\([^)]*\)[^{]*{\s*const access = await requireMilestones\("milestones\.manage"\)\s*if \(!access\.ok\) return/.test(h[0])),
  true
)
const listSrc = readFileSync("src/app/(app)/staff/page.tsx", "utf8")
check(
  "C7. /staff badge gate unchanged: Milestones on AND role ADMIN or MANAGER",
  /const showOnTime = milestonesActive\(org\) && \(dbUser\?\.role === "ADMIN" \|\| dbUser\?\.role === "MANAGER"\)/.test(listSrc),
  true
)
check("C8. /staff computes raise eligibility only inside that gate", /if \(showOnTime\) {[\s\S]*?getRaiseEligibility\([\s\S]*?\n {2}}\n/.test(listSrc) && listSrc.indexOf("getRaiseEligibility(") > listSrc.indexOf("if (showOnTime) {"), true)
check("C9. /staff passes the SCOPED roster (MANAGER store scope) to it", /getRaiseEligibility\(\s*org,\s*staff\.map\(/.test(listSrc), true)
const profileSrc = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8")
check("C10. tab gate unchanged: canSeeHrTabs && milestonesActive(org)", /const showMilestonesTab = canSeeHrTabs && milestonesActive\(org\)/.test(profileSrc), true)
const tabBlock = profileSrc.slice(profileSrc.indexOf("if (showMilestonesTab) {\n    const settings"))
check("C11. tab: raise eligibility computed only under showMilestonesTab", tabBlock.indexOf("getRaiseEligibility(") > 0 && tabBlock.indexOf("getRaiseEligibility(") < tabBlock.indexOf("\n  }\n"), true)
check(
  "C12. out-of-scope MANAGER 404 precedes the raise computation",
  profileSrc.indexOf("if (!member) notFound()") > 0 && profileSrc.indexOf("if (!member) notFound()") < profileSrc.indexOf("getRaiseEligibility("),
  true
)
check("C13. the Raise card renders only inside the Milestones tab content", /{showMilestonesTab && milestoneProgress && \([\s\S]*?{raise && <RaiseCard result={raise} \/>}/.test(profileSrc), true)
const libSrc = readFileSync("src/lib/raise-eligibility.ts", "utf8")
check("C14. the eligibility module names no wage table or rate column (MS-3a reads no pay)", /wageSnapshot|squareTeamMemberWage|hourlyRate|annualRate|getPayForStaff/.test(libSrc), false)
check("C15. overlay check is the first thing the read does (F12)", /const out = new Map<string, RaiseEligibility>\(\)\s*if \(!laborOverlayOn\(org\)\) return out/.test(libSrc), true)
// MS-3c (Gary, 2026-10-17): no amber "Raise in progress" on /staff — the
// compact badge renders nothing for yellow, as for cooldown (MS-3b F7). Green
// and red still show there; the tab's full badge and card show every state.
const STATUSES = ["green", "yellow", "red", "cooldown"] as const
const asStatus = (status: (typeof STATUSES)[number]): RaiseEligibility => ({ ...assembleRaise(base()), status })
check("C17. MS-3c: /staff compact badge per status (green, yellow, red, cooldown)", STATUSES.map((s) => RaiseBadge({ result: asStatus(s), size: "compact" }) !== null), [true, false, true, false])
check("C18. MS-3c: tab full badge still renders every status", STATUSES.map((s) => RaiseBadge({ result: asStatus(s), size: "full" }) !== null), [true, true, true, true])
check("C19. MS-3c: tab card still renders for amber", RaiseCard({ result: asStatus("yellow") }) !== null, true)

async function overlayOff() {
  const fakeOrg = { id: "no-such-org", clerkOrgId: "org_ms3_off", activeModules: ["hr"], squareLaborEnabled: false } as unknown as Organization
  const r = await getRaiseEligibility(
    fakeOrg,
    [{ id: "m1", squareTeamMemberId: "TM1", assignedStoreIds: [], startDate: null, status: "ACTIVE", zone: LA }],
    V(),
    DEFAULT_MILESTONE_SETTINGS
  )
  check("C16. F12: Square labor off → no result for anyone, no read", r.size, 0)
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
  const USER = `ms3-fixture-user-${stamp}`
  const org = await prisma.organization.create({
    data: { clerkOrgId: `ms3-fixture-${stamp}`, name: "MS-3 Fixture Org", activeModules: ["hr", "labor"], squareLaborEnabled: true, timezone: LA },
  })
  const other = await prisma.organization.create({ data: { clerkOrgId: `ms3-fixture-other-${stamp}`, name: "MS-3 Fixture Other Org" } })
  try {
    // ── settings ──
    check("D1. no settings row → defaults", await getRaiseSettings(org.id), DEFAULT_RAISE_SETTINGS)
    check("D2. hours 61 refused, nothing written", [
      (await saveRaiseSettings(org.id, V({ raiseMinHoursPerWeek: 61 }))).ok,
      await prisma.milestoneSettings.count({ where: { organizationId: org.id } }),
    ], [false, 0])

    const food = await prisma.trainingModule.create({ data: { organizationId: org.id, title: "MS-3 Food Safety" } })
    const overdueMod = await prisma.trainingModule.create({ data: { organizationId: org.id, title: "MS-3 Overdue Module" } })
    const archivedMod = await prisma.trainingModule.create({ data: { organizationId: org.id, title: "MS-3 Archived Module", isArchived: true } })
    const foreignMod = await prisma.trainingModule.create({ data: { organizationId: other.id, title: "MS-3 Foreign Module" } })
    const handbook = await prisma.hrDocument.create({
      data: { organizationId: org.id, kind: "Acknowledgment", title: "MS-3 Handbook", category: "Other", appliesTo: "selected", requiresAcknowledgment: true },
    })
    const reference = await prisma.hrDocument.create({ data: { organizationId: org.id, kind: "Reference", title: "MS-3 Reference", category: "Other" } })

    check("D3. archived training id refused", (await saveRaiseSettings(org.id, V({ requiredTrainingIds: [archivedMod.id] }))).ok, false)
    check("D4. another org's training id refused", (await saveRaiseSettings(org.id, V({ requiredTrainingIds: [foreignMod.id] }))).ok, false)
    check("D5. a non-compliance document (Reference) refused", (await saveRaiseSettings(org.id, V({ requiredDocumentIds: [reference.id] }))).ok, false)
    check("D6. ...and still no row written", await prisma.milestoneSettings.count({ where: { organizationId: org.id } }), 0)

    const good = V({ requiredTrainingIds: [food.id], requiredDocumentIds: [handbook.id] })
    check("D7. valid save with a required training and document", (await saveRaiseSettings(org.id, good)).ok, true)
    check("D8. read back", await getRaiseSettings(org.id), good)
    check("D9. the On-time settings on the same row are untouched (still defaults)", await getMilestoneSettings(org.id), DEFAULT_MILESTONE_SETTINGS)
    await saveRaiseSettings(org.id, V({ requiredTrainingIds: [overdueMod.id], requiredDocumentIds: [] }))
    check("D10. a second save REPLACES both lists on the one row", [
      await prisma.milestoneSettings.count({ where: { organizationId: org.id } }),
      (await getRaiseSettings(org.id)).requiredTrainingIds,
      (await getRaiseSettings(org.id)).requiredDocumentIds,
    ], [1, [overdueMod.id], []])
    await saveRaiseSettings(org.id, good)
    await prisma.trainingModule.update({ where: { id: food.id }, data: { isArchived: true } })
    check("D11. a required training archived later drops out of the settings read", (await getRaiseSettings(org.id)).requiredTrainingIds, [])
    await prisma.trainingModule.update({ where: { id: food.id }, data: { isArchived: false } })

    // ── seeded Square rows ──
    const pac = await prisma.store.create({ data: { organizationId: org.id, name: "MS-3 Pacific", timezone: LA, squareLocationId: `ms3-loc-p-${stamp}` } })
    const den = await prisma.store.create({ data: { organizationId: org.id, name: "MS-3 Denver", timezone: DEN, squareLocationId: `ms3-loc-d-${stamp}` } })
    const now = new Date()
    const weeks = completedWeeks(localDateStr(now, LA), 3)
    const longAgo = new Date("2025-01-06T00:00:00.000Z")
    const mk = (name: string, linked: boolean, stores: string[], startDate: Date) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: name,
          squareTeamMemberId: linked ? `ms3-tm-${name.replace(/\W/g, "")}-${stamp}` : null,
          startDate,
          storeAssignments: { create: stores.map((storeId, i) => ({ storeId, isPrimary: i === 0 })) },
        },
      })
    const green = await mk("MS-3 Green", true, [pac.id, den.id], longAgo)
    const short = await mk("MS-3 Short", true, [pac.id], longAgo)
    const red = await mk("MS-3 Red", true, [pac.id], longAgo)
    const fresh = await mk("MS-3 New Hire", true, [pac.id], new Date(`${weeks[1]}T00:00:00.000Z`))
    const unlinked = await mk("MS-3 Unlinked", false, [pac.id], longAgo)
    const gone = await mk("MS-3 Terminated", true, [pac.id], longAgo)
    await prisma.staffMember.update({ where: { id: gone.id }, data: { status: "TERMINATED", terminatedAt: now } })

    for (const s of [pac, den]) await prisma.squareLaborSyncState.create({ data: { organizationId: org.id, storeId: s.id, lastSyncOkAt: now } })
    let n = 0
    const at = (date: string, hour: number, tz: string) => new Date(localMidnightUtc(date, tz).getTime() + hour * 3600000)
    const cards: object[] = []
    const shifts: object[] = []
    // A 6-hour card with a 30-minute unpaid break = 5.5 paid hours, and a
    // published shift starting at the same minute (on time).
    const work = (m: { squareTeamMemberId: string | null }, store: typeof pac, start: Date) => {
      n++
      const end = new Date(start.getTime() + 6 * 3600000)
      cards.push({
        organizationId: org.id, storeId: store.id, squareTimecardId: `ms3-tc-${stamp}-${n}`, squareTeamMemberId: m.squareTeamMemberId!, squareLocationId: store.squareLocationId!,
        startAt: start, endAt: end, breakUnpaidMinutes: 30, status: "CLOSED", squareVersion: 1, squareCreatedAt: now, squareUpdatedAt: now, syncedAt: now,
      })
      shifts.push({
        organizationId: org.id, storeId: store.id, squareScheduledShiftId: `ms3-sh-${stamp}-${n}`, squareVersion: 1, squareCreatedAt: now, squareUpdatedAt: now,
        draftLocationId: store.squareLocationId!, draftJobId: "J", draftStartAt: start, draftEndAt: end, draftTimezone: store.timezone, draftIsDeleted: false, draftTeamMemberId: m.squareTeamMemberId!,
        effectiveLocationId: store.squareLocationId!, effectiveJobId: "J", effectiveStartAt: start, effectiveEndAt: end, effectiveTimezone: store.timezone,
        effectiveIsDeleted: false, effectiveTeamMemberId: m.squareTeamMemberId!, effectiveSource: "published", syncedAt: now,
      })
    }
    // GREEN: 4 × 5.5 h = 22 h in each judged week. In the last week the fourth
    // card is at the DENVER store, Sunday 23:00 Mountain = Monday 05:00 UTC —
    // dated in its own store's zone it is Sunday, inside the week; dated in UTC
    // it would fall into the current week and leave that week at 16.5 h.
    for (const [wi, w] of weeks.entries()) {
      for (let d = 0; d < 3; d++) work(green, pac, at(addDaysStr(w, d), 9, LA))
      if (wi === weeks.length - 1) work(green, den, at(addDaysStr(w, 6), 23, DEN))
      else work(green, pac, at(addDaysStr(w, 3), 9, LA))
    }
    // SHORT: the two newest weeks only (the oldest is covered — Green's cards
    // start before it — so it is a real zero), plus 40 h in the CURRENT week,
    // which must not count.
    for (const w of weeks.slice(1)) for (let d = 0; d < 4; d++) work(short, pac, at(addDaysStr(w, d), 9, LA))
    const thisMonday = addDaysStr(weeks[2], 7)
    for (let d = 0; d < 7; d++) {
      const day = addDaysStr(thisMonday, d)
      if (at(day, 9, LA).getTime() + 6 * 3600000 < now.getTime()) work(short, pac, at(day, 9, LA))
    }
    // RED and NEW HIRE: full weeks — red is red for compliance, the new hire is
    // yellow because their first judged week predates their start date (F9).
    for (const m of [red, fresh]) for (const w of weeks) for (let d = 0; d < 4; d++) work(m, pac, at(addDaysStr(w, d), 9, LA))
    await prisma.squareTimecard.createMany({ data: cards as never })
    await prisma.squareScheduledShift.createMany({ data: shifts as never })

    // Trainings: Green completed the required one; Red has an OVERDUE other one.
    await prisma.trainingAssignment.createMany({
      data: [
        { trainingModuleId: food.id, staffMemberId: green.id, assignedByUserId: USER, status: "Completed" },
        { trainingModuleId: food.id, staffMemberId: red.id, assignedByUserId: USER, status: "Completed" },
        { trainingModuleId: food.id, staffMemberId: fresh.id, assignedByUserId: USER, status: "Completed" },
        { trainingModuleId: overdueMod.id, staffMemberId: red.id, assignedByUserId: USER, dueDate: new Date(now.getTime() - 86400000) },
      ],
    })
    // The handbook reaches Green, Red and the new hire (STAFF grants), NOT
    // Short. Green and the new hire have signed it.
    const v1 = await prisma.hrDocumentVersion.create({
      data: { hrDocumentId: handbook.id, versionNumber: 1, fileUrl: "ms3://handbook", fileName: "ms3-handbook.pdf", contentType: "application/pdf", sizeBytes: 1, fileHash: "ms3", uploadedByUserId: USER },
    })
    await prisma.hrDocumentCheckpoint.create({ data: { hrDocumentId: handbook.id, name: "MS-3 Signature", type: "Signature", orderIndex: 0 } })
    await prisma.hrDocumentGrant.createMany({
      data: [green, red, fresh].map((m) => ({ hrDocumentId: handbook.id, granteeType: "STAFF", staffMemberId: m.id })),
    })
    await prisma.hrSignedRecord.createMany({
      data: [green, fresh].map((m) => ({ hrDocumentVersionId: v1.id, staffMemberId: m.id, completedAt: now, signedPdfPathname: "ms3/x.pdf", signedPdfHash: "ms3" })),
    })

    const fullOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    const members = [green, short, red, fresh, unlinked, gone]
    const all = await prisma.staffMember.findMany({ where: { id: { in: members.map((m) => m.id) } }, include: { storeAssignments: true } })
    const input = all.map((m) => ({
      id: m.id,
      squareTeamMemberId: m.squareTeamMemberId,
      assignedStoreIds: m.storeAssignments.map((a) => a.storeId),
      startDate: m.startDate,
      status: m.status,
      zone: LA,
    }))
    const res = await getRaiseEligibility(fullOrg, input, await getRaiseSettings(org.id), await getMilestoneSettings(org.id), { now })
    const g = res.get(green.id)
    const crit = (r: RaiseEligibility | undefined) => Object.fromEntries((r?.criteria ?? []).map((c) => [c.key, c.state]))

    check("D12. GREEN: every criterion met", [g?.status, crit(g)], ["green", { compliance: "met", hours: "met", onTime: "met", trainings: "met", documents: "met" }])
    check("D13. the Denver card is dated in ITS store's zone (Sunday) — last week reads 22.0 h", g?.criteria.find((c) => c.key === "hours")?.detail, "Weeks oldest first: 22.0 h, 22.0 h, 22.0 h.")
    const s = res.get(short.id)
    check("D14. SHORT: oldest week a real zero, current-week hours ignored → hours not met, YELLOW", [s?.status, crit(s).hours], ["yellow", "not-met"])
    check("D15. SHORT: handbook not in their audience, training not assigned → both N/A", [crit(s).documents, crit(s).trainings], ["na", "na"])
    const r = res.get(red.id)
    check("D16. RED: overdue training + unsigned handbook → compliance blocked, RED", [r?.status, crit(r).compliance, crit(r).documents], ["red", "blocked", "not-met"])
    const f = res.get(fresh.id)
    check("D17. NEW HIRE: first judged week predates the start date → no data, YELLOW, never green", [f?.status, crit(f).hours], ["yellow", "no-data"])
    check("D18. UNLINKED: hours and on-time have no data → YELLOW", [res.get(unlinked.id)?.status, crit(res.get(unlinked.id)).hours, crit(res.get(unlinked.id)).onTime], ["yellow", "no-data", "no-data"])
    check("D19. TERMINATED: no result at all", res.has(gone.id), false)
    check("D20. raw JSON of every result carries no pay key or value", PAY_PATTERN.test(JSON.stringify([...res.entries()])), false)

    await prisma.organization.update({ where: { id: org.id }, data: { squareLaborEnabled: false } })
    const offOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    const off = await getRaiseEligibility(offOrg, input, await getRaiseSettings(org.id), await getMilestoneSettings(org.id), { now })
    check("D21. F12: overlay off → no badge for anyone", off.size, 0)
  } finally {
    const ids = (await prisma.staffMember.findMany({ where: { organizationId: org.id }, select: { id: true } })).map((m) => m.id)
    await prisma.hrSignedRecord.deleteMany({ where: { staffMemberId: { in: ids } } })
    await prisma.hrDocumentAcknowledgment.deleteMany({ where: { staffMemberId: { in: ids } } })
    await prisma.milestoneSettings.deleteMany({ where: { organizationId: org.id } }) // cascades both join tables
    await prisma.hrDocument.deleteMany({ where: { organizationId: org.id } }) // cascades versions, checkpoints, grants
    await prisma.trainingAssignment.deleteMany({ where: { staffMemberId: { in: ids } } })
    await prisma.trainingModule.deleteMany({ where: { organizationId: { in: [org.id, other.id] } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } }) // cascades shifts, cards, sync state
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, other.id] } } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "ms3-fixture" } } })
    check("D22. cleanup: no MS-3 fixture orgs left", left, 0)
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
