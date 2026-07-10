import { round2, yearDates } from "@/lib/goal-engine"

// ─── Forecast import parsing (Phase F, extracted in F-5) ─────────────────────
// Pure row-parsing for /api/forecasting/import, factored out of the route so
// the verify script can round-trip an exported CSV through the real importer
// logic. Accepts two shapes from (key, amount) row pairs:
//   daily   → rows of (date, amount)
//   monthly → rows of (month, amount)
// Extra columns beyond the first two are the caller's to drop — the route and
// the export round-trip both feed (col0, col1).

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
}

export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw !== "string") return null
  const cleaned = raw.replace(/[$,\s]/g, "")
  if (cleaned === "") return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// yyyy-mm-dd from a Date cell, ISO string, or m/d/yyyy — else null.
export function parseDateCell(raw: unknown): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // XLSX cellDates gives local-ish dates; format by UTC first, else local.
    const iso = raw.toISOString().slice(0, 10)
    return iso
  }
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (us) {
    const [, m, d, yRaw] = us
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  return null
}

// Month number 1–12 from "yyyy-mm", "July", "Jul 2026", or a bare 1–12.
export function parseMonthCell(raw: unknown, year: number): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 12) return raw
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.getUTCFullYear() === year ? raw.getUTCMonth() + 1 : null
  }
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase()
  const ym = s.match(/^(\d{4})-(\d{2})(-01)?$/)
  if (ym) return Number(ym[1]) === year ? Number(ym[2]) : null
  const name = s.match(/^([a-z]+)\.?(?:\s+(\d{4}))?$/)
  if (name && MONTH_NAMES[name[1]]) {
    if (name[2] && Number(name[2]) !== year) return null
    return MONTH_NAMES[name[1]]
  }
  const n = Number(s)
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n
  return null
}

export type ParsedImport = {
  shape: "daily" | "monthly"
  rowCount: number
  dailyAmounts: Map<string, number>
  monthTotals: Map<string, number>
  errors: string[]
  warnings: string[]
}

// Raw sheet rows → validated amounts. Keeps rows whose second cell is a usable
// amount; the header row falls out naturally ("Amount" isn't numeric). Shape
// detection: daily wins if the first data row parses as a full date.
export function parseImportRows(rawRows: unknown[][], year: number): ParsedImport | { error: string } {
  const rows = rawRows
    .map((r) => ({ key: r?.[0], amount: parseAmount(r?.[1]) }))
    .filter((r) => r.key !== null && r.key !== undefined && String(r.key).trim() !== "" && r.amount !== null)

  if (rows.length === 0) {
    return { error: "No usable rows found. Expected two columns: date (or month) and amount." }
  }

  const shape: "daily" | "monthly" = parseDateCell(rows[0].key) ? "daily" : "monthly"

  const errors: string[] = []
  const warnings: string[] = []
  const dailyAmounts = new Map<string, number>()
  const monthTotals = new Map<string, number>()

  if (shape === "daily") {
    for (const [i, row] of rows.entries()) {
      const date = parseDateCell(row.key)
      if (!date) {
        errors.push(`Row ${i + 1}: "${String(row.key)}" is not a date`)
        continue
      }
      if (!date.startsWith(`${year}-`)) {
        errors.push(`Row ${i + 1}: ${date} is outside the plan year ${year}`)
        continue
      }
      if (row.amount! < 0) {
        errors.push(`Row ${i + 1}: negative amount for ${date}`)
        continue
      }
      if (dailyAmounts.has(date)) {
        errors.push(`Row ${i + 1}: duplicate date ${date}`)
        continue
      }
      dailyAmounts.set(date, round2(row.amount!))
    }
    const missing = yearDates(year).filter((d) => !dailyAmounts.has(d)).length
    if (missing > 0 && errors.length === 0) {
      warnings.push(`${missing} day(s) of ${year} are not in the file — their goals will be $0.`)
    }
  } else {
    for (const [i, row] of rows.entries()) {
      const m = parseMonthCell(row.key, year)
      if (!m) {
        errors.push(`Row ${i + 1}: "${String(row.key)}" is not a month (or is outside ${year})`)
        continue
      }
      if (row.amount! < 0) {
        errors.push(`Row ${i + 1}: negative amount for month ${m}`)
        continue
      }
      const key = `${year}-${String(m).padStart(2, "0")}`
      if (monthTotals.has(key)) {
        errors.push(`Row ${i + 1}: duplicate month ${key}`)
        continue
      }
      monthTotals.set(key, round2(row.amount!))
    }
    if (monthTotals.size < 12 && errors.length === 0) {
      warnings.push(`Only ${monthTotals.size} of 12 months present — missing months will be $0.`)
    }
  }

  return { shape, rowCount: rows.length, dailyAmounts, monthTotals, errors, warnings }
}
