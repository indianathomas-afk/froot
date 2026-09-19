"use client"

import { useEffect, useState } from "react"
import { CALENDAR_CATEGORIES, CALENDAR_PRIORITIES, CALENDAR_RECURRENCES } from "@/lib/calendar"
import type { StoreOption } from "./calendar-client"

// CAL-2 — the EVENT half of ruling 1's two entity types: a TEMPLATE SCHEDULED
// TO RUN. CAL-1 shipped this tab disabled with "Coming in CAL-2"; this is it.
//
// ── WHY THIS IS A SIBLING OF create-reminder-form.tsx AND NOT A MODE OF IT ───
// That file keeps create and edit in ONE component on a stated argument: "a
// fork would put the eleven fields, their validation and their layout in two
// files, and the twelfth field would be added to one of them." That argument is
// about the SAME field set rendered twice. An Event's field set is genuinely
// different — it GAINS a template picker and LOSES notes, url and attachment,
// because those live on the template and duplicating them here would give one
// fact two homes and two places to edit it. So the two forms are siblings under
// one tab strip, not one form with a mode flag.
//
// ── WHAT THE TEMPLATE PICKER FILLS IN, AND WHERE IT READS IT FROM ────────────
// Ruling 2: "Repeat is preset from Template.frequency (Weekly -> Weekly,
// Monthly -> Monthly) and can be changed; the start date is what the calendar
// collects — THAT IS THE DAY-OF-WEEK / DAY-OF-MONTH DEBT-61 SAYS NOBODY
// COLLECTED. Category defaults to Store Ops. Stores follow the template's
// assignment."
//
// THE STORE SET COMES FROM THE TEMPLATE ROW, never from any form state. The
// template editor infers its own appliesTo from whether assignments exist
// rather than reading the column (template-form.tsx), and a dialog that copied
// that inference would inherit it. The API answers with the row.

type SchedulableTemplate = {
  id: string
  name: string
  frequency: string
  appliesTo: string
  storeIds: string[]
  presetRecurrence: string | null
  scheduled: boolean
}

/** An existing scheduled event, for edit mode. The TEMPLATE IS NOT EDITABLE:
 *  changing which template an event schedules is not an edit, it is a different
 *  schedule — and the occurrences and checklists already made under the old one
 *  would be left describing work that is no longer what this event means.
 *  Archive it and add the other template. */
export type EventDraft = {
  id: string
  templateId: string
  templateName: string
  category: string
  priority: string
  recurrence: string
  startDate: string
  dueTime: string | null
  endDate: string | null
  appliesTo: string
  storeIds: string[]
}

