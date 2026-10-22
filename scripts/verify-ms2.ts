/**
 * MS-2 acceptance fixture — Staff Milestones on-time % and the On-Time badge.
 *
 *   npx tsx scripts/verify-ms2.ts
 *
 * Rulings: docs/DECISIONS.md 2026-10-16 (MS-2). Audit:
 * docs/prompts/2026-10-16_MS-2_AUDIT.md.
 *
 *   A. Pure rules — grace boundary at 5/10/15 compared to the minute (F2:
 *      9:05:59 on time, 9:06:00 late), threshold edges 79/80/89/90 (F8), the validator (red >= green refused, grace
 *      5/10/15 only), and the code defaults equal the schema @defaults.
 *   B. The calculation — percent math (display rounds DOWN, colour on the
 *      exact value: 89.6% shows 89% amber, 90.0% shows 90% green), no-show counted late, unscheduled
 *      excluded, drafts excluded (F9), min-shifts grey, no-schedule vs
 *      not-enough, not-linked (F11), same-store pairing across two stores
 *      (F10), earliest clock-in, sync horizon, and look-back window edges in a
 *      Pacific and a Denver store (F1), including a terminated member's window.
 *   C. Gates — toggle off = 404, every attendance handler asks
 *      requireMilestones("milestones.manage"), STORE/STAFF refused, the badge
 *      gate is Milestones on + ADMIN/MANAGER on both pages, the out-of-scope
 *      MANAGER 404 precedes the badge computation, overlay off reads nothing.
 *   D. F12 — the Day Inspector's output is byte-identical to the golden file
 *      written from the pre-move code, on the same seeded data.
 *   E. Database (dev branch) — the batched read end to end on seeded
 *      Square rows, settings save/refuse/default, cleanup. Every fixture row is
 *      named "MS-2 …" (CLAUDE.md § Name every test principal).
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import type { Organization } from "@prisma/client"
import { prisma } from "../src/lib/prisma"
import { can, type PermissionRole } from "../src/lib/permissions"
import { milestonesActive, milestonesDenialStatus } from "../src/lib/milestones-access"
import {
  assembleOnTime,
  colourFor,
  DEFAULT_MILESTONE_SETTINGS,
  getMilestoneSettings,
  getOnTimeForStaff,
  isOnTime,
  lookbackRange,
  minutesLate,
  saveMilestoneSettings,
  settingsProblem,
  type AttendanceCard,
  type AttendanceShift,
  type MilestoneSettingsValues,
} from "../src/lib/attendance"
import { GOLDEN_PATH, serialiseAll } from "./ms2-inspector-seed"

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
const S = DEFAULT_MILESTONE_SETTINGS

// ─── A. PURE RULES ───────────────────────────────────────────────────────────
console.log("\nA. Grace period — compared to the minute (F2)")
const start = new Date("2026-10-01T09:00:00-07:00")
const at = (hms: string) => new Date(`2026-10-01T${hms}-07:00`)
check("A1. 9:05:59 at grace 5 → on time", isOnTime(at("09:05:59"), start, 5), true)
check("A2. 9:06:00 at grace 5 → late", isOnTime(at("09:06:00"), start, 5), false)
check("A3. 9:10:59 at grace 10 → on time", isOnTime(at("09:10:59"), start, 10), true)
check("A4. 9:11:00 at grace 10 → late", isOnTime(at("09:11:00"), start, 10), false)
check("A5. 9:15:59 at grace 15 → on time", isOnTime(at("09:15:59"), start, 15), true)
check("A6. 9:16:00 at grace 15 → late", isOnTime(at("09:16:00"), start, 15), false)
check("A7. early clock-in 8:30 → on time", isOnTime(at("08:30:00"), start, 5), true)
check("A8. minutesLate floors (9:05:59 → 5)", minutesLate(at("09:05:59"), start), 5)

console.log("\nA. Threshold edges (F8) at red 80 / green 90")
check("A9. 79 → red", colourFor(79, S), "red")
check("A10. 80 → amber", colourFor(80, S), "amber")
check("A11. 89 → amber", colourFor(89, S), "amber")
check("A12. 90 → green", colourFor(90, S), "green")
check("A13. 89.6 stays amber (colour on the exact value)", colourFor(89.6, S), "amber")

console.log("\nA. Validator")
check("A14. defaults are valid", settingsProblem(S), null)
check("A15. red == green refused", settingsProblem({ ...S, onTimeRedBelow: 90 }), "The red threshold must be below the green threshold.")
check("A16. red > green refused", settingsProblem({ ...S, onTimeRedBelow: 95 }), "The red threshold must be below the green threshold.")
check("A17. grace 7 refused (5/10/15 only)", settingsProblem({ ...S, onTimeGraceMinutes: 7 }), "Grace period must be 5, 10 or 15 minutes.")
check("A18. grace 0 refused", settingsProblem({ ...S, onTimeGraceMinutes: 0 }) !== null, true)
check("A19. grace 10 and 15 accepted", [settingsProblem({ ...S, onTimeGraceMinutes: 10 }), settingsProblem({ ...S, onTimeGraceMinutes: 15 })], [null, null])
check("A20. look-back 6 refused", settingsProblem({ ...S, onTimeLookbackDays: 6 }) !== null, true)
check("A21. min shifts 0 refused", settingsProblem({ ...S, onTimeMinShifts: 0 }) !== null, true)
check("A22. fractional value refused", settingsProblem({ ...S, onTimeRedBelow: 80.5 }), "Every value must be a whole number.")

console.log("\nA. Code defaults equal the schema @defaults")
const schema = readFileSync("prisma/schema.prisma", "utf8")
const model = schema.slice(schema.indexOf("model MilestoneSettings {"), schema.indexOf("}", schema.indexOf("model MilestoneSettings {")))
const schemaDefault = (field: string) => Number(new RegExp(`${field}\\s+Int\\s+@default\\((\\d+)\\)`).exec(model)?.[1])
for (const k of Object.keys(S) as (keyof MilestoneSettingsValues)[]) {
  check(`A23. ${k}: code ${S[k]} = schema`, schemaDefault(k), S[k])
}
check("A24. grace default is 5 (Gary, F2)", S.onTimeGraceMinutes, 5)

// ─── B. THE CALCULATION ──────────────────────────────────────────────────────
const P = "store-pacific"
const D = "store-denver"
const ME = "TM-ms2-me"
const zones = new Map([
  [P, LA],
  [D, DEN],
])
const NOW = new Date("2026-10-16T20:00:00Z") // 13:00 PDT, 14:00 MDT
const synced = new Map<string, number | null>([
  [P, NOW.getTime()],
  [D, NOW.getTime()],
])

function sh(store: string, isoStart: string, hours = 6, o: Partial<AttendanceShift> = {}): AttendanceShift {
  const s = new Date(isoStart)
  return {
    storeId: store,
    effectiveTeamMemberId: ME,
    effectiveStartAt: s,
    effectiveEndAt: new Date(s.getTime() + hours * 3600000),
    effectiveSource: "published",
    effectiveIsDeleted: false,
    ...o,
  }
}
function cd(store: string, isoStart: string, hours = 6, member = ME): AttendanceCard {
  const s = new Date(isoStart)
  return { storeId: store, squareTeamMemberId: member, startAt: s, endAt: new Date(s.getTime() + hours * 3600000) }
}
const RANGE = { from: "2026-09-17", to: "2026-10-16" }
function run(o: {
  shifts: AttendanceShift[]
  cards: AttendanceCard[]
  assigned?: string[]
  withSchedule?: string[]
  linked?: boolean
  range?: { from: string; to: string }
  settings?: MilestoneSettingsValues
  sync?: Map<string, number | null>
}) {
  return assembleOnTime({
    squareTeamMemberId: o.linked === false ? null : ME,
    assignedStoreIds: o.assigned ?? [P],
    memberShifts: o.shifts,
    memberCards: o.cards,
    storesWithSchedule: new Set(o.withSchedule ?? [P]),
    storeZones: zones,
    syncedThroughByStore: o.sync ?? synced,
    range: o.range ?? RANGE,
    now: NOW,
    settings: o.settings ?? S,
  })
}
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`

console.log("\nB. Percent math")
{
  // Ten shifts on Oct 1–10 at 9:00 PDT; eight on time, one 9:06 late, one 9:20 late.
  const shifts = Array.from({ length: 10 }, (_, i) => sh(P, `${day(i + 1)}T09:00:00-07:00`))
  const cards = shifts.map((s, i) =>
    cd(P, `${day(i + 1)}T${i === 8 ? "09:06:00" : i === 9 ? "09:20:00" : "09:04:00"}-07:00`)
  )
  const r = run({ shifts, cards })
  check("B1. 8 of 10 → 80%, amber", [r.onTime, r.total, r.percent, r.displayPercent, r.status], [8, 10, 80, 80, "amber"])
  const r10 = run({ shifts, cards, settings: { ...S, onTimeGraceMinutes: 10 } })
  check("B2. grace 10 recalculates: 9:06 now on time → 9/10 green", [r10.onTime, r10.status], [9, "green"])

  // Display ROUNDS DOWN, colour on the exact value (Gary, 2026-10-16: "the
  // displayed % must never disagree with the badge colour"). One-hour shifts two
  // hours apart, so no card overlaps a neighbouring shift; a late card starts
  // ten minutes in.
  const mk = (onTime: number, total: number) => {
    const base = new Date("2026-09-20T00:00:00-07:00").getTime()
    const ss = Array.from({ length: total }, (_, k) => sh(P, new Date(base + k * 7200000).toISOString(), 1))
    const cc = ss.map((x, k) => cd(P, new Date(x.effectiveStartAt.getTime() + (k < onTime ? 0 : 600000)).toISOString(), 1))
    const r = run({ shifts: ss, cards: cc })
    return [r.onTime, r.total, r.percent, r.displayPercent, r.status]
  }
  check("B2a. 112 of 125 = 89.6% → shows 89%, amber (never 90% on amber)", mk(112, 125), [112, 125, 89.6, 89, "amber"])
  check("B2b. 9 of 10 = 90.0% → shows 90%, green", mk(9, 10), [9, 10, 90, 90, "green"])
  check("B2c. 29 of 50 = 58% exactly → shows 58%, not 57% (multiply first)", mk(29, 50), [29, 50, 58, 58, "red"])

  console.log("\nB. No-shows, unscheduled, drafts (F3, F9)")
  const noShow = run({ shifts, cards: cards.slice(0, 9) })
  check("B3. a shift with no card counts as not on time", [noShow.onTime, noShow.total], [8, 10])
  const extra = run({ shifts, cards: [...cards, cd(P, "2026-10-11T09:00:00-07:00"), cd(P, "2026-10-12T15:00:00-07:00")] })
  check("B4. unscheduled cards are left out entirely", [extra.onTime, extra.total], [8, 10])
  const drafts = run({ shifts: [...shifts, sh(P, "2026-10-11T09:00:00-07:00", 6, { effectiveSource: "draft" })], cards })
  check("B5. a draft-only shift with no card is not counted (F9)", [drafts.onTime, drafts.total], [8, 10])
  const deleted = run({ shifts: [...shifts, sh(P, "2026-10-11T09:00:00-07:00", 6, { effectiveIsDeleted: true })], cards })
  check("B6. a tombstoned shift is not counted", deleted.total, 10)
}

console.log("\nB. Grey states (F4, F5, F11)")
{
  const four = Array.from({ length: 4 }, (_, i) => sh(P, `${day(i + 1)}T09:00:00-07:00`))
  const r = run({ shifts: four, cards: four.map((s, i) => cd(P, `${day(i + 1)}T09:00:00-07:00`)) })
  check("B7. 4 shifts under minimum 5 → not-enough (grey), 100% not coloured", [r.status, r.total], ["not-enough", 4])
  check("B8. exactly 5 → coloured", run({
    shifts: [...four, sh(P, "2026-10-05T09:00:00-07:00")],
    cards: [...four, sh(P, "2026-10-05T09:00:00-07:00")].map((s) => cd(P, s.effectiveStartAt.toISOString())),
  }).status, "green")
  check("B9. no published shifts at the member's stores → no-schedule", run({ shifts: [], cards: [], withSchedule: [] }).status, "no-schedule")
  check("B10. store schedules, member has none → not-enough, not no-schedule", run({ shifts: [], cards: [], withSchedule: [P] }).status, "not-enough")
  check("B11. no Square link → not-linked (F11)", run({ shifts: four, cards: [], linked: false }).status, "not-linked")
}

console.log("\nB. Pairing — same store, earliest card, split shifts (F10)")
{
  const atP = sh(P, "2026-10-02T09:00:00-07:00", 8)
  const wrongStore = run({ shifts: [atP], cards: [cd(D, "2026-10-02T10:00:00-06:00", 8)], settings: { ...S, onTimeMinShifts: 1 } })
  check("B12. clocked in at the other store → no-show at the scheduled one", [wrongStore.onTime, wrongStore.total], [0, 1])
  const both = run({
    shifts: [atP, sh(D, "2026-10-03T09:00:00-06:00", 8)],
    cards: [cd(P, "2026-10-02T08:58:00-07:00", 8), cd(D, "2026-10-03T09:02:00-06:00", 8)],
    assigned: [P, D],
    settings: { ...S, onTimeMinShifts: 1 },
  })
  check("B13. shifts at both stores counted in one %", [both.onTime, both.total, both.percent], [2, 2, 100])
  const twoCards = run({
    shifts: [atP],
    cards: [cd(P, "2026-10-02T09:30:00-07:00", 4), cd(P, "2026-10-02T09:03:00-07:00", 0.25)],
    settings: { ...S, onTimeMinShifts: 1 },
  })
  check("B14. the EARLIEST paired card decides (9:03 beats 9:30)", twoCards.onTime, 1)
  const split = run({
    shifts: [sh(P, "2026-10-04T09:00:00-07:00", 4), sh(P, "2026-10-04T13:00:00-07:00", 4)],
    cards: [cd(P, "2026-10-04T09:00:00-07:00", 8)],
    settings: { ...S, onTimeMinShifts: 1 },
  })
  check("B15. one 9–5 card covers a 9–1 and 1–5 split → both on time", [split.onTime, split.total], [2, 2])
  const touch = run({
    shifts: [sh(P, "2026-10-05T09:00:00-07:00", 8)],
    cards: [cd(P, "2026-10-05T16:46:00-07:00", 1)],
    settings: { ...S, onTimeMinShifts: 1 },
  })
  check("B16. 14 minutes' overlap does not pair → no-show (inspector's 15)", [touch.onTime, touch.total], [0, 1])
}

console.log("\nB. Sync horizon (F3)")
{
  const s = sh(P, "2026-10-16T12:50:00-07:00") // 19:50Z; eligible at 20:10Z
  const r = run({ shifts: [s], cards: [], settings: { ...S, onTimeMinShifts: 1 } })
  check("B17. shift whose start+20 is past the horizon: excluded, not a no-show", r.total, 0)
  const stale = run({
    shifts: [sh(P, "2026-10-10T09:00:00-07:00")],
    cards: [],
    sync: new Map([[P, new Date("2026-10-09T00:00:00Z").getTime()]]),
    settings: { ...S, onTimeMinShifts: 1 },
  })
  check("B18. timecards not synced past the shift → excluded", stale.total, 0)
  const never = run({ shifts: [sh(P, "2026-10-10T09:00:00-07:00")], cards: [], sync: new Map(), settings: { ...S, onTimeMinShifts: 1 } })
  check("B19. never-synced store → excluded", never.total, 0)
}

console.log("\nB. Look-back window edges — Pacific and Denver (F1)")
{
  // 06:30Z on Oct 16 is 23:30 PDT Oct 15 and 00:30 MDT Oct 16: the zones disagree.
  const instant = new Date("2026-10-16T06:30:00Z")
  check("B20. Pacific member: 30 days ending Oct 15", lookbackRange(30, instant, LA, null), { from: "2026-09-16", to: "2026-10-15" })
  check("B21. Denver member: 30 days ending Oct 16", lookbackRange(30, instant, DEN, null), { from: "2026-09-17", to: "2026-10-16" })
  check("B22. terminated Oct 1 (Pacific): window ends Oct 1", lookbackRange(30, NOW, LA, new Date("2026-10-01T20:00:00Z")), { from: "2026-09-02", to: "2026-10-01" })

  const one = { ...S, onTimeMinShifts: 1 }
  const edge = (store: string, iso: string) =>
    run({ shifts: [sh(store, iso, 2)], cards: [cd(store, iso, 2)], assigned: [store], withSchedule: [store], settings: one }).total
  check("B23. Pacific 23:30 the day BEFORE from → out", edge(P, "2026-09-16T23:30:00-07:00"), 0)
  check("B24. Pacific 00:30 ON from → in", edge(P, "2026-09-17T00:30:00-07:00"), 1)
  check("B25. Denver 23:30 Sep 16 MDT → out", edge(D, "2026-09-16T23:30:00-06:00"), 0)
  check("B26. Denver 00:30 Sep 17 MDT (= 23:30 PDT Sep 16) → in, dated in its OWN zone", edge(D, "2026-09-17T00:30:00-06:00"), 1)
  check("B27. Pacific 23:30 Sep 16 PDT (= 00:30 MDT Sep 17) → out, dated in its OWN zone", edge(P, "2026-09-16T23:30:00-07:00"), 0)
  const after = run({
    shifts: [sh(P, "2026-10-17T00:30:00-07:00", 2)],
    cards: [],
    sync: new Map([[P, new Date("2026-10-18T00:00:00Z").getTime()]]),
    settings: one,
  })
  check("B28. a shift dated after `to` → out", after.total, 0)
}

// ─── C. GATES ────────────────────────────────────────────────────────────────
console.log("\nC. Gates")
const savedHr = process.env.HR_MODULE_AVAILABLE
process.env.HR_MODULE_AVAILABLE = "true"
check("C1. toggle off → Milestones off", milestonesActive({ clerkOrgId: "x", activeModules: ["hr"], milestonesEnabled: false }), false)
check("C2. off → API answers 404", milestonesDenialStatus("disabled"), 404)
if (savedHr === undefined) delete process.env.HR_MODULE_AVAILABLE
else process.env.HR_MODULE_AVAILABLE = savedHr
const ROLES: PermissionRole[] = ["ADMIN", "MANAGER", "STORE", "STAFF"]
for (const role of ROLES) check(`C3. settings route capability: ${role}`, can({ role }, "milestones.manage"), role === "ADMIN")
check("C4. MANAGER → 403 (forbidden, not 404)", milestonesDenialStatus("forbidden"), 403)
check("C5. STORE and STAFF never reach /staff (staff.view)", [can({ role: "STORE" }, "staff.view"), can({ role: "STAFF" }, "staff.view")], [false, false])

const routeSrc = readFileSync("src/app/api/milestones/attendance/route.ts", "utf8")
const handlers = [...routeSrc.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([\s\S]*?\n}/g)]
check("C6. attendance route: GET and PUT", handlers.map((h) => h[1]), ["GET", "PUT"])
check(
  'C7. every handler opens with requireMilestones("milestones.manage")',
  handlers.every((h) => /^export async function \w+\([^)]*\)[^{]*{\s*const access = await requireMilestones\("milestones\.manage"\)\s*if \(!access\.ok\) return/.test(h[0])),
  true
)
const listSrc = readFileSync("src/app/(app)/staff/page.tsx", "utf8")
check(
  "C8. /staff badge gate: Milestones on AND role ADMIN or MANAGER",
  /const showOnTime = milestonesActive\(org\) && \(dbUser\?\.role === "ADMIN" \|\| dbUser\?\.role === "MANAGER"\)/.test(listSrc),
  true
)
check("C9. /staff runs the attendance read only inside the gate", /if \(showOnTime\) {[\s\S]*?getOnTimeForStaff\(/.test(listSrc), true)
const profileSrc = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8")
check("C10. tab: badge computed only under showMilestonesTab", /if \(showMilestonesTab\) {\s*const settings = await getMilestoneSettings/.test(profileSrc), true)
check("C11. tab gate unchanged: canSeeHrTabs && milestonesActive(org)", /const showMilestonesTab = canSeeHrTabs && milestonesActive\(org\)/.test(profileSrc), true)
check(
  "C12. out-of-scope MANAGER 404 precedes the badge computation",
  profileSrc.indexOf("if (!member) notFound()") > 0 && profileSrc.indexOf("if (!member) notFound()") < profileSrc.indexOf("getOnTimeForStaff("),
  true
)

console.log("\nC. Overlay off reads nothing (F5)")
async function overlayOff() {
  const fakeOrg = { id: "no-such-org", clerkOrgId: "org_ms2_off", activeModules: ["hr"], squareLaborEnabled: false } as unknown as Organization
  const r = await getOnTimeForStaff(
    fakeOrg,
    [
      { id: "m1", squareTeamMemberId: "TM1", assignedStoreIds: [], range: RANGE, milestoneEligible: true },
      { id: "m2", squareTeamMemberId: null, assignedStoreIds: [], range: RANGE, milestoneEligible: true },
    ],
    S
  )
  check("C13. linked member → no-schedule / square-labor-off", [r.get("m1")?.status, r.get("m1")?.reason], ["no-schedule", "square-labor-off"])
  check("C14. unlinked member → not-linked", r.get("m2")?.status, "not-linked")
}

// ─── D. F12 — INSPECTOR UNCHANGED ────────────────────────────────────────────
console.log("\nD. Day Inspector output identical before/after the pairing move (F12)")
check("D1. every seeded scenario byte-identical to the pre-move golden file", serialiseAll() + "\n" === readFileSync(GOLDEN_PATH, "utf8"), true)
const insp = readFileSync("src/lib/labor-inspector.ts", "utf8")
check("D2. inspector calls pairsAsAttendance in both loops", (insp.match(/pairsAsAttendance\(tc, s, ceilingMs, thresholds\.showedUpMinOverlapMinutes\)/g) ?? []).length, 2)
check("D3. inspector's NO-SHOW wait still 20 minutes", /export const NO_SHOW_GRACE_MINUTES = 20\n/.test(insp), true)
const att = readFileSync("src/lib/attendance.ts", "utf8")
check("D4. attendance.ts pairs only via pairsAsAttendance — no overlap arithmetic of its own", [/overlapMinutes/.test(att), /pairsAsAttendance\(c, s, ceilingMs, SHOWED_UP_MIN_OVERLAP_MINUTES\)/.test(att)], [false, true])

// ─── E. DATABASE ─────────────────────────────────────────────────────────────
async function db() {
  console.log("\nE. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
  console.log(`      branch id: ${branch[0]?.b ?? "(null)"}`)

  const saved = { L: process.env.LABOR_MODULE_AVAILABLE, Q: process.env.SQUARE_LABOR_AVAILABLE }
  process.env.LABOR_MODULE_AVAILABLE = "true"
  process.env.SQUARE_LABOR_AVAILABLE = "true"
  const stamp = Date.now()
  const org = await prisma.organization.create({
    data: { clerkOrgId: `ms2-fixture-${stamp}`, name: "MS-2 Fixture Org", activeModules: ["hr", "labor"], squareLaborEnabled: true },
  })
  try {
    check("E1. no settings row → defaults", await getMilestoneSettings(org.id), DEFAULT_MILESTONE_SETTINGS)
    check("E2. red >= green refused, nothing written", [
      await saveMilestoneSettings(org.id, { ...S, onTimeRedBelow: 90 }),
      await prisma.milestoneSettings.count({ where: { organizationId: org.id } }),
    ], [{ ok: false, error: "The red threshold must be below the green threshold." }, 0])
    const good = { ...S, onTimeGraceMinutes: 10, onTimeMinShifts: 3 }
    check("E3. valid save creates the row", (await saveMilestoneSettings(org.id, good)).ok, true)
    check("E4. read back", await getMilestoneSettings(org.id), good)
    await saveMilestoneSettings(org.id, { ...good, onTimeGraceMinutes: 5 })
    check("E5. second save updates the one row", [await prisma.milestoneSettings.count({ where: { organizationId: org.id } }), (await getMilestoneSettings(org.id)).onTimeGraceMinutes], [1, 5])

    const pac = await prisma.store.create({ data: { organizationId: org.id, name: "MS-2 Pacific", timezone: LA, squareLocationId: `ms2-loc-p-${stamp}` } })
    const den = await prisma.store.create({ data: { organizationId: org.id, name: "MS-2 Denver", timezone: DEN, squareLocationId: `ms2-loc-d-${stamp}` } })
    const sq = `ms2-tm-${stamp}`
    const staff = await prisma.staffMember.create({
      data: { organizationId: org.id, displayName: "MS-2 Staff", squareTeamMemberId: sq, storeAssignments: { create: [{ storeId: pac.id, isPrimary: true }] } },
    })
    const unlinked = await prisma.staffMember.create({ data: { organizationId: org.id, displayName: "MS-2 Unlinked" } })
    const now = new Date()
    for (const s of [pac, den]) {
      await prisma.squareLaborSyncState.create({ data: { organizationId: org.id, storeId: s.id, lastSyncOkAt: now } })
    }
    let n = 0
    const shiftRow = (store: typeof pac, startAt: Date, source = "published") => {
      const endAt = new Date(startAt.getTime() + 6 * 3600000)
      n++
      return {
        organizationId: org.id, storeId: store.id, squareScheduledShiftId: `ms2-sh-${stamp}-${n}`, squareVersion: 1,
        squareCreatedAt: now, squareUpdatedAt: now,
        draftLocationId: store.squareLocationId!, draftJobId: "J", draftStartAt: startAt, draftEndAt: endAt, draftTimezone: store.timezone, draftIsDeleted: false, draftTeamMemberId: sq,
        effectiveLocationId: store.squareLocationId!, effectiveJobId: "J", effectiveStartAt: startAt, effectiveEndAt: endAt, effectiveTimezone: store.timezone,
        effectiveIsDeleted: false, effectiveTeamMemberId: sq, effectiveSource: source, syncedAt: now,
      }
    }
    const cardRow = (store: typeof pac, startAt: Date) => {
      n++
      return {
        organizationId: org.id, storeId: store.id, squareTimecardId: `ms2-tc-${stamp}-${n}`, squareTeamMemberId: sq, squareLocationId: store.squareLocationId!,
        startAt, endAt: new Date(startAt.getTime() + 6 * 3600000), status: "CLOSED", squareVersion: 1, squareCreatedAt: now, squareUpdatedAt: now, syncedAt: now,
      }
    }
    // Five Pacific shifts in the last week: 3 on time (≤ 5 min), 1 late (9:06), 1 no-show.
    // One Denver shift on time, one Pacific draft with no card, one Pacific shift 40 days ago.
    const daysAgo = (d: number, hh: number, mm: number, ss = 0) => {
      const t = new Date(now.getTime() - d * 86400000)
      t.setUTCHours(hh, mm, ss, 0)
      return t
    }
    const shiftsSeed = [1, 2, 3, 4, 5].map((d) => shiftRow(pac, daysAgo(d, 16, 0)))
    await prisma.squareScheduledShift.createMany({
      data: [...shiftsSeed, shiftRow(den, daysAgo(6, 15, 0)), shiftRow(pac, daysAgo(2, 23, 0), "draft"), shiftRow(pac, daysAgo(40, 16, 0))],
    })
    await prisma.squareTimecard.createMany({
      data: [
        cardRow(pac, daysAgo(1, 16, 5, 59)), // on time at grace 5
        cardRow(pac, daysAgo(2, 15, 55)), // early
        cardRow(pac, daysAgo(3, 16, 0)),
        cardRow(pac, daysAgo(4, 16, 6)), // late
        // day 5: no-show
        cardRow(den, daysAgo(6, 15, 2)),
        cardRow(pac, daysAgo(40, 16, 0)),
        cardRow(pac, daysAgo(7, 3, 0)), // unscheduled
      ],
    })

    const fullOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    const settings = await getMilestoneSettings(org.id)
    const range = lookbackRange(30, now, LA, null)
    const res = await getOnTimeForStaff(
      fullOrg,
      [
        { id: staff.id, squareTeamMemberId: sq, assignedStoreIds: [pac.id], range, milestoneEligible: true },
        { id: unlinked.id, squareTeamMemberId: null, assignedStoreIds: [pac.id], range, milestoneEligible: true },
      ],
      settings,
      now
    )
    const r = res.get(staff.id)
    check("E6. 4 of 6 (66.7%, shows 66%) on time across two stores (no-show late, draft/unscheduled/40-days-ago out)", [r?.onTime, r?.total, r?.displayPercent, r?.status], [4, 6, 66, "red"])
    check("E7. unlinked member → not-linked", res.get(unlinked.id)?.status, "not-linked")
    await saveMilestoneSettings(org.id, { ...settings, onTimeGraceMinutes: 10 })
    const r10 = (await getOnTimeForStaff(fullOrg, [{ id: staff.id, squareTeamMemberId: sq, assignedStoreIds: [pac.id], range, milestoneEligible: true }], await getMilestoneSettings(org.id), now)).get(staff.id)
    check("E8. grace 10 → the 9:06 card is on time: 5 of 6", [r10?.onTime, r10?.total], [5, 6])

    await prisma.organization.update({ where: { id: org.id }, data: { squareLaborEnabled: false } })
    const offOrg = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    const off = (await getOnTimeForStaff(offOrg, [{ id: staff.id, squareTeamMemberId: sq, assignedStoreIds: [pac.id], range, milestoneEligible: true }], settings, now)).get(staff.id)
    check("E9. overlay off → grey, stale rows not read (F5)", [off?.status, off?.reason, off?.total], ["no-schedule", "square-labor-off", 0])
  } finally {
    await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
    await prisma.store.deleteMany({ where: { organizationId: org.id } }) // cascades shifts, cards, sync state
    await prisma.milestoneSettings.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "ms2-fixture" } } })
    check("E10. cleanup: no MS-2 fixture orgs left", left, 0)
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
