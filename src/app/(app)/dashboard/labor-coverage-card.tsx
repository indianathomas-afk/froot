"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Users, ShieldAlert, CircleAlert, CloudRain, ChevronLeft, ChevronRight, Crown, CalendarRange, CalendarClock } from "lucide-react"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceArea } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { fetchCard } from "./card-fetch"
import { useLaborViewedDate, shiftDateStr, todayStr } from "./use-labor-date"
import { SplitPolicyInfo } from "@/components/labor/split-policy-info"
import { badgePreset, type BadgePresetKey } from "@/lib/badge-presets"
import { OVERLAY_KEY, SUGGESTED_KEY, agoLabel, jobSeriesKey, toggleSeries, visibleSeriesKeys } from "@/lib/overlay-legend"

// Labor Coverage card (Dashboard, Phase 3 — "Recommended · guidance"). A
// demand-shaped, budget-capped headcount step line for the viewed day — future
// days included (projected from recent same-weekdays). The salaried GM is
// counted on floor in their window. Single headcount axis. ADMIN/MANAGER set a
// ±% weather adjustment. Day nav (‹ ›) is shared with the Budget card.

type CoveragePoint = { hour: number; headcount: number; hourly: number; gm: boolean; open: boolean }

// OVL-S3 — the overlay half. OPTIONAL BECAUSE IT IS ABSENT, NOT EMPTY: without
// labor.schedule.view the route sends no `overlay` key at all, so `res.overlay`
// is undefined and every branch below falls through to the card exactly as it
// rendered before this session.
type OverlayPoint = { hour: number; total: number; byJobId: Record<string, number> }

type OverlayJob = { jobId: string; title: string | null; colorKey: BadgePresetKey; hex: string }

type ScheduleSyncHealth = "never" | "synced-empty" | "fresh" | "stale" | "error"

type Overlay = {
  scheduled: OverlayPoint[] | null
  /// Today only. Other days show the plan alone — a past day's actuals are the
  /// S4 comparison page's job.
  clockedIn: OverlayPoint[] | null
  jobs: OverlayJob[]
  sync: { health: ScheduleSyncHealth; lastSyncOkAt: string | null; lastShiftCount: number }
  draftSourcedCount: number
  openTimecardCount: number
  unknownJobId: string
}

type OverlayMode = "scheduled" | "clockedIn"

/// The empty hidden set, hoisted so every "nothing is hidden" render shares one
/// identity — a fresh `new Set()` each render would re-run the memo below on
/// every keystroke elsewhere in the card.
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>()

/// One x-position of the chart. The suggested curve, the overlay total, and one
/// `job:<id>` key per position on the active curve — an index signature because
/// the job ids are Square's and are not known at compile time.
type ChartRow = { label: string; headcount: number | null; overlayTotal: number | null } & {
  [jobKey: string]: string | number | null
}

type CoverageResponse = {
  today: string
  date: string
  available: boolean
  canManage: boolean
  hasForecast: boolean
  hasShape: boolean
  isFuture: boolean
  /// D7 — the server's own verdict on whether this day's suggested curve is a
  /// PROJECTION (today and every future day) rather than the day's own actuals.
  /// It replaces the card's old `isFuture` heuristic, which quietly excluded
  /// today and so left the projection unlabelled on the one day most people read
  /// the card.
  projected: boolean
  adjustment: { adjustmentPct: number; reason: string | null } | null
  overlay?: Overlay
  coverage: {
    points: CoveragePoint[]
    peakHours: number[]
    peakHeadcount: number
    hourlyBudgetHours: number
    usedHourlyHours: number
    understaffedBudget: boolean
    gmWindow: { startHour: number; endHour: number } | null
    supervisorGap: boolean
  } | null
}

function hourLabel(h: number): string {
  if (h === 0) return "12a"
  if (h < 12) return `${h}a`
  if (h === 12) return "12p"
  return `${h - 12}p`
}
function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "today"
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  const base = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  return dateStr > today ? base : base
}

