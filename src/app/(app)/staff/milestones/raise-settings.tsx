"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  COOLDOWN_CHOICES,
  everyCriterionOff,
  raiseSettingsProblem,
  type RaiseSettingsValues,
} from "@/lib/raise-settings"

// MS-3a — the Raise eligibility section of /staff/milestones, replacing the
// "Coming soon" card. Holds no authority: the save goes to
// /api/milestones/raise, which re-checks milestones.manage, the module gate and
// that every ticked id is a live training / compliance document in this org.
// The validation text is the route's own (raiseSettingsProblem), so the form
// and the 400 can never say different things.
//
// Built from existing components only (no design bundle — Gary, 2026-10-16,
// extended to MS-3a and MS-3b): the On-time Card beside it
// (attendance-settings.tsx) for the shell, number fields, Select and warning
// note; the Switch from /settings; and the checkbox list from the /staff/[id]
// "Assign training" dialog (staff-training.tsx).

type Option = { id: string; title: string }
const CUSTOM = "custom"

export function RaiseSettings({
  initial,
  trainings,
  documents,
  squareLaborOn,
}: {
  initial: RaiseSettingsValues
  trainings: Option[]
  documents: Option[]
  /// F12 — false when the Square labor overlay is off: no Raise badge shows
  /// anywhere. The form still saves.
  squareLaborOn: boolean
}) {
  const router = useRouter()
  const isPreset = (COOLDOWN_CHOICES as readonly number[]).includes(initial.raiseCooldownDays)
  const [gate, setGate] = useState(initial.raiseComplianceGate)
  const [hours, setHours] = useState(String(initial.raiseMinHoursPerWeek))
  const [weeks, setWeeks] = useState(String(initial.raiseConsecutiveWeeks))
  const [pct, setPct] = useState(String(initial.raiseMinOnTimePct))
  const [cooldownChoice, setCooldownChoice] = useState(isPreset ? String(initial.raiseCooldownDays) : CUSTOM)
  const [customDays, setCustomDays] = useState(isPreset ? "" : String(initial.raiseCooldownDays))
  const [pickedTrainings, setPickedTrainings] = useState(() => new Set(initial.requiredTrainingIds))
  const [pickedDocuments, setPickedDocuments] = useState(() => new Set(initial.requiredDocumentIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const touch = () => setSaved(false)

  function values(): RaiseSettingsValues {
    return {
      raiseComplianceGate: gate,
      raiseMinHoursPerWeek: Number(hours),
      raiseConsecutiveWeeks: Number(weeks),
      raiseMinOnTimePct: Number(pct),
      raiseCooldownDays: Number(cooldownChoice === CUSTOM ? customDays : cooldownChoice),
      // Keep the options' order, and only ids still on offer.
      requiredTrainingIds: trainings.filter((t) => pickedTrainings.has(t.id)).map((t) => t.id),
      requiredDocumentIds: documents.filter((d) => pickedDocuments.has(d.id)).map((d) => d.id),
    }
  }

  async function save() {
    const v = values()
    if (cooldownChoice === CUSTOM && customDays.trim() === "") {
      setError("Enter the number of cooldown days.")
      return
    }
    const problem = raiseSettingsProblem(v)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const res = await fetch("/api/milestones/raise", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setError(data?.error ?? "Could not save the raise settings.")
      return
    }
    setSaved(true)
    router.refresh()
  }

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    touch()
    set((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOff = everyCriterionOff(values())

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[var(--color-primary)]" /> Raise eligibility
        </CardTitle>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          A red, yellow or green badge for each person, seen only by admins and managers. Green means every rule below
          is met. Red means compliance is outstanding or on-time is below the minimum. Yellow means something is still
          in progress or there isn&apos;t enough data yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!squareLaborOn && (
          <div className="rounded-md border border-[var(--color-warning,#efa201)]/40 bg-[var(--color-warning,#efa201)]/10 px-3 py-2 text-sm">
            Raise eligibility needs Square labor switched on — hours come from Square timecards and on-time from Square
            schedules. Until then no Raise badge shows. You can still set these rules now.
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="raise-gate">Compliance gate</Label>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
              Red while any training is overdue or any required document is unsigned. Applies to raises only — tenure
              milestones always count from the start date.
            </p>
          </div>
          <Switch
            id="raise-gate"
            checked={gate}
            onCheckedChange={(c) => {
              touch()
              setGate(c)
            }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="raise-hours">Minimum hours per week</Label>
            <Input id="raise-hours" type="number" inputMode="numeric" min={0} max={60} value={hours} onChange={(e) => { touch(); setHours(e.target.value) }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-weeks">Consecutive weeks</Label>
            <Input id="raise-weeks" type="number" inputMode="numeric" min={1} max={26} value={weeks} onChange={(e) => { touch(); setWeeks(e.target.value) }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-pct">Minimum on-time (%)</Label>
            <Input id="raise-pct" type="number" inputMode="numeric" min={0} max={100} value={pct} onChange={(e) => { touch(); setPct(e.target.value) }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="raise-cooldown">Cooldown after a raise</Label>
            <Select
              value={cooldownChoice}
              onValueChange={(v) => {
                touch()
                setCooldownChoice(v)
              }}
            >
              <SelectTrigger id="raise-cooldown" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COOLDOWN_CHOICES.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} days
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom</SelectItem>
              </SelectContent>
            </Select>
            {cooldownChoice === CUSTOM && (
              <Input
                aria-label="Custom cooldown days"
                type="number"
                inputMode="numeric"
                min={1}
                max={730}
                placeholder="Days"
                value={customDays}
                onChange={(e) => {
                  touch()
                  setCustomDays(e.target.value)
                }}
              />
            )}
          </div>
        </div>

        <p className="text-xs text-[var(--color-muted-foreground)]">
          Hours are paid hours (unpaid breaks taken off) in each of the last completed Monday–Sunday weeks, all stores
          combined; the current week is never counted. On-time is the same percentage as the On-time badge, over those
          same weeks. Set hours or on-time to 0 to switch that rule off. The cooldown counts from the latest raise Froot
          sees in Square (wages sync daily) or the last raise date an admin enters on the person&apos;s Milestones tab,
          whichever is later. During it the Raise badge is hidden on Staff.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Required trainings</Label>
            {trainings.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">No active trainings yet. Create one under HR → Training.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                {trainings.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={pickedTrainings.has(t.id)} onChange={() => toggle(setPickedTrainings, t.id)} />
                    {t.title}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Required documents</Label>
            {documents.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                No documents that need signing yet. Add one under HR → Documents.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                {documents.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={pickedDocuments.has(d.id)} onChange={() => toggle(setPickedDocuments, d.id)} />
                    {d.title}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          A required training or document that isn&apos;t assigned to someone shows as &ldquo;N/A — not assigned&rdquo;
          for them and doesn&apos;t affect their badge.
        </p>

        {allOff && (
          <div className="rounded-md border border-[var(--color-warning,#efa201)]/40 bg-[var(--color-warning,#efa201)]/10 px-3 py-2 text-sm">
            Every rule is switched off, so everyone would show green. Turn on at least one rule.
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        {saved && !error && <p className="text-sm text-[var(--color-success-text,#1d7c2e)]">Saved.</p>}

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving} className="min-h-11 sm:min-h-0">
            {saving ? "Saving…" : "Save raise settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
