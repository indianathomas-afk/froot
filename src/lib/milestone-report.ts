import type { Organization } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { localDateStr } from "@/lib/reports"
import type { PermissionUser } from "@/lib/permissions"
import { CORPORATE_STORE_LABEL, displayTimeZone } from "@/lib/hr"
import { checklistProgress, dateColumnStr, tenureProgress } from "@/lib/milestones"
import { checklistMilestonesEnabled, namedTaskDatesForMembers } from "@/lib/milestones-db"
import { getMilestoneSettings, getOnTimeForStaff, lookbackRange } from "@/lib/attendance"
import {
  getRaiseEligibility,
  getRaiseSettings,
  raiseHiddenForViewer,
  redactForViewer,
  type RaiseEligibility,
} from "@/lib/raise-eligibility"
import { getRaiseDetailVisibility } from "@/lib/raise-history"
import type { MilestoneReport, ReportRaise, ReportReached, ReportRow } from "@/lib/milestone-report-view"

// ─────────────────────────────────────────────────────────────────────────────
// MS-5 — THE MILESTONE REPORT. One read-only page, /staff/milestones/report.
// Rulings: Gary 2026-10-19 on docs/prompts/2026-10-19_MS-5_AUDIT.md (F1–F10).
//
// buildMilestoneReport's RETURN VALUE IS THE CLIENT COMPONENT'S PROPS, whole.
// Nothing is added between here and the browser, so whatever this function
// leaves out is absent from the page payload and from the CSV (F6: the CSV is
// built in the browser from these rows). scripts/verify-ms5.ts searches the
// JSON of this return value for raise dates — that is the payload check.
//
// THE PEOPLE: the /staff roster query exactly (A4) — ADMIN everyone, otherwise
// anyone with SOME assignment in the viewer's stores ("also works here"
// included). THE READERS: the existing batched ones (MS-1..MS-4a), a fixed
// number of queries whatever the roster size; the checklist dates come from
// namedTaskDatesForMembers, one read.
//
// RAISE, in this order, per member — and only these three paths reach a row:
//   1. redactForViewer (F10): the dates survive only where the viewer may see
//      that person's pay (getRaiseDetailVisibility — canSeeWages, then COMP-1).
//   2. F3 (Gary): "Leave amber 'Raise in progress' OFF the report, same as
//      /staff." A yellow result becomes NO raise field at all.
//   3. F9 (Gary): a MANAGER's own row carries no raise field at all.
// Green, red and cooldown remain. F10 (Gary): "Allow the cooldown filter for
// pay-confidential people; dates stay hidden." — so cooldown is kept as a
// status; its date follows rule 1.
//
// TERMINATED (F5): their reached milestones only. No next milestone (MS-1 F4,
// already true of tenureProgress / checklistProgress), no on-time, no raise
// (getRaiseEligibility already skips them). The client hides them by default.
// ─────────────────────────────────────────────────────────────────────────────

export type ReportViewer = {
  actor: PermissionUser
  role: string | null
  isAdmin: boolean
  /// The viewer's assigned stores. Ignored for an ADMIN.
  storeIds: string[]
  /// resolveSelfStaff's answer — F9.
  selfStaffId: string | null
}

/// Exported for scripts/verify-ms5.ts (the F3 mapping, every status).
export function raiseForRow(r: RaiseEligibility): ReportRaise | null {
  if (r.status === "yellow") return null // F3
  const why =
    r.status === "green"
      ? "Every raise rule is met."
      : r.status === "cooldown"
        ? "Recent raise — in cooldown."
        : r.criteria
            .filter((c) => c.state === "blocked" || c.state === "not-met" || c.state === "no-data")
            .map((c) => `${c.label}: ${c.detail}`)
            .join(" ")
  return {
    status: r.status,
    why,
    ...(r.lastRaise ? { lastRaiseOn: r.lastRaise.date } : {}),
    ...(r.cooldownUntil ? { cooldownUntil: r.cooldownUntil } : {}),
  }
}