export function LaborCoverageCard({ storeId }: { storeId: string }) {
  const [viewedDate, setViewedDate] = useLaborViewedDate()
  const [data, setData] = useState<{ key: string; res: CoverageResponse | null } | null>(null)
  const [editing, setEditing] = useState(false)
  // The same-day toggle's REQUESTED mode. "scheduled" is the default because it
  // is the curve that exists on every day; what actually renders is
  // `effectiveMode` below, which falls back when the request cannot be honoured.
  const [mode, setMode] = useState<OverlayMode>("scheduled")
  // OVL-S4 — LEGEND VISIBILITY, AND IT IS DISPLAY STATE ONLY (Gary,
  // 2026-08-20). Holds the Recharts dataKeys the reader has switched off. No
  // fetch, no recomputation, no server round trip: hiding a curve cuts visual
  // noise and changes nothing about what the card was told.
  //
  // THE HIDDEN SET IS STORED WITH THE DATE IT BELONGS TO, which is how the
  // ruling's "resets on day navigation" is enforced. Deriving it from the viewed
  // date rather than clearing it in an effect means there is no window — not
  // even one render — in which yesterday's hidden series applies to today's
  // curve, and a "froot-labor-changed" refetch of the SAME day cannot silently
  // restore a curve the reader just switched off.
  const [hiddenFor, setHiddenFor] = useState<{ date: string; keys: ReadonlySet<string> }>({
    date: viewedDate,
    keys: EMPTY_HIDDEN,
  })
  const hidden = hiddenFor.date === viewedDate ? hiddenFor.keys : EMPTY_HIDDEN

  const key = `${storeId}|${viewedDate}`
  const load = useCallback(() => {
    if (!storeId) return
    fetchCard<CoverageResponse>("labor coverage", `/api/labor/coverage?storeId=${storeId}&date=${viewedDate}`).then(
      (res) => setData({ key, res })
    )
  }, [storeId, viewedDate, key])

  useEffect(() => {
    load()
    const onChange = () => load()
    window.addEventListener("froot-labor-changed", onChange)
    return () => window.removeEventListener("froot-labor-changed", onChange)
  }, [load])

  const loading = !data || data.key !== key
  const res = data?.res ?? null

  // The overlay curve currently on screen, or null. Clocked-in is offered only
  // where the payload actually carries it (today), so `mode` can never select a
  // series that does not exist.
  const overlay = res?.overlay
  const canToggle = !!overlay?.clockedIn && !!overlay?.scheduled
  // THE MODE IS DERIVED, NOT JUST STORED. Clocked-in exists only for today, so a
  // reader who selects it and then pages to tomorrow would otherwise hold a mode
  // whose series is null — and the overlay would silently vanish rather than
  // falling back to the plan. Deriving it means the state survives a round trip
  // back to today instead of being reset out from under them.
  const effectiveMode: OverlayMode = mode === "clockedIn" && overlay?.clockedIn ? "clockedIn" : "scheduled"
  const activeSeries = effectiveMode === "clockedIn" ? overlay?.clockedIn ?? null : overlay?.scheduled ?? null

  const chart = useMemo(() => {
    if (!res?.coverage) return { rows: [] as ChartRow[], gmStart: null as string | null, gmEnd: null as string | null, maxHead: 0, jobKeys: [] as string[] }
    const pts = res.coverage.points.filter((p) => p.hour >= 6)

    // THE OVERLAY IS INDEXED BY HOUR, NOT ZIPPED BY POSITION. Both series are 24
    // entries by construction, but a lookup cannot go wrong the way a parallel
    // walk silently can if either side ever changes length.
    const byHour = new Map((activeSeries ?? []).map((p) => [p.hour, p]))

    // Only jobs that actually appear on the ACTIVE curve get a line. Drawing a
    // flat zero for a job that is scheduled but not clocked in (or the reverse)
    // would read as "this position was on the floor at zero staff".
    const jobKeys = [...new Set((activeSeries ?? []).flatMap((p) => Object.keys(p.byJobId)))].sort()

    const rows: ChartRow[] = pts.map((p) => {
      const o = byHour.get(p.hour)
      const row: ChartRow = {
        label: hourLabel(p.hour),
        // THE CLOSED-HOUR CONVENTION IS SHARED, NOT RE-INVENTED. Both the
        // suggested curve and every overlay line go null on a closed hour, so
        // connectNulls={false} breaks all of them at the same x — the alternative
        // is an overlay that appears to span hours the store was shut.
        headcount: p.open ? p.headcount : null,
        overlayTotal: p.open && o ? o.total : null,
      }
      for (const jobId of jobKeys) {
        row[`job:${jobId}`] = p.open && o ? o.byJobId[jobId] ?? 0 : null
      }
      return row
    })

    const gm = res.coverage.gmWindow
    // The axis has to hold whichever curve is taller, or a fully-staffed actual
    // day would be clipped by a lean recommendation.
    const overlayPeak = Math.max(0, ...rows.map((r) => r.overlayTotal ?? 0))
    return {
      rows,
      gmStart: gm ? hourLabel(Math.max(6, gm.startHour)) : null,
      gmEnd: gm ? hourLabel(gm.endHour) : null,
      maxHead: Math.max(res.coverage.peakHeadcount, overlayPeak),
      jobKeys,
    }
  }, [res, activeSeries])

  // The drawn set, from the one module that decides it. `chart.jobKeys` is
  // already the ACTIVE curve's positions, so switching mode re-derives the chips
  // while a job id the reader hid stays hidden — the same series, same key.
  const visible = useMemo(
    () => new Set(visibleSeriesKeys({ hasOverlay: !!activeSeries, jobKeys: chart.jobKeys, hidden })),
    [activeSeries, chart.jobKeys, hidden]
  )
  const toggle = useCallback(
    (k: string) =>
      setHiddenFor((h) => ({
        date: viewedDate,
        keys: toggleSeries(h.date === viewedDate ? h.keys : EMPTY_HIDDEN, k),
      })),
    [viewedDate]
  )

  const canGoBack = viewedDate > shiftDateStr(todayStr(), -60)
  const canGoFwd = viewedDate < shiftDateStr(todayStr(), 28)

  if (loading) return <Skeleton className="h-56 w-full" />

  const cov = res?.coverage
  const hasChart = !!cov && !chart.rows.every((r) => r.headcount === null)

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-[var(--color-primary)]" />
            <p className="text-[15px] font-bold text-[var(--color-foreground)]">Labor Coverage</p>
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-primary)] uppercase">Recommended · guidance</span>
        </div>

        {/* Day navigator (shared with the Budget card) */}
        <div className="flex items-center gap-1.5 mb-2">
          <button onClick={() => setViewedDate(shiftDateStr(viewedDate, -1))} disabled={!canGoBack} className="p-1 rounded hover:bg-[var(--color-accent)] disabled:opacity-40" aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12.5px] font-semibold text-[var(--color-foreground)] min-w-[92px] text-center">
            {res ? dayLabel(res.date, res.today) : dayLabel(viewedDate, todayStr())}
          </span>
          <button onClick={() => setViewedDate(shiftDateStr(viewedDate, 1))} disabled={!canGoFwd} className="p-1 rounded hover:bg-[var(--color-accent)] disabled:opacity-40" aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </button>
          {res?.projected && (
            <span className="text-[11px] text-[var(--color-muted-foreground)]">
              · projected from recent {new Date(`${res.date}T12:00`).toLocaleDateString("en-US", { weekday: "long" })}s
            </span>
          )}
          {res && viewedDate !== res.today && (
            <button onClick={() => setViewedDate(todayStr())} className="text-[11px] text-[var(--color-primary)] hover:underline ml-1">today</button>
          )}
        </div>

        {!res ? (
          <div className="py-6 flex flex-col items-start gap-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">Couldn’t load coverage — the request failed or timed out.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setData(null)
                load()
              }}
            >
              Retry
            </Button>
          </div>
        ) : !res.hasForecast ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">No sales forecast for this week (set one up in Forecasting) — coverage needs a budget.</p>
        ) : !res.available ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Recommended coverage needs hourly sales history — connect Square and activate Inventory.</p>
        ) : !hasChart ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">No sales shape to project {dayLabel(res.date, res.today)} yet.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[12.5px] text-[var(--color-muted-foreground)]">
                Suggested staff on floor{cov!.gmWindow ? " (incl. GM)" : ""}
              </p>
              <div className="flex items-center gap-2">
                {canToggle && (
                  <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
                    {(["scheduled", "clockedIn"] as OverlayMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        aria-pressed={effectiveMode === m}
                        className={`px-2 py-0.5 text-[11px] font-semibold ${
                          effectiveMode === m
                            ? "bg-[var(--color-primary)] text-white"
                            : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                        }`}
                      >
                        {m === "scheduled" ? "Scheduled" : "Clocked in"}
                      </button>
                    ))}
                  </div>
                )}
                {/* OVL-S4 — THE ROSTER AFFORDANCE, AND IT IS A BUTTON RATHER
                    THAN A CHART CLICK (approved 2026-08-20). The Recharts
                    tooltip at <ChartTooltip> below is hover-driven, and on touch
                    Recharts synthesises hover from a tap — a click handler on the
                    plot would fire underneath a live tooltip and fight it. A
                    button coexists, is keyboard-reachable, and leaves the shipped
                    tooltip untouched. */}
                {effectiveMode === "clockedIn" && overlay!.openTimecardCount > 0 && (
                  <ClockedInRosterPopover storeId={storeId} count={overlay!.openTimecardCount} />
                )}
                {res.adjustment && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-[var(--color-warning)]/15 text-[#a36a00]">
                    <CloudRain className="h-3 w-3" />
                    {res.adjustment.adjustmentPct > 0 ? "+" : ""}{res.adjustment.adjustmentPct}%{res.adjustment.reason ? ` · ${res.adjustment.reason}` : ""}
                  </span>
                )}
                {res.canManage && (
                  <button className="text-[11px] font-medium text-[var(--color-primary)] hover:underline" onClick={() => setEditing(true)}>
                    {res.adjustment ? "Edit adjustment" : "Adjust for weather"}
                  </button>
                )}
              </div>
            </div>

            {cov && (cov.supervisorGap || cov.understaffedBudget) && (
              <div className="flex flex-col gap-1 mb-2">
                {cov.supervisorGap && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#b42318]">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> No supervisory position covers the hours the GM is off the floor.
                  </div>
                )}
                {cov.understaffedBudget && (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#a36a00]">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" /> The budget can’t cover a floor of 1 all day ({cov.usedHourlyHours} hrs needed vs {cov.hourlyBudgetHours.toFixed(1)} budgeted).
                    <SplitPolicyInfo />
                  </div>
                )}
              </div>
            )}

            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows}>
                  {chart.gmStart && <ReferenceArea x1={chart.gmStart} x2={chart.gmEnd ?? chart.gmStart} fill="var(--color-primary)" fillOpacity={0.08} label={{ value: "GM", position: "insideTop", fontSize: 9, fill: "var(--color-primary)" }} />}
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} width={28} allowDecimals={false} domain={[0, Math.max(2, chart.maxHead + 1)]} />
                  <ChartTooltip formatter={(v, name) => [`${v} on floor`, tooltipLabel(String(name), res.overlay, effectiveMode)]} />
                  {/* OVL-S4 — every <Line> is gated on `visible`. OMITTED, NOT
                      styled transparent: a zero-opacity line still owns the
                      tooltip row it would have drawn, so the reader who hid a
                      curve would keep reading its number. */}
                  {visible.has(SUGGESTED_KEY) && (
                    <Line type="stepAfter" dataKey="headcount" stroke="var(--color-primary)" strokeWidth={3} dot={false} connectNulls={false} />
                  )}
                  {/* OVL-S3 — DISPLAY ONLY. These series are drawn from the
                      `overlay` key and feed nothing: the suggested curve above is
                      computed server-side before the overlay is even assembled. */}
                  {activeSeries && visible.has(OVERLAY_KEY) && (
                    <Line
                      type="stepAfter"
                      dataKey="overlayTotal"
                      stroke="var(--color-foreground)"
                      strokeWidth={2}
                      strokeDasharray={effectiveMode === "scheduled" ? "5 3" : "1 3"}
                      dot={false}
                      connectNulls={false}
                    />
                  )}
                  {chart.jobKeys
                    .filter((jobId) => visible.has(jobSeriesKey(jobId)))
                    .map((jobId) => (
                    <Line
                      key={jobId}
                      type="stepAfter"
                      dataKey={`job:${jobId}`}
                      stroke={jobHex(res.overlay, jobId)}
                      strokeWidth={1.5}
                      strokeDasharray={effectiveMode === "scheduled" ? "5 3" : "1 3"}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* OVL-S4 — THE LEGEND IS NOW THE CONTROL. Every series chip is a
                click-to-toggle button; a hidden series keeps its chip, muted, so
                there is always a way back. The chips that are NOT series — GM
                window, hourly budget — stay plain spans, because there is no
                curve for them to hide. */}
            <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-[var(--color-muted-foreground)]">
              {/* THE CURVE IDENTIFICATION, and the projected-shape ruling landing
                  on the legend rather than only on the day navigator. */}
              <button
                type="button"
                onClick={() => toggle(SUGGESTED_KEY)}
                aria-pressed={visible.has(SUGGESTED_KEY)}
                title={visible.has(SUGGESTED_KEY) ? "Hide the suggested curve" : "Show the suggested curve"}
                className={`inline-flex items-center gap-1 rounded hover:text-[var(--color-foreground)] ${chipMuted(visible.has(SUGGESTED_KEY))}`}
              >
                <span className="h-0.5 w-4 rounded bg-[var(--color-primary)]" /> Suggested
                {res.projected && ` · projected from recent ${new Date(`${res.date}T12:00`).toLocaleDateString("en-US", { weekday: "long" })}s`}
              </button>
              {activeSeries && (
                <button
                  type="button"
                  onClick={() => toggle(OVERLAY_KEY)}
                  aria-pressed={visible.has(OVERLAY_KEY)}
                  title={visible.has(OVERLAY_KEY) ? "Hide this curve" : "Show this curve"}
                  className={`inline-flex items-center gap-1 rounded hover:text-[var(--color-foreground)] ${chipMuted(visible.has(OVERLAY_KEY))}`}
                >
                  <span
                    className="h-0 w-4 border-t-2 border-dashed border-[var(--color-foreground)]"
                    style={effectiveMode === "clockedIn" ? { borderStyle: "dotted" } : undefined}
                  />
                  {effectiveMode === "scheduled" ? "Scheduled" : "Clocked in"}
                  {effectiveMode === "clockedIn" && overlay!.openTimecardCount > 0 && " · still on the clock"}
                  {effectiveMode === "scheduled" && overlay!.draftSourcedCount > 0 &&
                    ` · incl. ${overlay!.draftSourcedCount} draft shift${overlay!.draftSourcedCount === 1 ? "" : "s"}`}
                </button>
              )}
              {/* Per-position chips. ONE KEY drives the chip and the stroke — the
                  class here, the hex on the <Line> above, both from colorKey. */}
              {activeSeries &&
                chart.jobKeys.map((jobId) => {
                  const job = overlay!.jobs.find((j) => j.jobId === jobId)
                  const shown = visible.has(jobSeriesKey(jobId))
                  return (
                    <button
                      key={jobId}
                      type="button"
                      onClick={() => toggle(jobSeriesKey(jobId))}
                      aria-pressed={shown}
                      title={shown ? "Hide this position" : "Show this position"}
                      className={`inline-flex items-center gap-1 rounded hover:text-[var(--color-foreground)] ${chipMuted(shown)}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${badgePreset(job?.colorKey).dot}`} />
                      {jobLabel(job, jobId, overlay!.unknownJobId)}
                    </button>
                  )
                })}
              {cov!.gmWindow && (
                <span className="inline-flex items-center gap-1"><Crown className="h-3 w-3 text-[var(--color-primary)]" /> GM on floor {hourLabel(cov!.gmWindow.startHour)}–{hourLabel(cov!.gmWindow.endHour)}</span>
              )}
              <span>Hourly budget {cov!.hourlyBudgetHours.toFixed(1)} hrs</span>
            </div>

            {/* SEAM (c) — STALE DATA IS SHOWN AND LABELLED, NEVER BLANKED. An
                integration that stopped answering leaves the last known schedule
                on screen with its age; it never silently becomes "nobody is
                scheduled", which is the sentence the seam exists to forbid. */}
            {overlay && (overlay.sync.health === "stale" || overlay.sync.health === "error") && (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#a36a00] mt-1">
                <CalendarClock className="h-3 w-3 shrink-0" />
                Schedule last synced {agoLabel(overlay.sync.lastSyncOkAt)} — showing the last known plan.
              </div>
            )}
            {/* SYNCED-EMPTY IS AN HONEST ZERO AND SAYS SO. Distinct from
                never-synced, which renders no overlay line at all. */}
            {overlay && overlay.sync.health === "synced-empty" && (
              <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
                No shifts scheduled in Square for this store yet — showing the forecast only.
              </p>
            )}
            <p className="text-[11px] text-[var(--color-muted-foreground)] mt-1">
              Demand-shaped and capped by the conservative budget — a guide, not a schedule. Floor of 1 while open.
            </p>
            <Link href="/labor" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline mt-2">
              <CalendarRange className="h-3.5 w-3.5" /> Open Weekly Plan
            </Link>
          </>
        )}
      </CardContent>

      {editing && res && (
        <AdjustmentDialog
          storeId={storeId}
          date={res.date}
          dateLabel={dayLabel(res.date, res.today)}
          current={res.adjustment}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
            window.dispatchEvent(new Event("froot-labor-changed"))
          }}
        />
      )}
    </Card>
  )
}

