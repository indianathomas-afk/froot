"use client"

import { CalendarClock } from "lucide-react"
import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"

// CHK-2 (S2). The editing surface for StoreHours — the table's first writer.
// Mirrors the Edit Store dialog next to it (store-actions.tsx): a Dialog, a
// form, one fetch, surface the error, router.refresh() on success.
//
// COPY DISCIPLINE (DEBT-29): this dialog says what these hours do TODAY and
// stops there. Today the only reader is the Weekly Labor Model. Day close reads
// them in CHK-3 and this copy does not promise it — the "not yet used" sentence
// DEBT-59 left on the offsets box is the standing example of copy that was worth
// keeping honest, and the way to avoid needing that again is not to write the
// promise in the first place.

export type StoreHoursRow = {
  dayOfWeek: number
  openingTime: string | null
  closingTime: string | null
  isClosed: boolean
}

// Rendered Monday-first because that is how a week is read off a schedule, but
// stored as the JS day-of-week both readers index by (0 Sun .. 6 Sat) — see
// labor-plan.ts:194-195 and this page's own formatHours.
const WEEK: { dayOfWeek: number; label: string }[] = [
  { dayOfWeek: 1, label: "Monday" },
  { dayOfWeek: 2, label: "Tuesday" },
  { dayOfWeek: 3, label: "Wednesday" },
  { dayOfWeek: 4, label: "Thursday" },
  { dayOfWeek: 5, label: "Friday" },
  { dayOfWeek: 6, label: "Saturday" },
  { dayOfWeek: 0, label: "Sunday" },
]

type DayState = { openingTime: string; closingTime: string; isClosed: boolean }

// Blank is blank. An unset day starts empty and, if left empty, is saved as no
// row at all — nothing is pre-filled, so nothing gets persisted that nobody
// chose.
const EMPTY_DAY: DayState = { openingTime: "", closingTime: "", isClosed: false }

function seed(hours: StoreHoursRow[]): Record<number, DayState> {
  const out: Record<number, DayState> = {}
  for (const { dayOfWeek } of WEEK) {
    const row = hours.find((h) => h.dayOfWeek === dayOfWeek)
    out[dayOfWeek] = row
      ? {
          openingTime: row.openingTime ?? "",
          closingTime: row.closingTime ?? "",
          isClosed: row.isClosed,
        }
      : { ...EMPTY_DAY }
  }
  return out
}

export function StoreHoursButton({
  store,
}: {
  store: { id: string; name: string; hours: StoreHoursRow[] }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<Record<number, DayState>>(() => seed(store.hours))

  const hasAny = store.hours.length > 0

  function handleOpen() {
    setDays(seed(store.hours))
    setError(null)
    setOpen(true)
  }

  function set(dayOfWeek: number, patch: Partial<DayState>) {
    setDays((prev) => ({ ...prev, [dayOfWeek]: { ...prev[dayOfWeek], ...patch } }))
  }

  // Copy Monday's row down to Tue-Fri. Convenience only — it fills the FORM,
  // and nothing is saved until the operator submits, so this never persists a
  // value they did not look at.
  function copyMondayToWeekdays() {
    const mon = days[1]
    setDays((prev) => {
      const next = { ...prev }
      for (const d of [2, 3, 4, 5]) next[d] = { ...mon }
      return next
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stores/${store.id}/hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hours: WEEK.map(({ dayOfWeek }) => ({
            dayOfWeek,
            openingTime: days[dayOfWeek].openingTime || null,
            closingTime: days[dayOfWeek].closingTime || null,
            isClosed: days[dayOfWeek].isClosed,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? "Failed to save hours.")
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 text-[var(--color-primary)] text-xs mt-1 hover:opacity-80"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        {hasAny ? "Edit Hours" : "Set Hours"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Store Hours — {store.name}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Opening and closing times for each day, in the store&apos;s own timezone. Today these
              are read by the Weekly Labor Model, which plans a day&apos;s coverage from real hours
              instead of inferring the open window from past sales. They are Froot&apos;s own — a
              Square resync never overwrites them.
            </p>

            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Leave a day blank if it hasn&apos;t been decided — nothing is filled in for you.
              </p>
              <button
                type="button"
                onClick={copyMondayToWeekdays}
                className="text-xs text-[var(--color-primary)] hover:opacity-80 shrink-0 ml-3"
              >
                Copy Mon to Tue–Fri
              </button>
            </div>

            <div className="space-y-2">
              {WEEK.map(({ dayOfWeek, label }) => {
                const d = days[dayOfWeek]
                return (
                  <div key={dayOfWeek} className="grid grid-cols-[5.5rem_1fr_1fr_auto] items-center gap-2">
                    <span className="text-sm text-[var(--color-foreground)]">{label}</span>
                    <Input
                      type="time"
                      aria-label={`${label} opening time`}
                      value={d.openingTime}
                      disabled={d.isClosed}
                      onChange={(e) => set(dayOfWeek, { openingTime: e.target.value })}
                      className="disabled:opacity-40"
                    />
                    <Input
                      type="time"
                      aria-label={`${label} closing time`}
                      value={d.closingTime}
                      disabled={d.isClosed}
                      onChange={(e) => set(dayOfWeek, { closingTime: e.target.value })}
                      className="disabled:opacity-40"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={d.isClosed}
                        onChange={(e) => set(dayOfWeek, { isClosed: e.target.checked })}
                        className="h-4 w-4 accent-[var(--color-primary)]"
                      />
                      Closed
                    </label>
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-[var(--color-muted-foreground)]">
              A store that closes after midnight is fine — enter the real closing time (say 02:00)
              rather than 24:00.
            </p>

            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Hours"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
