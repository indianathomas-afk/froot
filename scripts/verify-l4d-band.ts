/**
 * L-4d acceptance fixture — the manager band reads the Square schedule.
 *
 *   npx tsx scripts/verify-l4d-band.ts
 *
 * Pure functions, no DB and no network. Rulings: docs/DECISIONS.md L-4-1 ruling
 * 5/5a/5b/5c and the L-4d entry (R1-R4). Asserts:
 *   1. The band draws only on days Square has her AT THIS STORE.
 *   2. No Square data → every day as-today, exactly.
 *   3. Overlay toggle off, or viewer denied labor.schedule.view (R1) → as-today.
 *   4. Sync never / stale / error → as-today (5c); synced-empty still decides.
 *   5. Each B3 edge case: two stores one day; a draft-sourced effective row;
 *      a shift past open/close; shifts elsewhere but none here; two salaried
 *      people (R2); past the sync window end (R3); split shift + hour grain (R4);
 *      tombstones.
 *   6. applyManagerBand replaces gmWindow + points[].gm and NOTHING else;
 *      as-today is identity.
 *   7. THE BOUNDARY TEST: for a fixed week, floor credit, gmHoursByDay, the GM
 *      cap, coverage headcount, Suggested and the budget are byte-identical with
 *      and without Square schedule rows present.
 *   8. Seam (b), statically: none of the six core engines imports labor-schedule.
 */
import { readFileSync } from "fs"
import {
  decideManagerBands,
  applyManagerBand,
  bandWindowFor,
  getManagerBandDecisions,
  localMidnightUtc,
  type ManagerBand,
  type ManagerBandDecision,
  type ManagerBandShiftRow,
} from "../src/lib/labor-schedule"
import { computeDailyCoverage, suggestedHoursForDay, type HourNet } from "../src/lib/labor-coverage"
import { capGmFloorCredits } from "../src/lib/labor-daily"
import { computeWeeklyLaborBudget, type LaborBudgetPosition } from "../src/lib/labor-budget"

