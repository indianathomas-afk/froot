"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Award, TrendingUp, ListChecks, Pencil, Plus, Archive, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { dayCountLabel } from "@/lib/milestones"
import type { MilestoneSettingsValues } from "@/lib/attendance-settings"
import { AttendanceSettings } from "./attendance-settings"

// MS-1 — the client half of /staff/milestones. Holds no authority: every write
// goes to /api/milestones/tenure*, which re-checks milestones.manage and the
// module gate. Existing components only (F0).

type Row = {
  id: string
  dayCount: number
  title: string
  recognition: string
  employeeMessage: string
  isArchived: boolean
}

type Draft = { dayCount: string; title: string; recognition: string; employeeMessage: string }
const EMPTY: Draft = { dayCount: "", title: "", recognition: "", employeeMessage: "" }

export function MilestonesClient({
  initial,
  attendance,
  squareLaborOn,
}: {
  initial: Row[]
  attendance: MilestoneSettingsValues
  squareLaborOn: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Row | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Row | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const active = initial.filter((r) => !r.isArchived)
  const archived = initial.filter((r) => r.isArchived)

  function openNew() {
    setDraft(EMPTY)
    setError(null)
    setEditing("new")
  }

  function openEdit(row: Row) {
    setDraft({
      dayCount: String(row.dayCount),
      title: row.title,
      recognition: row.recognition,
      employeeMessage: row.employeeMessage,
    })
    setError(null)
    setEditing(row)
  }

  async function save() {
    const dayCount = Number(draft.dayCount)
    if (!Number.isInteger(dayCount) || dayCount < 1) {
      setError("Days must be a whole number of 1 or more.")
      return
    }
    if (!draft.title.trim()) {
      setError("Give the milestone a title.")
      return
    }
    setSaving(true)
    setError(null)
    const body = JSON.stringify({
      dayCount,
      title: draft.title,
      recognition: draft.recognition,
      employeeMessage: draft.employeeMessage,
    })
    const res = await fetch(editing === "new" ? "/api/milestones/tenure" : `/api/milestones/tenure/${(editing as Row).id}`, {
      method: editing === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? "Could not save the milestone.")
      return
    }
    setEditing(null)
    router.refresh()
  }

  async function setArchived(row: Row, isArchived: boolean) {
    setRowError(null)
    const res = await fetch(`/api/milestones/tenure/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isArchived }),
    }).catch(() => null)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setRowError(data?.error ?? "Could not update the milestone.")
      return
    }
    router.refresh()
  }

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
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Tenure milestones</CardTitle>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" /> Add milestone
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {rowError && <p className="text-sm text-[var(--color-destructive)]">{rowError}</p>}
          {active.length === 0 ? (
            <div className="border border-dashed border-[var(--color-border)] rounded-lg p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
                <Award className="h-6 w-6 text-[var(--color-muted-foreground)]" />
              </div>
              <p className="font-medium text-[var(--color-foreground)] mb-1">No tenure milestones yet</p>
              <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
                Add one — for example 90 days or 1 year — and it appears on every staff member&apos;s Milestones tab.
              </p>
              <Button size="sm" className="mt-4" onClick={openNew}>
                <Plus className="h-4 w-4" /> Add milestone
              </Button>
            </div>
          ) : (
            active.map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-3 p-4 border border-[var(--color-border)] rounded-lg">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{dayCountLabel(row.dayCount)}</Badge>
                    <h3 className="font-medium text-[var(--color-foreground)]">{row.title}</h3>
                  </div>
                  {row.recognition && (
                    <p className="text-sm text-[var(--color-muted-foreground)] mt-1.5">
                      <span className="font-medium text-[var(--color-foreground)]">Recognition: </span>
                      {row.recognition}
                    </p>
                  )}
                  {row.employeeMessage && (
                    <p className="text-sm text-[var(--color-muted-foreground)] mt-1 whitespace-pre-line">
                      <span className="font-medium text-[var(--color-foreground)]">Message: </span>
                      {row.employeeMessage}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(row)} aria-label={`Edit ${row.title}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setArchiveTarget(row)} aria-label={`Archive ${row.title}`}>
                    <Archive className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}

          {archived.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Archived</p>
              {archived.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                  <span className="min-w-0 truncate">
                    {dayCountLabel(row.dayCount)} — {row.title}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setArchived(row, false)}>
                    <RotateCcw className="h-4 w-4" /> Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MS-2 — the On-time section, replacing MS-1's Attendance placeholder. */}
      <AttendanceSettings initial={attendance} squareLaborOn={squareLaborOn} />

      {/* Placeholders for MS-3..MS-4. NO CONTROLS, by instruction: they say what
          is coming and nothing else. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {[
          { icon: TrendingUp, title: "Raise eligibility", copy: "Raise eligibility from hours and on-time %, with a cooldown after each raise." },
          { icon: ListChecks, title: "Checklists", copy: "Milestones for completing training and onboarding checklists." },
        ].map(({ icon: Icon, title, copy }) => (
          <div key={title} className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
              <Icon className="h-5 w-5 text-[var(--color-muted-foreground)]" />
            </div>
            <p className="font-medium text-[var(--color-foreground)] mb-1">{title}</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">{copy}</p>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-3 uppercase tracking-wide">Coming soon</p>
          </div>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add tenure milestone" : "Edit tenure milestone"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ms-days">Days from start date</Label>
              <Input
                id="ms-days"
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.dayCount}
                onChange={(e) => setDraft({ ...draft, dayCount: e.target.value })}
                placeholder="e.g. 90 or 365"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-title">Title</Label>
              <Input
                id="ms-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. One year with the team"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-recognition">Recognition</Label>
              <Textarea
                id="ms-recognition"
                value={draft.recognition}
                onChange={(e) => setDraft({ ...draft, recognition: e.target.value })}
                placeholder="What the business does — e.g. a $25 gift card and a shout-out at the team meeting"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-message">Suggested message to the employee</Label>
              <Textarea
                id="ms-message"
                rows={4}
                value={draft.employeeMessage}
                onChange={(e) => setDraft({ ...draft, employeeMessage: e.target.value })}
                placeholder="A message a manager can send in their own email. Froot never emails employees."
              />
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveTarget !== null} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this milestone?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget ? `"${archiveTarget.title}" (${dayCountLabel(archiveTarget.dayCount)})` : ""} stops appearing on staff
              profiles. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) void setArchived(archiveTarget, true)
                setArchiveTarget(null)
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
