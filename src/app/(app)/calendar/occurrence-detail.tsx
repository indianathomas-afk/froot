"use client"

import { useState } from "react"
import { Flag, Paperclip, Link2, X } from "lucide-react"
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
import type { StaffOption, StoreOption } from "./calendar-client"

// CAL-1 — the detail popover. Read-only fields, the completion control, and
// (for calendar.manage) Archive.
//
// COMPLETE IS OFFERED TO ANYONE THE ROUTE WOULD ACCEPT, which is anyone
// assigned to that store — R1's store-scope-only rule, and ruling 5's first
// half ("anyone who can complete a checklist at a store can complete a reminder
// at that store"). There is no capability test in this file for the Complete
// button, deliberately: putting one here would invent a gate the route does not
// have and hide the button from people the API would serve.
//
// ONLY A MATERIALISED OCCURRENCE CAN BE COMPLETED (ruling 3). A projected date
// with no occurrence row has no frozen dueAt and nothing to write to, so the
// panel says when it will appear rather than offering a button that cannot work.

type EventLike = {
  id: string
  title: string
  notes: string | null
  url: string | null
  category: string
  priority: string
  recurrence: string
  startDate: string
  dueTime: string | null
  endDate: string | null
  appliesTo: string
  storeIds: string[]
  attachment: { id: string; label: string; url: string } | null
}

type OccurrenceLike = {
  id: string
  dueDate: string
  dueAt: string
  status: string
  completedAt: string | null
  notes: string | null
  photoUrl: string | null
}

export function OccurrenceDetail({
  event,
  date,
  occurrence,
  stores,
  staff,
  canManage,
  categoryLabel,
  onClose,
  onChanged,
}: {
  event: EventLike
  date: string
  occurrence: OccurrenceLike | null
  stores: StoreOption[]
  staff: StaffOption[]
  canManage: boolean
  categoryLabel: string
  onClose: () => void
  onChanged: () => void
}) {
  const [notes, setNotes] = useState("")
  const [staffId, setStaffId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  async function complete() {
    if (!occurrence) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/calendar/occurrences/${occurrence.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || null, completedByStaffId: staffId || null }),
    }).catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      // The 409's own sentence is the right thing to show — somebody else
      // finished it, which is information, not an error.
      setError(body?.error ?? "Could not save that.")
      return
    }
    onChanged()
  }

  async function archive() {
    setBusy(true)
    const res = await fetch(`/api/calendar/events/${event.id}`, { method: "DELETE" }).catch(() => null)
    setBusy(false)
    setConfirmArchive(false)
    if (!res?.ok) {
      setError("Could not archive that reminder.")
      return
    }
    onChanged()
  }

  const storeNames =
    event.appliesTo === "all"
      ? "All stores"
      : stores
          .filter((s) => event.storeIds.includes(s.id))
          .map((s) => s.name)
          .join(", ")

  const completed = occurrence?.status === "Completed"

  return (
    <>
      {/* A plain overlay panel rather than a Radix Popover: the trigger cell can
          scroll out from under it while the panel is open, and an anchored
          popover would follow the cell off screen. */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
        <div
          className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-4 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-cal-${event.category})` }}
              />
              {event.priority === "Critical" && <Flag className="h-4 w-4 shrink-0 text-[var(--color-destructive)]" />}
              <h2 className={`truncate text-base font-semibold ${completed ? "line-through opacity-60" : ""}`}>
                {event.title}
              </h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="space-y-1.5 text-sm">
            <Row label="Date" value={event.dueTime ? `${date} at ${event.dueTime}` : date} />
            <Row label="Category" value={categoryLabel} />
            <Row label="Priority" value={event.priority} />
            <Row label="Repeats" value={event.recurrence === "None" ? "Does not repeat" : event.recurrence} />
            {event.endDate && <Row label="Ends" value={event.endDate} />}
            <Row label="Stores" value={storeNames} />
            {event.notes && <Row label="Notes" value={event.notes} />}
          </dl>

          {(event.url || event.attachment) && (
            <div className="mt-3 space-y-1.5 text-sm">
              {event.url && (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[var(--color-primary)] hover:underline"
                >
                  <Link2 className="h-4 w-4" /> Open link
                </a>
              )}
              {event.attachment && (
                <a
                  href={event.attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[var(--color-primary)] hover:underline"
                >
                  <Paperclip className="h-4 w-4" /> {event.attachment.label}
                </a>
              )}
            </div>
          )}

          {/* ── Completion history for THIS occurrence ─────────────────── */}
          <div className="mt-4 border-t border-[var(--color-border)] pt-4">
            {!occurrence ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Not yet due. This date is projected from the repeat rule — it becomes completable once the current one is
                done.
              </p>
            ) : completed ? (
              <div className="rounded-md bg-[var(--color-success-bg)] p-3 text-sm text-[var(--color-success-text)]">
                <p className="font-medium">
                  Completed {occurrence.completedAt ? new Date(occurrence.completedAt).toLocaleString() : ""}
                </p>
                {occurrence.notes && <p className="mt-1 opacity-90">{occurrence.notes}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-medium" htmlFor="occ-notes">
                  Notes <span className="text-[var(--color-muted-foreground)]">(optional)</span>
                </label>
                <textarea
                  id="occ-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm"
                />
                {staff.length > 0 && (
                  <select
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    aria-label="Who completed this"
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"
                  >
                    <option value="">Who completed this? (optional)</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={complete}
                  disabled={busy}
                  className="min-h-[44px] w-full rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-white disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Complete"}
                </button>
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-[var(--color-destructive)]">{error}</p>}

          {canManage && (
            <div className="mt-4 flex justify-end border-t border-[var(--color-border)] pt-3">
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="h-9 rounded-md border border-[var(--color-border)] px-3 text-sm text-[var(--color-destructive)]"
              >
                Archive
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Destructive actions require a confirmation AlertDialog (§ Design System). */}
      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this reminder?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops appearing on the calendar and in the due banner, and no new occurrences are created. Reminders
              already completed stay in the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  )
}
