"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { ScheduleFrequency } from "@/lib/notifications/define"
import type { ScheduleView } from "@/lib/notifications/schedule-settings"
import { TIME_ZONE_OPTIONS, timeZoneLabel } from "@/lib/time-zones"

// ─── NOTIFY-SCHED: the Schedule block on a scheduled email's card ───────────
// Sits under RecipientsSection on the pace and milestone cards. Everything it
// offers comes from the kind's registry `schedule` (via ScheduleView), so the
// choices cannot drift from what the route and the hourly runner accept: pace
// hours 5 AM–8 PM (F10), milestones daily or weekly (F12), weekly = one day
// (F16). Save → PUT /api/notify/schedule/[kind]; "Reset to default" → DELETE,
// which removes the row (F15) behind a confirmation, as every destructive
// action here is.
//
// Shows what was SAVED after a save (the route returns the stored row), like
// AlsoSendTo.

const WEEKDAYS = [
  { iso: 1, short: "Mon", long: "Monday" },
  { iso: 2, short: "Tue", long: "Tuesday" },
  { iso: 3, short: "Wed", long: "Wednesday" },
  { iso: 4, short: "Thu", long: "Thursday" },
  { iso: 5, short: "Fri", long: "Friday" },
  { iso: 6, short: "Sat", long: "Saturday" },
  { iso: 7, short: "Sun", long: "Sunday" },
]
const ALL_DAYS = WEEKDAYS.map((d) => d.iso)

function hourLabel(h: number): string {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

const FREQUENCY_LABEL: Record<ScheduleFrequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }

/** What each frequency does, per kind — the sentence under the picker. */
function frequencyHelp(kind: string, f: ScheduleFrequency): string {
  if (kind === "pace.alert") {
    if (f === "monthly") return "At most one alert per store per month, on the first checked day a store is behind."
    if (f === "weekly") return "At most one alert per store per week, on the day you pick, if the store is behind."
    return "At most one alert per store per day, on the checked days, while a store is behind."
  }
  if (f === "weekly") return "One email a week, on the day you pick, listing milestones reached since the last one."
  if (f === "monthly") return "One email a month, on the day you pick."
  return "At most one email a day, on the checked days."
}

