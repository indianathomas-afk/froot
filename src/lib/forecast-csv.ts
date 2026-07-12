import { escapeCell } from "@/lib/csv"
import { round2 } from "@/lib/pacing"

// ─── Forecast CSV export (Phase F-5) ─────────────────────────────────────────
// Builds the CSV served by /api/forecasting/export. Column order matters: the
// importer (forecast-import.ts) reads (key, amount) from the FIRST TWO columns
// and ignores the rest, so an exported file round-trips — goal becomes the
// imported basis; actual/variance ride along for humans.

export type ForecastCsvRow = {
  key: string // yyyy-mm-dd (daily) or yyyy-mm (monthly)
  goal: number
  actual: number | null // null = no sales cached for the span
}

export function buildForecastCsv(shape: "daily" | "monthly", rows: ForecastCsvRow[]): string {
  const header = [shape === "daily" ? "date" : "month", "goal", "actual", "variance"]
  const lines = rows.map((r) => [
    r.key,
    round2(r.goal),
    r.actual !== null ? round2(r.actual) : "",
    r.actual !== null ? round2(r.actual - r.goal) : "",
  ])
  return [header, ...lines].map((row) => row.map(escapeCell).join(",")).join("\n")
}
