"use client"

import { useEffect, useMemo, useState } from "react"
import { Users } from "lucide-react"
import { Line, LineChart, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceArea } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSalesViewedDay } from "./sales-performance-card"

// Labor Coverage card (Dashboard, Phase 1B — "Recommended · guidance"). A
// headcount step line for the currently-viewed day, using the same hourly-sales
// source as the Sales Performance card for its demand shape (GET
// /api/labor/coverage). Single y-axis (headcount) — never dollars. Sits
// directly beneath the Sales card so the hourly axes align.

type CoveragePoint = { hour: number; headcount: number; open: boolean }

type CoverageResponse = {
  store: { id: string; name: string; timezone: string }
  today: string
  date: string
  weekStart: string
  available: boolean
  hasForecast: boolean
  hasShape: boolean
  totalSchedulableHours: number | null
  coverage: { points: CoveragePoint[]; openHours: number[]; peakHours: number[]; dayHours: number; peakHeadcount: number } | null
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
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export function LaborCoverageCard({ storeId }: { storeId: string }) {
  const viewedDay = useSalesViewedDay()
  const [data, setData] = useState<{ key: string; res: CoverageResponse | null } | null>(null)

  const key = `${storeId}|${viewedDay ?? "today"}`
  useEffect(() => {
    if (!storeId) return
    const q = viewedDay ? `&date=${viewedDay}` : ""
    fetch(`/api/labor/coverage?storeId=${storeId}${q}`)
      .then((r): Promise<CoverageResponse | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((res) => setData({ key, res }))
      .catch(() => setData({ key, res: null }))
  }, [storeId, viewedDay, key])

  const loading = !data || data.key !== key
  const res = data?.res ?? null

  const chart = useMemo(() => {
    if (!res?.coverage) return { rows: [], peakStart: null as string | null, peakEnd: null as string | null, maxHead: 0 }
    // Start the axis at 6a to match the Sales Performance card.
    const pts = res.coverage.points.filter((p) => p.hour >= 6)
    const rows = pts.map((p) => ({ label: hourLabel(p.hour), headcount: p.open ? p.headcount : null }))
    const peaks = res.coverage.peakHours.filter((h) => h >= 6)
    return {
      rows,
      peakStart: peaks.length ? hourLabel(Math.min(...peaks)) : null,
      peakEnd: peaks.length ? hourLabel(Math.max(...peaks)) : null,
      maxHead: res.coverage.peakHeadcount,
    }
  }, [res])

  if (loading) return <Skeleton className="h-56 w-full" />

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-[var(--color-primary)]" />
            <p className="text-[15px] font-bold text-[var(--color-foreground)]">Labor Coverage</p>
          </div>
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-primary)] uppercase">
            Recommended · guidance
          </span>
        </div>

        {!res ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">Couldn’t load coverage — try again in a moment.</p>
        ) : !res.hasForecast ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">
            Set this week’s projected sales (Labor Budget card) to see recommended coverage.
          </p>
        ) : !res.available ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">
            Recommended coverage needs live hourly sales — connect Square and activate Inventory.
          </p>
        ) : !res.hasShape || chart.rows.every((r) => r.headcount === null) ? (
          <p className="text-sm text-[var(--color-muted-foreground)] py-6">
            No hourly sales shape for {res && dayLabel(res.date, res.today)} yet — the recommendation fills in as sales record.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] text-[var(--color-muted-foreground)] mb-2">
              Suggested staff on floor · {dayLabel(res.date, res.today)}
              {chart.peakStart ? ` · peak ${chart.peakStart}${chart.peakEnd && chart.peakEnd !== chart.peakStart ? `–${chart.peakEnd}` : ""}` : ""}
            </p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.rows}>
                  {chart.peakStart && (
                    <ReferenceArea x1={chart.peakStart} x2={chart.peakEnd ?? chart.peakStart} fill="var(--color-primary)" fillOpacity={0.08} />
                  )}
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={28}
                    allowDecimals={false}
                    domain={[0, Math.max(2, chart.maxHead + 1)]}
                  />
                  <ChartTooltip formatter={(v) => [`${v} on floor`, "Recommended"]} />
                  <Line type="stepAfter" dataKey="headcount" stroke="var(--color-primary)" strokeWidth={3} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-[var(--color-muted-foreground)] mt-2">
              A guide from the weekly budget shaped by this day’s sales — not a schedule. Single-shift headcount, floor of 1 while open.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