export function ScheduleSection({ view: initial }: { view: ScheduleView }) {
  const router = useRouter()
  const { kind, spec } = initial
  const [view, setView] = useState(initial)

  const start = view.saved
  const hours = Array.from({ length: spec.hours.max - spec.hours.min + 1 }, (_, i) => spec.hours.min + i)
  const defaultHour = Math.min(Math.max(8, spec.hours.min), spec.hours.max)

  const [frequency, setFrequency] = useState<ScheduleFrequency>(
    (start?.frequency as ScheduleFrequency | undefined) ??
      (spec.frequencies.includes("monthly") && spec.monthly === "every-allowed-day" ? "monthly" : spec.frequencies[0])
  )
  const [sendHour, setSendHour] = useState(start?.sendHour ?? defaultHour)
  // Daily (and pace monthly) keep a SET of days; weekly keeps ONE (F16). Two
  // states, so flipping the frequency back and forth loses neither.
  const [days, setDays] = useState<Set<number>>(
    new Set(start && start.frequency !== "weekly" ? start.daysOfWeek : ALL_DAYS)
  )
  const [weeklyDay, setWeeklyDay] = useState(start?.frequency === "weekly" ? start.daysOfWeek[0] : 1)
  const [dayOfMonth, setDayOfMonth] = useState(start?.dayOfMonth ?? 1)
  const [timeZone, setTimeZone] = useState(start?.timeZone ?? view.defaultZone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const usesDayOfMonth = frequency === "monthly" && spec.monthly === "day-of-month"
  const usesDaySet = frequency === "daily" || (frequency === "monthly" && spec.monthly === "every-allowed-day")

  function body() {
    return {
      frequency,
      sendHour,
      daysOfWeek: frequency === "weekly" ? [weeklyDay] : usesDaySet ? [...days].sort((a, b) => a - b) : ALL_DAYS,
      dayOfMonth: usesDayOfMonth ? dayOfMonth : null,
      timeZone: spec.scope === "org" ? timeZone : null,
    }
  }

  function changed() {
    setError(null)
    setDone(null)
  }

  async function save() {
    setBusy(true)
    changed()
    const res = await fetch(`/api/notify/schedule/${encodeURIComponent(kind)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body()),
    }).catch(() => null)
    if (!res?.ok) {
      const b = (await res?.json().catch(() => null)) as { error?: string } | null
      setError(b?.error ?? "Could not save. Try again.")
      setBusy(false)
      return
    }
    const next = (await res.json().catch(() => null)) as ScheduleView | null
    if (next) setView(next)
    setDone("Saved")
    setBusy(false)
    router.refresh()
  }

  async function reset() {
    setBusy(true)
    changed()
    const res = await fetch(`/api/notify/schedule/${encodeURIComponent(kind)}`, { method: "DELETE" }).catch(() => null)
    if (!res?.ok) {
      setError("Could not reset. Try again.")
      setBusy(false)
      return
    }
    setView({ ...view, saved: null })
    setFrequency(spec.frequencies.includes("monthly") && spec.monthly === "every-allowed-day" ? "monthly" : spec.frequencies[0])
    setSendHour(defaultHour)
    setDays(new Set(ALL_DAYS))
    setWeeklyDay(1)
    setDayOfMonth(1)
    setTimeZone(view.defaultZone)
    setDone("Back to the default schedule")
    setBusy(false)
    router.refresh()
  }

  const noDays = usesDaySet && days.size === 0

  return (
    <div className="mt-3 p-4 border border-[var(--color-border)] rounded-lg">
      <h3 className="font-medium text-[var(--color-foreground)]">Schedule</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        {view.saved ? (
          <>Custom schedule.</>
        ) : (
          // F6: no row = the old daily cron, 15:00 UTC. Said in UTC first
          // because that is what it is; the Pacific reading moves with DST.
          <>
            Default: every day at 15:00 UTC (8 AM Pacific, 7 AM in winter)
            {kind === "pace.alert" ? ", at most one alert per store per month." : "."}
          </>
        )}{" "}
        {spec.scope === "store"
          ? "Times are each store's own local time."
          : "Times are in the time zone you choose below."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <div className="space-y-1.5">
          <Label htmlFor={`sched-freq-${kind}`}>How often</Label>
          <Select
            value={frequency}
            onValueChange={(v) => {
              setFrequency(v as ScheduleFrequency)
              changed()
            }}
            disabled={busy}
          >
            <SelectTrigger id={`sched-freq-${kind}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spec.frequencies.map((f) => (
                <SelectItem key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`sched-hour-${kind}`}>Send at</Label>
          <Select
            value={String(sendHour)}
            onValueChange={(v) => {
              setSendHour(Number(v))
              changed()
            }}
            disabled={busy}
          >
            <SelectTrigger id={`sched-hour-${kind}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hours.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm text-[var(--color-muted-foreground)] mt-2">{frequencyHelp(kind, frequency)}</p>

      {usesDaySet && (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-[var(--color-foreground)]">On these days</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1.5">
            {WEEKDAYS.map((d) => {
              const id = `sched-day-${kind}-${d.iso}`
              return (
                <div key={d.iso} className="flex items-center gap-1.5">
                  <Checkbox
                    id={id}
                    checked={days.has(d.iso)}
                    disabled={busy}
                    onCheckedChange={(v) => {
                      setDays((prev) => {
                        const next = new Set(prev)
                        if (v === true) next.add(d.iso)
                        else next.delete(d.iso)
                        return next
                      })
                      changed()
                    }}
                  />
                  <label htmlFor={id} className="text-sm cursor-pointer">
                    {d.short}
                  </label>
                </div>
              )
            })}
          </div>
          {noDays && <p className="text-sm text-[var(--color-destructive)] mt-1.5">Tick at least one day.</p>}
        </fieldset>
      )}

      {frequency === "weekly" && (
        <div className="space-y-1.5 mt-3 sm:max-w-[50%]">
          <Label htmlFor={`sched-weekday-${kind}`}>On</Label>
          <Select
            value={String(weeklyDay)}
            onValueChange={(v) => {
              setWeeklyDay(Number(v))
              changed()
            }}
            disabled={busy}
          >
            <SelectTrigger id={`sched-weekday-${kind}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((d) => (
                <SelectItem key={d.iso} value={String(d.iso)}>
                  {d.long}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {usesDayOfMonth && (
        <div className="space-y-1.5 mt-3 sm:max-w-[50%]">
          <Label htmlFor={`sched-dom-${kind}`}>Day of the month</Label>
          <Select
            value={String(dayOfMonth)}
            onValueChange={(v) => {
              setDayOfMonth(Number(v))
              changed()
            }}
            disabled={busy}
          >
            <SelectTrigger id={`sched-dom-${kind}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {spec.scope === "org" && (
        <div className="space-y-1.5 mt-3 sm:max-w-[50%]">
          <Label htmlFor={`sched-zone-${kind}`}>Time zone</Label>
          <Select
            value={timeZone}
            onValueChange={(v) => {
              setTimeZone(v)
              changed()
            }}
            disabled={busy}
          >
            <SelectTrigger id={`sched-zone-${kind}`}>
              <SelectValue>{timeZoneLabel(timeZone)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {!TIME_ZONE_OPTIONS.some((z) => z.value === timeZone) && (
                <SelectItem value={timeZone}>{timeZone}</SelectItem>
              )}
              {TIME_ZONE_OPTIONS.map((z) => (
                <SelectItem key={z.value} value={z.value}>
                  {z.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* F10 (Gary, 2026-10-24): pace hours are 5 AM–8 PM. The nightly sales
          re-pull runs at 11:00 UTC, so an early Eastern alert can go out first. */}
      {kind === "pace.alert" && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-3">
          Alerts can go out from 5 AM to 8 PM. Very early alerts may not include yesterday&apos;s late refunds.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <Button size="sm" onClick={save} disabled={busy || noDays}>
          {busy ? "Saving…" : "Save schedule"}
        </Button>
        {view.saved && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>
                Reset to default
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset to the default schedule?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes your custom schedule. These emails go back to every day at 15:00 UTC
                  {kind === "pace.alert" ? ", at most one alert per store per month" : ""}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        {!error && done && <span className="text-sm text-[var(--color-success-text)]">{done}</span>}
      </div>
    </div>
  )
}
