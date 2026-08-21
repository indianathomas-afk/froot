"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Stethoscope, CircleAlert, CalendarClock, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agoLabel } from "@/lib/overlay-legend"

// Labor Day Inspector (OVL-S5) — the client half.
//
// EVERY LABEL AND EVERY PERCENTAGE ARRIVES PRE-COMPUTED. The store's timezone
// lives on the server and the conversion happens where the answer is known, so
// this file adds ZERO new format() sites for an instant — the S4 posture for
// clockInAt, applied to a whole page. The only date arithmetic below is on
// yyyy-mm-dd STRINGS for the day navigator, which is timezone-free by
// construction.
//
// THE TIMELINE IS STYLED ROWS, NOT RECHARTS (S5-D4). Recharts has no Gantt
// primitive, and the nearest fake — a stacked BarChart with a transparent offset
// segment — CANNOT DRAW TWO OVERLAPPING BARS ON ONE ROW. That case is DOUBLE, one
// of the six flags this page exists to show, so the library that cannot render it
// is the wrong library. Absolutely-positioned bars in a percentage-width track
// render overlap natively and cost no dependency.

type FlagCode = "OPEN-STALE" | "OPEN-LONG" | "DOUBLE" | "UNMAPPED" | "NO-SHOW" | "UNSCHEDULED"

type Bar = {
  key: string
  startPct: number
  endPct: number
  startLabel: string
  endLabel: string | null
  open: boolean
  continuesBefore: boolean
  continuesAfter: boolean
  jobId: string
  title: string | null
  startedOn: string | null
  flags: FlagCode[]
  detail: string
}

type Person = {
  key: string
  name: string
  unmapped: boolean
  flags: FlagCode[]
  paidLabel: string | null
  bars: Bar[]
  ghosts: Bar[]
}

type Job = { jobId: string; title: string | null; colorKey: string; hex: string }
type Health = "never" | "fresh" | "stale" | "error"
type ScheduleHealth = Health | "synced-empty"

type InspectorResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  date: string
  hourTicks: { pct: number; label: string }[]
  people: Person[]
  counts: Record<FlagCode, number>
  cardsOnFloor: number
  jobIds: string[]
  scheduleSuppressed: boolean
  durationSuppressed: boolean
  jobs: Job[]
  timecardSync: { health: Health; lastSyncOkAt: string | null; lastTimecardCount: number }
  scheduleSync: { health: ScheduleHealth; lastSyncOkAt: string | null; lastShiftCount: number }
}

// Class strings are written out LITERALLY — Tailwind 4 generates utilities by
// scanning source text, so an interpolated `bg-${x}-50` is never generated and
// renders unstyled (badge-presets.ts says this at length).
const FLAG_META: Record<FlagCode, { label: string; chip: string; bar: string; help: string }> = {
  "OPEN-STALE": {
    label: "Open, stale",
    chip: "bg-red-100 text-red-700 border-red-200",
    bar: "outline-2 outline-red-500",
    help: "Still open in Froot, but it started before today. This is the BUG-10 phantom — a clock-out that landed after the day's last sync and was never seen. Check the card in Square.",
  },
  "OPEN-LONG": {
    label: "Open, long",
    chip: "bg-amber-100 text-amber-700 border-amber-200",
    bar: "outline-2 outline-amber-500",
    help: "Opened today and still running past the long-shift threshold. Usually a missed clock-out; occasionally a real long shift. It is a prompt to go look, not a finding.",
  },
  DOUBLE: {
    label: "Double",
    chip: "bg-red-100 text-red-700 border-red-200",
    bar: "outline-2 outline-red-500",
    help: "Two timecards for one person overlapping in time, at this store. Both are drawn on the row so you can see the overlap.",
  },
  UNMAPPED: {
    label: "Unmapped",
    chip: "bg-purple-100 text-purple-700 border-purple-200",
    bar: "outline-2 outline-purple-500",
    help: "Square knows this person and Froot has no staff record for them, so they render as Unnamed. They are never dropped — a missing name would otherwise hide real hours.",
  },
  "NO-SHOW": {
    label: "No-show",
    chip: "bg-amber-100 text-amber-700 border-amber-200",
    bar: "outline-2 outline-amber-500",
    help: "A scheduled shift with no timecard overlapping it. Either they did not work it, or they clocked in under a different person or store.",
  },
  UNSCHEDULED: {
    label: "Unscheduled",
    chip: "bg-blue-100 text-blue-700 border-blue-200",
    bar: "outline-2 outline-blue-500",
    help: "A timecard with no scheduled shift behind it. Either an unplanned shift, or the schedule was written after the fact.",
  },
}

const FLAG_ORDER: FlagCode[] = ["OPEN-STALE", "OPEN-LONG", "DOUBLE", "UNMAPPED", "NO-SHOW", "UNSCHEDULED"]