let failures = 0
let checks = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  checks++
  // Serialized payloads are compared whole but printed short — the length is
  // what a reader needs to see that something non-trivial was compared.
  const fmt = (v: unknown) => {
    const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)
    return s.length > 60 ? `<${s.length} chars>` : s
  }
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${fmt(actual)}${ok ? "" : ` (expected ${fmt(expected)})`}`)
}

const TZ = "America/Los_Angeles"
// Mon 2026-11-09 .. Sun 2026-11-15 — clear of both DST changes.
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]
const [MON, TUE, WED, THU, FRI, SAT, SUN] = WEEK
const OPEN: Record<string, ManagerBand | null> = Object.fromEntries(
  WEEK.map((d) => [d, d === SUN ? null : { startHour: 7, endHour: 19 }])
)
const LB = "store-las-brisas"
const UNR = "store-unr"
const K = "tm-kristie"
const M = "tm-second"

function at(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number)
  return new Date(localMidnightUtc(date, TZ).getTime() + h * 3600000 + m * 60000)
}
function shift(storeId: string, tm: string, date: string, from: string, to: string, deleted = false, toDate = date): ManagerBandShiftRow {
  return { storeId, effectiveTeamMemberId: tm, effectiveStartAt: at(date, from), effectiveEndAt: at(toDate, to), effectiveIsDeleted: deleted }
}

const BASE = {
  storeId: LB,
  dates: WEEK,
  openByDate: OPEN,
  timeZone: TZ,
  overlayOn: true,
  viewerCanSee: true,
  health: "fresh" as const,
  lastWindowEnd: "2026-12-31",
  teamMemberIds: [K],
  shifts: [] as ManagerBandShiftRow[],
}

function show(d: ManagerBandDecision | undefined): string {
  if (!d) return "undefined"
  return d.kind === "present" ? `present ${d.band.startHour}-${d.band.endHour}` : d.kind
}
function allAsToday(r: Record<string, ManagerBandDecision>): boolean {
  return WEEK.every((d) => r[d]?.kind === "as-today")
}

const KRISTIE_WEEK = [
  shift(LB, K, MON, "07:30", "13:45"),
  shift(UNR, K, TUE, "07:00", "15:00"),
  shift(LB, K, WED, "08:00", "14:00"),
]

console.log("1 · The band draws only on scheduled days at this store:")
{
  const r = decideManagerBands({ ...BASE, shifts: KRISTIE_WEEK })
  check("Mon (LB 07:30-13:45) → present 7-14", show(r[MON]), "present 7-14")
  check("Tue (at UNR, not here) → absent", show(r[TUE]), "absent")
  check("Wed (LB 08:00-14:00) → present 8-14", show(r[WED]), "present 8-14")
  check("Thu (no shift) → absent", show(r[THU]), "absent")
  check("Fri → absent", show(r[FRI]), "absent")
  check("Sat → absent", show(r[SAT]), "absent")
  check("Sun (closed) → as-today", show(r[SUN]), "as-today")
  const u = decideManagerBands({ ...BASE, storeId: UNR, shifts: KRISTIE_WEEK })
  check("UNR Mon → absent", show(u[MON]), "absent")
  check("UNR Tue → present 7-15", show(u[TUE]), "present 7-15")
}

console.log("\n2 · No Square data → as-today, every day:")
{
  check("no rows at all", allAsToday(decideManagerBands({ ...BASE })), true)
  check(
    "rows only for someone not allocated here",
    allAsToday(decideManagerBands({ ...BASE, shifts: [shift(LB, "tm-hourly", MON, "07:00", "15:00")] })),
    true
  )
  check(
    "her rows only in ANOTHER week",
    allAsToday(decideManagerBands({ ...BASE, shifts: [shift(LB, K, "2026-11-16", "07:00", "15:00")] })),
    true
  )
  check(
    "an unassigned shift (null team member) is nobody's",
    allAsToday(
      decideManagerBands({ ...BASE, shifts: [{ ...shift(LB, K, MON, "07:00", "15:00"), effectiveTeamMemberId: null }] })
    ),
    true
  )
  check("no allocated person", allAsToday(decideManagerBands({ ...BASE, teamMemberIds: [], shifts: KRISTIE_WEEK })), true)
}

console.log("\n3 · Toggle off / viewer denied (R1) → as-today:")
{
  check("overlay off", allAsToday(decideManagerBands({ ...BASE, overlayOn: false, shifts: KRISTIE_WEEK })), true)
  check("viewer lacks labor.schedule.view", allAsToday(decideManagerBands({ ...BASE, viewerCanSee: false, shifts: KRISTIE_WEEK })), true)
}

console.log("\n4 · Sync health (5c):")
{
  for (const h of ["never", "stale", "error"] as const) {
    check(`${h} → as-today`, allAsToday(decideManagerBands({ ...BASE, health: h, shifts: KRISTIE_WEEK })), true)
  }
  const se = decideManagerBands({ ...BASE, health: "synced-empty", shifts: [shift(UNR, K, TUE, "07:00", "15:00")] })
  check("synced-empty here, her shift elsewhere → Mon absent", show(se[MON]), "absent")
}

console.log("\n5 · B3 edge cases:")
{
  const two = [shift(LB, K, MON, "07:00", "11:00"), shift(UNR, K, MON, "12:00", "17:00")]
  check("two stores one day — LB draws only its own", show(decideManagerBands({ ...BASE, shifts: two })[MON]), "present 7-11")
  check("two stores one day — UNR draws only its own", show(decideManagerBands({ ...BASE, storeId: UNR, shifts: two })[MON]), "present 12-17")

  // The rows are EFFECTIVE (published ?? draft, resolved at sync); a draft-only
  // shift arrives as an ordinary row and counts (5a).
  check("draft-sourced effective row counts", show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, THU, "09:00", "12:00")] })[THU]), "present 9-12")

  check("shift 05:00-21:00 clipped to open 7-19", show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "05:00", "21:00")] })[MON]), "present 7-19")
  check("shift 04:00-06:00 wholly before open → absent", show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "04:00", "06:00")] })[MON]), "absent")
  check("shift on a closed day → as-today", show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, SUN, "09:00", "12:00")] })[SUN]), "as-today")
  const overnight = decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "17:00", "02:00", false, TUE)] })
  check("overnight Mon 17:00→Tue 02:00 — Mon present 17-19", show(overnight[MON]), "present 17-19")
  check("overnight — Tue's 00-02 part is before open → absent", show(overnight[TUE]), "absent")

  const elsewhere = decideManagerBands({ ...BASE, shifts: [shift(UNR, K, MON, "07:00", "15:00"), shift(UNR, K, WED, "07:00", "15:00")] })
  check("shifts elsewhere, none here → every open day absent", WEEK.filter((d) => d !== SUN).every((d) => elsewhere[d].kind === "absent"), true)

  // R2 — more than one salaried person.
  const twoPeople = { ...BASE, teamMemberIds: [K, M] }
  check(
    "R2: second person has no shift that week → as-today",
    allAsToday(decideManagerBands({ ...twoPeople, shifts: [shift(LB, K, MON, "07:00", "11:00")] })),
    true
  )
  const both = decideManagerBands({
    ...twoPeople,
    shifts: [shift(LB, K, MON, "07:00", "11:00"), shift(LB, M, MON, "13:00", "18:00"), shift(LB, M, TUE, "09:00", "12:00"), shift(UNR, K, WED, "07:00", "15:00")],
  })
  check("R2: Mon earliest-to-latest across both → 7-18", show(both[MON]), "present 7-18")
  check("R2: Tue only the second person → 9-12", show(both[TUE]), "present 9-12")
  check("R2: Wed nobody here → absent", show(both[WED]), "absent")

  // R3 — past the last sync window end.
  const r3 = decideManagerBands({ ...BASE, lastWindowEnd: WED, shifts: KRISTIE_WEEK })
  check("R3: Mon (inside window) → present 7-14", show(r3[MON]), "present 7-14")
  check("R3: Wed (= window end, inclusive) → present 8-14", show(r3[WED]), "present 8-14")
  check("R3: Thu (after window end) → as-today", show(r3[THU]), "as-today")
  check("R3: Sat → as-today", show(r3[SAT]), "as-today")
  check("R3: window end unknown → as-today", show(decideManagerBands({ ...BASE, lastWindowEnd: null, shifts: KRISTIE_WEEK })[MON]), "as-today")

  // R4 — split shift and hour grain.
  check(
    "R4: split 07-10 + 15-18 → one band 7-18",
    show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "07:00", "10:00"), shift(LB, K, MON, "15:00", "18:00")] })[MON]),
    "present 7-18"
  )
  check("R4: 07:30-13:45 → 7-14 (floor/ceil)", show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "07:30", "13:45")] })[MON]), "present 7-14")
  check("R4: end exactly 13:00 stays 13", show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "08:00", "13:00")] })[MON]), "present 8-13")

  check(
    "tombstone only → as-today (no live data)",
    allAsToday(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "07:00", "15:00", true)] })),
    true
  )
  check(
    "tombstone beside a live shift elsewhere → Mon absent here",
    show(decideManagerBands({ ...BASE, shifts: [shift(LB, K, MON, "07:00", "15:00", true), shift(UNR, K, TUE, "07:00", "15:00")] })[MON]),
    "absent"
  )
}

// ─── A fixed engine week, shared by 6 and 7 ─────────────────────────────────
// The engine's band today: allocated → gmOnFloor default 7-14 every open day.
const ENGINE_GM: ManagerBand = { startHour: 7, endHour: 14 }
const DEMAND: HourNet[] = Array.from({ length: 24 }, (_, hour) => ({ hour, net: hour >= 7 && hour < 19 ? 50 + (hour % 5) * 20 : 0 }))
const gmHoursByDay = WEEK.map((d) => (OPEN[d] ? Math.min(ENGINE_GM.endHour, OPEN[d]!.endHour) - Math.max(ENGINE_GM.startHour, OPEN[d]!.startHour) : 0))
const POSITIONS: LaborBudgetPosition[] = [
  { payType: "SALARIED", defaultHourlyRate: 20, impliedWeeklyHours: 20, active: true },
  { payType: "HOURLY", defaultHourlyRate: 15, impliedWeeklyHours: null, active: true },
]

function engineWeek() {
  const budget = computeWeeklyLaborBudget({
    settings: { laborTargetPct: 20, roundingIncrement: 1000, plannedBlendedRate: 15 },
    positions: POSITIONS,
    forecast: { total: 14900 },
  })
  const credit = capGmFloorCredits(gmHoursByDay, 20)
  const coverage = WEEK.map((d, i) =>
    computeDailyCoverage({
      hourlyBudgetHours: 14 + i,
      demand: DEMAND,
      open: OPEN[d],
      gmWindow: OPEN[d] ? ENGINE_GM : null,
      hasHourlySupervisor: false,
    })
  )
  return { budget, credit, coverage }
}

function stripBand(c: ReturnType<typeof computeDailyCoverage>) {
  if (!c) return null
  const rest: Record<string, unknown> = { ...c }
  delete rest.gmWindow
  rest.points = c.points.map((p) => {
    const q: Record<string, unknown> = { ...p }
    delete q.gm
    return q
  })
  return rest
}

console.log("\n6 · applyManagerBand replaces the band and nothing else:")
{
  const { coverage } = engineWeek()
  const mon = coverage[0]!
  check("as-today → the SAME object", Object.is(applyManagerBand(mon, { kind: "as-today" }), mon), true)
  check("undefined decision → the SAME object", Object.is(applyManagerBand(mon, undefined), mon), true)
  check("null coverage stays null", applyManagerBand(null, { kind: "absent" }), null)

  const absent = applyManagerBand(mon, { kind: "absent" })!
  check("absent → gmWindow null", absent.gmWindow, null)
  check("absent → no point has gm", absent.points.some((p) => p.gm), false)
  check("absent → everything else identical", JSON.stringify(stripBand(absent)), JSON.stringify(stripBand(mon)))

  const present = applyManagerBand(mon, { kind: "present", band: { startHour: 9, endHour: 12 } })!
  check("present → gmWindow 9-12", `${present.gmWindow?.startHour}-${present.gmWindow?.endHour}`, "9-12")
  check(
    "present → gm exactly hours 9,10,11",
    present.points.filter((p) => p.gm).map((p) => p.hour).join(","),
    "9,10,11"
  )
  check("present → everything else identical", JSON.stringify(stripBand(present)), JSON.stringify(stripBand(mon)))
  check("engine object not mutated", JSON.stringify(mon.gmWindow), JSON.stringify(ENGINE_GM))

  check("bandWindowFor as-today → engine window", bandWindowFor(ENGINE_GM, { kind: "as-today" }), ENGINE_GM)
  check("bandWindowFor absent → null", bandWindowFor(ENGINE_GM, { kind: "absent" }), null)
  check("bandWindowFor present → band", JSON.stringify(bandWindowFor(ENGINE_GM, { kind: "present", band: { startHour: 8, endHour: 14 } })), '{"startHour":8,"endHour":14}')
}

console.log("\n7 · THE BOUNDARY TEST — every number byte-identical with and without Square rows:")
{
  const without = engineWeek()
  const withRows = engineWeek()
  const decisions = decideManagerBands({ ...BASE, shifts: KRISTIE_WEEK })
  const applied = withRows.coverage.map((c, i) => applyManagerBand(c, decisions[WEEK[i]]))

  // The band DID move (otherwise the test proves nothing).
  check("band moved on Tue (drawn → absent)", applied[1]?.gmWindow ?? null, null)
  check("band moved on Wed (7-14 → 8-14)", applied[2]?.gmWindow?.startHour, 8)

  check("gmHoursByDay input unchanged", JSON.stringify(gmHoursByDay), JSON.stringify([7, 7, 7, 7, 7, 7, 0]))
  check("floor credit (capGmFloorCredits) identical", JSON.stringify(withRows.credit), JSON.stringify(without.credit))
  check("budget identical", JSON.stringify(withRows.budget), JSON.stringify(without.budget))
  check(
    "coverage minus the band identical (headcount, hourly, peak, used, understaffed, supervisorGap)",
    JSON.stringify(applied.map(stripBand)),
    JSON.stringify(without.coverage.map(stripBand))
  )
  check(
    "coverage headcount identical",
    JSON.stringify(applied.map((c) => c?.points.map((p) => p.headcount))),
    JSON.stringify(without.coverage.map((c) => c?.points.map((p) => p.headcount)))
  )
  check(
    "Suggested (suggestedHoursForDay) identical",
    JSON.stringify(applied.map((c, i) => (c ? suggestedHoursForDay(c.points, without.credit[i]) : null))),
    JSON.stringify(without.coverage.map((c, i) => (c ? suggestedHoursForDay(c.points, without.credit[i]) : null)))
  )
  const allAsTodayApplied = withRows.coverage.map((c, i) => applyManagerBand(c, decideManagerBands({ ...BASE })[WEEK[i]]))
  check(
    "no Square data → coverage byte-identical INCLUDING the band",
    JSON.stringify(allAsTodayApplied),
    JSON.stringify(without.coverage)
  )
}

console.log("\n8 · Seam (b) — no core engine imports labor-schedule; gates cost no query:")
{
  for (const f of ["labor-plan", "labor-coverage", "labor-budget", "labor-daily", "labor-week", "labor-forecast"]) {
    const src = readFileSync(`src/lib/${f}.ts`, "utf8")
    check(`${f}.ts has no labor-schedule import`, /labor-schedule/.test(src), false)
  }
  // overlayOn false returns before any prisma call — if it queried, this would
  // throw without a database.
  getManagerBandDecisions({ organizationId: "org", storeId: LB, timeZone: TZ, dates: WEEK, openByDate: OPEN, overlayOn: false, viewerCanSee: true })
    .then((r) => {
      check("gate off → as-today without a query", allAsToday(r), true)
      return getManagerBandDecisions({ organizationId: "org", storeId: LB, timeZone: TZ, dates: WEEK, openByDate: OPEN, overlayOn: true, viewerCanSee: false })
    })
    .then((r) => {
      check("viewer denied → as-today without a query", allAsToday(r), true)
      console.log(`\n${failures === 0 ? `PASS — ${checks} checks` : `FAIL — ${failures} of ${checks} check(s)`}\n`)
      process.exit(failures === 0 ? 0 : 1)
    })
}
