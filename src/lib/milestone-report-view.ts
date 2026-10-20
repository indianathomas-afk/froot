import { daysBetween } from "@/lib/milestones"
import type { OnTimeResult } from "@/lib/attendance"

// MS-5 — the report's ROW SHAPE and its PURE filters and sort. CLIENT-SAFE on
// purpose: report-client.tsx imports this file, so it must never import prisma
// or anything server-only. The builder that fills these rows, and the
// redaction rules that decide what a row may carry, are in
// src/lib/milestone-report.ts.

export type ReportReached = { kind: "tenure" | "checklist"; title: string; on: string; archived: boolean }

export type ReportRaise = {
  status: "green" | "red" | "cooldown"
  /// The open rules, in words. Criterion text never carries a date (MS-3b).
  why: string
  /// PAY DATA — present only when it survived redactForViewer.
  lastRaiseOn?: string
  /// PAY DATA — same rule.
  cooldownUntil?: string
}

export type ReportRow = {
  id: string
  name: string
  homeStore: string
  /// The member's stores THIS VIEWER can see — what the store filter matches.
  storeIds: string[]
  terminated: boolean
  isSelf: boolean
  /// Member-zone "today" (store-local, never UTC — MS-1).
  today: string
  startDate: string | null
  daysEmployed: number | null
  /// Every reached milestone, both kinds, oldest first.
  reached: ReportReached[]
  lastReached: ReportReached | null
  nextTenure: { title: string; dayCount: number; dueOn: string; daysToGo: number } | null
  /// Null while the "Checklist milestones" switch is off (F13).
  checklist: { tasksCompleted: number; next: { title: string; taskCount: number; tasksToGo: number } | null } | null
  onTime: OnTimeResult | null
  raise: ReportRaise | null
}

export type MilestoneReport = {
  stores: { id: string; name: string }[]
  checklistOn: boolean
  onTimeLookbackDays: number
  canExport: boolean
  rows: ReportRow[]
}

// ─── PURE: FILTERS AND SORT (F4, F5, F7) ─────────────────────────────────────

export type ReportFilters = {
  storeId: string // "all" or a store id
  type: "all" | "tenure" | "checklist" | "onTime" | "raise"
  reachedWithinDays: 0 | 30 | 90 // 0 = off
  upcomingWithinDays: 0 | 30 // 0 = off
  raiseStatus: "all" | ReportRaise["status"]
  showTerminated: boolean
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  storeId: "all",
  type: "all",
  reachedWithinDays: 0,
  upcomingWithinDays: 0,
  raiseStatus: "all",
  showTerminated: false,
}

/// "In the last N days" counts today as day 0, member-zone.
function reachedWithin(row: ReportRow, days: number, kind: ReportFilters["type"]): boolean {
  return row.reached.some((r) => {
    if ((kind === "tenure" || kind === "checklist") && r.kind !== kind) return false
    const ago = daysBetween(r.on, row.today)
    return ago >= 0 && ago < days
  })
}

export function filterReportRows(rows: ReportRow[], f: ReportFilters): ReportRow[] {
  return rows.filter((r) => {
    if (!f.showTerminated && r.terminated) return false
    if (f.storeId !== "all" && !r.storeIds.includes(f.storeId)) return false
    if (f.type === "tenure" && !(r.reached.some((x) => x.kind === "tenure") || r.nextTenure)) return false
    if (f.type === "checklist" && !(r.reached.some((x) => x.kind === "checklist") || r.checklist?.next)) return false
    if (f.type === "onTime" && !r.onTime) return false
    if (f.type === "raise" && !r.raise) return false
    if (f.reachedWithinDays && !reachedWithin(r, f.reachedWithinDays, f.type)) return false
    // Checklist milestones have no date to come up on (A6), so "coming up" is
    // tenure only.
    if (f.upcomingWithinDays && !(r.nextTenure && r.nextTenure.daysToGo <= f.upcomingWithinDays)) return false
    if (f.raiseStatus !== "all" && r.raise?.status !== f.raiseStatus) return false
    return true
  })
}

export type ReportSortKey = "next" | "name" | "store" | "start" | "days" | "last" | "checklist" | "onTime" | "raise"

const RAISE_ORDER: Record<ReportRaise["status"], number> = { green: 0, red: 1, cooldown: 2 }

/// F7: default "next milestone soonest"; a missing value always sorts LAST,
/// whichever way the column is turned. Ties break by name.
export function sortReportRows(rows: ReportRow[], key: ReportSortKey, dir: "asc" | "desc" = "asc"): ReportRow[] {
  const value = (r: ReportRow): string | number | null => {
    switch (key) {
      case "next":
        return r.nextTenure?.daysToGo ?? null
      case "name":
        return r.name.toLowerCase()
      case "store":
        return r.homeStore.toLowerCase()
      case "start":
        return r.startDate
      case "days":
        return r.daysEmployed
      case "last":
        return r.lastReached?.on ?? null
      case "checklist":
        return r.checklist?.tasksCompleted ?? null
      case "onTime":
        return r.onTime?.percent ?? null
      case "raise":
        return r.raise ? RAISE_ORDER[r.raise.status] : null
    }
  }
  const sign = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null && vb !== null) return 1
    if (vb === null && va !== null) return -1
    if (va !== null && vb !== null && va !== vb) return (va < vb ? -1 : 1) * sign
    return a.name.localeCompare(b.name)
  })
}

// ─── PURE: THE CSV (F6) ──────────────────────────────────────────────────────

export const RAISE_LABEL: Record<ReportRaise["status"], string> = {
  green: "Raise eligible",
  red: "Raise blocked",
  cooldown: "Recent raise",
}

/// F6 (Gary): "CSV for ADMIN only, built from the page's already-redacted
/// data." Headers and cells from the rows ON SCREEN and nothing else — the
/// client hands this to downloadCsv, and scripts/verify-ms5.ts asserts on its
/// raw output. Raise dates appear only where they survived redaction.
export function reportCsv(
  report: Pick<MilestoneReport, "checklistOn">,
  rows: ReportRow[]
): { headers: string[]; body: (string | number | null | undefined)[][] } {
  const headers = [
    "Name",
    "Home store",
    "Status",
    "Start date",
    "Days employed",
    "Last milestone",
    "Last milestone type",
    "Reached on",
    "Next milestone",
    "Next milestone on",
    "Days to go",
    ...(report.checklistOn ? ["Checklist tasks", "Next checklist milestone", "Tasks to go"] : []),
    "On-time %",
    "On-time shifts",
    "Raise status",
    "Last raise",
    "Raise eligible again",
  ]
  const body = rows.map((r) => [
    r.name,
    r.homeStore,
    r.terminated ? "Terminated" : "Active",
    r.startDate,
    r.daysEmployed,
    r.lastReached?.title,
    r.lastReached ? (r.lastReached.kind === "checklist" ? "Checklist" : "Tenure") : null,
    r.lastReached?.on,
    r.nextTenure?.title,
    r.nextTenure?.dueOn,
    r.nextTenure?.daysToGo,
    ...(report.checklistOn ? [r.checklist?.tasksCompleted, r.checklist?.next?.title, r.checklist?.next?.tasksToGo] : []),
    r.onTime?.displayPercent ?? null,
    r.onTime && r.onTime.total ? `${r.onTime.onTime} of ${r.onTime.total}` : null,
    r.raise ? RAISE_LABEL[r.raise.status] : null,
    r.raise?.lastRaiseOn,
    r.raise?.cooldownUntil,
  ])
  return { headers, body }
}
