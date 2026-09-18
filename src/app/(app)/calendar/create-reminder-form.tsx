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

export function CreateReminderForm({
  date,
  stores,
  onDone,
  onCancel,
}: {
  date: string
  stores: StoreOption[]
  onDone: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<string>(CALENDAR_CATEGORIES[0].id)
  const [priority, setPriority] = useState<string>("Standard")
  const [recurrence, setRecurrence] = useState<string>("None")
  const [appliesTo, setAppliesTo] = useState<"all" | "specific">("all")
  const [storeIds, setStoreIds] = useState<string[]>([])
  const [dueTime, setDueTime] = useState("")
  const [endDate, setEndDate] = useState("")
  const [notes, setNotes] = useState("")
  const [url, setUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        priority,
        recurrence,
        startDate: date,
        dueTime: dueTime || null,
        endDate: endDate || null,
        appliesTo,
        storeIds: appliesTo === "specific" ? storeIds : [],
        notes: notes || null,
        url: url || null,
      }),
    }).catch(() => null)

    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      setError(body?.error ?? "Could not save that reminder.")
      setBusy(false)
      return
    }

    // The attachment is a SECOND request against the created event, because the
    // event route takes JSON and an upload takes multipart. A failed upload
    // leaves the reminder — losing the whole reminder because a PDF did not
    // stick would be the worse trade on a shop floor.
    if (file) {
      const created = (await res.json()) as { id: string }
      const form = new FormData()
      form.set("file", file)
      const up = await fetch(`/api/calendar/events/${created.id}/attachment`, { method: "POST", body: form }).catch(
        () => null
      )
      if (!up?.ok) {
        setError("The reminder was saved, but the attachment did not upload.")
        setBusy(false)
        onDone()
        return
      }
    }

    setBusy(false)
    onDone()
  }

  const field = "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"

  return (
    <Tabs defaultValue="reminder">
      <TabsList className="mb-3">
        <TabsTrigger value="reminder">Reminder</TabsTrigger>
        <TabsTrigger value="event" disabled title="Coming in CAL-2">
          Event
        </TabsTrigger>
      </TabsList>

      <TabsContent value="event">
        <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">Coming in CAL-2</p>
      </TabsContent>

      <TabsContent value="reminder">
        <form onSubmit={submit} className="space-y-3">
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
              {/* The clicked day. Read-only: the popover is anchored to that
                  cell, and a date field that disagrees with the cell you opened
                  is a small lie the grid then has to explain. */}
              <input id="cal-date" value={date} readOnly className={`${field} opacity-70`} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cal-time">
                Time <span className="text-[var(--color-muted-foreground)]">(optional)</span>
              </label>
              <input
                id="cal-time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className={field}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cal-repeat">
                Repeat
              </label>
              <select
                id="cal-repeat"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value)}
                className={field}
              >
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
                  min={date}
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
            <input
              id="cal-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs"
            />
          </div>

          {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
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
      </TabsContent>
    </Tabs>
  )
}
