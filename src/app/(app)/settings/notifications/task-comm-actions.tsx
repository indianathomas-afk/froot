"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
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

// NOTIFY-4 — interactive islands for the Tasks and Communication card on
// /settings/notifications. Every control writes PUT /api/task-comm/settings
// with ONLY its own fields (partial body), so no control can clobber
// another's — the pace card's pattern.

type Saved = {
  enabled: boolean
  sendToAdmins: boolean
  sendToManagers: boolean
  thresholdPct: number | null
  subject: string | null
  body: string | null
}

async function put(fields: Partial<Saved>): Promise<{ ok: true; row: Saved } | { ok: false; error: string }> {
  const res = await fetch("/api/task-comm/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }).catch(() => null)
  const body = (await res?.json().catch(() => null)) as (Saved & { error?: string }) | null
  if (!res?.ok || !body) return { ok: false, error: body?.error ?? "Could not save. Try again." }
  return { ok: true, row: body }
}

export function TaskCommToggle({ enabled: initial }: { enabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initial)
  const [busy, setBusy] = useState(false)
  async function toggle(next: boolean) {
    setEnabled(next) // optimistic — reverted if the request fails
    setBusy(true)
    const r = await put({ enabled: next })
    if (!r.ok) setEnabled(!next)
    setBusy(false)
    router.refresh()
  }
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] shrink-0">
      {enabled ? "On" : "Off"}
      <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label="Enable the Tasks and Communication email" />
    </label>
  )
}

/** F2 (Gary): "Admins and Managers only, both on by default. No Store logins option." */
export function TaskCommRoleBoxes({ sendToAdmins, sendToManagers }: { sendToAdmins: boolean; sendToManagers: boolean }) {
  const router = useRouter()
  const [admins, setAdmins] = useState(sendToAdmins)
  const [managers, setManagers] = useState(sendToManagers)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(field: "sendToAdmins" | "sendToManagers", next: boolean) {
    const set = field === "sendToAdmins" ? setAdmins : setManagers
    set(next)
    setBusy(true)
    setError(null)
    const r = await put({ [field]: next })
    if (!r.ok) {
      set(!next)
      setError(r.error)
    }
    setBusy(false)
    router.refresh()
  }
  return (
    <div className="p-4 border border-[var(--color-border)] rounded-lg mt-4">
      <h3 className="font-medium text-[var(--color-foreground)]">Send to</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        Admins see every store. Managers see only their assigned stores. To reach a store&apos;s own mailbox, add it as a
        contact and pick it under &quot;Also send to&quot;.
      </p>
      <div className="flex flex-wrap gap-6 mt-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)] min-h-11">
          <Checkbox checked={admins} disabled={busy} onCheckedChange={(v) => save("sendToAdmins", v === true)} />
          Admins
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)] min-h-11">
          <Checkbox checked={managers} disabled={busy} onCheckedChange={(v) => save("sendToManagers", v === true)} />
          Managers
        </label>
      </div>
      {error && <p className="text-sm text-[var(--color-destructive)] mt-2">{error}</p>}
    </div>
  )
}

