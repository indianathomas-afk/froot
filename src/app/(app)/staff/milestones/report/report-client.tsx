"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowLeft, ArrowUp, Download, ListChecks, TrendingUp, Trophy } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { BADGE_PRESETS } from "@/lib/badge-presets"
import { formatCivilDate } from "@/lib/display-time"
import { downloadCsv } from "@/lib/csv"
import { dayCountLabel, taskCountLabel } from "@/lib/milestones"
import { OnTimeBadge } from "../../on-time-badge"
import {
  DEFAULT_REPORT_FILTERS,
  filterReportRows,
  RAISE_LABEL,
  reportCsv,
  sortReportRows,
  type MilestoneReport,
  type ReportFilters,
  type ReportRaise,
  type ReportRow,
  type ReportSortKey,
} from "@/lib/milestone-report-view"

// MS-5 — the client half of /staff/milestones/report. HOLDS NO AUTHORITY AND
// NO DATA OF ITS OWN: `report` is buildMilestoneReport's return value, already
// scoped to the viewer's stores and already redacted (F10), with amber (F3)
// and the manager's own raise (F9) already absent. Filters, sorting and the
// CSV only ever subtract from it. Existing components only (no design bundle,
// the MS-1..MS-4 rule): the /staff Select, BADGE_PRESETS pills, the On-Time
// badge.

const civil = (d: string) => formatCivilDate(`${d}T00:00:00.000Z`, "medium")

