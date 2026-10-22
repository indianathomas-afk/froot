/**
 * MS-5 acceptance fixture — the Milestone Report (/staff/milestones/report).
 *
 *   npx tsx scripts/verify-ms5.ts
 *
 * Rulings: Gary, 2026-10-19, on docs/prompts/2026-10-19_MS-5_AUDIT.md (F1–F10)
 * — docs/DECISIONS.md 2026-10-19 — MS-5.
 *
 *   A. Pure — F9 raiseHiddenForViewer; the F3 raise mapping (amber dropped,
 *      green / red / cooldown kept, dates only when present); filters (store,
 *      type, reached in 30/90, coming up in 30, raise status, terminated);
 *      sort (soonest first, missing values last both ways); the CSV columns.
 *   B. Gates and structure — page gate order (staff layout → requireMilestones
 *      with no capability, 404 when off → ADMIN/MANAGER role); STORE and STAFF
 *      fail staff.view; the roster where-clause is /staff's; the builder
 *      redacts and never reads raise history directly; the client imports no
 *      server module; CSV only behind canExport; /staff and the profile both
 *      apply F9.
 *   C. Database (dev branch) — MANAGER scope incl. "also works here", a second
 *      manager on a Denver store, ADMIN everyone; checklist columns absent
 *      while the switch is off and the batched reader agreeing with the
 *      per-member one when on; terminated hidden by default with history
 *      only; upcoming date in a Pacific and a Denver store at the hour they
 *      disagree; F3 amber absent; F9 own row absent; F10 the RAW PAYLOAD and
 *      the RAW CSV of a MANAGER without pay access carry no raise date, with
 *      ADMIN as the positive control; filters over real rows; cleanup. Every
 *      fixture row is named "MS-5 …" (CLAUDE.md § Name every test principal).
 *
 * NEGATIVE CONTROLS (run by the build session, recorded in the report):
 *   - in src/lib/milestone-report.ts pass `true` to redactForViewer — C13/C14
 *     must FAIL;
 *   - drop the yellow line in raiseForRow — A2 and C10 must FAIL;
 *   - drop the raiseHiddenForViewer test in the builder — C11 must FAIL.
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { prisma } from "../src/lib/prisma"
import { can, overridesFrom, type PermissionUser } from "../src/lib/permissions"
import { milestonesActive, milestonesDenialStatus } from "../src/lib/milestones-access"
import { localDateStr } from "../src/lib/reports"
import { addDays } from "../src/lib/milestones"
import { namedTaskDates, namedTaskDatesForMembers } from "../src/lib/milestones-db"
import { getMilestoneSettings } from "../src/lib/attendance"
import { getRaiseEligibility, getRaiseSettings, raiseHiddenForViewer, type RaiseEligibility } from "../src/lib/raise-eligibility"
import { buildMilestoneReport, raiseForRow, type ReportViewer } from "../src/lib/milestone-report"
import {
  DEFAULT_REPORT_FILTERS,
  filterReportRows,
  reportCsv,
  sortReportRows,
  type MilestoneReport,
  type ReportFilters,
  type ReportRow,
} from "../src/lib/milestone-report-view"
import { escapeCell } from "../src/lib/csv"

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
const src = (p: string) => readFileSync(p, "utf8")

// ─── A. PURE ─────────────────────────────────────────────────────────────────
console.log("A. Pure")
check(
  "A1. F9: a MANAGER's own row is hidden; another's is not; an ADMIN's own is not; no self resolved hides nothing",
  [
    raiseHiddenForViewer("MANAGER", "s1", "s1"),
    raiseHiddenForViewer("MANAGER", "s1", "s2"),
    raiseHiddenForViewer("ADMIN", "s1", "s1"),
    raiseHiddenForViewer("MANAGER", null, "s1"),
  ],
  [true, false, false, false]
)
const er = (status: RaiseEligibility["status"], extra: Partial<RaiseEligibility> = {}): RaiseEligibility => ({
  status,
  criteria: [{ key: "compliance", label: "Compliance", state: status === "red" ? "blocked" : "met", detail: "1 overdue training." }],
  weeks: { from: "2026-09-21", to: "2026-10-11" },
  ...extra,
})
check(
  "A2. F3: amber is DROPPED (null); green, red, cooldown kept; weeks never copied",
  [raiseForRow(er("yellow")), raiseForRow(er("green")), raiseForRow(er("red")), JSON.stringify(raiseForRow(er("red"))).includes("2026-09-21")],
  [null, { status: "green", why: "Every raise rule is met." }, { status: "red", why: "Compliance: 1 overdue training." }, false]
)
check(
  "A3. cooldown keeps its dates only when the result still carries them",
  [
    raiseForRow(er("cooldown", { lastRaise: { date: "2026-10-09", source: "detected" }, cooldownUntil: "2027-01-07" })),
    raiseForRow(er("cooldown")),
  ],
  [
    { status: "cooldown", why: "Recent raise — in cooldown.", lastRaiseOn: "2026-10-09", cooldownUntil: "2027-01-07" },
    { status: "cooldown", why: "Recent raise — in cooldown." },
  ]
)

const T0 = "2026-10-19"
const row = (id: string, o: Partial<ReportRow> = {}): ReportRow => ({
  id,
  name: id,
  homeStore: "P1",
  storeIds: ["p1"],
  terminated: false,
  isSelf: false,
  today: T0,
  startDate: "2026-01-01",
  daysEmployed: 291,
  reached: [],
  lastReached: null,
  nextTenure: null,
  checklist: null,
  onTime: null,
  raise: null,
  ...o,
})
const rows: ReportRow[] = [
  row("a", { reached: [{ kind: "tenure", title: "90", on: addDays(T0, -10), archived: false }], nextTenure: { title: "1y", dayCount: 365, dueOn: addDays(T0, 74), daysToGo: 74 } }),
  row("b", { storeIds: ["p2"], reached: [{ kind: "checklist", title: "1 task", on: addDays(T0, -60), archived: false }], nextTenure: { title: "30", dayCount: 30, dueOn: addDays(T0, 5), daysToGo: 5 } }),
  row("c", { storeIds: ["p1", "p2"], raise: { status: "cooldown", why: "x" }, nextTenure: { title: "90", dayCount: 90, dueOn: addDays(T0, 30), daysToGo: 30 } }),
  row("d", { terminated: true, reached: [{ kind: "tenure", title: "30", on: addDays(T0, -1), archived: false }] }),
  row("e", { raise: { status: "green", why: "x" }, onTime: { status: "green", reason: null, onTime: 9, total: 10, percent: 90, displayPercent: 90, range: { from: T0, to: T0 } } }),
]
const ids = (rs: ReportRow[]) => rs.map((r) => r.id)
const f = (o: Partial<ReportFilters>) => ids(filterReportRows(rows, { ...DEFAULT_REPORT_FILTERS, ...o }))
check("A4. F5: terminated hidden by default, shown with the toggle", [f({}), f({ showTerminated: true })], [["a", "b", "c", "e"], ["a", "b", "c", "d", "e"]])
check("A5. store filter matches ANY of the row's visible stores", [f({ storeId: "p1" }), f({ storeId: "p2" })], [["a", "c", "e"], ["b", "c"]])
check(
  "A6. type filter: tenure / checklist / on-time / raise",
  [f({ type: "tenure" }), f({ type: "checklist" }), f({ type: "onTime" }), f({ type: "raise" })],
  [["a", "b", "c"], ["b"], ["e"], ["c", "e"]]
)
check(
  "A7. reached in last 30 / 90 days (today is day 0); with type it is that kind only",
  [f({ reachedWithinDays: 30 }), f({ reachedWithinDays: 90 }), f({ reachedWithinDays: 90, type: "checklist" }), f({ reachedWithinDays: 30, showTerminated: true })],
  [["a"], ["a", "b"], ["b"], ["a", "d"]]
)
check("A8. coming up in 30 days (tenure; 30 itself included)", f({ upcomingWithinDays: 30 }), ["b", "c"])
check("A9. raise status filter", [f({ raiseStatus: "cooldown" }), f({ raiseStatus: "green" }), f({ raiseStatus: "red" })], [["c"], ["e"], []])
check(
  "A10. F7 sort: next soonest first, no-next last — in BOTH directions; name ties",
  [ids(sortReportRows(rows, "next")), ids(sortReportRows(rows, "next", "desc"))],
  [["b", "c", "a", "d", "e"], ["a", "c", "b", "d", "e"]]
)
const csvOff = reportCsv({ checklistOn: false }, [rows[2]])
const csvOn = reportCsv({ checklistOn: true }, [rows[2]])
check(
  "A11. CSV: checklist columns only with the switch on; raise date cells empty when the keys are absent",
  [csvOff.headers.includes("Checklist tasks"), csvOn.headers.includes("Checklist tasks"), csvOff.body[0].slice(-3)],
  [false, true, ["Recent raise", undefined, undefined]]
)

// ─── B. GATES AND STRUCTURE ──────────────────────────────────────────────────
console.log("\nB. Gates and structure")
const pageSrc = src("src/app/(app)/staff/milestones/report/page.tsx")
const libSrc = src("src/lib/milestone-report.ts")
const viewSrc = src("src/lib/milestone-report-view.ts")
const clientSrc = src("src/app/(app)/staff/milestones/report/report-client.tsx")
const staffSrc = src("src/app/(app)/staff/page.tsx")
const profileSrc = src("src/app/(app)/staff/[id]/page.tsx")
const layoutSrc = src("src/app/(app)/staff/layout.tsx")
const P = (role: string, denied: string[] = []): PermissionUser => ({ role: role as PermissionUser["role"], overrides: overridesFrom(denied) })
check("B1. the /staff layout still gates on staff.view", /can\(actor, "staff\.view"\)/.test(layoutSrc), true)
check(
  "B2. staff.view: ADMIN and MANAGER pass, STORE and STAFF are refused (redirected by the layout)",
  ["ADMIN", "MANAGER", "STORE", "STAFF"].map((r) => can(P(r), "staff.view")),
  [true, true, false, false]
)
check(
  "B3. page: requireMilestones() with NO capability, disabled → notFound, then the ADMIN/MANAGER role check",
  [
    /requireMilestones\(\)/.test(pageSrc),
    /access\.reason === "disabled"[^\n]*notFound\(\)/.test(pageSrc),
    /role !== "ADMIN" && role !== "MANAGER"\) redirect\("\/dashboard"\)/.test(pageSrc),
    pageSrc.indexOf("requireMilestones()") < pageSrc.indexOf('role !== "ADMIN"'),
  ],
  [true, true, true, true]
)
check("B4. Milestones off answers 404", milestonesDenialStatus("disabled"), 404)
check("B5. page scopes a MANAGER by access.storeIds and uses getCurrentUser (no clerkUserId lookup)", [/storeIds: access\.storeIds/.test(pageSrc), /getCurrentUser\(\)/.test(pageSrc), /where: \{ clerkUserId/.test(pageSrc)], [true, true, false])
const SCOPE = "storeAssignments: { some: { storeId: { in: "
check("B6. the roster where-clause is /staff's", [staffSrc.includes(SCOPE + "storeIds } } }"), libSrc.includes(SCOPE + "viewer.storeIds } } }")], [true, true])
check(
  "B7. the builder redacts, applies F9, and never reads raise history or wages directly",
  [/redactForViewer\(/.test(libSrc), /raiseHiddenForViewer\(/.test(libSrc), /detectRaises|getManualRaiseDates|wageSnapshot|staffLastRaise|squareTeamMemberWage|getPayForStaff/.test(libSrc)],
  [true, true, false]
)
check(
  "B8. client-safe: the view module and the client import no prisma and not the server builder",
  [/@\/lib\/prisma|from "@\/lib\/milestone-report"/.test(viewSrc), /@\/lib\/prisma|from "@\/lib\/milestone-report"/.test(clientSrc)],
  [false, false]
)
check("B9. F6: the CSV button renders only behind report.canExport, and canExport is isAdmin", [/report\.canExport && \(/.test(clientSrc), /canExport: viewer\.isAdmin/.test(libSrc)], [true, true])
check(
  "B10. F9 applied on /staff and on the profile tab too",
  [/raiseHiddenForViewer\(dbUser\?\.role, selfStaffId, id\)/.test(staffSrc), /raiseHiddenForViewer\(dbUser\.role,/.test(profileSrc)],
  [true, true]
)
check("B11. the /staff report link sits on the badges' gate, minus the Milestones-button holders (MS-5b)", /const canSeeMilestoneReport = showOnTime && !canSetUpMilestones\n/.test(staffSrc), true)
// MS-5b (Gary, 2026-10-19) — ONE milestone button per role on /staff. The two
// flags as page.tsx composes them, with Milestones on and the role on the
// badges' gate: ADMIN gets Milestones and no report button (it lives on
// /staff/milestones); MANAGER gets the report button, its only route in.
const staffButtons = (role: string) => {
  const showOnTime = role === "ADMIN" || role === "MANAGER"
  const canSetUpMilestones = can(P(role), "milestones.manage")
  return { milestones: canSetUpMilestones, report: showOnTime && !canSetUpMilestones }
}
check(
  "B12. MS-5b: ADMIN sees no report button on /staff (Milestones only); MANAGER sees the report button (no Milestones)",
  [staffButtons("ADMIN"), staffButtons("MANAGER")],
  [{ milestones: true, report: false }, { milestones: false, report: true }]
)
check(
  "B13. MS-5b: the report button still renders on /staff/milestones, and /staff renders it behind canSeeMilestoneReport",
  [src("src/app/(app)/staff/milestones/milestones-client.tsx").includes('href="/staff/milestones/report"'), /\{canSeeMilestoneReport && \(\s*<Link\s*href="\/staff\/milestones\/report"/.test(staffSrc)],
  [true, true]
)

// ─── C. DATABASE ─────────────────────────────────────────────────────────────

/// An instant on today's UTC date at which Denver is already a day ahead of
/// Los Angeles (late evening Pacific) — the hour the two stores disagree.
function splitHour(): Date {
  const d = new Date()
  for (let h = 0; h < 24; h++) {
    const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 30))
    if (localDateStr(c, DEN) > localDateStr(c, LA)) return c
  }
  throw new Error("no split hour")
}

async function db() {
  console.log("\nC. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS b`
  console.log(`      branch id: ${branch[0]?.b ?? "(null)"}`)

  const saved = { H: process.env.HR_MODULE_AVAILABLE, L: process.env.LABOR_MODULE_AVAILABLE, Q: process.env.SQUARE_LABOR_AVAILABLE }
  process.env.HR_MODULE_AVAILABLE = "true"
  process.env.LABOR_MODULE_AVAILABLE = "true"
  process.env.SQUARE_LABOR_AVAILABLE = "true"
  const stamp = Date.now()
  const created = await prisma.organization.create({
    data: { clerkOrgId: `ms5-fixture-${stamp}`, name: "MS-5 Fixture Org", activeModules: ["hr", "labor"], squareLaborEnabled: true, milestonesEnabled: true, timezone: LA },
  })
  const offOrg = await prisma.organization.create({
    data: { clerkOrgId: `ms5-fixture-off-${stamp}`, name: "MS-5 Fixture Off Org", activeModules: ["hr"], milestonesEnabled: false },
  })
  const orgIds = [created.id, offOrg.id]
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: created.id } })
    check("C0. Milestones toggle off → milestonesActive is false (the page 404s)", [milestonesActive(org), milestonesActive(offOrg)], [true, false])

    const now = splitHour()
    const tLA = localDateStr(now, LA)
    const tDEN = localDateStr(now, DEN)
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000)
    const store = (name: string, timezone: string) =>
      prisma.store.create({ data: { organizationId: org.id, name: `MS-5 ${name}`, timezone, squareLocationId: `ms5-loc-${name}-${stamp}` } })
    const P1 = await store("Pacific One", LA)
    const P2 = await store("Pacific Two", LA)
    const D = await store("Denver", DEN)
    const tm = (n: string) => `ms5-tm-${n}-${stamp}`
    const mk = (n: string, stores: string[], opts: { linked?: boolean; start?: number | null; corporate?: boolean } = {}) =>
      prisma.staffMember.create({
        data: {
          organizationId: org.id,
          displayName: `MS-5 ${n}`,
          squareTeamMemberId: opts.linked ? tm(n) : null,
          isCorporate: opts.corporate ?? false,
          startDate: opts.start === null ? null : new Date(`${addDays(tLA, -(opts.start ?? 100))}T00:00:00.000Z`),
          storeAssignments: { create: stores.map((storeId, i) => ({ storeId, isPrimary: i === 0 })) },
        },
      })
    const Ana = await mk("Ana", [P1.id], { linked: true, start: 105 }) // cooldown, open wage row
    const Ben = await mk("Ben", [P2.id, P1.id], { linked: true, start: 20 }) // home P2, also works at P1; amber
    const Cara = await mk("Cara", [D.id, P1.id], { linked: true, start: 200 }) // Denver home, confidential, cooldown
    const Dan = await mk("Dan", [D.id], { start: 20 }) // Denver only, unlinked
    const Tess = await mk("Tess", [P1.id], { linked: true, start: 400 }) // terminated
    const Mo = await mk("Mo", [P1.id], { linked: true, start: 50 }) // the MANAGER's own record, cooldown
    const Xia = await mk("Xia", [P2.id], { start: 60 })
    const Corp = await mk("Corp", [], { corporate: true, start: null })
    await prisma.staffMember.update({ where: { id: Tess.id }, data: { status: "TERMINATED", terminatedAt: ago(5) } })
    const everyone = [Ana, Ben, Cara, Dan, Tess, Mo, Xia, Corp]

    for (const [n, conf] of [["Ana", false], ["Ben", false], ["Cara", true], ["Tess", false], ["Mo", false]] as const) {
      await prisma.squareTeamMemberWage.create({
        data: { organizationId: org.id, squareTeamMemberId: tm(n), status: "ACTIVE", locationIds: [], payType: "HOURLY", hourlyRate: 16, compConfidential: conf, syncedAt: now },
      })
    }
    for (const n of ["Ana", "Cara", "Tess", "Mo"]) {
      await prisma.wageSnapshot.createMany({
        data: [
          { organizationId: org.id, squareTeamMemberId: tm(n), payType: "HOURLY", hourlyRate: 15, capturedAt: ago(40) },
          { organizationId: org.id, squareTeamMemberId: tm(n), payType: "HOURLY", hourlyRate: 16, capturedAt: ago(10) },
        ],
      })
    }
    await prisma.milestoneSettings.create({ data: { organizationId: org.id, checklistMilestonesEnabled: false } })
    await prisma.tenureMilestone.createMany({
      data: [
        { organizationId: org.id, dayCount: 30, title: "MS-5 30 days", recognition: "", employeeMessage: "" },
        { organizationId: org.id, dayCount: 90, title: "MS-5 90 days", recognition: "", employeeMessage: "" },
        { organizationId: org.id, dayCount: 365, title: "MS-5 One year", recognition: "", employeeMessage: "" },
      ],
    })
    await prisma.checklistMilestone.createMany({
      data: [
        { organizationId: org.id, taskCount: 1, title: "MS-5 First task", recognition: "", employeeMessage: "" },
        { organizationId: org.id, taskCount: 3, title: "MS-5 Three tasks", recognition: "", employeeMessage: "" },
      ],
    })
    const template = await prisma.template.create({ data: { organizationId: org.id, name: "MS-5 Template", type: "Opening" } })
    const tasks = await Promise.all(
      Array.from({ length: 3 }, (_, i) => prisma.task.create({ data: { templateId: template.id, sectionName: "MS-5", description: `MS-5 task ${i}` } }))
    )
    const cl = await prisma.checklist.create({ data: { organizationId: org.id, templateId: template.id, storeId: P1.id, date: ago(3) } })
    const log = (taskId: string, staffId: string, days: number) =>
      prisma.taskLog.create({ data: { checklistId: cl.id, taskId, completedByStaffId: staffId, completedAt: ago(days) } })
    await log(tasks[0].id, Ana.id, 3)
    await log(tasks[1].id, Ana.id, 2)
    await log(tasks[2].id, Mo.id, 1)

    // The raise dates, in each member's own zone, and their cooldown ends.
    const raised = (zone: string) => localDateStr(ago(10), zone)
    const RAISE_DATES = [raised(LA), raised(DEN), addDays(raised(LA), 90), addDays(raised(DEN), 90)]

    const MANAGER = P("MANAGER")
    const NO_PAY = P("MANAGER", ["labor.costs.view"])
    const vAdmin: ReportViewer = { actor: P("ADMIN"), role: "ADMIN", isAdmin: true, storeIds: [], selfStaffId: null }
    const vMgr: ReportViewer = { actor: MANAGER, role: "MANAGER", isAdmin: false, storeIds: [P1.id], selfStaffId: Mo.id }
    const vNoPay: ReportViewer = { ...vMgr, actor: NO_PAY }
    const vDen: ReportViewer = { actor: MANAGER, role: "MANAGER", isAdmin: false, storeIds: [D.id], selfStaffId: null }
    const build = (viewer: ReportViewer) => buildMilestoneReport({ org, viewer, now })
    const byName = (r: MilestoneReport) => new Map(r.rows.map((x) => [x.name.replace("MS-5 ", ""), x]))
    const names = (rs: ReportRow[]) => rs.map((x) => x.name.replace("MS-5 ", "")).sort()

    // ── Scope ──
    const admin = await build(vAdmin)
    const mgr = await build(vMgr)
    const den = await build(vDen)
    const staffQuery = await prisma.staffMember.findMany({
      where: { organizationId: org.id, storeAssignments: { some: { storeId: { in: [P1.id] } } } },
      select: { displayName: true },
    })
    check("C1. MANAGER (Pacific One) sees exactly /staff's roster — incl. Ben and Cara, who only ALSO work there", [names(mgr.rows), staffQuery.map((s) => s.displayName.replace("MS-5 ", "")).sort()], [["Ana", "Ben", "Cara", "Mo", "Tess"], ["Ana", "Ben", "Cara", "Mo", "Tess"]])
    check("C2. ...and nobody outside it (Dan, Xia, Corp), and only their own store in the filter", [mgr.rows.some((r) => /Dan|Xia|Corp/.test(r.name)), mgr.stores.map((s) => s.name)], [false, ["MS-5 Pacific One"]])
    check("C3. a MANAGER on the Denver store sees only Denver's people", names(den.rows), ["Cara", "Dan"])
    check("C4. ADMIN sees the whole org, corporate included", names(admin.rows), ["Ana", "Ben", "Cara", "Corp", "Dan", "Mo", "Tess", "Xia"])
    check("C5. a row's stores are only the ones the viewer can see (Ben: Pacific One only for the manager)", byName(mgr).get("Ben")?.storeIds, [P1.id])
    check("C5b. home store column: home first, Corporate for corporate", [byName(mgr).get("Ben")?.homeStore, byName(admin).get("Corp")?.homeStore], ["MS-5 Pacific Two", "Corporate"])

    // ── Checklist switch (F13) ──
    check(
      "C6. switch OFF: checklistOn false, every row's checklist null, no CSV checklist column",
      [admin.checklistOn, admin.rows.every((r) => r.checklist === null), reportCsv(admin, admin.rows).headers.includes("Checklist tasks")],
      [false, true, false]
    )
    await prisma.milestoneSettings.update({ where: { organizationId: org.id }, data: { checklistMilestonesEnabled: true } })
    const adminOn = await build(vAdmin)
    const on = byName(adminOn)
    check(
      "C7. switch ON: task counts and next thresholds",
      [on.get("Ana")?.checklist, on.get("Mo")?.checklist?.tasksCompleted, on.get("Ben")?.checklist?.tasksCompleted, on.get("Tess")?.checklist?.next],
      [{ tasksCompleted: 2, next: { title: "MS-5 Three tasks", taskCount: 3, tasksToGo: 1 } }, 1, 0, null]
    )
    const batched = await namedTaskDatesForMembers({ organizationId: org.id, members: everyone.map((m) => ({ id: m.id, zone: m.id === Cara.id || m.id === Dan.id ? DEN : LA })) })
    const single = await Promise.all(everyone.map((m) => namedTaskDates({ organizationId: org.id, staffMemberId: m.id, zone: m.id === Cara.id || m.id === Dan.id ? DEN : LA })))
    check("C8. the batched reader agrees with namedTaskDates for every member", everyone.map((m) => batched.get(m.id)), single)
    check("C8b. the batched reader is org-scoped: another org reads none of these", [...(await namedTaskDatesForMembers({ organizationId: offOrg.id, members: [{ id: Ana.id, zone: LA }] })).values()], [[]])

    // ── Terminated (F5) ──
    const tess = on.get("Tess") as ReportRow
    check(
      "C9. terminated: history only — reached kept, no next, no on-time, no raise; hidden by default",
      [tess.terminated, tess.reached.filter((r) => r.kind === "tenure").map((r) => r.title), tess.nextTenure, tess.onTime, tess.raise, names(filterReportRows(adminOn.rows, DEFAULT_REPORT_FILTERS)).includes("Tess"), names(filterReportRows(adminOn.rows, { ...DEFAULT_REPORT_FILTERS, showTerminated: true })).includes("Tess")],
      [true, ["MS-5 30 days", "MS-5 90 days", "MS-5 One year"], null, null, null, false, true]
    )

    // ── Upcoming date, Pacific vs Denver ──
    const ben = on.get("Ben") as ReportRow
    const dan = on.get("Dan") as ReportRow
    check(
      `C10a. at ${now.toISOString()} (UTC) Pacific is ${tLA}, Denver ${tDEN}: each row counts in its own store's day`,
      [ben.today, dan.today, ben.nextTenure?.dueOn, dan.nextTenure?.dueOn, ben.nextTenure?.daysToGo, dan.nextTenure?.daysToGo],
      [tLA, tDEN, addDays(tLA, 10), addDays(tLA, 10), 10, 9]
    )

    // ── F3, F9, F10 ──
    const computed = await getRaiseEligibility(
      org,
      [{ id: Ben.id, squareTeamMemberId: tm("Ben"), assignedStoreIds: [P2.id, P1.id], startDate: null, status: "ACTIVE", zone: LA, milestoneEligible: true }],
      await getRaiseSettings(org.id),
      await getMilestoneSettings(org.id),
      { now }
    )
    check("C10. F3: Ben is amber underneath, and has NO raise on the report for anyone", [computed.get(Ben.id)?.status, byName(admin).get("Ben")?.raise, byName(mgr).get("Ben")?.raise], ["yellow", null, null])
    check(
      "C11. F9: the MANAGER's own row has no raise (and is marked You); ADMIN sees it",
      [byName(mgr).get("Mo")?.raise, byName(mgr).get("Mo")?.isSelf, byName(admin).get("Mo")?.raise?.status],
      [null, true, "cooldown"]
    )
    check(
      "C12. MANAGER with pay access: open member has both dates; confidential member keeps the colour with NO dates",
      [byName(mgr).get("Ana")?.raise, byName(mgr).get("Cara")?.raise],
      [
        { status: "cooldown", why: "Recent raise — in cooldown.", lastRaiseOn: raised(LA), cooldownUntil: addDays(raised(LA), 90) },
        { status: "cooldown", why: "Recent raise — in cooldown." },
      ]
    )
    const leaks = (text: string) => /lastRaiseOn|cooldownUntil/.test(text) || RAISE_DATES.some((d) => text.includes(d))
    const csvText = (r: MilestoneReport) => {
      const { headers, body } = reportCsv(r, r.rows)
      return [headers, ...body].map((x) => x.map(escapeCell).join(",")).join("\n")
    }
    const noPay = await build(vNoPay)
    check(
      "C13. MANAGER WITHOUT pay access: colours kept, and the RAW PAYLOAD carries no raise date key or date string",
      [byName(noPay).get("Ana")?.raise?.status, byName(noPay).get("Cara")?.raise?.status, leaks(JSON.stringify(noPay))],
      ["cooldown", "cooldown", false]
    )
    check("C14. ...and the RAW CSV of every row (terminated included) carries none either", leaks(csvText(noPay)), false)
    check("C14b. the pay-access MANAGER's CSV has Ana's dates but not Cara's (confidential)", [csvText(mgr).includes(addDays(raised(LA), 90)), csvText(mgr).includes(addDays(raised(DEN), 90))], [true, false])
    // POSITIVE CONTROL: the same detector on the ADMIN's payload and CSV MUST
    // fire, or C13/C14 prove nothing.
    check(
      "C15. positive control: ADMIN gets Cara's dates (Denver), and leaks() sees them in payload and CSV",
      [byName(admin).get("Cara")?.raise?.cooldownUntil, leaks(JSON.stringify(admin)), leaks(csvText(admin))],
      [addDays(raised(DEN), 90), true, true]
    )
    check(
      "C16. no pay amount or rate field reaches any report",
      [admin, mgr, noPay].some((r) => /hourlyRate|annualRate|fromRate|toRate|payType|compConfidential/.test(JSON.stringify(r))),
      false
    )
    check("C17. F6: only the ADMIN can export", [admin.canExport, mgr.canExport, noPay.canExport], [true, false, false])

    // ── Filters over real rows ──
    const F = (o: Partial<ReportFilters>, r: MilestoneReport = adminOn) => names(filterReportRows(r.rows, { ...DEFAULT_REPORT_FILTERS, ...o }))
    check(
      "C18. filters on the ADMIN report: store, raise status, coming up in 30, reached in 30",
      [F({ storeId: P1.id }), F({ raiseStatus: "cooldown" }), F({ upcomingWithinDays: 30 }), F({ reachedWithinDays: 30 })],
      [["Ana", "Ben", "Cara", "Mo"], ["Ana", "Cara", "Mo"], ["Ben", "Dan", "Xia"], ["Ana", "Mo"]]
    )
    check("C19. F10: the cooldown filter on a no-pay MANAGER returns the confidential member, still with no date", [F({ raiseStatus: "cooldown" }, noPay), leaks(JSON.stringify(filterReportRows(noPay.rows, { ...DEFAULT_REPORT_FILTERS, raiseStatus: "cooldown" })))], [["Ana", "Cara"], false])
    check("C20. default sort is soonest next milestone first", names(sortReportRows(filterReportRows(adminOn.rows, DEFAULT_REPORT_FILTERS), "next")).length, 7)
    check("C20b. ...in order", sortReportRows(filterReportRows(adminOn.rows, DEFAULT_REPORT_FILTERS), "next").map((r) => r.name.replace("MS-5 ", "")), ["Dan", "Ben", "Xia", "Mo", "Cara", "Ana", "Corp"])
  } finally {
    await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: { in: orgIds } } } })
    await prisma.checklist.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.task.deleteMany({ where: { template: { organizationId: { in: orgIds } } } })
    await prisma.template.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.checklistMilestone.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.tenureMilestone.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.milestoneSettings.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.wageSnapshot.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.squareTeamMemberWage.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.staffMember.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.store.deleteMany({ where: { organizationId: { in: orgIds } } })
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "ms5-fixture" } } })
    check("C21. cleanup: no MS-5 fixture orgs left", left, 0)
    for (const [k, v] of [["HR_MODULE_AVAILABLE", saved.H], ["LABOR_MODULE_AVAILABLE", saved.L], ["SQUARE_LABOR_AVAILABLE", saved.Q]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

db()
  .catch((e) => {
    failures++
    console.error(e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(`\n${passes} passed, ${failures} failed`)
    process.exit(failures ? 1 : 0)
  })
