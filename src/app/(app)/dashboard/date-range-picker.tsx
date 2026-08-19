"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// The dashboard's date-range control and its calendar arithmetic.
//
// EXTRACTED FROM sales-performance-card.tsx BY AL-2, not rewritten: vision item 6
// asks the All Locations view for "selectable date ranges (daily, weekly,
// monthly, custom) MATCHING the Sales Performance card", and the only way two
// pickers stay matched is for there to be one picker. A second copy would agree
// on the day it was written and drift on the first day either is edited.
//
// Everything below moved verbatim except for the export keywords.

// ─── Local-date helpers (yyyy-mm-dd strings, browser-local calendar) ─────────

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function shiftDateStr(dateStr: string, days: number): string {
  const d = fromDateStr(dateStr)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

export function daysInclusive(start: string, end: string): number {
  return Math.round((fromDateStr(end).getTime() - fromDateStr(start).getTime()) / 86400000) + 1
}

export const PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "custom",
] as const
export type Preset = (typeof PRESETS)[number]

export const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  last_year: "Last year",
  custom: "Custom",
}

// Weeks start Sunday (matches the Square calendar the design mirrors).
export function resolvePreset(preset: Exclude<Preset, "custom">): { start: string; end: string } {
  const now = new Date()
  const t = toDateStr(now)
  switch (preset) {
    case "today":
      return { start: t, end: t }
    case "yesterday": {
      const y = shiftDateStr(t, -1)
      return { start: y, end: y }
    }
    case "this_week": {
      const start = shiftDateStr(t, -now.getDay())
      return { start, end: t }
    }
    case "last_week": {
      const thisWeekStart = shiftDateStr(t, -now.getDay())
      return { start: shiftDateStr(thisWeekStart, -7), end: shiftDateStr(thisWeekStart, -1) }
    }
    case "this_month":
      return { start: `${t.slice(0, 7)}-01`, end: t }
    case "last_month": {
      const firstOfThis = fromDateStr(`${t.slice(0, 7)}-01`)
      const lastOfPrev = new Date(firstOfThis.getFullYear(), firstOfThis.getMonth(), 0)
      return { start: `${toDateStr(lastOfPrev).slice(0, 7)}-01`, end: toDateStr(lastOfPrev) }
    }
    case "this_year":
      return { start: `${t.slice(0, 4)}-01-01`, end: t }
    case "last_year": {
      const y = Number(t.slice(0, 4)) - 1
      return { start: `${y}-01-01`, end: `${y}-12-31` }
    }
  }
}

export function fmtDay(dateStr: string, withYear = false): string {
  return fromDateStr(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  })
}

export function rangeLabel(start: string, end: string): string {
  const thisYear = String(new Date().getFullYear())
  const withYear = start.slice(0, 4) !== thisYear || end.slice(0, 4) !== thisYear
  if (start === end) return fmtDay(start, withYear)
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmtDay(start)}–${Number(end.slice(8, 10))}${withYear ? `, ${end.slice(0, 4)}` : ""}`
  }
  return `${fmtDay(start, withYear)} – ${fmtDay(end, withYear)}`
}

// ─── Controls ─────────────────────────────────────────────────────────────────

export function PickerPill({ prefix, label }: { prefix: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-[var(--color-input)] px-2.5 h-8 text-[13px] hover:bg-[var(--color-accent)] cursor-pointer">
      <span className="text-[var(--color-muted-foreground)]">{prefix}</span>
      <span className="font-semibold text-[var(--color-foreground)]">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
    </span>
  )
}

export function DatePicker({
  preset,
  range,
  onApply,
}: {
  preset: Preset
  range: { start: string; end: string }
  onApply: (preset: Preset, range: { start: string; end: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  const pillLabel =
    preset === "today" || preset === "yesterday" ? PRESET_LABELS[preset] : rangeLabel(range.start, range.end)

  const openChange = (o: boolean) => {
    setOpen(o)
    if (o) setDraft({ from: fromDateStr(range.start), to: fromDateStr(range.end) })
  }

  const applyDraft = () => {
    if (!draft?.from) return
    const from = draft.from
    const to = draft.to ?? draft.from
    onApply("custom", { start: toDateStr(from), end: toDateStr(to) })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Change date range">
          <PickerPill prefix="Date" label={pillLabel} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-auto">
        <div className="flex">
          <div className="flex flex-col border-r border-[var(--color-border)] p-2 min-w-[120px]">
            {(PRESETS.filter((p) => p !== "custom") as Exclude<Preset, "custom">[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onApply(p, resolvePreset(p))
                  setOpen(false)
                }}
                className={`text-left text-[13px] rounded-md px-2.5 py-1.5 hover:bg-[var(--color-accent)] ${
                  preset === p ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-foreground)]"
                }`}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
            <span className={`text-left text-[13px] px-2.5 py-1.5 ${preset === "custom" ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"}`}>
              Custom
            </span>
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={draft}
              onSelect={setDraft}
              defaultMonth={fromDateStr(range.start)}
              disabled={{ after: new Date() }}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {draft?.from ? rangeLabel(toDateStr(draft.from), toDateStr(draft.to ?? draft.from)) : "Pick a day or range"}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={applyDraft} disabled={!draft?.from}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