export function CreateEventForm({
  date,
  stores,
  isAdmin,
  lockedTemplateId,
  edit,
  onDone,
  onCancel,
}: {
  date: string
  stores: StoreOption[]
  /** B11: a non-ADMIN's "All stores" means THEIR stores, and the label says so
   *  rather than promising an org-wide reach the route will refuse. */
  isAdmin: boolean
  /** Set when the form was opened from a template's own "Add to Calendar"
   *  button — the template is the one thing not up for discussion there. */
  lockedTemplateId?: string
  edit?: EventDraft
  onDone: (result?: { reDerived: boolean; keptStarted: number }) => void
  onCancel: () => void
}) {
  const [templates, setTemplates] = useState<SchedulableTemplate[] | null>(null)
  const [templateId, setTemplateId] = useState(edit?.templateId ?? lockedTemplateId ?? "")
  const [category, setCategory] = useState<string>(edit?.category ?? "storeops") // ruling 2's default
  const [priority, setPriority] = useState<string>(edit?.priority ?? "Standard")
  const [recurrence, setRecurrence] = useState<string>(edit?.recurrence ?? "Weekly")
  const [appliesTo, setAppliesTo] = useState<"all" | "specific">(
    edit?.appliesTo === "specific" ? "specific" : "all"
  )
  const [storeIds, setStoreIds] = useState<string[]>(edit?.storeIds ?? [])
  const [startDate, setStartDate] = useState(edit?.startDate ?? date)
  const [dueTime, setDueTime] = useState(edit?.dueTime ?? "")
  const [endDate, setEndDate] = useState(edit?.endDate ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch("/api/calendar/schedulable-templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => {
        if (live) setTemplates(d.templates ?? [])
      })
      .catch(() => {
        if (live) setTemplates([])
      })
    return () => {
      live = false
    }
  }, [])

  const selected = templates?.find((t) => t.id === templateId) ?? null

  // PRESET, NOT RULE (ruling 2). Applied when the operator picks a template and
  // never again — re-applying it on every render would fight them the moment
  // they changed the repeat, which is a thing the ruling explicitly allows.
  function pickTemplate(id: string) {
    setTemplateId(id)
    const t = templates?.find((x) => x.id === id)
    if (!t) return
    if (t.presetRecurrence) setRecurrence(t.presetRecurrence)
    // Stores follow the template's assignment — from the row, not from a guess.
    if (t.appliesTo === "selected" && t.storeIds.length > 0) {
      setAppliesTo("specific")
      setStoreIds(t.storeIds.filter((sid) => stores.some((s) => s.id === sid)))
    } else {
      setAppliesTo("all")
      setStoreIds([])
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!templateId) return
    setBusy(true)
    setError(null)

    const title = selected?.name ?? edit?.templateName
    const res = await fetch(edit ? `/api/calendar/events/${edit.id}` : "/api/calendar/events", {
      method: edit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // The event's title is the TEMPLATE'S NAME, not a second name somebody
        // types. A scheduled checklist that reads differently on the calendar
        // and on /templates is two names for one thing.
        ...(title ? { title } : {}),
        category,
        priority,
        recurrence,
        startDate,
        dueTime: dueTime || null,
        endDate: endDate || null,
        appliesTo,
        storeIds: appliesTo === "specific" ? storeIds : [],
        // templateId is sent ON CREATE ONLY. PATCH does not accept it — see
        // EventDraft above for why re-pointing an event is not an edit.
        ...(edit ? {} : { templateId }),
      }),
    }).catch(() => null)

    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      setError(body?.error ?? (edit ? "Could not save those changes." : "Could not schedule that template."))
      setBusy(false)
      return
    }
    const saved = (await res.json().catch(() => null)) as
      | { reDerived?: boolean; keptStarted?: number }
      | null
    setBusy(false)
    onDone({ reDerived: saved?.reDerived ?? false, keptStarted: saved?.keptStarted ?? 0 })
  }

  const field = "h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm"

  if (templates === null) {
    // Skeleton, never a spinner (§ Design System).
    return (
      <div className="space-y-2 py-6">
        <div className="h-9 animate-pulse rounded-md bg-[var(--color-muted)]" />
        <div className="h-9 w-2/3 animate-pulse rounded-md bg-[var(--color-muted)]" />
      </div>
    )
  }

  if (templates.length === 0 && !edit) {
    // Empty state with a CTA (§ Design System) — and it names the reason, since
    // "no templates" and "no templates THIS CAN SCHEDULE" are different facts.
    return (
      <div className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
        <p className="mb-1 font-medium text-[var(--color-foreground)]">No weekly or monthly templates yet</p>
        <p>
          Only a weekly or monthly template can be scheduled here — a daily one already generates every day. Set a
          template&rsquo;s frequency to Weekly or Monthly on the Templates page first.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-template">
            Checklist template
          </label>
          {edit ? (
            <input id="cal-template" value={edit.templateName} readOnly className={`${field} opacity-70`} />
          ) : (
            <select
              id="cal-template"
              value={templateId}
              required
              disabled={!!lockedTemplateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className={`${field} ${lockedTemplateId ? "opacity-70" : ""}`}
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.frequency}){t.scheduled ? " — already scheduled" : ""}
                </option>
              ))}
            </select>
          )}
          {!edit && selected?.scheduled && (
            <p className="mt-1 text-xs text-[var(--color-warning-text,#efa201)]">
              This template already has a calendar entry. Adding a second one will generate two checklists.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-category">
              Category
            </label>
            <select
              id="cal-ev-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={field}
            >
              {CALENDAR_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-priority">
              Priority
            </label>
            <select
              id="cal-ev-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={field}
            >
              {CALENDAR_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-applies">
            Stores
          </label>
          <select
            id="cal-ev-applies"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value as "all" | "specific")}
            className={field}
          >
            {/* B11: a non-ADMIN's "all" resolves to THEIR stores on the server,
                so the label says what will actually happen rather than letting
                them read an org-wide promise into it. */}
            <option value="all">{isAdmin ? "All stores" : "All my stores"}</option>
            <option value="specific">Pick stores</option>
          </select>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            Pre-filled from the template&rsquo;s own store assignment.
          </p>
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
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-date">
              Starts
            </label>
            {/* THE FIELD DEBT-61 SAYS NOBODY COLLECTED. A Weekly template needs a
                day-of-week and a Monthly one a day-of-month; this date is where
                both come from — projectDueDates() reads the weekday, or the
                day-of-month, straight off it. */}
            <input
              id="cal-ev-date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-time">
              Time <span className="text-[var(--color-muted-foreground)]">(optional)</span>
            </label>
            <input
              id="cal-ev-time"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className={field}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-repeat">
              Repeat
            </label>
            <select
              id="cal-ev-repeat"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className={field}
            >
              {CALENDAR_RECURRENCES.filter((r) => r !== "None").map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              Preset from the template&rsquo;s frequency. You can change it.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cal-ev-end">
              Ends <span className="text-[var(--color-muted-foreground)]">(optional)</span>
            </label>
            <input
              id="cal-ev-end"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={field}
            />
          </div>
        </div>

        <p className="text-xs text-[var(--color-muted-foreground)]">
          The checklist itself — its tasks, notes and attachments — lives on the template. This schedules when it runs.
        </p>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
        <button type="button" onClick={onCancel} className="h-9 rounded-md px-3 text-sm">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !templateId}
          className="h-9 rounded-md bg-[var(--color-primary)] px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : edit ? "Save changes" : "Add to calendar"}
        </button>
      </div>
    </form>
  )
}
