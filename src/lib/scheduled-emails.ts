import { NextResponse } from "next/server"
import type { NotificationSchedule } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { DEFAULT_TIME_ZONE } from "@/lib/hr"
import { deliveryMode, getEmailSender, type DeliveryMode, type EmailSender } from "@/lib/notify"
import { paceThresholdPct, processPaceAlertForStore, type PaceAlertResult } from "@/lib/pace-alerts"
import { processMilestoneAlerts, type MilestoneOrgResult } from "@/lib/milestone-alerts"
import { milestonesActive } from "@/lib/milestones-access"
import { getKind } from "@/lib/notifications/registry"
import { MILESTONE_KIND } from "@/lib/notifications/kinds/milestone"
import { claimScheduleSlot, scheduleProblem, slotDue } from "@/lib/notifications/schedule"
import { DOC_DIGEST_KIND, docDigestHrActive } from "@/lib/notifications/kinds/doc-digest"
import { processDocDigest, type DocDigestOrgResult } from "@/lib/doc-digest-alerts"

// ─── NOTIFY-SCHED: the hourly runner for scheduled email kinds ───────────────
// docs/prompts/NOTIFY-SCHED_AUDIT.md § 5 and § 13 step 2. Called by
// /api/cron/scheduled-emails ("5 * * * *", F7) and, unregistered, by
// /api/cron/pace-alerts so a hand-fired curl of the old path still works and
// still respects schedules.
//
// EVERY HOUR, for every kind whose registry entry carries `schedule` (F1: pace
// and milestones — hr.ack and test stay immediate):
//   scope "store" (pace)       per store: slotDue in Store.timezone → claim
//                              the run marker → processPaceAlertForStore
//   scope "org" (milestones)   per org:   slotDue in the row's timeZone →
//                              claim → processMilestoneAlerts for that org
// slotDue / periodKey / the run marker live in src/lib/notifications/schedule.ts.
//
// NO SCHEDULE ROW = TODAY, EXACTLY (F6). Both kinds' slots open at 15:00 UTC,
// the hour the daily pace-alerts cron fired; the pace store query and the
// threshold resolution below are that route's, moved here unchanged; the
// producers are called with no frequency, so every key, reason, payload and
// email byte is what it was. The one deliberate difference is F8's catch-up:
// an hour that is skipped (outage, deploy, the time budget) is finished by the
// next hourly run the same day instead of being lost.
//
// THE TIME BUDGET (audit § 7). At ~100 orgs the single 15:00 UTC hour nears
// maxDuration. The runner stops claiming new slots at `deadline` and reports
// them as `deferred`; nothing deferred is claimed, so the next hourly run picks
// them up under F8. A slot is claimed BEFORE its producer runs, so a deferral
// never splits one store's or org's work.
//
// NOTIFY-14 adds a THIRD LEG, the document digest: org-scoped like milestones,
// gated by docDigestEnabled and HR available + active (F10), read here first
// so an org that cannot send burns no run marker. Its no-row default is the
// kind's own defaultRow (weekly, Monday, 8 AM Pacific — F2), not 15:00 UTC.
//
// PACE BEFORE MILESTONES, as in the old route. Each leg has its own try/catch
// per unit; a failure in one store or org never stops the next.

const PACE_KIND = "pace.alert"

export type ScheduledRunResult = {
  mode: DeliveryMode
  /** NOTIFY-2a's fallback threshold, resolved once. */
  fallbackThresholdPct: number
  /** What each org was evaluated at — evaluated orgs only. */
  thresholds: { organizationId: string; thresholdPct: number; source: "org" | "env" }[]
  orgsEnabled: number
  /** Stores in pace-enabled orgs with goals this month — the old `stores`. */
  storesConsidered: number
  /** Of those: slot not open at this hour (not the hour, not an allowed day). */
  storesNotDue: number
  /** Of those: slot open but already evaluated by an earlier run today. */
  storesAlreadyRun: number
  /** Of those: slot open, left for the next hour by the time budget. */
  storesDeferred: number
  alerted: number
  skippedDisabled: number
  results: PaceAlertResult[]
  milestones: MilestoneOrgResult[] | { error: string }
  milestoneOrgsNotDue: number
  milestoneOrgsAlreadyRun: number
  milestoneOrgsDeferred: number
  /** NOTIFY-14: the document digest leg. */
  docDigest: DocDigestOrgResult[] | { error: string }
  docDigestOrgsNotDue: number
  docDigestOrgsAlreadyRun: number
  docDigestOrgsDeferred: number
  /** Rows the evaluator could not use; those slots ran on the default (F6). */
  unusableSchedules: { organizationId: string; kind: string; problem: string }[]
}