const pad = (n: number) => String(n).padStart(2, "0")
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}
const dayLabel = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export function DayInspectorClient({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [date, setDate] = useState(() => todayStr())
  const [data, setData] = useState<{ key: string; res: InspectorResponse | null } | null>(null)

  const key = `${storeId}|${date}`
  const load = useCallback(() => {
    if (!storeId) return
    fetch(`/api/labor/day-inspector?storeId=${storeId}&date=${date}`)
      .then((r): Promise<InspectorResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => setData({ key, res }))
      .catch(() => setData({ key, res: null }))
  }, [storeId, date, key])

  useEffect(() => {
    load()
  }, [load])

  const loading = !data || data.key !== key
  const res = data?.res ?? null

  if (stores.length === 0) {
    return (
      <div>
        <Header />
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No Square-linked stores to inspect. A store needs a Square location linked before its
            timecards and scheduled shifts can be mirrored.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <Header />
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
      </div>

      {/* Day navigator */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setDate(addDays(date, -1))}
          className="p-1.5 rounded hover:bg-[var(--color-accent)]"
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-[var(--color-foreground)] min-w-[150px] text-center">
          {dayLabel(date)}
        </span>
        <button
          onClick={() => setDate(addDays(date, 1))}
          className="p-1.5 rounded hover:bg-[var(--color-accent)]"
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {date !== todayStr() && (
          <button onClick={() => setDate(todayStr())} className="text-xs text-[var(--color-primary)] hover:underline ml-1">
            today
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !res ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Couldn&apos;t load this day — try again in a moment.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <FreshnessStrip res={res} />
          <FlagStrip res={res} />
          <Timeline res={res} />
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Stethoscope className="h-5 w-5 text-[var(--color-primary)]" />
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Day Inspector</h1>
      </div>
      <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
        Every timecard on one store-day, with the scheduled shifts ghosted behind. For diagnosing a
        Square-vs-Froot labor variance without opening the database. Read-only — corrections happen in
        Square.
      </p>
    </div>
  )
}

// ── freshness (both syncs, 26h threshold, seam (c)) ──────────────────────────
function FreshnessStrip({ res }: { res: InspectorResponse }) {
  const tc = res.timecardSync
  const sc = res.scheduleSync
  return (
    <Card>
      <CardContent className="py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <Stamp
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Timecards"
          health={tc.health}
          iso={tc.lastSyncOkAt}
        />
        <Stamp
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Schedule"
          health={sc.health}
          iso={sc.lastSyncOkAt}
        />
        <span className="text-[var(--color-muted-foreground)] text-[12px]">
          Lag is not truth — a figure below is only as current as the sync above it.
        </span>
      </CardContent>
    </Card>
  )
}

function Stamp({
  icon,
  label,
  health,
  iso,
}: {
  icon: React.ReactNode
  label: string
  health: Health | "synced-empty"
  iso: string | null
}) {
  const tone =
    health === "fresh"
      ? "text-[#1d7c2e]"
      : health === "never" || health === "synced-empty"
        ? "text-[var(--color-muted-foreground)]"
        : "text-[#b42318]"
  const word =
    health === "never"
      ? "never synced"
      : health === "synced-empty"
        ? "synced, nothing scheduled"
        : health === "fresh"
          ? "fresh"
          : health === "stale"
            ? "stale"
            : "error"
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--color-muted-foreground)]">
      {icon}
      <span className="font-semibold text-[var(--color-foreground)]">{label}</span>
      <span className={`font-medium ${tone}`}>{word}</span>
      {health !== "never" && <span>· synced {agoLabel(iso)}</span>}
    </span>
  )
}

// ── the flags ─────────────────────────────────────────────────────────────────
function FlagStrip({ res }: { res: InspectorResponse }) {
  const raised = FLAG_ORDER.filter((f) => res.counts[f] > 0)
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          {raised.length === 0 ? (
            <span className="text-[13px] text-[var(--color-muted-foreground)]">
              No variance flags raised for this day.
            </span>
          ) : (
            raised.map((f) => (
              <span
                key={f}
                title={FLAG_META[f].help}
                className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-2 py-0.5 rounded-full border ${FLAG_META[f].chip}`}
              >
                {FLAG_META[f].label}
                <span className="tabular-nums">{res.counts[f]}</span>
              </span>
            ))
          )}
        </div>

        {/* S5-A6 — say what the number counts, and say what it will not match. */}
        <p className="text-[12px] text-[var(--color-muted-foreground)] mt-2">
          {res.cardsOnFloor} card{res.cardsOnFloor === 1 ? "" : "s"} on the floor during this day. Flag
          counts are per person, not per card. This page counts a card on every day it{" "}
          <em>overlaps</em>, so a shift crossing midnight appears in both days&apos; views by design —
          which means these totals will <strong>not</strong> reconcile with the Weekly Plan&apos;s day
          figures, where a card belongs only to the day it started (Square&apos;s own business-day
          rule).
        </p>

        {res.scheduleSuppressed && (
          <p className="flex items-start gap-1.5 text-[12px] text-[var(--color-muted-foreground)] mt-1.5">
            <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              No schedule data for this store-day, so <strong>No-show</strong> and{" "}
              <strong>Unscheduled</strong> are not computed. Nothing here says a shift was unplanned —
              only that there is no plan to compare it against.
            </span>
          </p>
        )}
        {res.durationSuppressed && (
          <p className="flex items-start gap-1.5 text-[12px] text-[var(--color-muted-foreground)] mt-1.5">
            <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              The timecard sync is not fresh, so <strong>Open, long</strong> is not computed — every
              open card looks long once Froot stops being told. <strong>Open, stale</strong> is still
              computed: it is a date comparison, and a broken sync is exactly when it matters most.
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ── the timeline ──────────────────────────────────────────────────────────────
function Timeline({ res }: { res: InspectorResponse }) {
  const hexOf = useMemo(() => {
    const m = new Map(res.jobs.map((j) => [j.jobId, j.hex]))
    return (jobId: string) => m.get(jobId) ?? "#99a1af"
  }, [res.jobs])

  if (res.people.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
          Nothing on the floor and nothing scheduled for this store-day.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-5 pb-4 overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Hour axis */}
          <div className="flex">
            <div className="w-44 shrink-0" />
            <div className="relative flex-1 h-5">
              {res.hourTicks.map((t, i) => (
                <span
                  key={t.label + i}
                  className="absolute top-0 -translate-x-1/2 text-[10px] text-[var(--color-muted-foreground)]"
                  style={{ left: `${t.pct}%` }}
                >
                  {i % 2 === 0 ? t.label : ""}
                </span>
              ))}
            </div>
          </div>

          {res.people.map((p) => (
            <div key={p.key} className="flex items-stretch border-t border-[var(--color-border)]">
              <div className="w-44 shrink-0 py-2 pr-3">
                <div className="text-[13px] font-semibold text-[var(--color-foreground)] truncate" title={p.name}>
                  {p.name}
                </div>
                {p.paidLabel && (
                  <div className="text-[11px] text-[var(--color-muted-foreground)] tabular-nums">{p.paidLabel}</div>
                )}
                {p.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {FLAG_ORDER.filter((f) => p.flags.includes(f)).map((f) => (
                      <span
                        key={f}
                        title={FLAG_META[f].help}
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${FLAG_META[f].chip}`}
                      >
                        {FLAG_META[f].label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative flex-1 py-2">
                {/* gridlines */}
                {res.hourTicks.map((t, i) => (
                  <span
                    key={`g${i}`}
                    className="absolute inset-y-0 w-px bg-[var(--color-border)]/60"
                    style={{ left: `${t.pct}%` }}
                  />
                ))}

                {/* ghosted scheduled shifts, behind */}
                {p.ghosts.map((g) => (
                  <span
                    key={g.key}
                    title={`${g.detail}${g.flags.length ? ` · ${g.flags.map((f) => FLAG_META[f].label).join(", ")}` : ""}`}
                    className={`absolute top-2 h-7 rounded-md border-2 border-dashed opacity-70 ${
                      g.flags.length ? FLAG_META[g.flags[0]].bar : ""
                    }`}
                    style={{
                      left: `${g.startPct}%`,
                      width: `${Math.max(g.endPct - g.startPct, 0)}%`,
                      minWidth: 3,
                      borderColor: hexOf(g.jobId),
                      background: `${hexOf(g.jobId)}14`,
                    }}
                  />
                ))}

                {/* timecards, in front — overlapping bars sit on top of each
                    other, which is exactly how DOUBLE reads */}
                {p.bars.map((b) => (
                  <span
                    key={b.key}
                    title={`${b.title ?? "No position recorded"} · ${b.detail}${
                      b.startedOn ? ` · started ${b.startedOn}` : ""
                    }${b.flags.length ? ` · ${b.flags.map((f) => FLAG_META[f].label).join(", ")}` : ""}`}
                    className={`absolute top-3.5 h-5 rounded-md ${b.flags.length ? FLAG_META[b.flags[0]].bar : ""} ${
                      b.continuesBefore ? "rounded-l-none" : ""
                    } ${b.continuesAfter || b.open ? "rounded-r-none" : ""}`}
                    style={{
                      left: `${b.startPct}%`,
                      width: `${Math.max(b.endPct - b.startPct, 0)}%`,
                      minWidth: 3,
                      background: hexOf(b.jobId),
                      // An OPEN card is drawn faded toward its ceiling: the hours
                      // are real up to now and unknown after, and a hard edge
                      // would read as a clock-out that never happened.
                      opacity: b.open ? 0.75 : 1,
                    }}
                  >
                    {b.startedOn && (
                      <span className="absolute -top-3.5 left-0 text-[9px] font-semibold text-[#b42318] whitespace-nowrap">
                        {b.startedOn}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3 mt-1 border-t border-[var(--color-border)] text-[11px] text-[var(--color-muted-foreground)]">
            {res.jobs.map((j) => (
              <span key={j.jobId} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: j.hex }} />
                {j.title ?? "Unnamed position"}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded border-2 border-dashed border-[var(--color-muted-foreground)]" />
              scheduled
            </span>
            <span>
              Bars are clock-in to clock-out. Break minutes are stored as a total, never as intervals,
              so no break is drawn inside a bar.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
