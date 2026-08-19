"use client"

import { useState, useEffect, useCallback } from "react"
import { Pencil, Trash2, Plus, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SplitPolicyInfo } from "@/components/labor/split-policy-info"
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

type PayType = "HOURLY" | "SALARIED"

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
  initialPositions,
  stores,
  showRoster = false,
}: {
  initialPositions: Position[]
  stores: { id: string; name: string }[]
  /// AL-3. True only when the Advanced Labor overlay is on AND the viewer holds
  /// labor.costs.view. False makes PositionsCard render exactly as it did before
  /// AL-3 — the segmented control is not mounted and no roster fetch is issued.
  showRoster?: boolean
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      <SettingsCard stores={stores} />
      <PositionsCard initial={initialPositions} stores={stores} showRoster={showRoster} />
      <DaySplitCard stores={stores} />
      <DaypartsCard />
    </div>
  )
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// ─── Day-split weights (per store) ─────────────────────────────────────────────

function DaySplitCard({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [weights, setWeights] = useState<string[]>(Array(7).fill(""))
  const [isOverride, setIsOverride] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadSplit = useCallback((sid: string) => {
    if (!sid) return
    setLoading(true)
    fetch(`/api/labor/day-split?storeId=${sid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.weights) {
          setWeights(d.weights.map((w: number) => ((w / 100).toFixed(1))))
          setIsOverride(!!d.isOverride)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadSplit(storeId)
  }, [storeId, loadSplit])

  const pctSum = weights.reduce((s, w) => s + (Number(w) || 0), 0)

  async function save() {
    // Inputs are percents (one decimal); convert to basis points.
    const bps = weights.map((w) => Math.round((Number(w) || 0) * 100))
    const total = bps.reduce((s, w) => s + w, 0)
    if (total === 0) return setMsg("Weights can’t all be zero.")
    setSaving(true)
    setMsg(null)
    const res = await fetch("/api/labor/day-split", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, weights: bps }),
    }).catch(() => null)
    setSaving(false)
    if (res?.ok) {
      setIsOverride(true)
      setMsg("Saved.")
    } else setMsg("Couldn’t save — try again.")
  }

  async function resetToSales() {
    setSaving(true)
    const res = await fetch(`/api/labor/day-split?storeId=${storeId}`, { method: "DELETE" }).catch(() => null)
    setSaving(false)
    if (res?.ok) {
      const d = await res.json()
      setWeights(d.weights.map((w: number) => (w / 100).toFixed(1)))
      setIsOverride(false)
      setMsg("Reset to sales-derived.")
    }
  }

  if (stores.length === 0) return null

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <h2 className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">Weekly → daily split</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          How the week’s hourly hours spread across days (percent of the week). Defaults come from recent sales; edit to override.
          Salaried hours aren’t split — they’re a weekly constant.
        </p>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {stores.length > 1 && (
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className={`text-xs font-medium ${isOverride ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"}`}>
            {isOverride ? "Manual override" : "Sales-derived"}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((wd, i) => (
            <div key={wd}>
              <Label className="text-xs">{wd}</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={weights[i]}
                disabled={loading}
                onChange={(e) => setWeights((prev) => prev.map((w, j) => (j === i ? e.target.value : w)))}
                className="px-2"
              />
            </div>
          ))}
        </div>
        <p className={`text-xs mt-2 ${Math.abs(pctSum - 100) > 0.5 ? "text-[var(--color-warning)]" : "text-[var(--color-muted-foreground)]"}`}>
          Sum: {pctSum.toFixed(1)}% {Math.abs(pctSum - 100) > 0.5 ? "(will be normalized to 100%)" : ""}
        </p>

        <div className="flex items-center gap-3 mt-4">
          <Button onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save split"}</Button>
          <Button variant="outline" onClick={resetToSales} disabled={saving || loading}>Reset to sales-derived</Button>
          {msg && <span className="text-sm text-[var(--color-muted-foreground)]">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Settings card ────────────────────────────────────────────────────────────

const minToTimeOrBlank = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)
const timeToMinOrNull = (t: string) => {
  if (!t.trim()) return null
  const [h, m] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

function SettingsCard({ stores }: { stores: { id: string; name: string }[] }) {
  const [scope, setScope] = useState<string>("org") // "org" or a storeId
  const [targetPct, setTargetPct] = useState("20")
  const [rounding, setRounding] = useState("1000")
  const [blended, setBlended] = useState("")
  const [gmStart, setGmStart] = useState("")
  const [gmEnd, setGmEnd] = useState("")
  const [splitPolicy, setSplitPolicy] = useState<"FLOOR_FIRST" | "SALES_WEIGHTED">("FLOOR_FIRST")
  const [hasOverride, setHasOverride] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback((sc: string) => {
    setLoading(true)
    setMsg(null)
    const q = sc === "org" ? "" : `?storeId=${sc}`
    fetch(`/api/labor/settings${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setTargetPct(String(d.laborTargetPct))
        setRounding(String(d.roundingIncrement))
        setBlended(d.plannedBlendedRate == null ? "" : String(d.plannedBlendedRate))
        setGmStart(minToTimeOrBlank(d.gmOnFloorStartMinutes))
        setGmEnd(minToTimeOrBlank(d.gmOnFloorEndMinutes))
        setSplitPolicy(d.dailySplitPolicy === "SALES_WEIGHTED" ? "SALES_WEIGHTED" : "FLOOR_FIRST")
        setHasOverride(!!d.hasOverride)
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(scope), [scope, load])

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
        storeId: scope === "org" ? null : scope,
        laborTargetPct: pct,
        roundingIncrement: inc,
        plannedBlendedRate: blendedNum,
        gmOnFloorStartMinutes: timeToMinOrNull(gmStart),
        gmOnFloorEndMinutes: timeToMinOrNull(gmEnd),
        dailySplitPolicy: splitPolicy,
      }),
    }).catch(() => null)
    setSaving(false)
    if (res?.ok) {
      setHasOverride(true)
      setMsg("Saved.")
    } else setMsg("Couldn’t save — try again.")
  }

  async function revert() {
    setSaving(true)
    const res = await fetch(`/api/labor/settings?storeId=${scope}`, { method: "DELETE" }).catch(() => null)
    setSaving(false)
    if (res?.ok) {
      load(scope)
      setMsg("Reverted to org default.")
    }
  }

  const isStore = scope !== "org"

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-[15px] font-bold text-[var(--color-foreground)]">Budget settings</h2>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="org">Organization default</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          {isStore
            ? hasOverride
              ? "This store overrides the org default."
              : "This store currently inherits the org default — saving creates an override."
            : "The organization default, inherited by every store without its own override."}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="targetPct">Labor target (%)</Label>
            <Input id="targetPct" type="number" min="0" max="100" step="0.01" value={targetPct} disabled={loading} onChange={(e) => setTargetPct(e.target.value)} />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Labor cost as a share of sales.</p>
          </div>
          <div>
            <Label htmlFor="rounding">Rounding increment ($)</Label>
            <Input id="rounding" type="number" min="0" step="1" value={rounding} disabled={loading} onChange={(e) => setRounding(e.target.value)} />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Projected sales round down to this tier (conservative).</p>
          </div>
          <div>
            <Label htmlFor="blended">Blended hourly rate ($, optional)</Label>
            <Input id="blended" type="number" min="0" step="0.01" placeholder="Computed from positions if blank" value={blended} disabled={loading} onChange={(e) => setBlended(e.target.value)} />
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Override the average hourly rate used to convert dollars to hours.</p>
          </div>
          <div>
            <Label>GM on-floor window (optional)</Label>
            <div className="flex items-center gap-2">
              <Input type="time" value={gmStart} disabled={loading} onChange={(e) => setGmStart(e.target.value)} />
              <span className="text-[var(--color-muted-foreground)]">–</span>
              <Input type="time" value={gmEnd} disabled={loading} onChange={(e) => setGmEnd(e.target.value)} />
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">When the salaried GM is on the floor (counts as coverage + supervisor). Blank = open→2:00p.</p>
          </div>
        </div>

        {/* L-3: floor-first vs sales-weighted daily split */}
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Label htmlFor="splitPolicy">Daily hours split</Label>
            <SplitPolicyInfo />
          </div>
          <div className="max-w-xs">
            <Select value={splitPolicy} onValueChange={(v) => setSplitPolicy(v === "SALES_WEIGHTED" ? "SALES_WEIGHTED" : "FLOOR_FIRST")}>
              <SelectTrigger id="splitPolicy" disabled={loading}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FLOOR_FIRST">Floor-first (recommended)</SelectItem>
                <SelectItem value="SALES_WEIGHTED">Sales-weighted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
            {splitPolicy === "FLOOR_FIRST"
              ? "Each open day is guaranteed enough hours to keep one person on the floor before the rest are split by sales."
              : "Hours are split purely by sales weight — slow-but-open days may be flagged as understaffed so you can rebalance."}
          </p>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <Button onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save settings"}</Button>
          {isStore && hasOverride && (
            <Button variant="outline" onClick={revert} disabled={saving || loading}>Revert to org default</Button>
          )}
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

function PositionsCard({
  initial,
  stores,
  showRoster,
}: {
  initial: Position[]
  stores: { id: string; name: string }[]
  showRoster: boolean
}) {
  const [positions, setPositions] = useState<Position[]>(initial)
  const [editing, setEditing] = useState<Position | Omit<Position, "id"> | null>(null)
  const [deleting, setDeleting] = useState<Position | null>(null)
  // AL-3, Gary's Q3 ruling: the Square roster is the DEFAULT VIEW when the
  // overlay is on, and the legend survives one click away. Vision item 10 says
  // the roster "replaces" the legend; LITERAL REPLACEMENT WAS REJECTED because
  // LaborPosition is not a legend at all — it is the weekly budget engine's rate
  // table (labor-plan.ts:165 → computeWeeklyLaborBudget), whose blended rate is
  // the unweighted mean of active hourly rates. Measured 2026-08-19: the legend's
  // mean is $14.50 and the Square roster's is $12.36 across 94 hourly members, so
  // swapping the roster in would drop the blended rate ~15% and inflate
  // schedulable hours ~17% at the same budget — and would feed a Square-sourced
  // input into a core engine, which L-2 seam (b) forbids outright.
  const [tab, setTab] = useState<"roster" | "legend">(showRoster ? "roster" : "legend")

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
          <h2 className="text-[15px] font-bold text-[var(--color-foreground)]">
            {showRoster ? "Positions" : "Positions (rate legend)"}
          </h2>
          {tab === "legend" && (
            <Button size="sm" onClick={() => setEditing({ ...BLANK_POSITION, sortOrder: positions.length })}>
              <Plus className="h-4 w-4 mr-1" /> Add position
            </Button>
          )}
        </div>

        {showRoster && (
          <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5 mb-3 mt-2">
            {(
              [
                ["roster", "Team from Square"],
                // THE LABEL CARRIES THE RULING. Anyone who wonders why both views
                // exist reads the answer on the control itself, rather than
                // discovering it by editing the wrong table.
                ["legend", "Rate legend — drives the budget"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={
                  tab === key
                    ? "px-3 py-1 text-xs font-semibold rounded bg-[var(--color-primary)] text-white"
                    : "px-3 py-1 text-xs font-medium rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "legend" && (
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
            Default rates by role. Salaried positions carry implied weekly hours; hourly positions leave it blank.
            {showRoster && " These rows — not the Square roster — are what the weekly labor budget is built from."}
          </p>
        )}

        {tab === "roster" && <TeamRosterView stores={stores} />}

        {tab === "legend" &&
          (positions.length === 0 ? (
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
        ))}
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

// ─── AL-3: the Square team roster ─────────────────────────────────────────────
//
// Vision item 10: "lists the store's team members from Square with pay and
// current positions; positions may vary per Square; WK HRS and SUP stay
// Froot-adjustable."
//
// PER STORE, because the roster is. LaborPosition has no storeId and is org-wide;
// Square's assigned_locations are per location, so this view carries its own
// store picker. A member flagged for ALL locations appears under every store,
// which is why per-store counts can sum past the org total.
//
// MOUNTED ONLY WHEN showRoster IS TRUE, so a viewer without labor.costs.view
// never issues this fetch and the route would 403 them anyway.

type RosterRow = {
  squareTeamMemberId: string
  staffMemberId: string | null
  displayName: string | null
  jobTitle: string | null
  payType: string | null
  hourlyRate: number | null
  annualRate: number | null
  squareWeeklyHours: number | null
  weeklyHoursOverride: number | null
  isSupervisory: boolean | null
  jobAssignmentCount: number
}

type RosterPayload = {
  storeLinked: boolean
  rows: RosterRow[]
  unmatchedCount: number
  unmappedLocationCount: number
  syncedAt: string | null
}

/// Mirrors formatPay in src/lib/labor-costs.ts. NULL IS A SENTENCE, NEVER $0 —
/// the two must agree, because /staff and this card show the same person's pay.
function payText(r: RosterRow): string {
  if (r.payType === "SALARY" && r.annualRate !== null) {
    return r.annualRate.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) + "/yr"
  }
  if (r.hourlyRate !== null) return usd(r.hourlyRate) + "/hr"
  return "Not set in Square"
}

function TeamRosterView({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [data, setData] = useState<RosterPayload | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!storeId) return
      // THE FETCH IS THE FIRST STATEMENT, and no state is set before it awaits.
      // A synchronous setState from an effect body triggers a cascading render,
      // so "loading" is DERIVED below (no data and no error yet) rather than
      // stored — one fewer state, and the effect stays a pure side effect.
      try {
        const res = await fetch(`/api/square/labor/roster?storeId=${encodeURIComponent(storeId)}`, { signal })
        setErr(null)
        if (!res.ok) throw new Error(`Roster unavailable (${res.status})`)
        setData(await res.json())
      } catch (e) {
        // An aborted request is a store switch, not a failure — writing an error
        // for it would flash "Roster unavailable" every time the picker moves.
        if (e instanceof DOMException && e.name === "AbortError") return
        // SEAM (c): the overlay degrades, it never crashes the page. The rest of
        // the Labor settings — target %, rounding, the rate legend, day splits —
        // is untouched by a failure here.
        setErr(e instanceof Error ? e.message : "Roster unavailable")
        setData(null)
      }
    },
    [storeId]
  )

  // The effect fires a fetch and nothing else — every set* happens in a promise
  // callback after the request resolves, never synchronously in the body.
  //
  // THE ABORT IS THE STORE-SWITCH RACE, not tidiness: switch from Carson to
  // Sparks quickly and Carson's slower response would otherwise land last and
  // paint Carson's roster under Sparks' name.
  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  async function syncRoster() {
    setSyncing(true)
    setErr(null)
    try {
      const res = await fetch("/api/square/labor/roster/sync", { method: "POST" })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? body?.error ?? `Sync failed (${res.status})`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  async function patchRow(id: string, patch: { weeklyHoursOverride?: number | null; isSupervisory?: boolean | null }) {
    // Optimistic, then reconciled by the response — a two-field edit that has to
    // wait for a round trip to show a tick reads as broken.
    setData((prev) =>
      prev
        ? { ...prev, rows: prev.rows.map((r) => (r.squareTeamMemberId === id ? { ...r, ...patch } : r)) }
        : prev
    )
    const res = await fetch(`/api/square/labor/roster/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      setErr("Could not save that change.")
      await load()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Select
          value={storeId}
          onValueChange={(v) => {
            // Clear before switching, so the previous store's roster cannot sit
            // under the new store's name while its fetch is in flight. Done in
            // the handler rather than in an effect — same reason the abort exists.
            setData(null)
            setErr(null)
            setStoreId(v)
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select a store" />
          </SelectTrigger>
          <SelectContent>
            {stores.map((st) => (
              <SelectItem key={st.id} value={st.id}>
                {st.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={syncRoster} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync roster"}
        </Button>
        {/* THE FRESHNESS STAMP, not a health badge. There is no scheduled
            refresh for the roster (see the route comment): a wage setting moves
            when somebody gets a raise, so the stamp says when it was last read
            and the button is how it is read again. */}
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {data?.syncedAt
            ? `Synced ${new Date(data.syncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
            : "Not synced yet"}
        </span>
      </div>

      {err && <p className="text-sm text-[var(--color-destructive)] mb-3">{err}</p>}

      {!data && !err ? (
        // Skeleton, never a spinner (§ Design System).
        <div className="space-y-2 py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded bg-[var(--color-muted)] animate-pulse" />
          ))}
        </div>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)] py-6 text-center">
          {data && !data.storeLinked
            ? "This store is not linked to a Square location, so it has no Square team."
            : "No team members synced yet — use Sync roster to pull them from Square."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 font-semibold">Position (Square)</th>
                <th className="py-2 pr-3 font-semibold">Pay</th>
                <th className="py-2 pr-3 font-semibold">Wk hrs</th>
                <th className="py-2 pr-0 font-semibold">Sup.</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.squareTeamMemberId} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-[var(--color-foreground)]">
                    {r.displayName ?? (
                      <span className="text-[var(--color-muted-foreground)] italic">Not in Froot</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-[var(--color-muted-foreground)]">
                    {r.jobTitle ?? "—"}
                    {/* NO SILENT TRUNCATION. Square's job_assignments is plural;
                        measured 2026-08-19 every member carried exactly one. If
                        one ever carries two, the extra is named here rather than
                        dropped. */}
                    {r.jobAssignmentCount > 1 && (
                      <span className="ml-1 text-xs" title="Square carries more than one job for this person; the first is shown.">
                        +{r.jobAssignmentCount - 1}
                      </span>
                    )}
                  </td>
                  <td
                    className={
                      payText(r) === "Not set in Square"
                        ? "py-2.5 pr-3 text-[var(--color-warning,#efa201)]"
                        : "py-2.5 pr-3 text-[var(--color-foreground)]"
                    }
                  >
                    {payText(r)}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      className="h-7 w-20"
                      // Square's own weekly_hours is the PLACEHOLDER, never the
                      // value: showing it as a value would make an unset override
                      // indistinguishable from one that happens to match Square.
                      placeholder={r.squareWeeklyHours != null ? String(r.squareWeeklyHours) : "—"}
                      defaultValue={r.weeklyHoursOverride ?? ""}
                      onBlur={(e) => {
                        const raw = e.target.value.trim()
                        const next = raw === "" ? null : Number(raw)
                        if (next !== null && !(Number.isInteger(next) && next > 0 && next <= 168)) return
                        if (next === r.weeklyHoursOverride) return
                        void patchRow(r.squareTeamMemberId, { weeklyHoursOverride: next })
                      }}
                    />
                  </td>
                  <td className="py-2.5 pr-0">
                    <Switch
                      checked={r.isSupervisory === true}
                      onCheckedChange={(v) => void patchRow(r.squareTeamMemberId, { isSupervisory: v })}
                      aria-label={`Supervisory — ${r.displayName ?? r.squareTeamMemberId}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 space-y-1">
            {/* WK HRS AND SUP ARE INERT, AND THE CARD SAYS SO (Gary's Q9 ruling).
                Seam (b) holds: the weekly budget is built from the rate legend,
                and no core labor engine gained a Square-sourced input in this
                phase. Labelling it is what stops an operator concluding their
                edits did nothing — or worse, concluding they did something. */}
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Wk hrs and Sup. are Froot&rsquo;s own fields and are saved here, but nothing reads them yet — the weekly
              labor budget is still built from the rate legend.
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Pay is each person&rsquo;s current wage setting in Square, not what past shifts were costed at. Froot
              never writes to Square — correct a rate there and sync.
            </p>
            {data.unmatchedCount > 0 && (
              <p className="text-xs text-[var(--color-warning,#efa201)]">
                {data.unmatchedCount} in Square with no Froot staff record — run Sync from Square on the Staff page to
                import them.
              </p>
            )}
            {data.unmappedLocationCount > 0 && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {data.unmappedLocationCount} Square location
                {data.unmappedLocationCount === 1 ? " has" : "s have"} no matching store in Froot — team members
                assigned only there appear on no roster.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
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

// ─── Dayparts (org-default shift blocks + min staffing) ────────────────────────

type Daypart = {
  id: string
  name: string
  startLocalMinutes: number
  endLocalMinutes: number
  minHeadcount: number
  requiresSupervisor: boolean
  sortOrder: number
  active: boolean
}

const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}
const BLANK_DAYPART: Omit<Daypart, "id"> = {
  name: "",
  startLocalMinutes: 480,
  endLocalMinutes: 660,
  minHeadcount: 1,
  requiresSupervisor: false,
  sortOrder: 0,
  active: true,
}

function DaypartsCard() {
  const [rows, setRows] = useState<Daypart[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Daypart | Omit<Daypart, "id"> | null>(null)
  const [deleting, setDeleting] = useState<Daypart | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/labor/daypart")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Daypart[]) => setRows(d))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(), [load])

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-bold text-[var(--color-foreground)]">Shift blocks (min staffing)</h2>
          <Button size="sm" onClick={() => setEditing({ ...BLANK_DAYPART, sortOrder: rows.length })}>
            <Plus className="h-4 w-4 mr-1" /> Add block
          </Button>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          Named shift windows and whether each needs a supervisor on the floor. Headcount is demand-shaped and budget-capped — not a fixed minimum.
        </p>

        {loading ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-4 text-center">No shift blocks yet — add one to set minimum coverage.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Window</th>
                  <th className="py-2 pr-3 font-semibold">Supervisor</th>
                  <th className="py-2 pr-0 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-[var(--color-foreground)]">
                      {d.name}
                      {!d.active && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">(inactive)</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--color-muted-foreground)]">{minToTime(d.startLocalMinutes)}–{minToTime(d.endLocalMinutes)}</td>
                    <td className="py-2.5 pr-3">
                      {d.requiresSupervisor ? <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" aria-label="Requires supervisor" /> : <span className="text-[var(--color-muted-foreground)]">—</span>}
                    </td>
                    <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(d)} className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]" aria-label={`Edit ${d.name}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleting(d)} className="p-1.5 rounded hover:bg-red-50 text-[var(--color-destructive)]" aria-label={`Delete ${d.name}`}>
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
        <DaypartDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
      {deleting && (
        <AlertDialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{deleting.name}”?</AlertDialogTitle>
              <AlertDialogDescription>This removes the shift block and its minimum-staffing rule.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async (e) => {
                  e.preventDefault()
                  const res = await fetch(`/api/labor/daypart/${deleting.id}`, { method: "DELETE" }).catch(() => null)
                  if (res?.ok) {
                    setDeleting(null)
                    load()
                  }
                }}
                className="bg-[var(--color-destructive)] hover:opacity-90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  )
}

function dpHasId(d: Daypart | Omit<Daypart, "id">): d is Daypart {
  return "id" in d && typeof (d as Daypart).id === "string"
}

function DaypartDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Daypart | Omit<Daypart, "id">
  onClose: () => void
  onSaved: () => void
}) {
  const editingId = dpHasId(initial) ? initial.id : null
  const [name, setName] = useState(initial.name)
  const [start, setStart] = useState(minToTime(initial.startLocalMinutes))
  const [end, setEnd] = useState(minToTime(initial.endLocalMinutes))
  const [requiresSupervisor, setRequiresSupervisor] = useState(initial.requiresSupervisor)
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder))
  const [active, setActive] = useState(initial.active)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    const s = timeToMin(start)
    const e = timeToMin(end)
    if (name.trim() === "" || e <= s) {
      setErr("Name is required and the end must be after the start.")
      return
    }
    setSaving(true)
    setErr(null)
    const body = {
      name: name.trim(),
      startLocalMinutes: s,
      endLocalMinutes: e,
      minHeadcount: 1, // retained in the schema; no longer used by the coverage engine
      requiresSupervisor,
      sortOrder: Number(sortOrder) || 0,
      active,
    }
    const res = await fetch(editingId ? `/api/labor/daypart/${editingId}` : "/api/labor/daypart", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      setErr("Couldn’t save — try again.")
      return
    }
    onSaved()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit shift block" : "Add shift block"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label htmlFor="d-name">Name</Label>
            <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opening" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="d-start">Start</Label>
              <Input id="d-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="d-end">End</Label>
              <Input id="d-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="d-sort">Sort order</Label>
            <Input id="d-sort" type="number" min="0" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2">
            <Label htmlFor="d-sup" className="cursor-pointer">Requires a supervisor on floor</Label>
            <Switch id="d-sup" checked={requiresSupervisor} onCheckedChange={setRequiresSupervisor} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2">
            <Label htmlFor="d-active" className="cursor-pointer">Active</Label>
            <Switch id="d-active" checked={active} onCheckedChange={setActive} />
          </div>
          {err && <p className="text-sm text-[var(--color-destructive)]">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Add block"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