function scheduleKey(organizationId: string, kind: string): string {
  return `${organizationId}\u0000${kind}`
}

export async function runScheduledEmails(opts: {
  sender: EmailSender
  mode: DeliveryMode
  now?: Date
  /** Wall-clock epoch ms after which no new slot is claimed. Real time, not `now`. */
  deadline?: number
  /** Fixtures scope to their own org. */
  organizationId?: string
}): Promise<ScheduledRunResult> {
  const now = opts.now ?? new Date()
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY
  const orgScope = opts.organizationId ? { organizationId: opts.organizationId } : {}
  const paceSpec = getKind(PACE_KIND)?.schedule
  const milestoneSpec = getKind(MILESTONE_KIND)?.schedule
  const digestSpec = getKind(DOC_DIGEST_KIND)?.schedule
  if (!paceSpec || !milestoneSpec || !digestSpec) throw new Error("scheduled kinds are missing their schedule definitions")

  const schedules = await prisma.notificationSchedule.findMany({
    where: { kind: { in: [PACE_KIND, MILESTONE_KIND, DOC_DIGEST_KIND] }, ...orgScope },
  })
  const scheduleOf = new Map<string, NotificationSchedule>(
    schedules.map((s) => [scheduleKey(s.organizationId, s.kind), s])
  )
  const unusableSchedules: ScheduledRunResult["unusableSchedules"] = []
  for (const s of schedules) {
    const spec = s.kind === PACE_KIND ? paceSpec : s.kind === MILESTONE_KIND ? milestoneSpec : digestSpec
    const problem = scheduleProblem(spec, s)
    if (problem) unusableSchedules.push({ organizationId: s.organizationId, kind: s.kind, problem })
  }

  // ── The pace leg. The store query and threshold lookup are the old
  // /api/cron/pace-alerts route's, unchanged but for `now` and the fixture's
  // org scope — see that route's history for why each part is shaped as it is
  // (F-5b: the org gate is IN the query, so a disabled org burns nothing).
  const fallbackPct = paceThresholdPct()
  const utcMonthStart = new Date(`${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`)
  const storeFilter = { isActive: true, dailyGoals: { some: { date: { gte: utcMonthStart } } }, ...orgScope }
  const [stores, enabledOrgs, skippedDisabled] = await Promise.all([
    prisma.store.findMany({ where: { ...storeFilter, organization: { paceAlertsEnabled: true } } }),
    prisma.organization.findMany({
      where: { paceAlertsEnabled: true, ...(opts.organizationId ? { id: opts.organizationId } : {}) },
      select: { id: true, paceAlertThresholdPct: true },
    }),
    prisma.store.count({ where: { ...storeFilter, organization: { paceAlertsEnabled: false } } }),
  ])
  const thresholdByOrg = new Map(enabledOrgs.map((o) => [o.id, o.paceAlertThresholdPct]))

  const results: PaceAlertResult[] = []
  const thresholdsUsed = new Map<string, { thresholdPct: number; source: "org" | "env" }>()
  let storesNotDue = 0
  let storesAlreadyRun = 0
  let storesDeferred = 0
  for (const store of stores) {
    try {
      const decision = slotDue(paceSpec, scheduleOf.get(scheduleKey(store.organizationId, PACE_KIND)) ?? null, now, store.timezone)
      if (!decision.due) {
        storesNotDue++
        continue
      }
      if (Date.now() > deadline) {
        storesDeferred++
        continue
      }
      const claimed = await claimScheduleSlot({
        organizationId: store.organizationId,
        kind: PACE_KIND,
        scopeKey: store.id,
        slotDate: decision.slotDate,
      })
      if (!claimed) {
        storesAlreadyRun++
        continue
      }
      const orgThreshold = thresholdByOrg.get(store.organizationId) ?? null
      const thresholdPct = orgThreshold ?? fallbackPct
      thresholdsUsed.set(store.organizationId, { thresholdPct, source: orgThreshold === null ? "env" : "org" })
      results.push(
        await processPaceAlertForStore(store, {
          thresholdPct,
          sender: opts.sender,
          mode: opts.mode,
          now,
          frequency: decision.frequency,
        })
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : "pace alert failed"
      results.push({ storeId: store.id, storeName: store.name, pacePct: null, alerted: false, reason: `error: ${msg.slice(0, 200)}` })
      console.error(`[scheduled-emails] pace store=${store.id}: ${msg}`)
    }
  }

  // ── The milestone leg. One slot per org (F3). processMilestoneAlerts still
  // applies its own switch and milestonesActive(); they are read here first
  // only so an org that cannot send burns no run marker.
  let milestones: MilestoneOrgResult[] | { error: string }
  let milestoneOrgsNotDue = 0
  let milestoneOrgsAlreadyRun = 0
  let milestoneOrgsDeferred = 0
  try {
    const orgs = await prisma.organization.findMany({
      where: { milestoneAlertsEnabled: true, ...(opts.organizationId ? { id: opts.organizationId } : {}) },
      select: { id: true, clerkOrgId: true, activeModules: true, milestonesEnabled: true },
    })
    const out: MilestoneOrgResult[] = []
    for (const org of orgs) {
      if (!milestonesActive(org)) continue
      try {
        const row = scheduleOf.get(scheduleKey(org.id, MILESTONE_KIND)) ?? null
        // A usable org-scoped row always has a zone (scheduleProblem); the
        // fallback only reaches slotDue for a row it will ignore anyway.
        const decision = slotDue(milestoneSpec, row, now, row?.timeZone ?? DEFAULT_TIME_ZONE)
        if (!decision.due) {
          milestoneOrgsNotDue++
          continue
        }
        if (Date.now() > deadline) {
          milestoneOrgsDeferred++
          continue
        }
        const claimed = await claimScheduleSlot({
          organizationId: org.id,
          kind: MILESTONE_KIND,
          scopeKey: "org",
          slotDate: decision.slotDate,
        })
        if (!claimed) {
          milestoneOrgsAlreadyRun++
          continue
        }
        out.push(
          ...(await processMilestoneAlerts({
            sender: opts.sender,
            mode: opts.mode,
            now,
            organizationId: org.id,
            frequency: decision.frequency,
          }))
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[scheduled-emails] milestones org=${org.id}: ${msg}`)
        out.push({ organizationId: org.id, members: 0, queued: 0, known: 0, unchanged: 0, sent: 0, failed: 0, dryRun: 0, error: msg.slice(0, 200) })
      }
    }
    milestones = out
  } catch (e) {
    const msg = e instanceof Error ? e.message : "milestone alerts failed"
    console.error(`[scheduled-emails] milestone leg: ${msg}`)
    milestones = { error: msg.slice(0, 200) }
  }

  // ── The document digest leg (NOTIFY-14). One slot per org, in the saved
  // row's zone or the default row's (slotDue resolves which).
  let docDigest: DocDigestOrgResult[] | { error: string }
  let docDigestOrgsNotDue = 0
  let docDigestOrgsAlreadyRun = 0
  let docDigestOrgsDeferred = 0
  try {
    const orgs = await prisma.organization.findMany({
      where: { docDigestEnabled: true, ...(opts.organizationId ? { id: opts.organizationId } : {}) },
      select: { id: true, clerkOrgId: true, activeModules: true },
    })
    const out: DocDigestOrgResult[] = []
    for (const org of orgs) {
      if (!docDigestHrActive(org)) continue
      try {
        const row = scheduleOf.get(scheduleKey(org.id, DOC_DIGEST_KIND)) ?? null
        const decision = slotDue(digestSpec, row, now, row?.timeZone ?? DEFAULT_TIME_ZONE)
        if (!decision.due) {
          docDigestOrgsNotDue++
          continue
        }
        if (Date.now() > deadline) {
          docDigestOrgsDeferred++
          continue
        }
        const claimed = await claimScheduleSlot({
          organizationId: org.id,
          kind: DOC_DIGEST_KIND,
          scopeKey: "org",
          slotDate: decision.slotDate,
        })
        if (!claimed) {
          docDigestOrgsAlreadyRun++
          continue
        }
        out.push(
          await processDocDigest({
            sender: opts.sender,
            mode: opts.mode,
            now,
            organizationId: org.id,
            // The kind has a defaultRow, so slotDue always returns a frequency.
            frequency: decision.frequency ?? "weekly",
            localDate: decision.localDate,
          })
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[scheduled-emails] doc digest org=${org.id}: ${msg}`)
        out.push({ organizationId: org.id, views: 0, recipients: 0, sent: 0, failed: 0, dryRun: 0, error: msg.slice(0, 200) })
      }
    }
    docDigest = out
  } catch (e) {
    const msg = e instanceof Error ? e.message : "doc digest failed"
    console.error(`[scheduled-emails] doc digest leg: ${msg}`)
    docDigest = { error: msg.slice(0, 200) }
  }

  return {
    mode: opts.mode,
    fallbackThresholdPct: fallbackPct,
    thresholds: [...thresholdsUsed.entries()].map(([organizationId, t]) => ({ organizationId, ...t })),
    orgsEnabled: enabledOrgs.length,
    storesConsidered: stores.length,
    storesNotDue,
    storesAlreadyRun,
    storesDeferred,
    alerted: results.filter((r) => r.alerted).length,
    skippedDisabled,
    results,
    milestones,
    milestoneOrgsNotDue,
    milestoneOrgsAlreadyRun,
    milestoneOrgsDeferred,
    docDigest,
    docDigestOrgsNotDue,
    docDigestOrgsAlreadyRun,
    docDigestOrgsDeferred,
    unusableSchedules,
  }
}

/** Stop claiming new slots this long after the run starts; maxDuration is 300 s. */
export const SCHEDULED_EMAILS_BUDGET_MS = 240_000

/**
 * The whole GET handler for /api/cron/scheduled-emails and the unregistered
 * /api/cron/pace-alerts. Auth is the house cron shape: CRON_SECRET unset → 500,
 * wrong bearer → 401. Sender and mode are resolved ONCE, before anything is
 * read — an unknown provider fails the run with zero rows written, and one run
 * cannot mix modes (NOTIFY-5).
 */
export async function scheduledEmailsCron(req: Request, route: string): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sender = getEmailSender()
  const mode = deliveryMode()
  const r = await runScheduledEmails({ sender, mode, deadline: Date.now() + SCHEDULED_EMAILS_BUDGET_MS })

  // ORGS ARE NAMED BY ID, never by name (CLAUDE.md § Database Evidence).
  const thresholdSummary =
    r.thresholds.length === 0
      ? `no org evaluated (fallback ${r.fallbackThresholdPct}%)`
      : r.thresholds.map((t) => `${t.organizationId}=${t.thresholdPct}%(${t.source})`).join(" ")
  console.log(
    `[cron:${route}] pace mode=${r.mode} ${r.orgsEnabled} orgs enabled, ${r.storesConsidered} stores considered, ` +
      `${r.results.length} evaluated, ${r.alerted} alerted, ${r.storesNotDue} not due, ${r.storesAlreadyRun} already run, ` +
      `${r.storesDeferred} deferred, ${r.skippedDisabled} skipped (org disabled) (thresholds ${thresholdSummary})`
  )
  if (Array.isArray(r.milestones)) {
    console.log(
      `[cron:${route}] milestones mode=${r.mode} ${r.milestones.length} org(s) run, ${r.milestoneOrgsNotDue} not due, ` +
        `${r.milestoneOrgsAlreadyRun} already run, ${r.milestoneOrgsDeferred} deferred` +
        (r.milestones.length
          ? ": " + r.milestones.map((m) => `${m.organizationId} queued=${m.queued} known=${m.known} sent=${m.sent} failed=${m.failed} dryRun=${m.dryRun}${m.error ? ` error=${m.error}` : ""}`).join("; ")
          : "")
    )
  }
  if (Array.isArray(r.docDigest)) {
    console.log(
      `[cron:${route}] doc digest mode=${r.mode} ${r.docDigest.length} org(s) run, ${r.docDigestOrgsNotDue} not due, ` +
        `${r.docDigestOrgsAlreadyRun} already run, ${r.docDigestOrgsDeferred} deferred` +
        (r.docDigest.length
          ? ": " + r.docDigest.map((d) => `${d.organizationId} ${d.skipped ? `skipped=${d.skipped}` : `state=${d.intentState} sent=${d.sent} failed=${d.failed} dryRun=${d.dryRun}`}${d.error ? ` error=${d.error}` : ""}`).join("; ")
          : "")
    )
  }
  if (r.unusableSchedules.length) {
    console.error(
      `[cron:${route}] unusable schedule rows ran on the default: ` +
        r.unusableSchedules.map((u) => `${u.organizationId}/${u.kind}: ${u.problem}`).join("; ")
    )
  }
  return NextResponse.json({ ok: true, route, ...r })
}
