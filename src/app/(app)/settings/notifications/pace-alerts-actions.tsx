"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Interactive islands for the Behind-pace alerts card on
// /settings/notifications.
//
// BOTH WRITE PUT /api/pace-alerts/settings, which NOTIFY-2a put in place of
// F-5b's POST /api/pace-alerts/toggle (deleted — this island was its only
// caller). The body is PARTIAL: the switch sends `{ enabled }` and the
// threshold sends `{ thresholdPct }`, so neither control can clobber the
// other's field. See the route for why that beats a full-state PUT.
//
// NOTHING IS SEEDED OR CLEARED ON ANY EDGE. Enabling does not send a catch-up
// alert, disabling does not delete this month's PaceAlertLog rows, and moving
// the threshold does not re-open a month a store has already alerted in — the
// lock is keyed on store-month and knows nothing about the number.

export function PaceAlertsToggle({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const res = await fetch("/api/pace-alerts/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    if (!res?.ok) setEnabled(!next)
    setBusy(false)
    router.refresh() // the card's own Enabled/Disabled badge follows the flag
  }

  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable behind-pace alert emails" />
    </label>
  )
}

// ─── NOTIFY-2a: the per-org threshold (F1, Gary 2026-09-20) ──────────────────
// BLANK IS A LEGITIMATE VALUE AND IT IS THE DEFAULT, not an unfilled form. It
// stores NULL and the cron falls back to the deployment's own default, which is
// what every org does today. So this field has three states, not two — a
// number, blank-meaning-fall-back, and the invalid text in between — and the
// Save button is the only thing that writes.
//
// SAVE BUTTON RATHER THAN THE SWITCH'S OPTIMISTIC WRITE, deliberately: a
// half-typed "7" on the way to "75" is a valid integer and would have been
// saved by a debounced field, silently taking the org to a threshold that
// alerts on nothing.

// THE DEFAULT IS PASSED IN, NOT HARDCODED "90%". Blank falls back to
// paceThresholdPct(), which reads PACE_ALERT_THRESHOLD_PCT and only then
// defaults to 90 — so a deployment that sets the variable would make a
// hardcoded "(90%)" a lie on the one screen whose job is to say what the
// number is. The variable is unset in every environment today, so this renders
// "90%" exactly as specified; it just stays true if that changes.
export function PaceAlertThresholdField({
  thresholdPct,
  defaultPct,
}: {
  thresholdPct: number | null
  defaultPct: number
}) {
  const router = useRouter()
  const defaultLabel = `${defaultPct}%`
  const initial = thresholdPct === null ? "" : String(thresholdPct)
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const dirty = value.trim() !== saved.trim()

  async function save() {
    const raw = value.trim()
    // Parsed here so a blank becomes an explicit null rather than an omitted
    // field — the route reads `undefined` as "leave it alone" and `null` as
    // "clear it", and those must not collapse into each other on the wire.
    let next: number | null
    if (raw === "") {
      next = null
    } else if (/^\d+$/.test(raw)) {
      next = Number(raw)
    } else {
      setError("Use a whole number between 50 and 100, or leave it blank.")
      setDone(false)
      return
    }

    setBusy(true)
    setError(null)
    setDone(false)
    const res = await fetch("/api/pace-alerts/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thresholdPct: next }),
    }).catch(() => null)

    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? "Could not save. Try again.")
      setBusy(false)
      return
    }

    // Re-render from what was STORED, on HrAckRecipientsField's reasoning: the
    // field should show the row, never the keystrokes.
    const body = (await res.json().catch(() => null)) as { thresholdPct?: number | null } | null
    const stored = body?.thresholdPct ?? null
    const shown = stored === null ? "" : String(stored)
    setValue(shown)
    setSaved(shown)
    setDone(true)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="p-4 border border-[var(--color-border)] rounded-lg mt-4">
      <h3 className="font-medium text-[var(--color-foreground)]">Alert threshold</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        Alert when month-to-date sales fall below this percentage of the month-to-date goal. Leave
        blank to use the default ({defaultLabel}).
      </p>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex items-center gap-1.5">
          <Input
            className="w-24"
            type="number"
            inputMode="numeric"
            min={50}
            max={100}
            step={1}
            value={value}
            disabled={busy}
            placeholder="90"
            aria-label="Alert threshold percentage"
            onChange={(e) => {
              setValue(e.target.value)
              setDone(false)
              setError(null)
            }}
          />
          <span className="text-sm text-[var(--color-muted-foreground)]">%</span>
        </div>
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        {!error && done && <span className="text-sm text-[var(--color-success-text)]">Saved</span>}
        {!error && !done && saved.trim() === "" && (
          <span className="text-sm text-[var(--color-muted-foreground)]">
            Using the default ({defaultLabel}).
          </span>
        )}
      </div>
    </div>
  )
}
