"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { CloudDownload, FileSpreadsheet, Pencil, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ─── Types (mirror /api/forecasting/*) ────────────────────────────────────────

type BasisType = "SQUARE_LAST_YEAR" | "IMPORT" | "MANUAL"

type PlanMeta = {
  id: string
  basisType: BasisType
  basisTotal: number
  increasePct: number
  goalTotal: number
}

type CalendarDay = {
  date: string
  basis: number
  goal: number
  isOverride: boolean
  actual: number | null
}

type CalendarData = {
  plan: PlanMeta | null
  today: string
  canEdit: boolean
  days: CalendarDay[]
}

// Live Square balancing report (mirrors /api/forecasting/day-report).
type DayReport = {
  date: string
  orderCount: number
  netSales: number
  grossSales: number
  discounts: number
  tax: number
  tips: number
  totalCollected: number
  tenders: { type: string; label: string; amount: number }[]
  delivery: { netSales: number; orders: number }
  inStore: { netSales: number; orders: number }
}

type BasisInfo = {
  basisTotal: number
  totalDays: number
  alignedDays: number
  fallbackDays: number
  uncoveredDays: number
  squareLinked: boolean
}

type ImportPreview = {
  shape: "daily" | "monthly"
  rowCount: number
  basisTotal: number
  goalTotal: number
  months: { month: string; total: number }[]
  warnings: string[]
  errors: string[]
  committed: boolean
}

const usd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"]

// Persisted store selection — same external-store pattern as the dashboard.
const STORE_KEY = "froot.forecasting.store"
const STORE_EVENT = "froot-forecasting-store"

function subscribeStoreKey(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(STORE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(STORE_EVENT, callback)
  }
}

function useSavedStoreId(): string | null {
  return useSyncExternalStore(
    subscribeStoreKey,
    () => localStorage.getItem(STORE_KEY),
    () => null
  )
}

function saveStoreId(id: string) {
  localStorage.setItem(STORE_KEY, id)
  window.dispatchEvent(new Event(STORE_EVENT))
}

// ─── Page component ───────────────────────────────────────────────────────────