/** F9 (Gary): "adjustable on the card, integer 50–100, default 90." Blank = the default. */
export function TaskCommThresholdField({ thresholdPct, defaultPct }: { thresholdPct: number | null; defaultPct: number }) {
  const router = useRouter()
  const initial = thresholdPct === null ? "" : String(thresholdPct)
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const dirty = value.trim() !== saved.trim()

  async function save() {
    const raw = value.trim()
    let next: number | null
    if (raw === "") next = null
    else if (/^\d+$/.test(raw) && Number(raw) >= 50 && Number(raw) <= 100) next = Number(raw)
    else {
      setError("Use a whole number between 50 and 100, or leave it blank.")
      setDone(false)
      return
    }
    setBusy(true)
    setError(null)
    setDone(false)
    const r = await put({ thresholdPct: next })
    if (!r.ok) {
      setError(r.error)
      setBusy(false)
      return
    }
    const shown = r.row.thresholdPct === null ? "" : String(r.row.thresholdPct)
    setValue(shown)
    setSaved(shown)
    setDone(true)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="p-4 border border-[var(--color-border)] rounded-lg mt-4">
      <h3 className="font-medium text-[var(--color-foreground)]">Completion threshold</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        Stores whose daily checklist completion falls below this percentage are listed first and flagged. Leave blank to
        use the default ({defaultPct}%).
      </p>
      <div className="flex flex-wrap items-center gap-3 mt-3">
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
            placeholder={String(defaultPct)}
            aria-label="Completion threshold percentage"
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
          <span className="text-sm text-[var(--color-muted-foreground)]">Using the default ({defaultPct}%).</span>
        )}
      </div>
    </div>
  )
}

/**
 * F5 (Gary: "Approved."). Plain text only; subject ≤ 120, body ≤ 1,000; blank =
 * the default text; "Reset to default" clears both, behind a confirmation.
 */
export function TaskCommCopyFields({
  subject,
  body,
  defaultSubject,
  defaultBody,
  subjectMax,
  bodyMax,
}: {
  subject: string | null
  body: string | null
  defaultSubject: string
  defaultBody: string
  subjectMax: number
  bodyMax: number
}) {
  const router = useRouter()
  const [s, setS] = useState(subject ?? "")
  const [b, setB] = useState(body ?? "")
  const [savedS, setSavedS] = useState(subject ?? "")
  const [savedB, setSavedB] = useState(body ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const dirty = s !== savedS || b !== savedB
  const customised = savedS.trim() !== "" || savedB.trim() !== ""

  async function write(fields: { subject: string | null; body: string | null }) {
    setBusy(true)
    setError(null)
    setDone(false)
    const r = await put(fields)
    if (!r.ok) {
      setError(r.error)
      setBusy(false)
      return
    }
    setS(r.row.subject ?? "")
    setB(r.row.body ?? "")
    setSavedS(r.row.subject ?? "")
    setSavedB(r.row.body ?? "")
    setDone(true)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="p-4 border border-[var(--color-border)] rounded-lg mt-4">
      <h3 className="font-medium text-[var(--color-foreground)]">Subject and introduction</h3>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        Plain text. Leave a field blank to use the default wording shown in it.
      </p>
      <label className="block text-sm font-medium text-[var(--color-foreground)] mt-3" htmlFor="taskcomm-subject">
        Subject
      </label>
      <Input
        id="taskcomm-subject"
        className="mt-1"
        value={s}
        maxLength={subjectMax}
        disabled={busy}
        placeholder={defaultSubject}
        onChange={(e) => {
          setS(e.target.value)
          setDone(false)
        }}
      />
      <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
        {s.length}/{subjectMax}
      </p>
      <label className="block text-sm font-medium text-[var(--color-foreground)] mt-3" htmlFor="taskcomm-body">
        Introduction
      </label>
      <Textarea
        id="taskcomm-body"
        className="mt-1 min-h-28"
        value={b}
        maxLength={bodyMax}
        disabled={busy}
        placeholder={defaultBody}
        onChange={(e) => {
          setB(e.target.value)
          setDone(false)
        }}
      />
      <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
        {b.length}/{bodyMax}
      </p>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <Button size="sm" onClick={() => write({ subject: s, body: b })} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy || (!customised && !dirty)}>
              Reset to default
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the subject and introduction?</AlertDialogTitle>
              <AlertDialogDescription>
                Both go back to the default wording. Your edited text is discarded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => write({ subject: null, body: null })}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {error && <span className="text-sm text-[var(--color-destructive)]">{error}</span>}
        {!error && done && <span className="text-sm text-[var(--color-success-text)]">Saved</span>}
      </div>
    </div>
  )
}
