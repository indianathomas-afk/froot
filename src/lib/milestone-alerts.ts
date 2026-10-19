// ─── MS-4b: the milestone producer — detect reached milestones, enqueue ──────
// Called once a day from /api/cron/pace-alerts (F4: "once a day inside the
// existing pace-alerts cron, judged in each store's time zone"), after the pace
// loop, in its own try/catch. A PRODUCER NEVER SENDS: it records what was
// reached and hands the intents to the dispatcher, which decides who hears
// about it and whether mail leaves (deliveryMode(), NOTIFY-5).
//
// THE SAME MATH AND THE SAME ZONE AS THE MILESTONES TAB (/staff/[id]):
// tenureProgress / checklistProgress over ACTIVE AND ARCHIVED rows, the
// member's displayTimeZone(). A tab and an email cannot disagree on a reach
// date. The math returns archived-but-reached history; F9 is applied HERE
// (archived entries skipped, only ACTIVE members read).
//
// RULING 2 (Gary, 2026-10-19): "Milestones reached more than 7 days before the
// job runs are recorded as known without sending, and each milestone is dated
// the day it was reached, never "today"." So:
//   reached ≤ 7 store-local days ago → enqueue `queued`, eventAt = the
//     store-local midnight of the reach date (stable, so a daily re-enqueue
//     never moves it to "today");
//   reached > 7 days ago             → recordKnownNotification (create-only:
//     an existing intent in any state is left alone).
// The dispatcher's 8-day freshness (N2) is the backstop, not the judge.
//
// MS-4b CHOICE C2 — THE DISPATCH IS SCOPED TO WHAT THIS RUN QUEUED OR
// REFRESHED. Every run re-counts from scratch and enqueues every milestone
// reached within the last 7 store-local days, so a skipped run loses nothing
// (verify-ms4b J1–J4). Only those intents are dispatched, so a queued checklist
// milestone whose count has since dropped (MS-4a: counts go down) is not
// re-announced; it ages out. A sent one stays sent whatever the count does.
//
// F13: with "Checklist milestones" off, no checklist intent is written at all —
// neither queued nor known. Turning it on later behaves like any switch-on:
// the last 7 days send, older ones are recorded known.

import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import { localMidnightUtc } from "@/lib/sales-sync"
import { displayTimeZone, primaryStoreName } from "@/lib/hr"
import {
  checklistProgress,
  dateColumnStr,
  dayCountLabel,
  daysBetween,
  taskCountLabel,
  tenureProgress,
} from "@/lib/milestones"
import { checklistMilestonesEnabled, namedTaskDates } from "@/lib/milestones-db"
import { milestonesActive } from "@/lib/milestones-access"
import type { DeliveryMode, EmailSender } from "@/lib/notify"
import { dispatchNotifications, enqueueNotification, recordKnownNotification } from "@/lib/notifications/dispatch"
import { MILESTONE_KIND, type MilestonePayload } from "@/lib/notifications/kinds/milestone"

/** Ruling 2's window, in store-local days. More than this → `known`. */
export const MILESTONE_SEND_WINDOW_DAYS = 7

export type MilestoneOrgResult = {
  organizationId: string
  members: number
  /** New or refreshed `queued` intents this run — what was handed to dispatch. */
  queued: number
  /** New `known` intents written this run. */
  known: number
  /** Reached milestones whose intent was already sent / known / partial / failed / expired. */
  unchanged: number
  /** Per-recipient outcomes of this run's dispatch. */
  sent: number
  failed: number
  dryRun: number
  error?: string
}

/**
 * Every org with milestoneAlertsEnabled AND Milestones active. Never throws:
 * a failing org records its error and the next org still runs.
 */
