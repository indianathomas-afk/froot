import { NextResponse } from "next/server"
import { put } from "@vercel/blob"
import Papa from "papaparse"
import * as XLSX from "xlsx"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { buildLastYearBasis, distributeMonthlyTotals, regeneratePlan, round2, yearDates } from "@/lib/goal-engine"

// POST /api/forecasting/import — multipart { file, storeId, year, increasePct,
// commit }. Parses a CSV/XLSX budget server-side and accepts two shapes:
//   daily   → rows of (date, amount)
//   monthly → rows of (month, amount), distributed to days by LY weekday
//             weights (even split when no LY sales are cached)
// commit=0 returns a validation preview; commit=1 stores the raw file in
// Vercel Blob and regenerates the plan transactionally. Admin only.

const MAX_BYTES = 5 * 1024 * 1024

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
}

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw !== "string") return null
  const cleaned = raw.replace(/[$,\s]/g, "")
  if (cleaned === "") return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// yyyy-mm-dd from a Date cell, ISO string, or m/d/yyyy — else null.
function parseDateCell(raw: unknown): string | null {
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
function parseMonthCell(raw: unknown, year: number): number | null {
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

async function extractRows(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  }
  const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true })
  return parsed.data
}

export async function POST(req: Request) {
  const ctx = await requireForecastContext({ write: true })
  if ("error" in ctx) return ctx.error

  const form = await req.formData()
  const file = form.get("file") as File | null
  const storeId = String(form.get("storeId") ?? "")
  const year = Number(form.get("year"))
  const increasePct = Number(form.get("increasePct") ?? 0)
  const commit = String(form.get("commit") ?? "0") === "1"

  if (!file || !storeId || !Number.isInteger(year)) {
    return NextResponse.json({ error: "file, storeId and year are required" }, { status: 400 })
  }
  if (!Number.isFinite(increasePct) || increasePct < -100 || increasePct > 1000) {
    return NextResponse.json({ error: "increasePct must be between -100 and 1000" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 5 MB or smaller" }, { status: 413 })
  }
  const store = await requireForecastStore(ctx, storeId)
  if ("error" in store) return store.error

  let rawRows: unknown[][]
  try {
    rawRows = await extractRows(file)
  } catch {
    return NextResponse.json({ error: "Couldn't read that file — upload a CSV or XLSX." }, { status: 400 })
  }

  // Keep rows whose second cell is a usable amount; the header row falls out
  // naturally ("Amount" isn't numeric).
  const rows = rawRows
    .map((r) => ({ key: r?.[0], amount: parseAmount(r?.[1]) }))
    .filter((r) => r.key !== null && r.key !== undefined && String(r.key).trim() !== "" && r.amount !== null)

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No usable rows found. Expected two columns: date (or month) and amount." },
      { status: 400 }
    )
  }

  // Shape detection: daily wins if the first data row parses as a full date.
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

  // Build the per-day basis. Monthly totals spread by LY weekday weights when
  // any LY sales are cached, even split otherwise.
  let basisByDay = new Map<string, number>()
  let distribution: "ly-weekday-weights" | "even" | null = null
  if (errors.length === 0) {
    if (shape === "daily") {
      basisByDay = new Map(yearDates(year).map((d) => [d, dailyAmounts.get(d) ?? 0]))
    } else {
      const coverage = await buildLastYearBasis(storeId, year)
      const hasLy = coverage.alignedDays + coverage.fallbackDays > 0
      distribution = hasLy ? "ly-weekday-weights" : "even"
      basisByDay = distributeMonthlyTotals(year, monthTotals, hasLy ? coverage.basisByDay : null)
      for (const d of yearDates(year)) if (!basisByDay.has(d)) basisByDay.set(d, 0)
    }
  }

  let basisTotal = 0
  for (const v of basisByDay.values()) basisTotal += v
  basisTotal = round2(basisTotal)

  const monthPreview = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`
    let total = 0
    for (const [d, v] of basisByDay) if (d.slice(0, 7) === key) total += v
    return { month: key, total: round2(total) }
  })

  const preview = {
    shape,
    rowCount: rows.length,
    basisTotal,
    goalTotal: round2(basisTotal * (1 + increasePct / 100)),
    months: monthPreview,
    distribution,
    warnings,
    errors,
  }

  if (!commit) return NextResponse.json({ ...preview, committed: false })
  if (errors.length > 0) {
    return NextResponse.json({ error: "Fix the file errors before committing.", ...preview }, { status: 400 })
  }

  const ext = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : file.name.toLowerCase().endsWith(".xls") ? "xls" : "csv"
  const blob = await put(`forecasting/${ctx.org.id}/${storeId}/${year}-${Date.now()}.${ext}`, file, {
    access: "public",
  })

  const plan = await regeneratePlan({
    organizationId: ctx.org.id,
    storeId,
    year,
    basisType: "IMPORT",
    increasePct,
    basisByDay,
    updatedById: ctx.userId,
    importFileUrl: blob.url,
    preserveOverrides: false, // a fresh import replaces everything
  })

  return NextResponse.json({
    ...preview,
    committed: true,
    plan: { id: plan.id, basisTotal: plan.basisTotal, goalTotal: plan.goalTotal, increasePct },
  })
}