const RAISE_CLASS: Record<ReportRaise["status"], string> = {
  green: BADGE_PRESETS.green.badge,
  red: BADGE_PRESETS.red.badge,
  cooldown: BADGE_PRESETS.gray.badge,
}
function RaisePill({ raise }: { raise: ReportRaise }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        title={raise.why}
        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap cursor-help w-fit ${RAISE_CLASS[raise.status]}`}
      >
        <TrendingUp className="h-3 w-3" />
        {RAISE_LABEL[raise.status]}
      </span>
      {/* Present only when the date survived redaction on the server. */}
      {raise.cooldownUntil && (
        <span className="text-xs text-[var(--color-muted-foreground)]">Eligible again {civil(raise.cooldownUntil)}</span>
      )}
    </span>
  )
}

function NextCell({ row }: { row: ReportRow }) {
  if (row.terminated) return <span className="text-[var(--color-muted-foreground)]">—</span>
  if (!row.nextTenure) return <span className="text-[var(--color-muted-foreground)]">—</span>
  const n = row.nextTenure
  return (
    <span>
      <span className="font-medium text-[var(--color-foreground)]">{n.title}</span>
      <span className="block text-xs text-[var(--color-muted-foreground)]">
        {dayCountLabel(n.dayCount)} · {civil(n.dueOn)} · {n.daysToGo} day{n.daysToGo === 1 ? "" : "s"} to go
      </span>
    </span>
  )
}

function LastCell({ row }: { row: ReportRow }) {
  const l = row.lastReached
  if (!l) return <span className="text-[var(--color-muted-foreground)]">—</span>
  return (
    <span>
      <span className="font-medium text-[var(--color-foreground)]">{l.title}</span>
      {l.archived && <Badge variant="outline" className="ml-1">Archived</Badge>}
      <span className="block text-xs text-[var(--color-muted-foreground)]">
        {l.kind === "checklist" ? "Checklist" : "Tenure"} · {civil(l.on)}
      </span>
    </span>
  )
}

function ChecklistCell({ row }: { row: ReportRow }) {
  if (!row.checklist) return <span className="text-[var(--color-muted-foreground)]">—</span>
  const c = row.checklist
  return (
    <span>
      <span className="font-medium text-[var(--color-foreground)]">{taskCountLabel(c.tasksCompleted)}</span>
      {c.next && !row.terminated && (
        <span className="block text-xs text-[var(--color-muted-foreground)]">
          Next: {c.next.title} · {c.next.tasksToGo} to go
        </span>
      )}
    </span>
  )
}

function NameCell({ row }: { row: ReportRow }) {
  return (
    <span>
      <Link href={`/staff/${row.id}?tab=milestones`} className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline">
        {row.name}
      </Link>
      {row.isSelf && <Badge variant="secondary" className="ml-2">You</Badge>}
      {row.terminated && <Badge variant="destructive" className="ml-2">Terminated</Badge>}
    </span>
  )
}

type Column = { key: ReportSortKey; label: string; align?: "right" }

export function ReportClient({ report }: { report: MilestoneReport }) {
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS)
  const [sort, setSort] = useState<{ key: ReportSortKey; dir: "asc" | "desc" }>({ key: "next", dir: "asc" })
  const set = <K extends keyof ReportFilters>(k: K, v: ReportFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))

  const rows = useMemo(
    () => sortReportRows(filterReportRows(report.rows, filters), sort.key, sort.dir),
    [report.rows, filters, sort]
  )

  const columns: Column[] = [
    { key: "name", label: "Name" },
    { key: "store", label: "Home store" },
    { key: "start", label: "Start date" },
    { key: "days", label: "Days", align: "right" },
    { key: "last", label: "Last milestone" },
    { key: "next", label: "Next milestone" },
    ...(report.checklistOn ? [{ key: "checklist" as const, label: "Checklist tasks" }] : []),
    { key: "onTime", label: "On time" },
    { key: "raise", label: "Raise" },
  ]

  const toggleSort = (key: ReportSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))

  // F6 — ADMIN only, and ONLY the rows on screen, built from the same props.
  // No pay amount exists in them; raise dates are present only where they
  // survived redaction on the server.
  const exportCsv = () => {
    const { headers, body } = reportCsv(report, rows)
    downloadCsv(`milestone-report-${new Date().toISOString().slice(0, 10)}`, headers, body)
  }

  const terminatedCount = report.rows.filter((r) => r.terminated).length

  return (
    <div>
      <div className="mb-6">
        <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-2">
          <ArrowLeft className="h-3.5 w-3.5" /> Staff
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Milestone report</h1>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              Milestones reached and coming up, with On-Time and Raise status. Visible to admins and managers only.
            </p>
          </div>
          {report.canExport && (
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
          )}
        </div>
      </div>

      {/* F4 filters. Stacked on a phone, a row on desktop. */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-4">
        <Select value={filters.storeId} onValueChange={(v) => set("storeId", v)}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Store" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {report.stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.type} onValueChange={(v) => set("type", v as ReportFilters["type"])}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Milestone type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="tenure">Tenure</SelectItem>
            {report.checklistOn && <SelectItem value="checklist">Checklist</SelectItem>}
            <SelectItem value="onTime">On-time</SelectItem>
            <SelectItem value="raise">Raise</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(filters.reachedWithinDays)} onValueChange={(v) => set("reachedWithinDays", Number(v) as ReportFilters["reachedWithinDays"])}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Reached" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Reached: any time</SelectItem>
            <SelectItem value="30">Reached in last 30 days</SelectItem>
            <SelectItem value="90">Reached in last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(filters.upcomingWithinDays)} onValueChange={(v) => set("upcomingWithinDays", Number(v) as ReportFilters["upcomingWithinDays"])}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Coming up" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Coming up: any time</SelectItem>
            <SelectItem value="30">Coming up in next 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.raiseStatus} onValueChange={(v) => set("raiseStatus", v as ReportFilters["raiseStatus"])}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Raise status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Raise: any</SelectItem>
            <SelectItem value="green">Raise eligible</SelectItem>
            <SelectItem value="red">Raise blocked</SelectItem>
            <SelectItem value="cooldown">Recent raise</SelectItem>
          </SelectContent>
        </Select>
        {terminatedCount > 0 && (
          <div className="flex items-center gap-2 h-9 sm:px-2">
            <Switch id="show-terminated" checked={filters.showTerminated} onCheckedChange={(v) => set("showTerminated", v)} />
            <Label htmlFor="show-terminated" className="text-sm">Show terminated ({terminatedCount})</Label>
          </div>
        )}
      </div>

      <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
        {rows.length} of {report.rows.length - (filters.showTerminated ? 0 : terminatedCount)} people
      </p>

      {rows.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
            <Trophy className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No one matches these filters</p>
          <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
            {report.rows.length === 0
              ? "Add team members on the Staff page and set start dates — they appear here with their milestones."
              : "Widen the filters above, or reset them to see everyone."}
          </p>
          {report.rows.length > 0 && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_REPORT_FILTERS)}
              className="mt-4 inline-flex items-center h-9 px-3 rounded-md border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-muted)]"
            >
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* F8 — a card per person at phone width. */}
          <ul className="md:hidden space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
                <NameCell row={r} />
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                  {r.homeStore}
                  {r.startDate && ` · started ${civil(r.startDate)}`}
                  {r.daysEmployed !== null && ` · ${r.daysEmployed} days`}
                </p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex gap-2"><Trophy className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-primary)]" /><LastCell row={r} /></div>
                  {!r.terminated && r.nextTenure && (
                    <div className="flex gap-2"><ArrowUp className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-muted-foreground)]" /><NextCell row={r} /></div>
                  )}
                  {report.checklistOn && (
                    <div className="flex gap-2"><ListChecks className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-muted-foreground)]" /><ChecklistCell row={r} /></div>
                  )}
                </div>
                {(r.onTime || r.raise) && (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {r.onTime && <OnTimeBadge result={r.onTime} lookbackDays={report.onTimeLookbackDays} size="compact" />}
                    {r.raise && <RaisePill raise={r.raise} />}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop table. Every header sorts (F7). */}
          <div className="hidden md:block border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {columns.map((c) => (
                    <th key={c.key} className={`px-4 py-3 text-xs font-medium text-[var(--color-muted-foreground)] ${c.align === "right" ? "text-right" : "text-left"}`}>
                      <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]">
                        {c.label}
                        {sort.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td className="px-4 py-3 text-sm"><NameCell row={r} /></td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{r.homeStore}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)] whitespace-nowrap">{r.startDate ? civil(r.startDate) : "—"}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{r.daysEmployed ?? "—"}</td>
                    <td className="px-4 py-3 text-sm"><LastCell row={r} /></td>
                    <td className="px-4 py-3 text-sm"><NextCell row={r} /></td>
                    {report.checklistOn && <td className="px-4 py-3 text-sm"><ChecklistCell row={r} /></td>}
                    <td className="px-4 py-3 text-sm">
                      {r.onTime ? <OnTimeBadge result={r.onTime} lookbackDays={report.onTimeLookbackDays} size="compact" /> : <span className="text-[var(--color-muted-foreground)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">{r.raise ? <RaisePill raise={r.raise} /> : <span className="text-[var(--color-muted-foreground)]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
