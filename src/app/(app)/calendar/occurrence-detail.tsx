"use client"

import { useState } from "react"
import { Flag, Paperclip, Link2 } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
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
import { CreateReminderForm, type SaveResult } from "./create-reminder-form"
import type { StaffOption, StoreOption } from "./calendar-client"

// CAL-1 — the detail popover. Read-only fields, the completion control, and
// (for calendar.manage) Edit / Archive.
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
//
// ── CAL-1b — EDIT ──────────────────────────────────────────────────────────
// CAL-1's B6 specified "Edit / Archive for calendar.manage" and the build
// shipped Archive alone, which left a reminder unchangeable once saved. Edit
// swaps this dialog's BODY for the create form pre-filled — not a second route
// and not a second dialog, because the reminder you are editing is the one you
// are looking at and losing it behind a navigation is how you lose your place
// in the month.
//
// THE BUTTON IS GATED ON `canManage`, THE SAME FLAG AS THE DAY-CLICK, and that
// is the affordance rather than the gate: PATCH and the two attachment routes
// each call requireCalendar("calendar.manage") on their own. PERM-2's lesson
// stands — the modal is not the gate.

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
  onSaved,
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
  /** Re-read the feed and LEAVE THIS DIALOG OPEN. Distinct from onChanged,
   *  which closes it: completing or archiving is the end of the interaction,
   *  but an edit lands you back on the thing you just edited so you can see
   *  that it took. */
  onSaved: () => void
}) {
  const [notes, setNotes] = useState("")
  const [staffId, setStaffId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [savedResult, setSavedResult] = useState<SaveResult | null>(null)

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
      {/* CAL-1a: the shared Dialog, replacing a hand-rolled `fixed inset-0`
          overlay.
          THIS PANEL WAS NEVER THE CLIPPING DEFECT — it was already centred on
          the viewport, not anchored to a cell, so it did not open off-screen
          the way the create popover did. What it lacked was everything Radix
          gives for free and a bare div does not: ESCAPE TO CLOSE, a focus trap,
          focus restored to the trigger on close, `aria-modal` and the
          role/labelling that make it a dialog to a screen reader, and a
          backdrop click that is a real dismissal rather than an onClick on a
          div. It also needed `stopPropagation` on the panel to stop its own
          backdrop handler firing — a hazard that simply does not exist here.
          Converted alongside the create form so the two read as one surface. */}
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        {/* CAL-1b: the edit body scrolls INSIDE the form (the UX-1 finding), so
            while editing the panel is a flex column and the overflow belongs to
            the form — not to DialogContent, which would put Save below the
            fold. The read-only view keeps the scroll it has always had. */}
        <DialogContent
          className={`max-w-md max-h-[85vh] ${editing ? "flex flex-col" : "overflow-y-auto"}`}
        >
          {editing ? (
            <>
              <DialogTitle className="mb-3 pr-6 text-base font-semibold">Edit reminder</DialogTitle>
              <CreateReminderForm
                // The clicked cell is NOT the event's start date, so the form is
                // seeded from the event itself; `date` is only the create-mode
                // fallback and is never read in edit mode.
                date={event.startDate}
                stores={stores}
                edit={{
                  id: event.id,
                  title: event.title,
                  category: event.category,
                  priority: event.priority,
                  recurrence: event.recurrence,
                  startDate: event.startDate,
                  dueTime: event.dueTime,
                  endDate: event.endDate,
                  appliesTo: event.appliesTo,
                  storeIds: event.storeIds,
                  notes: event.notes,
                  url: event.url,
                  attachment: event.attachment,
                }}
                onDone={(result) => {
                  setEditing(false)
                  setSavedResult(result ?? { reDerived: false })
                  // Re-read the month; this dialog stays open and re-renders
                  // from the refreshed event.
                  onSaved()
                }}
                // Cancel returns to the detail view having written nothing.
                onCancel={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              {/* pr-6 keeps the title clear of DialogContent's own close button,
                  which sits absolutely at top-right. */}
              {/* DialogTitle, not an <h2>: Radix warns at runtime when DialogContent
                  has no title, and it is what names the dialog to a screen reader.
                  The bespoke close button that sat on the right is gone —
                  DialogContent renders its own, so keeping ours would give the
                  panel two. */}
              <div className="mb-3 flex min-w-0 items-center gap-2 pr-6">
                <span
                  aria-hidden
                  className="h-4 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--color-cal-${event.category})` }}
                />
                {event.priority === "Critical" && <Flag className="h-4 w-4 shrink-0 text-[var(--color-destructive)]" />}
                <DialogTitle className={`truncate text-base font-semibold ${completed ? "line-through opacity-60" : ""}`}>
                  {event.title}
                </DialogTitle>
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

              {/* CAL-1b — WHAT AN EDIT DID, said once, after the save.
                  The re-derive line is the PATCH route's own `reDerived`, not a
                  guess: when the schedule moved it deleted this event's OPEN
                  occurrences and the hourly cron writes the next one. Completed
                  rows were not touched, and the note says so, because the first
                  question anyone asks after editing a repeating reminder is
                  whether they have just erased the record of doing it. */}
              {savedResult && (
                <div className="mt-3 rounded-md bg-[var(--color-muted)] p-3 text-xs text-[var(--color-muted-foreground)]">
                  <p className="font-medium text-[var(--color-foreground)]">Saved.</p>
                  {savedResult.reDerived && (
                    <p className="mt-1">
                      The schedule changed, so the next date will be re-derived by the hourly job. Completed reminders
                      stay in the record.
                    </p>
                  )}
                  {savedResult.warning && (
                    <p className="mt-1 text-[var(--color-destructive)]">{savedResult.warning}</p>
                  )}
                </div>
              )}

              {/* ── Completion history for THIS occurrence ─────────────────── */}
              <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                {!occurrence ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    Not yet due. This date is projected from the repeat rule — it becomes completable once the current
                    one is done.
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
                <div className="mt-4 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSavedResult(null)
                      setEditing(true)
                    }}
                    className="h-9 rounded-md border border-[var(--color-border)] px-3 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmArchive(true)}
                    className="h-9 rounded-md border border-[var(--color-border)] px-3 text-sm text-[var(--color-destructive)]"
                  >
                    Archive
                  </button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

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
