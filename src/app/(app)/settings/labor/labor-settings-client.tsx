"use client"

import { useState } from "react"
import { Pencil, Trash2, Plus, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

type Denominator = "IN_STORE" | "TOTAL_WITH_DELIVERY"
type PayType = "HOURLY" | "SALARIED"

type Settings = {
  laborTargetPct: number
  roundingIncrement: number
  denominator: Denominator
  plannedBlendedRate: number | null
}

type Position = {
  id: string
  name: string
  payType: PayType
  defaultHourlyRate: number
  impliedWeeklyHours: number | null
  isSupervisory: boolean
  sortOrder: number
  active: boolean
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── Component ────────────────────────────────────────────────────────────────

export function LaborSettingsClient({
  initialSettings,
  initialPositions,
}: {
  initialSettings: Settings
  initialPositions: Position[]
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      <SettingsCard initial={initialSettings} />
      <PositionsCard initial={initialPositions} />
    </div>
  )
}

// ─── Settings card ────────────────────────────────────────────────────────────

function SettingsCard({ initial }: { initial: Settings }) {
  const [targetPct, setTargetPct] = useState(String(initial.laborTargetPct))
  const [rounding, setRounding] = useState(String(initial.roundingIncrement))
  const [denominator, setDenominator] = useState<Denominator>(initial.denominator)
  const [blended, setBlended] = useState(initial.plannedBlendedRate == null ? "" : String(initial.plannedBlendedRate))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    const pct = Number(targetPct)
    const inc = Number(rounding)
    const blendedNum = blended.trim() === "" ? null : Number(blended)
    if (!(pct > 0 && pct <= 100) || !(inc > 0) || (blendedNum !== null && !(blendedNum > 0))) {
      setMsg("Check the values: target 0–100%, rounding and blended rate must be positive.")
      return
    }
    setSaving(true)
    setMsg(null)
    const res = await fetch("/api/labor/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        laborTargetPct: pct,
        roundingIncrement: inc,
        denominator,
        plannedBlendedRate: blendedNum,
      }),
    }).catch(() => null)
    setSaving(false)
    setMsg(res?.ok ? "Saved." : "Couldn’t save — try again.")
  }

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <h2 className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">Budget settings</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          The org default. Per-store overrides come in a later phase.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="targetPct">Labor target (%)</Label>
            <Input
              id="targetPct"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={targetPct}
              onChange={(e) => setTargetPct(e.target.value)}
            />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Labor cost as a share of sales.</p>
          </div>

          <div>
            <Label htmlFor="rounding">Rounding increment ($)</Label>
            <Input
              id="rounding"
              type="number"
              min="0"
              step="1"
              value={rounding}
              onChange={(e) => setRounding(e.target.value)}
            />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Projected sales round down to this tier (conservative).
            </p>
          </div>

          <div>
            <Label htmlFor="denominator">Labor-% denominator</Label>
            <Select value={denominator} onValueChange={(v) => setDenominator(v as Denominator)}>
              <SelectTrigger id="denominator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TOTAL_WITH_DELIVERY">Total sales (incl. delivery)</SelectItem>
                <SelectItem value="IN_STORE">In-store sales only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Which sales the target % is measured against.</p>
          </div>

          <div>
            <Label htmlFor="blended">Blended hourly rate ($, optional)</Label>
            <Input
              id="blended"
              type="number"
              min="0"
              step="0.01"
              placeholder="Computed from positions if blank"
              value={blended}
              onChange={(e) => setBlended(e.target.value)}
            />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
              Override the average hourly rate used to convert dollars to hours.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {msg && <span className="text-sm text-[var(--color-muted-foreground)]">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Positions card ───────────────────────────────────────────────────────────

const BLANK_POSITION: Omit<Position, "id"> = {
  name: "",
  payType: "HOURLY",
  defaultHourlyRate: 0,
  impliedWeeklyHours: null,
  isSupervisory: false,
  sortOrder: 0,
  active: true,
}

function PositionsCard({ initial }: { initial: Position[] }) {
  const [positions, setPositions] = useState<Position[]>(initial)
  const [editing, setEditing] = useState<Position | Omit<Position, "id"> | null>(null)
  const [deleting, setDeleting] = useState<Position | null>(null)

  function upsertLocal(p: Position) {
    setPositions((prev) => {
      const next = prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]
      return next.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    })
  }

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-bold text-[var(--color-foreground)]">Positions (rate legend)</h2>
          <Button size="sm" onClick={() => setEditing({ ...BLANK_POSITION, sortOrder: positions.length })}>
            <Plus className="h-4 w-4 mr-1" /> Add position
          </Button>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          Default rates by role. Salaried positions carry implied weekly hours; hourly positions leave it blank.
        </p>

        {positions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6 text-center">
            No positions yet — add your first role to build the rate legend.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Pay</th>
                  <th className="py-2 pr-3 font-semibold">Rate</th>
                  <th className="py-2 pr-3 font-semibold">Wk hrs</th>
                  <th className="py-2 pr-3 font-semibold">Sup.</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-0 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-[var(--color-foreground)]">
                      {p.name}
                      {!p.active && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">(inactive)</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--color-muted-foreground)]">
                      {p.payType === "SALARIED" ? "Salaried" : "Hourly"}
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--color-foreground)]">{usd(p.defaultHourlyRate)}/hr</td>
                    <td className="py-2.5 pr-3 text-[var(--color-muted-foreground)]">{p.impliedWeeklyHours ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      {p.isSupervisory ? (
                        <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" aria-label="Supervisory" />
                      ) : (
                        <span className="text-[var(--color-muted-foreground)]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={p.active ? "text-[var(--color-success-text)]" : "text-[var(--color-muted-foreground)]"}>
                        {p.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(p)}
                        className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]"
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleting(p)}
                        className="p-1.5 rounded hover:bg-red-50 text-[var(--color-destructive)]"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {editing && (
        <PositionDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            upsertLocal(p)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeletePositionDialog
          position={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setPositions((prev) => prev.filter((x) => x.id !== id))
            setDeleting(null)
          }}
        />
      )}
    </Card>
  )
}

