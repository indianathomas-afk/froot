"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { dayCountLabel } from "@/lib/milestones"
import type { MilestoneSettingsValues } from "@/lib/attendance-settings"
import { AttendanceSettings } from "./attendance-settings"
import type { RaiseSettingsValues } from "@/lib/raise-settings"
import { RaiseSettings } from "./raise-settings"
import { MilestoneListCard, PayWarning, type MilestoneKind, type MilestoneRow } from "./milestone-list"
import { ChecklistMilestones } from "./checklist-milestones"

// MS-1 — the client half of /staff/milestones. Holds no authority: every write
// goes to /api/milestones/*, which re-checks milestones.manage and the module
// gate. Existing components only (F0). MS-4a moved the tenure list card into
// milestone-list.tsx, shared with the checklist section.

type Row = {
  id: string
  dayCount: number
  title: string
  recognition: string
  employeeMessage: string
  isArchived: boolean
}

const TENURE: MilestoneKind = {
  countKey: "dayCount",
  apiBase: "/api/milestones/tenure",
  cardTitle: "Tenure milestones",
  noun: "tenure milestone",
  countLabel: dayCountLabel,
  countField: "Days from start date",
  countPlaceholder: "e.g. 90 or 365",
  countError: "Days must be a whole number of 1 or more.",
  titlePlaceholder: "e.g. One year with the team",
  emptyTitle: "No tenure milestones yet",
  emptyCopy: "Add one — for example 90 days or 1 year — and it appears on every staff member's Milestones tab.",
}

export function MilestonesClient({
  initial,
  checklist,
  attendance,
  raise,
  raiseOptions,
  squareLaborOn,
}: {
  initial: Row[]
  /** MS-4a. `rows` is empty while the F13 switch is off. */
  checklist: { enabled: boolean; rows: MilestoneRow[] }
  attendance: MilestoneSettingsValues
  raise: RaiseSettingsValues
  raiseOptions: { trainings: { id: string; title: string }[]; documents: { id: string; title: string }[] }
  squareLaborOn: boolean
}) {
  const tenureRows: MilestoneRow[] = initial.map(({ dayCount, ...r }) => ({ ...r, count: dayCount }))

  return (
    <div>
      <div className="mb-6">
        <Link href="/staff" className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-2">
          <ArrowLeft className="h-3.5 w-3.5" /> Staff
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Milestones</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Recognise your team as they reach tenure milestones. Days count from each person&apos;s start date.
        </p>
        <PayWarning className="mt-3" />
      </div>

      <MilestoneListCard kind={TENURE} rows={tenureRows} />

      {/* MS-2 — the On-time section, replacing MS-1's Attendance placeholder. */}
      <AttendanceSettings initial={attendance} squareLaborOn={squareLaborOn} />

      {/* MS-3a — the Raise eligibility section, replacing its placeholder. */}
      <RaiseSettings
        initial={raise}
        trainings={raiseOptions.trainings}
        documents={raiseOptions.documents}
        squareLaborOn={squareLaborOn}
      />

      {/* MS-4a — Checklist milestones, replacing its "Coming soon" card. */}
      <ChecklistMilestones enabled={checklist.enabled} rows={checklist.rows} />
    </div>
  )
}
