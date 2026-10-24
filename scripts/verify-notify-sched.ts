/**
 * NOTIFY-SCHED acceptance fixture — per-kind send schedules and the hourly
 * runner.
 *
 *   npx tsx scripts/verify-notify-sched.ts
 *
 * Runs against the DEV database (local .env). Creates two throwaway orgs,
 * "NOTIFY-SCHED Fixture Org A/B (safe to delete)", with stores, one ADMIN each,
 * goals and sales for Oct–Dec 2026, and staff named "NOTIFY-SCHED Staff …".
 * Drives the REAL runner (runScheduledEmails, ALWAYS scoped to a fixture org)
 * on an INJECTED CLOCK, in live mode through an in-process capture sender —
 * Resend is never contacted. Deletes everything afterwards.
 *
 *   P. Pure (no DB): ISO weeks across year ends; period keys; the 15:00 UTC
 *      default slot; the chosen hour in store-local time on both sides of the
 *      2026-11-01 PDT→PST change; the spring-forward 2 AM caught at 3 AM; a
 *      disallowed day; weekly = one day (F16); monthly day 1–28 (F5); the
 *      write validation (F10, F12, F16, F3); an unusable row → the default.
 *   C. The cron handler's auth refuses before reading anything.
 *   D. DEFAULTS UNCHANGED (F6), org A, no rows: nothing before 15:00 UTC; at
 *      15:05 UTC each store alerts once, monthly key, F-5 text byte for byte,
 *      no frequency in the payload, PaceAlertLog written; one milestone email
 *      with today's footer; a second run that hour does nothing; the next day
 *      "already alerted this month".
 *   M. One milestone email a day (audit M1): a milestone appearing after the
 *      day's run waits for the next day's run, and the earlier one is not
 *      resent.
 *   S. DAILY pace, org B: each store at ITS OWN local hour; repeated runs in
 *      one hour send once; the next day alerts again (the PaceAlertLog gate no
 *      longer blocks a non-monthly period, audit P1); a missed hour is caught
 *      later the same local day (F8) and never the next day.
 *   W. WEEKLY pace across the DST change: the slot moves with local time; the
 *      chosen weekday only; one alert per store per ISO week; per-week wording.
 *   N. MONTHLY pace with a row (F11 = today's behaviour): evaluated on every
 *      ticked day, one alert a month, F-5 text; an unticked day is skipped.
 *   K. WEEKLY milestones in an org zone (F3) across spring-forward: the 2 AM
 *      slot that does not exist fires at 3 AM; once per slot; per-week wording.
 *   I. ORG ISOLATION: a run for one org never claims, evaluates or mails the
 *      other, whatever the other's schedule says.
 *
 * NEGATIVE CONTROLS (run by the build session, recorded in the report):
 *   - slotDue(): delete the `local.hour < usable.sendHour` test — S1 and W1
 *     must FAIL;
 *   - claimScheduleSlot(): always return true — D3, S3 and M1 must FAIL;
 *   - pace-alerts.ts: make the PaceAlertLog gate unconditional — S4 must FAIL.
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"
import { dbDate } from "../src/lib/reports"
import type { EmailMessage, EmailSender } from "../src/lib/notify"
import { getKind } from "../src/lib/notifications/registry"
import { MILESTONE_KIND } from "../src/lib/notifications/kinds/milestone"
import type { KindSchedule } from "../src/lib/notifications/define"
import { isoWeekKey, periodKey, scheduleProblem, slotDue, type ScheduleRowLike } from "../src/lib/notifications/schedule"
import { parseScheduleBody } from "../src/lib/notifications/schedule-settings"
import { runScheduledEmails, scheduledEmailsCron } from "../src/lib/scheduled-emails"

const LA = "America/Los_Angeles"
const NY = "America/New_York"
const PACE = "pace.alert"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures += 1
}

const ENV_KEYS = ["HR_MODULE_AVAILABLE", "NEXT_PUBLIC_APP_URL", "CRON_SECRET", "PACE_ALERT_THRESHOLD_PCT"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}

type Capture = { sent: EmailMessage[]; sender: EmailSender }
function capture(): Capture {
  const sent: EmailMessage[] = []
  return {
    sent,
    sender: {
      async send(m) {
        sent.push(m)
        return { id: `nsched-cap-${Math.random().toString(36).slice(2, 10)}` }
      },
    },
  }
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const row = (o: Partial<ScheduleRowLike> = {}): ScheduleRowLike => ({
  frequency: "daily",
  sendHour: 8,
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  dayOfMonth: null,
  timeZone: null,
  ...o,
})
const at = (iso: string) => new Date(iso)

function pureChecks(pace: KindSchedule, ms: KindSchedule) {
  // ── P. Pure ─────────────────────────────────────────────────────────────
  check("P1 ISO weeks across year ends", isoWeekKey("2026-01-01") === "2026-W01" && isoWeekKey("2027-01-01") === "2026-W53" && isoWeekKey("2024-12-30") === "2025-W01" && isoWeekKey("2026-10-24") === "2026-W43")
  check("P2 period keys: monthly is the NOTIFY-6 suffix, weekly ISO week, daily the date", periodKey("monthly", "2026-10-24") === "2026-10" && periodKey("weekly", "2026-10-24") === "2026-W43" && periodKey("daily", "2026-10-24") === "2026-10-24")

  const legacyBefore = slotDue(pace, null, at("2026-10-20T14:59:00Z"), LA)
  const legacyAt = slotDue(pace, null, at("2026-10-20T15:05:00Z"), NY)
  const legacyLate = slotDue(pace, null, at("2026-10-20T23:55:00Z"), LA)
  const legacyNext = slotDue(pace, null, at("2026-10-21T00:05:00Z"), LA)
  check(
    "P3 no row: the slot opens at 15:00 UTC, whatever the zone, for the rest of that UTC day",
    !legacyBefore.due && legacyAt.due && legacyAt.slotDate === "2026-10-20" && legacyAt.frequency === undefined && legacyLate.due && legacyLate.slotDate === "2026-10-20" && !legacyNext.due
  )

  const pdt = slotDue(pace, row(), at("2026-10-30T15:05:00Z"), LA) // 08:05 PDT
  const pdtEarly = slotDue(pace, row(), at("2026-10-30T14:05:00Z"), LA) // 07:05 PDT
  const pst = slotDue(pace, row(), at("2026-11-02T15:05:00Z"), LA) // 07:05 PST
  const pstOk = slotDue(pace, row(), at("2026-11-02T16:05:00Z"), LA) // 08:05 PST
  check("P4 8 AM local across PDT→PST: 15:05Z due in October, not in November; 16:05Z due in November", pdt.due && !pdtEarly.due && !pst.due && pstOk.due)

  const msRow = row({ sendHour: 2, timeZone: LA })
  const beforeGap = slotDue(ms, msRow, at("2027-03-14T09:30:00Z"), LA) // 01:30 PST
  const afterGap = slotDue(ms, msRow, at("2027-03-14T10:05:00Z"), LA) // 03:05 PDT — 2 AM never happened
  check("P5 spring forward: a 2 AM slot fires at the 3 AM run", !beforeGap.due && afterGap.due && afterGap.slotDate === "2027-03-14")

  const fb1 = slotDue(ms, row({ sendHour: 1, timeZone: LA }), at("2026-11-01T08:30:00Z"), LA) // 01:30 PDT
  const fb2 = slotDue(ms, row({ sendHour: 1, timeZone: LA }), at("2026-11-01T09:30:00Z"), LA) // 01:30 PST
  check("P6 fall back: both 1 AMs are the same slot date (the run marker stops the second)", fb1.due && fb2.due && fb1.slotDate === fb2.slotDate)

  const weekdaysOnly = row({ daysOfWeek: [1, 2, 3, 4, 5] })
  check("P7 disallowed day: a Saturday with Mon–Fri ticked is not due", !slotDue(pace, weekdaysOnly, at("2026-10-24T16:05:00Z"), LA).due && slotDue(pace, weekdaysOnly, at("2026-10-23T16:05:00Z"), LA).due)

  const weekly = row({ frequency: "weekly", daysOfWeek: [1] })
  check("P8 weekly = the one chosen day (F16)", slotDue(pace, weekly, at("2026-10-26T16:05:00Z"), LA).due && !slotDue(pace, weekly, at("2026-10-27T16:05:00Z"), LA).due)

  // F5: no kind offers day-of-month today (F11, F12), so a synthetic digest spec.
  const digest: KindSchedule = { scope: "org", frequencies: ["daily", "weekly", "monthly"], monthly: "day-of-month", hours: { min: 0, max: 23 }, legacyUtcHour: 15 }
  const dom = row({ frequency: "monthly", dayOfMonth: 3, timeZone: LA, daysOfWeek: [6] })
  check(
    "P9 monthly digest: day of month, weekday boxes ignored (F5); 29 refused",
    slotDue(digest, dom, at("2026-11-03T17:05:00Z"), LA).due && !slotDue(digest, dom, at("2026-11-04T17:05:00Z"), LA).due && scheduleProblem(digest, { ...dom, dayOfMonth: 29 }) !== null
  )

  const ok = (r: ReturnType<typeof parseScheduleBody>) => r.ok
  check(
    "P10 write validation: pace 5–20 (F10), milestones daily/weekly (F12), weekly one day (F16), org zone required (F3)",
    ok(parseScheduleBody(pace, { frequency: "daily", sendHour: 5, daysOfWeek: [1] })) &&
      ok(parseScheduleBody(pace, { frequency: "daily", sendHour: 20, daysOfWeek: [1] })) &&
      !ok(parseScheduleBody(pace, { frequency: "daily", sendHour: 4, daysOfWeek: [1] })) &&
      !ok(parseScheduleBody(pace, { frequency: "daily", sendHour: 21, daysOfWeek: [1] })) &&
      !ok(parseScheduleBody(ms, { frequency: "monthly", sendHour: 8, daysOfWeek: [1], dayOfMonth: 3, timeZone: LA })) &&
      !ok(parseScheduleBody(pace, { frequency: "weekly", sendHour: 8, daysOfWeek: [1, 2] })) &&
      !ok(parseScheduleBody(ms, { frequency: "daily", sendHour: 8, daysOfWeek: [1] })) &&
      ok(parseScheduleBody(ms, { frequency: "weekly", sendHour: 2, daysOfWeek: [7], timeZone: NY }))
  )
  const bad = slotDue(pace, row({ sendHour: 3 }), at("2026-10-20T15:05:00Z"), LA)
  check("P11 an unusable row runs on the default slot", bad.due && bad.frequency === undefined && !slotDue(pace, row({ sendHour: 3 }), at("2026-10-20T14:05:00Z"), LA).due)
}

async function main() {
  process.env.HR_MODULE_AVAILABLE = "true"
  process.env.NEXT_PUBLIC_APP_URL = "https://notify-sched.example.com"

  const paceSpec = getKind(PACE)?.schedule
  const msSpec = getKind(MILESTONE_KIND)?.schedule
  check("R1 registry: pace and milestones are scheduled, hr.ack and test are not (F1)", !!paceSpec && !!msSpec && !getKind("hr.ack")?.schedule && !getKind("test")?.schedule)
  check("R2 pace: store-scoped, daily/weekly/monthly, 5–20 (F10), monthly = every allowed day (F11)", paceSpec?.scope === "store" && paceSpec.frequencies.join() === "daily,weekly,monthly" && paceSpec.hours.min === 5 && paceSpec.hours.max === 20 && paceSpec.monthly === "every-allowed-day")
  check("R3 milestones: org-scoped, daily/weekly only (F12)", msSpec?.scope === "org" && msSpec.frequencies.join() === "daily,weekly")
  if (!paceSpec || !msSpec) throw new Error("registry missing schedules")
  pureChecks(paceSpec, msSpec)

  // ── C. The cron handler refuses before reading anything ──────────────────
  delete process.env.CRON_SECRET
  const noSecret = await scheduledEmailsCron(new Request("http://x/api/cron/scheduled-emails"), "fixture")
  process.env.CRON_SECRET = "nsched-fixture-secret"
  const wrong = await scheduledEmailsCron(new Request("http://x/api/cron/scheduled-emails", { headers: { authorization: "Bearer nope" } }), "fixture")
  check("C1 handler: no CRON_SECRET → 500, wrong bearer → 401", noSecret.status === 500 && wrong.status === 401)

  const tag = Math.random().toString(36).slice(2, 8)
  const mkOrg = (x: string) =>
    prisma.organization.create({
      data: {
        clerkOrgId: `nsched-fixture-${x}-${tag}`,
        name: `NOTIFY-SCHED Fixture Org ${x} (safe to delete)`,
        timezone: LA,
        activeModules: ["hr"],
        milestonesEnabled: true,
        milestoneAlertsEnabled: true,
        paceAlertsEnabled: true,
        paceAlertThresholdPct: 90,
      },
    })
  const orgA = await mkOrg("A")
  const orgB = await mkOrg("B")
  const [{ branch }] = await prisma.$queryRaw<{ branch: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch`
  console.log(`branch ${branch ?? "(null — not Neon)"} · orgs A ${orgA.id} · B ${orgB.id}`)

  try {
    const months = eachDate("2026-10-01", "2026-12-31")
    const mkStore = async (orgId: string, name: string, tz: string) => {
      const store = await prisma.store.create({ data: { organizationId: orgId, name: `NOTIFY-SCHED Store ${name}`, timezone: tz } })
      const plan = await prisma.goalPlan.create({ data: { organizationId: orgId, storeId: store.id, year: 2026, basisType: "MANUAL", updatedById: "nsched-fixture" } })
      await prisma.dailyGoal.createMany({ data: months.map((d) => ({ planId: plan.id, storeId: store.id, date: dbDate(d), basisAmount: 1000, goalAmount: 1000 })) })
      // $500 a day against $1,000 → 50% of MTD goal, behind a 90% threshold every day.
      await prisma.salesPeriodCache.createMany({
        data: months.map((d) => ({ organizationId: orgId, storeId: store.id, date: dbDate(d), netSales: 500, grossSales: 540, taxTotal: 40, orderCount: 5 })),
      })
      return store
    }
    const aLA = await mkStore(orgA.id, "A-LA", LA)
    const aNY = await mkStore(orgA.id, "A-NY", NY)
    const bLA = await mkStore(orgB.id, "B-LA", LA)
    const bNY = await mkStore(orgB.id, "B-NY", NY)
    const adminA = await prisma.user.create({ data: { clerkUserId: `nsched-a-${tag}`, organizationId: orgA.id, email: `nsched-admin-a-${tag}@example.com`, role: "ADMIN" } })
    const adminB = await prisma.user.create({ data: { clerkUserId: `nsched-b-${tag}`, organizationId: orgB.id, email: `nsched-admin-b-${tag}@example.com`, role: "ADMIN" } })
    const tenureA = await prisma.tenureMilestone.create({ data: { organizationId: orgA.id, dayCount: 30, title: "NOTIFY-SCHED Thirty days", recognition: "", employeeMessage: "" } })
    const tenureB = await prisma.tenureMilestone.create({ data: { organizationId: orgB.id, dayCount: 30, title: "NOTIFY-SCHED Thirty days", recognition: "", employeeMessage: "" } })
    const staff = (orgId: string, storeId: string, name: string, reachedOn: string) =>
      prisma.staffMember.create({
        data: {
          organizationId: orgId,
          displayName: `NOTIFY-SCHED Staff ${name}`,
          startDate: dbDate(addDaysStr(reachedOn, -30)),
          storeAssignments: { create: [{ storeId, isPrimary: true }] },
        },
      })
    await staff(orgA.id, aLA.id, "A1", "2026-10-19")

    const run = async (orgId: string, iso: string) => {
      const cap = capture()
      const r = await runScheduledEmails({ sender: cap.sender, mode: "live", now: at(iso), organizationId: orgId })
      return { r, sent: cap.sent }
    }
    const subjectHas = (msgs: EmailMessage[], s: string) => msgs.filter((m) => m.subject.includes(s)).length
    const paceMsgs = (msgs: EmailMessage[]) => msgs.filter((m) => m.subject.includes("is behind pace"))
    const msMsgs = (msgs: EmailMessage[]) => msgs.filter((m) => !m.subject.includes("is behind pace"))
    const intents = (orgId: string, kind = PACE) =>
      prisma.notificationIntent.findMany({ where: { organizationId: orgId, kind }, orderBy: { createdAt: "asc" } })
    const runMarkers = (orgId: string) => prisma.notificationScheduleRun.findMany({ where: { organizationId: orgId } })
    const setSchedule = (orgId: string, kind: string, r: ScheduleRowLike) =>
      prisma.notificationSchedule.upsert({
        where: { organizationId_kind: { organizationId: orgId, kind } },
        create: { organizationId: orgId, kind, ...r },
        update: r,
      })

    // ── D. Defaults unchanged (F6), org A, no schedule rows ───────────────
    const d0 = await run(orgA.id, "2026-10-20T14:05:00Z")
    check("D1 no row, 14:05 UTC: nothing evaluated, nothing sent", d0.r.results.length === 0 && d0.r.storesNotDue === 2 && d0.r.milestoneOrgsNotDue === 1 && d0.sent.length === 0)

    const d1 = await run(orgA.id, "2026-10-20T15:05:00Z")
    const aIntents = await intents(orgA.id)
    const paceText = paceMsgs(d1.sent).map((m) => m.text ?? "").join("\n")
    const logs = await prisma.paceAlertLog.count({ where: { organizationId: orgA.id } })
    check(
      "D2 no row, 15:05 UTC: both stores alert once, monthly keys, F-5 text, no frequency in the payload, PaceAlertLog written",
      d1.r.alerted === 2 &&
        paceMsgs(d1.sent).length === 2 &&
        aIntents.map((i) => i.dedupeKey).sort().join() === [`${aLA.id}:2026-10`, `${aNY.id}:2026-10`].sort().join() &&
        aIntents.every((i) => !("frequency" in (i.payload as object))) &&
        paceText.split("Alert threshold: 90% of MTD goal. You'll get at most one alert per store per month.").length === 3 &&
        logs === 2,
      `alerted=${d1.r.alerted} keys=${aIntents.map((i) => i.dedupeKey).join(",")} logs=${logs}`
    )
    const msA1 = msMsgs(d1.sent)
    check(
      "D2b no row: one milestone email, today's footer",
      msA1.length === 1 && (msA1[0].text ?? "").includes("You get at most one milestone email a day.") && msA1[0].subject.includes("NOTIFY-SCHED Staff A1")
    )

    const d2 = await run(orgA.id, "2026-10-20T16:05:00Z")
    check("D3 no row, a second run the same day: already run, nothing sent", d2.r.storesAlreadyRun === 2 && d2.r.milestoneOrgsAlreadyRun === 1 && d2.sent.length === 0 && d2.r.results.length === 0)

    // ── M. One milestone email a day (audit M1) ──────────────────────────
    await staff(orgA.id, aLA.id, "A2", "2026-10-19")
    const m1 = await run(orgA.id, "2026-10-20T17:05:00Z")
    check("M1 a milestone appearing after the day's run is not sent that day", msMsgs(m1.sent).length === 0 && m1.r.milestoneOrgsAlreadyRun === 1)

    const d3 = await run(orgA.id, "2026-10-21T15:05:00Z")
    const reasons = d3.r.results.map((r) => r.reason)
    check("D4 no row, next day: evaluated again, \"already alerted this month\", no pace mail", d3.r.results.length === 2 && reasons.every((r) => r === "already alerted this month") && paceMsgs(d3.sent).length === 0, reasons.join(" | "))
    const msA2 = msMsgs(d3.sent)
    check("M2 next day's run sends it, and only it", msA2.length === 1 && msA2[0].subject.includes("NOTIFY-SCHED Staff A2"))

    // ── S. Daily pace, org B, 7 AM store-local ─────────────────────────
    await setSchedule(orgB.id, PACE, row({ sendHour: 7 }))
    const s1 = await run(orgB.id, "2026-10-22T13:05:00Z") // 06:05 PDT · 09:05 EDT
    check(
      "S1 each store at ITS OWN local hour: NY (09:05) alerts, LA (06:05) waits",
      s1.r.results.length === 1 && s1.r.results[0].storeId === bNY.id && s1.r.results[0].alerted && s1.r.storesNotDue === 1,
      `results=${s1.r.results.map((r) => r.storeName).join(",")} notDue=${s1.r.storesNotDue}`
    )
    const s2 = await run(orgB.id, "2026-10-22T14:05:00Z") // 07:05 PDT
    const bKeys = (await intents(orgB.id)).map((i) => i.dedupeKey)
    check(
      "S2 LA alerts at 07:05 PDT; daily keys are the store-local date",
      s2.r.results.length === 1 && s2.r.results[0].storeId === bLA.id && s2.r.results[0].alerted && bKeys.includes(`${bLA.id}:2026-10-22`) && bKeys.includes(`${bNY.id}:2026-10-22`),
      bKeys.join(",")
    )
    check("S2b daily wording, payload carries the frequency", paceMsgs(s2.sent).every((m) => (m.text ?? "").includes("You'll get at most one alert per store per day.")) && paceMsgs(s2.sent).length === 1)
    const s3 = await run(orgB.id, "2026-10-22T14:05:00Z")
    check("S3 the same hour again: both already run, nothing sent", s3.r.storesAlreadyRun === 2 && s3.sent.length === 0)

    const s4 = await run(orgB.id, "2026-10-23T14:05:00Z")
    check(
      "S4 the next day alerts AGAIN for both stores (PaceAlertLog gate is monthly only, audit P1)",
      s4.r.alerted === 2 && paceMsgs(s4.sent).length === 2,
      s4.r.results.map((r) => `${r.storeName}: ${r.reason}`).join(" | ")
    )

    // F8: no run at all at 7 AM on Saturday 10-24; a run at 15:05 PDT catches it.
    const s5 = await run(orgB.id, "2026-10-24T22:05:00Z")
    check("S5 missed hour caught later the SAME local day (F8)", s5.r.alerted === 2)
    // No run on Sunday 10-25 or Monday 10-26 at all; Tuesday 06:05 PDT is not a catch-up for them.
    const s6 = await run(orgB.id, "2026-10-27T13:05:00Z") // 06:05 PDT · 09:05 EDT
    const markers = await runMarkers(orgB.id)
    check(
      "S6 never the next day: no marker for the missed days, and LA is not due before its hour",
      !markers.some((m) => m.slotDate === "2026-10-25" || m.slotDate === "2026-10-26") && s6.r.results.length === 1 && s6.r.results[0].storeId === bNY.id
    )

    // ── W. Weekly pace across the DST change, Mondays 7 AM ─────────────
    await setSchedule(orgB.id, PACE, row({ frequency: "weekly", sendHour: 7, daysOfWeek: [1] }))
    const w1 = await run(orgB.id, "2026-11-02T14:05:00Z") // 06:05 PST — was 07:05 a week earlier in PDT
    check("W1 after PST starts, 14:05 UTC is 6 AM in LA: LA waits, NY (09:05 EST) alerts", w1.r.results.length === 1 && w1.r.results[0].storeId === bNY.id && w1.r.results[0].alerted)
    const w2 = await run(orgB.id, "2026-11-02T15:05:00Z")
    const wKeys = (await intents(orgB.id)).map((i) => i.dedupeKey)
    check(
      "W2 LA at 07:05 PST; weekly keys are the ISO week; weekly wording",
      w2.r.alerted === 1 && wKeys.includes(`${bLA.id}:2026-W45`) && wKeys.includes(`${bNY.id}:2026-W45`) && paceMsgs(w2.sent).every((m) => (m.text ?? "").includes("per store per week."))
    )
    const w3 = await run(orgB.id, "2026-11-03T15:05:00Z")
    check("W3 Tuesday is not the chosen day", w3.r.results.length === 0 && w3.r.storesNotDue === 2)
    const w4 = await run(orgB.id, "2026-11-09T15:05:00Z")
    check("W4 the next Monday alerts again (W46)", w4.r.alerted === 2 && (await intents(orgB.id)).some((i) => i.dedupeKey === `${bLA.id}:2026-W46`))

    // ── N. Monthly pace with a row = today's behaviour (F11) ────────────
    await setSchedule(orgB.id, PACE, row({ frequency: "monthly", sendHour: 7, daysOfWeek: [1, 2, 3, 4, 5] }))
    const n1 = await run(orgB.id, "2026-12-03T15:05:00Z") // Thursday
    const decIntents = (await intents(orgB.id)).filter((i) => i.dedupeKey.endsWith(":2026-12"))
    check(
      "N1 monthly row: alerts once per store, monthly key, F-5 sentence",
      n1.r.alerted === 2 && decIntents.length === 2 && paceMsgs(n1.sent).every((m) => (m.text ?? "").includes("You'll get at most one alert per store per month."))
    )
    const n2 = await run(orgB.id, "2026-12-04T15:05:00Z") // Friday
    check("N2 evaluated the next ticked day, \"already alerted this month\"", n2.r.results.length === 2 && n2.r.results.every((r) => r.reason === "already alerted this month") && n2.sent.length === 0)
    const n3 = await run(orgB.id, "2026-12-05T15:05:00Z") // Saturday, unticked
    check("N3 an unticked day is skipped", n3.r.results.length === 0 && n3.r.storesNotDue === 2)

    // ── K. Weekly milestones, org zone (F3), across spring-forward ─────
    await setSchedule(orgB.id, MILESTONE_KIND, row({ frequency: "weekly", sendHour: 2, daysOfWeek: [7], timeZone: NY }))
    await staff(orgB.id, bNY.id, "B1", "2027-03-10")
    const k1 = await run(orgB.id, "2027-03-14T06:30:00Z") // 01:30 EST
    check("K1 Sunday 01:30 EST: not yet", msMsgs(k1.sent).length === 0 && k1.r.milestoneOrgsNotDue === 1)
    const k2 = await run(orgB.id, "2027-03-14T07:05:00Z") // 03:05 EDT — 2 AM never happened
    const msB = msMsgs(k2.sent)
    check(
      "K2 the 2 AM slot fires at 3 AM on spring-forward day; weekly footer",
      msB.length === 1 && (msB[0].text ?? "").includes("You get at most one milestone email a week.") && msB[0].subject.includes("NOTIFY-SCHED Staff B1")
    )
    const k3 = await run(orgB.id, "2027-03-14T08:05:00Z")
    check("K3 once per slot", msMsgs(k3.sent).length === 0 && k3.r.milestoneOrgsAlreadyRun === 1)
    const k4 = await run(orgB.id, "2027-03-15T07:05:00Z")
    check("K4 Monday is not the chosen day", k4.r.milestoneOrgsNotDue === 1)

    // ── I. Org isolation ───────────────────────────────────────────────
    const aMarkersBefore = (await runMarkers(orgA.id)).length
    const bMarkersBefore = (await runMarkers(orgB.id)).length
    // B's daily-at-7 would be due at 14:05Z; A's default is not.
    await setSchedule(orgB.id, PACE, row({ sendHour: 7 }))
    const i1 = await run(orgA.id, "2026-12-10T14:05:00Z")
    check("I1 org A's run ignores org B's schedule: nothing due, nothing claimed", i1.r.results.length === 0 && i1.sent.length === 0 && (await runMarkers(orgA.id)).length === aMarkersBefore)
    const i2 = await run(orgB.id, "2026-12-10T14:05:00Z")
    check(
      "I2 org B's run touches only org B",
      i2.r.results.every((r) => r.storeId === bLA.id || r.storeId === bNY.id) &&
        i2.sent.every((m) => (Array.isArray(m.to) ? m.to : [m.to]).every((t) => t === adminB.email)) &&
        (await runMarkers(orgA.id)).length === aMarkersBefore &&
        (await runMarkers(orgB.id)).length > bMarkersBefore
    )
    check("I3 every org-A email went to org A's admin only", [...d1.sent, ...d3.sent].every((m) => (Array.isArray(m.to) ? m.to : [m.to]).every((t) => t === adminA.email)))
    void tenureA
    void tenureB
    void subjectHas
  } finally {
    restoreEnv()
    for (const org of [orgA, orgB]) {
      const ids = (await prisma.notificationIntent.findMany({ where: { organizationId: org.id }, select: { id: true } })).map((i) => i.id)
      await prisma.notificationDelivery.deleteMany({ where: { intentId: { in: ids } } })
      await prisma.notificationMessage.deleteMany({ where: { organizationId: org.id } })
      await prisma.notificationIntent.deleteMany({ where: { organizationId: org.id } })
      await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
      await prisma.paceAlertLog.deleteMany({ where: { organizationId: org.id } })
      await prisma.tenureMilestone.deleteMany({ where: { organizationId: org.id } })
      await prisma.staffMember.deleteMany({ where: { organizationId: org.id } })
      await prisma.user.deleteMany({ where: { organizationId: org.id } })
      await prisma.salesPeriodCache.deleteMany({ where: { organizationId: org.id } })
      await prisma.dailyGoal.deleteMany({ where: { store: { organizationId: org.id } } })
      await prisma.goalPlan.deleteMany({ where: { organizationId: org.id } })
      await prisma.store.deleteMany({ where: { organizationId: org.id } })
      // NotificationSchedule and NotificationScheduleRun cascade with the org.
      await prisma.organization.delete({ where: { id: org.id } })
    }
    console.log(`\nFixture orgs ${orgA.id}, ${orgB.id} (NOTIFY-SCHED) and everything under them deleted.`)
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log("\nAll NOTIFY-SCHED checks passed.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