// ─── Add/edit dialog ──────────────────────────────────────────────────────────

function hasId(p: Position | Omit<Position, "id">): p is Position {
  return "id" in p && typeof (p as Position).id === "string"
}

function PositionDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Position | Omit<Position, "id">
  onClose: () => void
  onSaved: (p: Position) => void
}) {
  const editingId = hasId(initial) ? initial.id : null
  const [name, setName] = useState(initial.name)
  const [payType, setPayType] = useState<PayType>(initial.payType)
  const [rate, setRate] = useState(initial.defaultHourlyRate ? String(initial.defaultHourlyRate) : "")
  const [weeklyHours, setWeeklyHours] = useState(initial.impliedWeeklyHours == null ? "" : String(initial.impliedWeeklyHours))
  const [supervisory, setSupervisory] = useState(initial.isSupervisory)
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder))
  const [active, setActive] = useState(initial.active)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    const rateNum = Number(rate)
    const hoursNum = weeklyHours.trim() === "" ? null : Number(weeklyHours)
    if (name.trim() === "" || !(rateNum > 0)) {
      setErr("Name and a positive rate are required.")
      return
    }
    if (hoursNum !== null && !(Number.isInteger(hoursNum) && hoursNum > 0 && hoursNum <= 168)) {
      setErr("Weekly hours must be a whole number between 1 and 168 (or blank).")
      return
    }
    setSaving(true)
    setErr(null)
    const body = {
      name: name.trim(),
      payType,
      defaultHourlyRate: rateNum,
      impliedWeeklyHours: hoursNum,
      isSupervisory: supervisory,
      sortOrder: Number(sortOrder) || 0,
      active,
    }
    const res = await fetch(editingId ? `/api/labor/positions/${editingId}` : "/api/labor/positions", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      setErr("Couldn’t save — try again.")
      return
    }
    onSaved((await res.json()) as Position)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit position" : "Add position"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div>
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team Member" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="p-pay">Pay type</Label>
              <Select value={payType} onValueChange={(v) => setPayType(v as PayType)}>
                <SelectTrigger id="p-pay">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="SALARIED">Salaried</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-rate">Default hourly rate ($)</Label>
              <Input id="p-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="p-hours">Implied weekly hours</Label>
              <Input
                id="p-hours"
                type="number"
                min="1"
                max="168"
                step="1"
                placeholder={payType === "SALARIED" ? "e.g. 40" : "Blank for hourly"}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="p-sort">Sort order</Label>
              <Input id="p-sort" type="number" min="0" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2">
            <Label htmlFor="p-sup" className="cursor-pointer">Supervisory role</Label>
            <Switch id="p-sup" checked={supervisory} onCheckedChange={setSupervisory} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2">
            <Label htmlFor="p-active" className="cursor-pointer">Active</Label>
            <Switch id="p-active" checked={active} onCheckedChange={setActive} />
          </div>

          {err && <p className="text-sm text-[var(--color-destructive)]">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add position"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeletePositionDialog({
  position,
  onClose,
  onDeleted,
}: {
  position: Position
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const res = await fetch(`/api/labor/positions/${position.id}`, { method: "DELETE" }).catch(() => null)
    setBusy(false)
    if (res?.ok) onDeleted(position.id)
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{position.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the position from the rate legend. This can’t be undone. To keep history, mark it inactive
            instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirm()
            }}
            disabled={busy}
            className="bg-[var(--color-destructive)] hover:opacity-90"
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
