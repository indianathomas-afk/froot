import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { put } from "@vercel/blob"
import Papa from "papaparse"
import * as XLSX from "xlsx"
import { requireForecastContext, requireForecastStore } from "@/lib/forecasting-access"
import { buildLastYearBasis, distributeMonthlyTotals, regeneratePlan, round2, yearDates } from "@/lib/goal-engine"
import { parseImportRows } from "@/lib/forecast-import"
import { writeAuditLog } from "@/lib/audit"

// POST /api/forecasting/import — multipart { file, storeId, year, increasePct,
// commit }. Parses a CSV/XLSX budget server-side (row logic shared with the
// export round-trip in src/lib/forecast-import.ts) and accepts two shapes:
//   daily   → rows of (date, amount)
//   monthly → rows of (month, amount), distributed to days by LY weekday
//             weights (even split when no LY sales are cached)
// commit=0 returns a validation preview; commit=1 stores the raw file in
// Vercel Blob and regenerates the plan transactionally. Admin only.

const MAX_BYTES = 5 * 1024 * 1024

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

  const parsedRows = parseImportRows(rawRows, year)
  if ("error" in parsedRows) {
    return NextResponse.json({ error: parsedRows.error }, { status: 400 })
  }
  const { shape, rowCount, dailyAmounts, monthTotals, errors, warnings } = parsedRows

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
    rowCount,
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

  const previousPlan = await prisma.goalPlan.findUnique({ where: { storeId_year: { storeId, year } } })

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

  await writeAuditLog({
    organizationId: ctx.org.id,
    userId: ctx.userId,
    action: "goal.import_commit",
    entityType: "goal_plan",
    entityId: plan.id,
    metadata: {
      storeId,
      storeName: store.name,
      period: String(year),
      before: previousPlan?.goalTotal ?? null,
      after: plan.goalTotal,
      source: "import",
      shape,
      rowCount,
      increasePct,
      fileName: file.name,
      fileUrl: blob.url,
    },
  })

  return NextResponse.json({
    ...preview,
    committed: true,
    plan: { id: plan.id, basisTotal: plan.basisTotal, goalTotal: plan.goalTotal, increasePct },
  })
}