export function ForecastingClient({
  stores,
  isAdmin,
  squareConnected,
  currentYear,
}: {
  stores: { id: string; name: string; squareLinked: boolean }[]
  isAdmin: boolean
  squareConnected: boolean
  currentYear: number
}) {
  const savedStoreId = useSavedStoreId()
  const storeId = stores.find((s) => s.id === savedStoreId)?.id ?? stores[0]?.id ?? ""
  const setStoreId = saveStoreId
  const [year, setYear] = useState(currentYear)
  const [result, setResult] = useState<{ key: string; data: CalendarData | null } | null>(null)
  const [loadKey, setLoadKey] = useState(0) // bump to refetch

  const reload = useCallback(() => setLoadKey((k) => k + 1), [])

  const viewKey = `${storeId}|${year}`
  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    const key = `${storeId}|${year}`
    fetch(`/api/forecasting/calendar?storeId=${storeId}&year=${year}`)
      .then((r): Promise<CalendarData | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((d) => {
        if (!cancelled) setResult({ key, data: d })
      })
      .catch(() => {
        if (!cancelled) setResult({ key, data: null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, year, loadKey])

  // Stale results for a different store/year render as loading; a same-view
  // reload keeps showing current data until the fresh copy lands.
  const calendar = result?.key === viewKey ? result.data : null

  const store = stores.find((s) => s.id === storeId)
  const years = [currentYear - 1, currentYear, currentYear + 1]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Forecasting</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Annual sales goals by day{store ? ` · ${store.name}` : ""}
            {!isAdmin && " · read-only"}
          </p>
        </div>
        <div className="flex gap-2">
          {stores.length > 1 && (
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        <div className="w-full lg:w-[320px] shrink-0">
          {isAdmin ? (
            <GoalSettingsPanel
              key={`${viewKey}|${calendar?.plan?.id ?? "none"}`}
              storeId={storeId}
              year={year}
              plan={calendar?.plan ?? null}
              squareLinked={!!store?.squareLinked && squareConnected}
              onSaved={reload}
            />
          ) : (
            <PlanSummaryCard plan={calendar?.plan ?? null} year={year} />
          )}
        </div>
        <div className="flex-1 min-w-[300px]">
          <YearCalendar storeId={storeId} year={year} calendar={calendar} onChanged={reload} />
        </div>
      </div>
    </div>
  )
}

// ─── Read-only plan summary (managers) ────────────────────────────────────────

function PlanSummaryCard({ plan, year }: { plan: PlanMeta | null; year: number }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-2">
        <p className="text-[15px] font-bold text-[var(--color-foreground)]">Goal Settings</p>
        {plan ? (
          <>
            <SummaryRow label="Basis" value={basisLabel(plan.basisType)} />
            <SummaryRow label={`${year - 1} basis total`} value={usd(plan.basisTotal, 2)} />
            <SummaryRow label="Increase" value={`${plan.increasePct}%`} />
            <SummaryRow label={`${year} sales goal`} value={usd(plan.goalTotal, 2)} bold />
          </>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No goal plan for {year} yet — an admin can create one.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className={cn("text-[var(--color-foreground)]", bold && "font-bold")}>{value}</span>
    </div>
  )
}

function basisLabel(t: BasisType) {
  return t === "SQUARE_LAST_YEAR" ? "Last year's Square sales" : t === "IMPORT" ? "Imported file" : "Manual"
}

// ─── Goal Settings panel (admins) ─────────────────────────────────────────────

function GoalSettingsPanel({
  storeId,
  year,
  plan,
  squareLinked,
  onSaved,
}: {
  storeId: string
  year: number
  plan: PlanMeta | null
  squareLinked: boolean
  onSaved: () => void
}) {
  // The panel is keyed on (store, year, plan id) by its parent, so these
  // initializers re-run whenever a different plan loads — no adopt-effect.
  const [basisType, setBasisType] = useState<BasisType>(plan?.basisType ?? "SQUARE_LAST_YEAR")
  const [increasePct, setIncreasePct] = useState<string>(plan ? String(plan.increasePct) : "0")
  const [applyScope, setApplyScope] = useState<"all" | "remaining">("all")
  const [resetOverrides, setResetOverrides] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // LY basis info + backfill.
  const [basis, setBasis] = useState<BasisInfo | null>(null)
  const [backfill, setBackfill] = useState<{ running: boolean; covered: number; total: number; error?: string } | null>(null)

  const loadBasis = useCallback(() => {
    if (!storeId) return
    fetch(`/api/forecasting/basis?storeId=${storeId}&year=${year}`)
      .then((r): Promise<BasisInfo | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then(setBasis)
      .catch(() => setBasis(null))
  }, [storeId, year])

  useEffect(() => {
    loadBasis()
  }, [loadBasis])

  async function runBackfill() {
    setBackfill({ running: true, covered: 0, total: 0 })
    // Chunked, resumable: each call syncs ~2 weeks; loop until done. A chunk
    // that times out or hits a Square hiccup is retried with backoff before
    // giving up — and even a hard stop loses nothing (re-running resumes).
    let lastProgress = { covered: 0, total: 0 }
    for (let i = 0; i < 80; i++) {
      let data: { done?: boolean; coveredDays: number; totalDays: number; error?: string } | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch("/api/forecasting/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeId, year }),
          })
          const body = await res.json()
          if (!res.ok) throw new Error(body.error ?? "Backfill failed")
          data = body
          break
        } catch (e) {
          if (attempt === 3) {
            setBackfill({
              ...lastProgress,
              running: false,
              error: `${e instanceof Error ? e.message : "Backfill failed"} — click to resume where it left off.`,
            })
            loadBasis()
            return
          }
          await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
      }
      if (!data) return
      lastProgress = { covered: data.coveredDays, total: data.totalDays }
      setBackfill({ running: !data.done, ...lastProgress })
      if (data.done) break
    }
    loadBasis()
  }

  // Force re-sync: re-pull every cached day (basis + actuals) so a corrected
  // sync formula reaches existing data. Cursor-driven, chunked, resumable.
  const [resync, setResync] = useState<{ running: boolean; pct: number; error?: string; done?: boolean } | null>(null)
  async function runResync() {
    setResync({ running: true, pct: 0 })
    let cursor: string | null = null
    for (let i = 0; i < 120; i++) {
      let data: { done?: boolean; coveredDays: number; totalDays: number; nextCursor: string | null; error?: string } | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch("/api/forecasting/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeId, year, force: true, ...(cursor ? { cursor } : {}) }),
          })
          const body = await res.json()
          if (!res.ok) throw new Error(body.error ?? "Re-sync failed")
          data = body
          break
        } catch (e) {
          if (attempt === 3) {
            setResync({ running: false, pct: 0, error: e instanceof Error ? e.message : "Re-sync failed" })
            loadBasis()
            return
          }
          await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
      }
      if (!data) return
      const pct = data.totalDays > 0 ? Math.round((data.coveredDays / data.totalDays) * 100) : 100
      setResync({ running: !data.done, pct })
      cursor = data.nextCursor
      if (data.done) {
        setResync({ running: false, pct: 100, done: true })
        break
      }
    }
    loadBasis()
    onSaved() // refresh the calendar with corrected actuals
  }

  // Import state.
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importing, setImporting] = useState(false)

  async function submitImport(commit: boolean) {
    if (!file) return
    setImporting(true)
    setError(null)
    const form = new FormData()
    form.set("file", file)
    form.set("storeId", storeId)
    form.set("year", String(year))
    form.set("increasePct", increasePct || "0")
    form.set("commit", commit ? "1" : "0")
    try {
      const res = await fetch("/api/forecasting/import", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok && !data.months) {
        setError(data.error ?? "Import failed")
        setPreview(null)
      } else {
        setPreview(data)
        if (data.committed) {
          setFile(null)
          onSaved()
        }
      }
    } catch {
      setError("Import failed — try again.")
    }
    setImporting(false)
  }

  async function savePlan() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/forecasting/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          year,
          basisType,
          increasePct: Number(increasePct) || 0,
          applyScope,
          resetOverrides: applyScope === "all" ? resetOverrides : false,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Save failed")
      } else {
        onSaved()
      }
    } catch {
      setError("Save failed — try again.")
    }
    setSaving(false)
  }

  const pct = Number(increasePct) || 0
  const liveBasisTotal =
    basisType === "SQUARE_LAST_YEAR"
      ? basis?.basisTotal ?? null
      : basisType === plan?.basisType
        ? plan?.basisTotal ?? null
        : basisType === "MANUAL"
          ? 0
          : null
  const liveGoalTotal = liveBasisTotal !== null ? liveBasisTotal * (1 + pct / 100) : null
  const backfillPct = backfill && backfill.total > 0 ? Math.round((backfill.covered / backfill.total) * 100) : 0
  const canSave =
    !saving &&
    !!storeId &&
    (basisType !== "IMPORT" || plan?.basisType === "IMPORT") &&
    (basisType !== "SQUARE_LAST_YEAR" || (basis !== null && basis.uncoveredDays < basis.totalDays))

  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-4">
        <p className="text-[15px] font-bold text-[var(--color-foreground)]">Goal Settings</p>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Basis
          </Label>
          <RadioGroup value={basisType} onValueChange={(v) => setBasisType(v as BasisType)} className="space-y-1">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="SQUARE_LAST_YEAR" className="mt-0.5" />
              <span>
                Use last year&apos;s Square sales
                {basis && basis.uncoveredDays < basis.totalDays && (
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    {usd(basis.basisTotal, 2)} ({year - 1}, weekday-aligned)
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="IMPORT" className="mt-0.5" />
              <span>Import from file (CSV / XLSX)</span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="MANUAL" className="mt-0.5" />
              <span>Manual — type goals into the calendar</span>
            </label>
          </RadioGroup>
        </div>

        {basisType === "SQUARE_LAST_YEAR" && basis && basis.uncoveredDays > 0 && (
          <div className="rounded-md bg-[var(--color-muted)] p-3 space-y-2">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {basis.uncoveredDays === basis.totalDays
                ? `No ${year - 1} sales are cached for this store yet.`
                : `${basis.uncoveredDays} of ${basis.totalDays} days have no ${year - 1} sales data.`}
            </p>
            {squareLinked ? (
              backfill?.running ? (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                    <div className="h-full bg-[var(--color-primary)] transition-all" style={{ width: `${backfillPct}%` }} />
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Importing your {year - 1} sales… {backfillPct}%
                  </p>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={runBackfill}>
                  <CloudDownload className="h-3.5 w-3.5 mr-1.5" />
                  Import {year - 1} sales from Square
                </Button>
              )
            ) : (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Link this store to Square (Stores → edit) to pull last year&apos;s sales.
              </p>
            )}
            {backfill?.error && <p className="text-xs text-[var(--color-destructive)]">{backfill.error}</p>}
          </div>
        )}

        {basisType === "IMPORT" && (
          <div className="rounded-md bg-[var(--color-muted)] p-3 space-y-2">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="block w-full text-xs text-[var(--color-muted-foreground)] file:mr-2 file:rounded-md file:border-0 file:bg-[var(--color-primary)] file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:opacity-90"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setPreview(null)
              }}
            />
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              Two columns: <code>date, amount</code> (daily) or <code>month, amount</code> (monthly — spread across days
              by last year&apos;s weekday pattern).
            </p>
            {file && !preview && (
              <Button size="sm" variant="outline" onClick={() => submitImport(false)} disabled={importing}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                {importing ? "Reading…" : "Preview import"}
              </Button>
            )}
            {preview && (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-foreground)]">
                  {preview.shape === "daily" ? "Daily" : "Monthly"} file · {preview.rowCount} rows ·{" "}
                  <strong>{usd(preview.basisTotal, 2)}</strong>
                </p>
                <div className="max-h-36 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-card)]">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {preview.months.map((m) => (
                        <tr key={m.month} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="px-2 py-1">{MONTH_LABELS[Number(m.month.slice(5)) - 1]}</td>
                          <td className="px-2 py-1 text-right">{usd(m.total, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.errors.map((e, i) => (
                  <p key={i} className="text-xs text-[var(--color-destructive)]">
                    {e}
                  </p>
                ))}
                {preview.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-[#a36a00]">
                    {w}
                  </p>
                ))}
                {!preview.committed && preview.errors.length === 0 && (
                  <Button size="sm" onClick={() => submitImport(true)} disabled={importing}>
                    {importing ? "Importing…" : `Commit — creates the ${year} plan`}
                  </Button>
                )}
                {preview.committed && <p className="text-xs text-[#1d7c2e] font-medium">Imported ✓</p>}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="increasePct" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Increase %
          </Label>
          <Input
            id="increasePct"
            type="number"
            step="0.5"
            className="w-28"
            value={increasePct}
            onChange={(e) => setIncreasePct(e.target.value)}
          />
        </div>

        <div className="rounded-md bg-[var(--color-primary)]/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {year} Sales Goal
          </p>
          <p className="text-xl font-extrabold text-[var(--color-foreground)]">
            {liveGoalTotal !== null ? usd(liveGoalTotal, 2) : "—"}
          </p>
          {liveBasisTotal !== null && liveBasisTotal > 0 && (
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              {usd(liveBasisTotal, 2)} basis {pct >= 0 ? "+" : ""}
              {pct}%
            </p>
          )}
        </div>

        {plan && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Apply changes to
            </Label>
            <Select value={applyScope} onValueChange={(v) => setApplyScope(v as "all" | "remaining")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">The whole year</SelectItem>
                <SelectItem value="remaining">Remaining days only</SelectItem>
              </SelectContent>
            </Select>
            {applyScope === "all" && (
              <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] cursor-pointer">
                <Checkbox checked={resetOverrides} onCheckedChange={(c) => setResetOverrides(c === true)} />
                Also recalculate manually-edited days
              </label>
            )}
          </div>
        )}

        {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

        {basisType !== "IMPORT" || plan?.basisType === "IMPORT" ? (
          <Button className="w-full" onClick={savePlan} disabled={!canSave}>
            {saving ? "Saving…" : plan ? "Save & regenerate goals" : `Create ${year} plan`}
          </Button>
        ) : (
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            Commit an import above to create the plan.
          </p>
        )}

        {squareLinked && (
          <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Sales data
            </Label>
            <Button variant="outline" className="w-full" onClick={runResync} disabled={resync?.running}>
              <RefreshCw className={cn("h-4 w-4 mr-1.5", resync?.running && "animate-spin")} />
              {resync?.running ? `Refreshing… ${resync.pct}%` : "Refresh from Square"}
            </Button>
            {resync?.running && (
              <div className="h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                <div className="h-full bg-[var(--color-primary)] transition-all" style={{ width: `${resync.pct}%` }} />
              </div>
            )}
            {resync?.done && <p className="text-[11px] text-[#1d7c2e] font-medium">Sales re-synced ✓</p>}
            {resync?.error && <p className="text-[11px] text-[var(--color-destructive)]">{resync.error}</p>}
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              Re-pulls last year&apos;s basis and this year&apos;s actuals from Square. Use after a sales-metric change.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

function YearCalendar({
  storeId,
  year,
  calendar,
  onChanged,
}: {
  storeId: string
  year: number
  calendar: CalendarData | null
  onChanged: () => void
}) {
  const [dayDialog, setDayDialog] = useState<CalendarDay | null>(null)
  const [monthDialog, setMonthDialog] = useState<{ month: string; total: number } | null>(null)

  const byDate = useMemo(() => new Map((calendar?.days ?? []).map((d) => [d.date, d])), [calendar])

  if (!calendar) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    )
  }

  if (calendar.days.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-2">
          <p className="text-sm font-medium text-[var(--color-foreground)]">No goals for {year} yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {calendar.canEdit
              ? "Pick a basis in Goal Settings and create the plan — daily goals will fill this calendar."
              : "An admin can create this year's plan in Goal Settings."}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {MONTH_LABELS.map((label, i) => {
          const monthKey = `${year}-${String(i + 1).padStart(2, "0")}`
          const monthDays = (calendar.days ?? []).filter((d) => d.date.slice(0, 7) === monthKey)
          const monthGoal = monthDays.reduce((s, d) => s + d.goal, 0)
          const monthActual = monthDays.reduce((s, d) => s + (d.actual ?? 0), 0)
          const hasActuals = monthDays.some((d) => d.actual !== null)
          const firstWeekday = new Date(`${monthKey}-01T00:00:00.000Z`).getUTCDay()
          const daysInMonth = monthDays.length

          return (
            <Card key={monthKey}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-sm font-bold text-[var(--color-foreground)]">{label}</p>
                  <button
                    className={cn(
                      "text-xs font-semibold text-[var(--color-muted-foreground)]",
                      calendar.canEdit && "hover:text-[var(--color-primary)] cursor-pointer"
                    )}
                    onClick={() => calendar.canEdit && setMonthDialog({ month: monthKey, total: Math.round(monthGoal * 100) / 100 })}
                    disabled={!calendar.canEdit}
                    title={calendar.canEdit ? "Edit month total" : undefined}
                  >
                    {hasActuals && <span className="mr-2 font-normal">{usd(monthActual)} /</span>}
                    {usd(monthGoal)}
                    {calendar.canEdit && <Pencil className="inline h-3 w-3 ml-1 opacity-60" />}
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-px text-center">
                  {WEEKDAY_HEADERS.map((w, wi) => (
                    <div key={wi} className="text-[10px] font-semibold text-[var(--color-muted-foreground)] pb-1">
                      {w}
                    </div>
                  ))}
                  {Array.from({ length: firstWeekday }, (_, b) => (
                    <div key={`b${b}`} />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, di) => {
                    const dateStr = `${monthKey}-${String(di + 1).padStart(2, "0")}`
                    const day = byDate.get(dateStr)
                    if (!day) return <div key={dateStr} />
                    const done = day.actual !== null
                    const hit = done && day.goal > 0 && day.actual! >= day.goal
                    const miss = done && day.goal > 0 && day.actual! < day.goal
                    const isToday = dateStr === calendar.today
                    return (
                      <button
                        key={dateStr}
                        onClick={() => calendar.canEdit && setDayDialog(day)}
                        disabled={!calendar.canEdit}
                        className={cn(
                          "rounded-sm px-0.5 py-1 min-h-[38px] text-left align-top border border-transparent",
                          hit && "bg-[#25ba3b]/15",
                          miss && "bg-[var(--color-destructive)]/10",
                          !done && "bg-[var(--color-muted)]/40",
                          isToday && "border-[var(--color-primary)]",
                          calendar.canEdit && "hover:border-[var(--color-primary)]/50 cursor-pointer"
                        )}
                        title={`${dateStr} · goal ${usd(day.goal, 2)}${done ? ` · actual ${usd(day.actual, 2)}` : ""}${day.isOverride ? " · manually set" : ""}`}
                      >
                        <span className="block text-[9px] leading-none text-[var(--color-muted-foreground)]">
                          {di + 1}
                          {day.isOverride && <span className="text-[var(--color-primary)]">*</span>}
                        </span>
                        <span className="block text-[10px] font-semibold leading-tight text-[var(--color-foreground)]">
                          {Math.round(day.goal).toLocaleString()}
                        </span>
                        {done && (
                          <span
                            className={cn(
                              "block text-[9px] leading-tight",
                              hit ? "text-[#1d7c2e]" : miss ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"
                            )}
                          >
                            {Math.round(day.actual!).toLocaleString()}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <DayEditDialog storeId={storeId} day={dayDialog} onClose={() => setDayDialog(null)} onSaved={onChanged} />
      <MonthEditDialog storeId={storeId} data={monthDialog} onClose={() => setMonthDialog(null)} onSaved={onChanged} />
    </>
  )
}

// ─── Day edit dialog ──────────────────────────────────────────────────────────

function DayEditDialog({
  storeId,
  day,
  onClose,
  onSaved,
}: {
  storeId: string
  day: CalendarDay | null
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open={!!day} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {day && <DayEditForm key={day.date} storeId={storeId} day={day} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function DayEditForm({
  storeId,
  day,
  onClose,
  onSaved,
}: {
  storeId: string
  day: CalendarDay
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(String(day.goal))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live Square balancing report for this day. Fetched once; the form is keyed
  // by date so it re-mounts. 0 orders (future or a no-sales day) → empty state.
  const [report, setReport] = useState<DayReport | null>(null)
  const [reportState, setReportState] = useState<"loading" | "ok" | "unavailable">("loading")
  useEffect(() => {
    let cancelled = false
    fetch(`/api/forecasting/day-report?storeId=${storeId}&date=${day.date}`)
      .then(async (r) => {
        if (cancelled) return
        if (r.ok) {
          setReport(await r.json())
          setReportState("ok")
        } else {
          setReportState("unavailable")
        }
      })
      .catch(() => !cancelled && setReportState("unavailable"))
    return () => {
      cancelled = true
    }
  }, [storeId, day.date])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/forecasting/day", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, date: day.date, goalAmount: Number(amount) || 0 }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Save failed")
      } else {
        onClose()
        onSaved()
      }
    } catch {
      setError("Save failed — try again.")
    }
    setSaving(false)
  }

  const dateLabel = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{dateLabel}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-[var(--color-muted)] p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Last year (same weekday)
            </p>
            <p className="font-bold">{usd(day.basis, 2)}</p>
          </div>
          <div className="rounded-md bg-[var(--color-muted)] p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Actual
            </p>
            <p className="font-bold">{day.actual !== null ? usd(day.actual, 2) : "—"}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dayGoal">
            Goal {day.isOverride && <span className="text-[var(--color-primary)] text-xs">(manually set)</span>}
          </Label>
          <Input id="dayGoal" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        <SquareBalancingReport state={reportState} report={report} />

        {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || amount === ""}>
            {saving ? "Saving…" : "Save goal"}
          </Button>
        </div>
      </div>
    </>
  )
}

// ─── Square balancing report (live, in the day dialog) ────────────────────────

function ReportRow({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between text-[12px]">
      <span className={muted ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-foreground)]"}>{label}</span>
      <span className={cn(muted ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-foreground)]", strong && "font-bold")}>
        {value}
      </span>
    </div>
  )
}

function SquareBalancingReport({ state, report }: { state: "loading" | "ok" | "unavailable"; report: DayReport | null }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Square sales — this day
      </p>

      {state === "loading" && <Skeleton className="h-24 w-full" />}
      {state === "unavailable" && (
        <p className="text-[12px] text-[var(--color-muted-foreground)]">
          Live Square data isn&apos;t available (Square not connected or unreachable).
        </p>
      )}
      {state === "ok" && report && report.orderCount === 0 && (
        <p className="text-[12px] text-[var(--color-muted-foreground)]">No sales recorded for this day.</p>
      )}
      {state === "ok" && report && report.orderCount > 0 && (
        <div className="space-y-1.5">
          <ReportRow label="Gross sales" value={usd(report.grossSales, 2)} />
          <ReportRow label="Discounts &amp; comps" value={`(${usd(report.discounts, 2)})`} muted />
          <ReportRow label="Net sales" value={usd(report.netSales, 2)} strong />
          <div className="border-t border-[var(--color-border)] my-1" />
          <ReportRow label="Tax" value={usd(report.tax, 2)} muted />
          <ReportRow label="Tips" value={usd(report.tips, 2)} muted />
          <ReportRow label="Total collected" value={usd(report.totalCollected, 2)} />
          <div className="border-t border-[var(--color-border)] my-1" />
          {report.tenders.map((t) => (
            <ReportRow key={t.type} label={t.label} value={usd(t.amount, 2)} muted />
          ))}
          <div className="border-t border-[var(--color-border)] my-1" />
          <ReportRow label={`In-store / pickup (${report.inStore.orders})`} value={usd(report.inStore.netSales, 2)} muted />
          <ReportRow label={`Delivery apps (${report.delivery.orders})`} value={usd(report.delivery.netSales, 2)} muted />
          <p className="text-[10.5px] text-[var(--color-muted-foreground)] pt-1">
            {report.orderCount} orders · net sales counts toward the goal and matches Square&apos;s Sales Summary.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Month edit dialog ────────────────────────────────────────────────────────

function MonthEditDialog({
  storeId,
  data,
  onClose,
  onSaved,
}: {
  storeId: string
  data: { month: string; total: number } | null
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {data && <MonthEditForm key={data.month} storeId={storeId} data={data} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function MonthEditForm({
  storeId,
  data,
  onClose,
  onSaved,
}: {
  storeId: string
  data: { month: string; total: number }
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(String(data.total))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/forecasting/month", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, month: data.month, totalAmount: Number(amount) || 0 }),
      })
      const resData = await res.json()
      if (!res.ok) {
        setError(resData.error ?? "Save failed")
      } else {
        onClose()
        onSaved()
      }
    } catch {
      setError("Save failed — try again.")
    }
    setSaving(false)
  }

  const label = `${MONTH_LABELS[Number(data.month.slice(5)) - 1]} ${data.month.slice(0, 4)}`

  return (
    <>
      <DialogHeader>
        <DialogTitle>{label} total</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          The new total is spread across the month&apos;s days following last year&apos;s weekday pattern, and those
          days are marked as manually set.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="monthGoal">Month goal ($)</Label>
          <Input id="monthGoal" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || amount === ""}>
            {saving ? "Saving…" : "Save & redistribute"}
          </Button>
        </div>
      </div>
    </>
  )
}