export async function processMilestoneAlerts(opts: {
  sender: EmailSender
  mode: DeliveryMode
  now?: Date
  /** Fixtures scope to their own org. */
  organizationId?: string
}): Promise<MilestoneOrgResult[]> {
  const now = opts.now ?? new Date()
  const orgs = await prisma.organization.findMany({
    where: { milestoneAlertsEnabled: true, ...(opts.organizationId ? { id: opts.organizationId } : {}) },
    select: { id: true, clerkOrgId: true, activeModules: true, milestonesEnabled: true, timezone: true },
  })
  const results: MilestoneOrgResult[] = []
  for (const org of orgs) {
    if (!milestonesActive(org)) continue
    try {
      results.push(await processOrg(org, opts, now))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[milestone-alerts] org=${org.id}: ${msg}`)
      results.push({ organizationId: org.id, members: 0, queued: 0, known: 0, unchanged: 0, sent: 0, failed: 0, dryRun: 0, error: msg.slice(0, 200) })
    }
  }
  return results
}

async function processOrg(
  org: { id: string; timezone: string },
  opts: { sender: EmailSender; mode: DeliveryMode },
  now: Date
): Promise<MilestoneOrgResult> {
  const result: MilestoneOrgResult = {
    organizationId: org.id,
    members: 0,
    queued: 0,
    known: 0,
    unchanged: 0,
    sent: 0,
    failed: 0,
    dryRun: 0,
  }
  const checklistOn = await checklistMilestonesEnabled(org.id)
  const [tenureRows, checklistRows] = await Promise.all([
    prisma.tenureMilestone.findMany({
      where: { organizationId: org.id },
      select: { id: true, dayCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true, archivedAt: true },
    }),
    checklistOn
      ? prisma.checklistMilestone.findMany({
          where: { organizationId: org.id },
          select: { id: true, taskCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true, archivedAt: true },
        })
      : Promise.resolve([]),
  ])
  const hasTenure = tenureRows.some((r) => !r.isArchived)
  const hasChecklist = checklistRows.some((r) => !r.isArchived)
  if (!hasTenure && !hasChecklist) return result

  // F9: ACTIVE members only. A terminated member's history is never announced.
  const members = await prisma.staffMember.findMany({
    where: { organizationId: org.id, status: "ACTIVE" },
    select: {
      id: true,
      displayName: true,
      startDate: true,
      isCorporate: true,
      storeAssignments: { select: { isPrimary: true, store: { select: { timezone: true, name: true } } } },
    },
  })
  result.members = members.length

  const toDispatch: string[] = []
  for (const member of members) {
    const zone = displayTimeZone(member, org)
    const today = localDateStr(now, zone)
    const archivedOn = (r: { isArchived: boolean; archivedAt: Date | null }) =>
      r.isArchived && r.archivedAt ? localDateStr(r.archivedAt, zone) : null

    const reached: Omit<MilestonePayload, "staffMemberId" | "staffName" | "storeName">[] = []
    if (hasTenure && member.startDate) {
      const progress = tenureProgress({
        startDate: dateColumnStr(member.startDate),
        today,
        terminatedOn: null,
        milestones: tenureRows.map((r) => ({ ...r, archivedOn: archivedOn(r) })),
      })
      if (progress.state === "ok") {
        for (const m of progress.achieved) {
          if (m.archived) continue
          reached.push({
            milestoneKind: "tenure",
            milestoneId: m.id,
            title: m.title,
            thresholdLabel: dayCountLabel(m.dayCount),
            recognition: m.recognition,
            employeeMessage: m.employeeMessage,
            reachedOn: m.achievedOn,
          })
        }
      }
    }
    if (hasChecklist) {
      const progress = checklistProgress({
        taskDates: await namedTaskDates({ organizationId: org.id, staffMemberId: member.id, zone }),
        terminated: false,
        milestones: checklistRows.map((r) => ({ ...r, archivedOn: archivedOn(r) })),
      })
      for (const m of progress.achieved) {
        if (m.archived) continue
        reached.push({
          milestoneKind: "checklist",
          milestoneId: m.id,
          title: m.title,
          thresholdLabel: taskCountLabel(m.taskCount),
          recognition: m.recognition,
          employeeMessage: m.employeeMessage,
          reachedOn: m.achievedOn,
        })
      }
    }

    for (const r of reached) {
      const payload: MilestonePayload = {
        staffMemberId: member.id,
        staffName: member.displayName,
        storeName: primaryStoreName(member),
        ...r,
      }
      const args = {
        organizationId: org.id,
        kind: MILESTONE_KIND,
        dedupeKey: `${member.id}:${r.milestoneKind}:${r.milestoneId}`,
        entityId: member.id,
        eventAt: localMidnightUtc(r.reachedOn, zone),
        payload,
      }
      if (daysBetween(r.reachedOn, today) > MILESTONE_SEND_WINDOW_DAYS) {
        const k = await recordKnownNotification(args)
        if (k?.created) result.known++
        else result.unchanged++
        continue
      }
      const enq = await enqueueNotification(args)
      if (enq?.state === "queued") {
        result.queued++
        toDispatch.push(enq.intentId)
      } else {
        result.unchanged++
      }
    }
  }

  if (toDispatch.length > 0) {
    const dispatched = await dispatchNotifications({
      transport: { mode: opts.mode, sender: () => opts.sender },
      trigger: "producer",
      organizationId: org.id,
      intentIds: toDispatch,
      now,
    })
    // A summary counts once per intent it covered; these are pair counts.
    for (const d of dispatched) {
      for (const r of d.recipients) {
        if (r.status === "sent") result.sent++
        else if (r.status === "failed") result.failed++
        else if (r.status === "dry-run") result.dryRun++
      }
    }
  }
  return result
}
