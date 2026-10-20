"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Award, Pencil, Plus, Archive, RotateCcw } from "lucide-react"
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

// MS-4a — ONE milestone list card for both kinds on /staff/milestones: tenure
// (MS-1, counted in days) and checklist (MS-4a, counted in named tasks). Lifted
// out of milestones-client.tsx unchanged in behaviour, so the two sections
// cannot drift apart. Holds no authority: every write goes to `apiBase`, which
// re-checks milestones.manage and the module gate.

export type MilestoneRow = {
  id: string
  /** dayCount for tenure, taskCount for checklist. */
  count: number
  title: string
  recognition: string
  employeeMessage: string
  isArchived: boolean
}

export type MilestoneKind = {
  /** The JSON key the API takes for `count`. */
  countKey: "dayCount" | "taskCount"
  apiBase: string
  cardTitle: string
  /** "tenure milestone" / "checklist milestone" — dialog titles. */
  noun: string
  countLabel: (count: number) => string
  countField: string
  countPlaceholder: string
  countError: string
  titlePlaceholder: string
  emptyTitle: string
  emptyCopy: string
}

type Draft = { count: string; title: string; recognition: string; employeeMessage: string }
const EMPTY: Draft = { count: "", title: "", recognition: "", employeeMessage: "" }

/** MS-4a, F7 addition (Gary, 2026-10-17): "the settings page warns admins not
 *  to type pay into recognition or message text." Shown on the page and again
 *  in the dialog where the text is typed. */
export function PayWarning({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-md border border-[var(--color-warning,#efa201)]/40 bg-[var(--color-warning,#efa201)]/10 px-3 py-2 text-sm ${className}`}
    >
      Don&apos;t put pay in recognition or message text — no raise amounts, rates or dates. Managers see this text on
      staff profiles and copy the message as written.
    </div>
  )
}

export function MilestoneListCard({ kind, rows }: { kind: MilestoneKind; rows: MilestoneRow[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<MilestoneRow | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<MilestoneRow | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const active = rows.filter((r) => !r.isArchived)
  const archived = rows.filter((r) => r.isArchived)

  function openNew() {
    setDraft(EMPTY)
    setError(null)
    setEditing("new")
  }

  function openEdit(row: MilestoneRow) {
    setDraft({ count: String(row.count), title: row.title, recognition: row.recognition, employeeMessage: row.employeeMessage })
    setError(null)
    setEditing(row)
  }

  async function save() {
    const count = Number(draft.count)
    if (!Number.isInteger(count) || count < 1) {
      setError(kind.countError)
      return
    }
    if (!draft.title.trim()) {
      setError("Give the milestone a title.")
      return
    }
    setSaving(true)
    setError(null)
    const body = JSON.stringify({
      [kind.countKey]: count,
      title: draft.title,
      recognition: draft.recognition,
      employeeMessage: draft.employeeMessage,
    })
    const res = await fetch(editing === "new" ? kind.apiBase : `${kind.apiBase}/${(editing as MilestoneRow).id}`, {
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

  async function setArchived(row: MilestoneRow, isArchived: boolean) {
    setRowError(null)
    const res = await fetch(`${kind.apiBase}/${row.id}`, {
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{kind.cardTitle}</CardTitle>
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
            <p className="font-medium text-[var(--color-foreground)] mb-1">{kind.emptyTitle}</p>
            <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">{kind.emptyCopy}</p>
            <Button size="sm" className="mt-4" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add milestone
            </Button>
          </div>
        ) : (
          active.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3 p-4 border border-[var(--color-border)] rounded-lg">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{kind.countLabel(row.count)}</Badge>
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
                  {kind.countLabel(row.count)} — {row.title}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setArchived(row, false)}>
                  <RotateCcw className="h-4 w-4" /> Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? `Add ${kind.noun}` : `Edit ${kind.noun}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${kind.countKey}-count`}>{kind.countField}</Label>
              <Input
                id={`${kind.countKey}-count`}
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.count}
                onChange={(e) => setDraft({ ...draft, count: e.target.value })}
                placeholder={kind.countPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${kind.countKey}-title`}>Title</Label>
              <Input
                id={`${kind.countKey}-title`}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={kind.titlePlaceholder}
              />
            </div>
            <PayWarning />
            <div className="space-y-1.5">
              <Label htmlFor={`${kind.countKey}-recognition`}>Recognition</Label>
              <Textarea
                id={`${kind.countKey}-recognition`}
                value={draft.recognition}
                onChange={(e) => setDraft({ ...draft, recognition: e.target.value })}
                placeholder="What the business does — e.g. a $25 gift card and a shout-out at the team meeting"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${kind.countKey}-message`}>Suggested message to the employee</Label>
              <Textarea
                id={`${kind.countKey}-message`}
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
              {archiveTarget ? `"${archiveTarget.title}" (${kind.countLabel(archiveTarget.count)})` : ""} stops appearing on
              staff profiles. You can restore it later.
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
    </Card>
  )
}
