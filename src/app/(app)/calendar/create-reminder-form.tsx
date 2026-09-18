"use client"

import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CALENDAR_CATEGORIES, CALENDAR_PRIORITIES, CALENDAR_RECURRENCES } from "@/lib/calendar"
import type { StoreOption } from "./calendar-client"

// CAL-1 — the create popover, Apple-style: an Event | Reminder tab pair.
//
// THE EVENT TAB IS DISABLED AND SAYS WHY. CAL-2 is what makes an Event real (a
// template scheduled to run, which is also what closes DEBT-61), and shipping
// the tab disabled rather than absent is deliberate: ruling 1 describes a
// calendar with TWO entity types, and a UI that shows only one teaches the
// wrong model to everyone who uses it between now and CAL-2.
//
// ── CAL-1b — THIS IS ALSO THE EDIT FORM ────────────────────────────────────
// `edit` seeds every field from an existing event and swings the submit at
// PATCH instead of POST. It is the same component rather than a second one
// because THE CREATE FORM IS THE SHAPE OF A REMINDER: a fork would put the
// eleven fields, their validation and their layout in two files, and the
// twelfth field would be added to one of them.
//
// THE TAB PAIR IS CREATE-ONLY. Event | Reminder is a choice of what to make,
// and an existing reminder has stopped being a choice — so in edit mode the
// form renders on its own, with no tabs above it.

/** An event as the grid already holds it, which is everything the form needs
 *  to open pre-filled. */
export type ReminderDraft = {
  id: string
  title: string
  category: string
  priority: string
  recurrence: string
  startDate: string
  dueTime: string | null
  endDate: string | null
  appliesTo: string
  storeIds: string[]
  notes: string | null
  url: string | null
  attachment: { id: string; label: string; url: string } | null
}

/** What the caller learns from a save. `reDerived` is the PATCH route's own
 *  answer about whether the schedule moved and the open occurrences were
 *  dropped — the detail view says so rather than guessing from the diff.
 *  `warning` carries a partial success: the event saved, the attachment did
 *  not, which the caller must be able to show AFTER the form has closed. */
export type SaveResult = { reDerived: boolean; warning?: string }

