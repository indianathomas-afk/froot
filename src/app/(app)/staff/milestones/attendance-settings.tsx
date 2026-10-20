"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GRACE_CHOICES, settingsProblem, type MilestoneSettingsValues } from "@/lib/attendance-settings"

// MS-2 — the On-Time section of /staff/milestones, replacing MS-1's "Coming
// soon" Attendance card. Holds no authority: the save goes to
// /api/milestones/attendance, which re-checks milestones.manage and the module
// gate. The validation text below is the route's own (settingsProblem), so the
// form and the 400 can never say different things.
//
// Built from existing components only (F0, Gary 2026-10-16): the Tenure
// milestones Card on this page, its Input/Label fields, and the --color-warning
// note style from legal-name-controls.tsx.

type Fields = Record<keyof MilestoneSettingsValues, string>

const toFields = (v: MilestoneSettingsValues): Fields => ({
  onTimeRedBelow: String(v.onTimeRedBelow),
  onTimeGreenAtOrAbove: String(v.onTimeGreenAtOrAbove),
  onTimeLookbackDays: String(v.onTimeLookbackDays),
  onTimeMinShifts: String(v.onTimeMinShifts),
  onTimeGraceMinutes: String(v.onTimeGraceMinutes),
})

export function AttendanceSettings({
  initial,
  squareLaborOn,
}: {
  initial: MilestoneSettingsValues
  /// F5 — false when the Square labor overlay is off, so there is no schedule
  /// data and every badge is grey. The form still saves.
  squareLaborOn: boolean
}) {
  const router = useRouter()
  const [fields, setFields] = useState<Fields>(() => toFields(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false)
    setFields({ ...fields, [k]: e.target.value })
  }

  async function save() {
    const values: MilestoneSettingsValues = {
      onTimeRedBelow: Number(fields.onTimeRedBelow),
      onTimeGreenAtOrAbove: Number(fields.onTimeGreenAtOrAbove),
      onTimeLookbackDays: Number(fields.onTimeLookbackDays),
      onTimeMinShifts: Number(fields.onTimeMinShifts),
      onTimeGraceMinutes: Number(fields.onTimeGraceMinutes),
    }
    const problem = settingsProblem(values)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const res = await fetch("/api/milestones/attendance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? "Could not save the on-time settings.")
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-[var(--color-primary)]" /> On-time
        </CardTitle>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Each person&apos;s on-time percentage compares their clock-in with their published Square shift. A missed
          shift counts as not on time; clocking in without a scheduled shift is left out.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!squareLaborOn && (
          <div className="rounded-md border border-[var(--color-warning,#efa201)]/40 bg-[var(--color-warning,#efa201)]/10 px-3 py-2 text-sm">
            On-time badges need Square labor switched on and shifts published in Square Scheduling. Until then every
            badge shows &ldquo;No schedule data&rdquo;. You can still set these values now.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ot-red">Red below (%)</Label>
            <Input id="ot-red" type="number" inputMode="numeric" min={1} max={100} value={fields.onTimeRedBelow} onChange={set("onTimeRedBelow")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ot-green">Green at or above (%)</Label>
            <Input id="ot-green" type="number" inputMode="numeric" min={1} max={100} value={fields.onTimeGreenAtOrAbove} onChange={set("onTimeGreenAtOrAbove")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ot-days">Look back (days)</Label>
            <Input id="ot-days" type="number" inputMode="numeric" min={7} max={90} value={fields.onTimeLookbackDays} onChange={set("onTimeLookbackDays")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ot-min">Minimum shifts</Label>
            <Input id="ot-min" type="number" inputMode="numeric" min={1} max={50} value={fields.onTimeMinShifts} onChange={set("onTimeMinShifts")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ot-grace">Grace period</Label>
            <Select
              value={fields.onTimeGraceMinutes}
              onValueChange={(v) => {
                setSaved(false)
                setFields({ ...fields, onTimeGraceMinutes: v })
              }}
            >
              <SelectTrigger id="ot-grace" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRACE_CHOICES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-[var(--color-muted-foreground)]">
          Red is below the red number, green is at or above the green number, and amber is in between. A clock-in
          within the grace period after the scheduled start counts as on time. Fewer shifts than the minimum in the
          look-back shows a grey &ldquo;Not enough shifts&rdquo; badge. Changes apply to every badge from the next page load.
        </p>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        {saved && !error && <p className="text-sm text-[var(--color-success-text,#1d7c2e)]">Saved.</p>}

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving} className="min-h-11 sm:min-h-0">
            {saving ? "Saving…" : "Save on-time settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