function AdjustmentDialog({
  storeId,
  date,
  dateLabel,
  current,
  onClose,
  onSaved,
}: {
  storeId: string
  date: string
  dateLabel: string
  current: { adjustmentPct: number; reason: string | null } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [pct, setPct] = useState(current ? String(current.adjustmentPct) : "-20")
  const [reason, setReason] = useState(current?.reason ?? "")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(pct)
    if (!(n >= -100 && n <= 100) || pct.trim() === "") return setErr("Enter a percent between -100 and 100.")
    setSaving(true)
    setErr(null)
    const res = await fetch("/api/labor/day-adjustment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, date, adjustmentPct: n, reason: reason.trim() || null }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) return setErr("Couldn’t save — try again.")
    onSaved()
  }
  async function clear() {
    setSaving(true)
    const res = await fetch(`/api/labor/day-adjustment?storeId=${storeId}&date=${date}`, { method: "DELETE" }).catch(() => null)
    setSaving(false)
    if (res?.ok) onSaved()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Labor adjustment · {dateLabel}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-sm text-[var(--color-muted-foreground)]">Scale this day’s hourly hours up or down for conditions like weather. Salaried is unaffected.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="a-pct">Adjustment (%)</Label>
              <Input id="a-pct" type="number" min="-100" max="100" step="5" value={pct} onChange={(e) => setPct(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="a-reason">Reason</Label>
              <Input id="a-reason" placeholder="e.g. Rain" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-sm text-[var(--color-destructive)]">{err}</p>}
        </div>
        <DialogFooter>
          {current && <Button variant="outline" onClick={clear} disabled={saving} className="mr-auto">Remove</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ─── OVL-S4 · THE CLOCKED-IN ROSTER POPUP ─────────────────────────────────────

type RosterEntry = { name: string; title: string | null; clockInAt: string }

/// WHO IS ON THE FLOOR RIGHT NOW. name · position title · clock-in time, and
/// nothing else — the payload is structurally free of wage, rate and tip fields
/// because the endpoint never selects them.
///
/// THE FETCH FIRES ON OPEN AND ONLY ON OPEN (Gary's ruling). Not prefetched, not
/// cached between opens, and not folded into the card's own payload: a manager
/// asking who is working is an action they took, not something the dashboard
/// does to itself every thirty seconds. Re-opening re-reads, which is also what
/// makes "right now" true rather than true-when-the-card-loaded.
function ClockedInRosterPopover({ storeId, count }: { storeId: string; count: number }) {
  const [state, setState] = useState<{ loading: boolean; rows: RosterEntry[] | null; failed: boolean }>({
    loading: false,
    rows: null,
    failed: false,
  })

  function onOpenChange(open: boolean) {
    if (!open) return setState({ loading: false, rows: null, failed: false })
    setState({ loading: true, rows: null, failed: false })
    fetch(`/api/labor/clocked-in-roster?storeId=${storeId}`)
      .then((r): Promise<{ roster: RosterEntry[] } | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) =>
        setState({ loading: false, rows: res?.roster ?? null, failed: !res })
      )
      .catch(() => setState({ loading: false, rows: null, failed: true }))
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
        >
          <Users className="h-3 w-3" />
          {count} on floor
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <p className="text-[12px] font-semibold text-[var(--color-foreground)] mb-2">On the floor now</p>
        {state.loading ? (
          <Skeleton className="h-16 w-full" />
        ) : state.failed ? (
          <p className="text-[11.5px] text-[var(--color-muted-foreground)]">Couldn’t load the roster — try again in a moment.</p>
        ) : !state.rows?.length ? (
          /* Reachable when the last card closes between the render and the click
             — an honest "nobody", never a stale list. */
          <p className="text-[11.5px] text-[var(--color-muted-foreground)]">Nobody is clocked in right now.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {state.rows.map((r, i) => (
              <li key={`${r.name}|${r.clockInAt}|${i}`} className="text-[11.5px] leading-tight">
                <span className="font-semibold text-[var(--color-foreground)]">{r.name}</span>
                <span className="text-[var(--color-muted-foreground)]">
                  {" · "}
                  {/* The legend's own wording for a job Square never titled. */}
                  {r.title ?? "No position recorded"}
                  {" · in "}
                  {r.clockInAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ─── OVL-S3 helpers ───────────────────────────────────────────────────────────

/// The legend's name for a position. An UNNAMED position is not an error state
/// (Gary, D6): Square publishes no job catalogue, so a job that is scheduled but
/// never worked has no timecard to borrow a title from and cannot be given one.
function jobLabel(job: OverlayJob | undefined, jobId: string, unknownJobId: string): string {
  if (jobId === unknownJobId) return "No position recorded"
  return job?.title ?? "Unnamed position"
}

function jobHex(overlay: Overlay | undefined, jobId: string): string {
  return overlay?.jobs.find((j) => j.jobId === jobId)?.hex ?? "var(--color-muted-foreground)"
}

/// Recharts hands the tooltip a dataKey; this turns it back into the words on the
/// legend so the two never disagree.
function tooltipLabel(dataKey: string, overlay: Overlay | undefined, mode: OverlayMode): string {
  if (dataKey === "headcount") return "Recommended"
  if (dataKey === "overlayTotal") return mode === "scheduled" ? "Scheduled" : "Clocked in"
  if (dataKey.startsWith("job:")) {
    const jobId = dataKey.slice(4)
    return jobLabel(overlay?.jobs.find((j) => j.jobId === jobId), jobId, overlay?.unknownJobId ?? "")
  }
  return dataKey
}

/// The muted treatment for a switched-off chip. Opacity rather than a colour
/// swap so the position dot stays recognisable — the reader has to be able to
/// tell WHICH curve they hid in order to bring it back.
function chipMuted(shown: boolean): string {
  return shown ? "" : "opacity-40"
}