export function CreateReminderForm({
  date,
  stores,
  edit,
  onDone,
  onCancel,
}: {
  date: string
  stores: StoreOption[]
  edit?: ReminderDraft
  onDone: (result?: SaveResult) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(edit?.title ?? "")
  const [category, setCategory] = useState<string>(edit?.category ?? CALENDAR_CATEGORIES[0].id)
  const [priority, setPriority] = useState<string>(edit?.priority ?? "Standard")
  const [recurrence, setRecurrence] = useState<string>(edit?.recurrence ?? "None")
  const [appliesTo, setAppliesTo] = useState<"all" | "specific">(edit?.appliesTo === "specific" ? "specific" : "all")
  const [storeIds, setStoreIds] = useState<string[]>(edit?.storeIds ?? [])
  const [startDate, setStartDate] = useState(edit?.startDate ?? date)
  const [dueTime, setDueTime] = useState(edit?.dueTime ?? "")
  const [endDate, setEndDate] = useState(edit?.endDate ?? "")
  const [notes, setNotes] = useState(edit?.notes ?? "")
  const [url, setUrl] = useState(edit?.url ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [dropAttachment, setDropAttachment] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    // EVERY FIELD IS SENT ON EVERY SAVE, including the ones nobody touched.
    // That is safe precisely because the PATCH route computes its re-derive
    // predicate from the parsed body AGAINST THE LOADED ROW rather than from
    // which keys arrived — a Weekly event PATCHed with `recurrence: "Weekly"`
    // has changed nothing and keeps its open occurrences.
    const payload = {
      title,
      category,
      priority,
      recurrence,
      startDate,
      dueTime: dueTime || null,
      endDate: endDate || null,
      appliesTo,
      storeIds: appliesTo === "specific" ? storeIds : [],
      notes: notes || null,
      url: url || null,
    }

    const res = await fetch(edit ? `/api/calendar/events/${edit.id}` : "/api/calendar/events", {
      method: edit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null)

    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      setError(body?.error ?? (edit ? "Could not save those changes." : "Could not save that reminder."))
      setBusy(false)
      return
    }

    const saved = (await res.json().catch(() => null)) as { id?: string; reDerived?: boolean } | null
    const eventId = edit?.id ?? saved?.id
    const reDerived = saved?.reDerived ?? false

    // The attachment is a SECOND request against the event, because the event
    // route takes JSON and an upload takes multipart. A failed upload leaves
    // the reminder — losing the whole reminder because a PDF did not stick
    // would be the worse trade on a shop floor. CAL-1b keeps that trade and
    // carries the failure out through `warning` so the caller can still say it.
    if (eventId && file) {
      const form = new FormData()
      form.set("file", file)
      const up = await fetch(`/api/calendar/events/${eventId}/attachment`, { method: "POST", body: form }).catch(
        () => null
      )
      if (!up?.ok) {
        setError("The reminder was saved, but the attachment did not upload.")
        setBusy(false)
        onDone({ reDerived, warning: "The changes were saved, but the attachment did not upload." })
        return
      }
    } else if (eventId && edit?.attachment && dropAttachment) {
      const rm = await fetch(`/api/calendar/events/${eventId}/attachment`, { method: "DELETE" }).catch(() => null)
      if (!rm?.ok) {
        setError("The reminder was saved, but the attachment was not removed.")
        setBusy(false)
        onDone({ reDerived, warning: "The changes were saved, but the attachment was not removed." })
        return
      }
    }

    setBusy(false)
    onDone({ reDerived })
  }

  const field = "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"

  const form = (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      {/* THE SCROLL IS HERE, NOT ON DialogContent — UX-1's finding on the
          Edit User modal: scrolling the dialog itself drops Save below the
          fold of a form that only gets longer, and this one already has
          eleven fields. The footer below sits outside this div and stays
          pinned at any height. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto -mx-1 px-1">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-title">
            Title
          </label>
          <input
            id="cal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            className={field}
            placeholder="Check the mailbox"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-category">
              Category
            </label>
            <select id="cal-category" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
              {CALENDAR_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-priority">
              Priority
            </label>
            <select id="cal-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
              {CALENDAR_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-applies">
            Stores
          </label>
          <select
            id="cal-applies"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value as "all" | "specific")}
            className={field}
          >
            <option value="all">All stores</option>
            <option value="specific">Pick stores</option>
          </select>
          {appliesTo === "specific" && (
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">
              {stores.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={storeIds.includes(s.id)}
                      onChange={(e) =>
                        setStoreIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                      }
                      className="h-4 w-4"
                    />
                    {s.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-date">
              Date
            </label>
            {/* The clicked day. Read-only on create: the dialog was opened FROM
                that cell, and a date field that disagrees with the cell you
                clicked is a small lie the grid then has to explain.
                CAL-1b — EDITABLE IN EDIT MODE, because nothing anchors the edit
                dialog to a cell, and startDate is one of the fields a schedule
                is made of: the PATCH route re-derives the open occurrences when
                it moves. */}
            {edit ? (
              <input
                id="cal-date"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={field}
              />
            ) : (
              <input id="cal-date" value={startDate} readOnly className={`${field} opacity-70`} />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-time">
              Time <span className="text-[var(--color-muted-foreground)]">(optional)</span>
            </label>
            <input id="cal-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={field} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-repeat">
              Repeat
            </label>
            <select id="cal-repeat" value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={field}>
              {CALENDAR_RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {r === "None" ? "Does not repeat" : r}
                </option>
              ))}
            </select>
          </div>
          {recurrence !== "None" && (
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cal-end">
                Ends <span className="text-[var(--color-muted-foreground)]">(optional)</span>
              </label>
              <input
                id="cal-end"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={field}
              />
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-notes">
            Notes <span className="text-[var(--color-muted-foreground)]">(optional)</span>
          </label>
          <textarea
            id="cal-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={5000}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-url">
            Link <span className="text-[var(--color-muted-foreground)]">(optional)</span>
          </label>
          <input
            id="cal-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className={field}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-file">
            Attachment <span className="text-[var(--color-muted-foreground)]">(PDF, JPG, PNG — 10 MB)</span>
          </label>
          {/* CAL-1b — REPLACE OR REMOVE. Choosing a file replaces in place (the
              POST route drops the old blob first), so the Remove control is
              only offered while no replacement is picked: otherwise the two
              read as a choice when one already supersedes the other. */}
          {edit?.attachment && !file && (
            <p className="mb-1 flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
              <span className={`min-w-0 truncate ${dropAttachment ? "line-through" : ""}`}>{edit.attachment.label}</span>
              <button
                type="button"
                onClick={() => setDropAttachment((v) => !v)}
                className="shrink-0 underline hover:text-[var(--color-foreground)]"
              >
                {dropAttachment ? "Keep" : "Remove"}
              </button>
            </p>
          )}
          <input
            id="cal-file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs"
          />
        </div>
      </div>

      {/* OUTSIDE THE SCROLL, DELIBERATELY. The error renders at the bottom
          of a form eleven fields long; left inside the scrolling body it
          would appear below the fold for anyone who had not scrolled, which
          is exactly the person who just hit Save and needs to read it. */}
      {error && <p className="mt-2 shrink-0 text-xs text-[var(--color-destructive)]">{error}</p>}

      <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-[var(--color-border)] pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md border border-[var(--color-border)] px-3 text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="h-9 rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  )

  if (edit) return form

  return (
    // CAL-1a. `min-h-0` is what makes the scroll below actually work: a flex
    // child defaults to min-height:auto and refuses to shrink under its
    // content, so the body would push the dialog past 85vh instead of
    // scrolling inside it. Same for the TabsContent pane underneath.
    <Tabs defaultValue="reminder" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mb-3 shrink-0">
        <TabsTrigger value="reminder">Reminder</TabsTrigger>
        <TabsTrigger value="event" disabled title="Coming in CAL-2">
          Event
        </TabsTrigger>
      </TabsList>

      <TabsContent value="event">
        <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">Coming in CAL-2</p>
      </TabsContent>

      <TabsContent value="reminder" className="flex min-h-0 flex-1 flex-col">
        {form}
      </TabsContent>
    </Tabs>
  )
}