/// THE CALLER HAS ALREADY GATED: Milestones on (requireMilestones) and the
/// viewer is ADMIN or MANAGER. This is not a gate; it is the scope.
export async function buildMilestoneReport(args: {
  org: Organization
  viewer: ReportViewer
  now?: Date
}): Promise<MilestoneReport> {
  const { org, viewer } = args
  const now = args.now ?? new Date()

  const [staff, stores, settings, checklistOn, tenureRows] = await Promise.all([
    prisma.staffMember.findMany({
      where: {
        organizationId: org.id,
        ...(viewer.isAdmin ? {} : { storeAssignments: { some: { storeId: { in: viewer.storeIds } } } }),
      },
      include: {
        storeAssignments: {
          include: { store: true },
          orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
        },
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.store.findMany({
      where: { organizationId: org.id, ...(viewer.isAdmin ? {} : { id: { in: viewer.storeIds } }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getMilestoneSettings(org.id),
    checklistMilestonesEnabled(org.id),
    prisma.tenureMilestone.findMany({
      where: { organizationId: org.id },
      select: { id: true, dayCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true, archivedAt: true },
    }),
  ])
  const checklistRows = checklistOn
    ? await prisma.checklistMilestone.findMany({
        where: { organizationId: org.id },
        select: { id: true, taskCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true, archivedAt: true },
      })
    : []
  const visibleStoreIds = new Set(stores.map((s) => s.id))
  const zoneOf = new Map(staff.map((m) => [m.id, displayTimeZone(m, org)]))
  const zone = (id: string) => zoneOf.get(id) as string
  const active = staff.filter((m) => m.status !== "TERMINATED")

  const [taskDates, onTime, computed, raiseVisible] = await Promise.all([
    checklistOn
      ? namedTaskDatesForMembers({ organizationId: org.id, members: staff.map((m) => ({ id: m.id, zone: zone(m.id) })) })
      : Promise.resolve(new Map<string, string[]>()),
    getOnTimeForStaff(
      org,
      active.map((m) => ({
        id: m.id,
        squareTeamMemberId: m.squareTeamMemberId,
        assignedStoreIds: m.storeAssignments.map((a) => a.storeId),
        range: lookbackRange(settings.onTimeLookbackDays, now, zone(m.id), null),
      })),
      settings,
      now
    ),
    getRaiseSettings(org.id).then((raise) =>
      getRaiseEligibility(
        org,
        active.map((m) => ({
          id: m.id,
          squareTeamMemberId: m.squareTeamMemberId,
          assignedStoreIds: m.storeAssignments.map((a) => a.storeId),
          startDate: m.startDate,
          status: m.status,
          zone: zone(m.id),
        })),
        raise,
        settings,
        { now }
      )
    ),
    getRaiseDetailVisibility(org, viewer.actor, staff),
  ])

  const rows: ReportRow[] = staff.map((m) => {
    const z = zone(m.id)
    const today = localDateStr(now, z)
    const terminated = m.status === "TERMINATED"
    const archivedOn = (r: { isArchived: boolean; archivedAt: Date | null }) =>
      r.isArchived && r.archivedAt ? localDateStr(r.archivedAt, z) : null

    const tenure = tenureProgress({
      startDate: m.startDate ? dateColumnStr(m.startDate) : null,
      today,
      terminatedOn: terminated && m.terminatedAt ? localDateStr(m.terminatedAt, z) : null,
      milestones: tenureRows.map((r) => ({ ...r, archivedOn: archivedOn(r) })),
    })
    const checklist = checklistOn
      ? checklistProgress({
          taskDates: taskDates.get(m.id) ?? [],
          terminated,
          milestones: checklistRows.map((r) => ({ ...r, archivedOn: archivedOn(r) })),
        })
      : null

    const reached: ReportReached[] = [
      ...(tenure.state === "ok"
        ? tenure.achieved.map((a) => ({ kind: "tenure" as const, title: a.title, on: a.achievedOn, archived: a.archived }))
        : []),
      ...(checklist?.achieved.map((a) => ({ kind: "checklist" as const, title: a.title, on: a.achievedOn, archived: a.archived })) ?? []),
    ].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))

    const redacted = computed.get(m.id)
    const raise =
      !terminated && redacted && !raiseHiddenForViewer(viewer.role, viewer.selfStaffId, m.id)
        ? raiseForRow(redactForViewer(redacted, raiseVisible.has(m.id)))
        : null

    const home = m.isCorporate
      ? CORPORATE_STORE_LABEL
      : (m.storeAssignments[0]?.store.name ?? "Unassigned")

    return {
      id: m.id,
      name: m.displayName,
      homeStore: home,
      storeIds: m.storeAssignments.map((a) => a.storeId).filter((id) => visibleStoreIds.has(id)),
      terminated,
      isSelf: viewer.selfStaffId === m.id,
      today,
      startDate: m.startDate ? dateColumnStr(m.startDate) : null,
      daysEmployed: tenure.state === "ok" ? tenure.daysEmployed : null,
      reached,
      lastReached: reached.length ? reached[reached.length - 1] : null,
      nextTenure:
        tenure.state === "ok" && tenure.next
          ? { title: tenure.next.title, dayCount: tenure.next.dayCount, dueOn: tenure.next.dueOn, daysToGo: tenure.next.daysToGo }
          : null,
      checklist: checklist
        ? {
            tasksCompleted: checklist.tasksCompleted,
            next: checklist.next
              ? { title: checklist.next.title, taskCount: checklist.next.taskCount, tasksToGo: checklist.next.tasksToGo }
              : null,
          }
        : null,
      onTime: terminated ? null : (onTime.get(m.id) ?? null),
      raise,
    }
  })

  return {
    stores,
    checklistOn,
    onTimeLookbackDays: settings.onTimeLookbackDays,
    // F6 (Gary): "CSV for ADMIN only, built from the page's already-redacted data."
    canExport: viewer.isAdmin,
    rows,
  }
}
