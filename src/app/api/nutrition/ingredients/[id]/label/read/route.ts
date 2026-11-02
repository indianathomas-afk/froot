import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { NutritionFileError, readLabelBytes } from "@/lib/nutrition-files"
import { findOrgIngredient, nutritionAudit } from "@/lib/nutrition-record"
import { LABEL_READ_MODEL, LabelReadError, labelReadConfigured, readLabelWithModel, unreadableTypeReason } from "@/lib/label-read"
import { parseLabelOutput } from "@/lib/label-review"

// POST /api/nutrition/ingredients/[id]/label/read — N-1c "Read label". ADMIN
// (nutrition.manage). Sends the ingredient's stored label document to the
// model and returns what it transcribed; the dialog builds the side-by-side
// review from it (src/lib/label-review.ts). WRITES NO NUTRITION — Apply goes
// through PUT …/[id] like any other save (deliverable 4).
//
// Gary, 2026-11-02: "Read label is a button only; never read on upload." N-1c
// F6 ("Read label requires saved nutrition first, for N-1c") is superseded by
// N1D-F1: any non-PREPARED food ingredient with a document. "Rate limit 30
// reads/hour and 300/day per org via audit rows; 24 h reuse of a result for the
// same file; maxDuration 60 with a 45 s call timeout."
//
// Every outcome writes one AuditLog row (deliverable 5): the file name and
// hash, the model, success or failure. The transcribed values are kept on the
// success row — they are what the 24 h reuse returns — but never the file.

export const maxDuration = 60

const HOUR_LIMIT = 30
const DAY_LIMIT = 300
const REUSE_MS = 24 * 60 * 60 * 1000
const COUNTED: string[] = ["nutrition.label.read", "nutrition.label.read.failed"]

// { fresh: true } skips the 24 h reuse (the review's "Read again"); still rate-limited.
const Schema = z.object({ fresh: z.boolean().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })

  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (ing.kind === "PREPARED") return NextResponse.json({ error: "A prepared ingredient's nutrition is computed from its recipe" }, { status: 409 })
  if (ing.nutritionExempt) return NextResponse.json({ error: "Not-food items carry no nutrition label" }, { status: 409 })
  const n = ing.nutrition
  if (!n?.labelFileUrl || !n.labelFileHash) return NextResponse.json({ error: "Upload a label document first" }, { status: 409 })
  const typeReason = unreadableTypeReason(n.labelContentType)
  if (typeReason) return NextResponse.json({ error: typeReason, code: "UNSUPPORTED_TYPE" }, { status: 415 })
  if (!labelReadConfigured()) {
    return NextResponse.json({ error: "Label reading isn't set up in this environment (ANTHROPIC_API_KEY is not set)" }, { status: 503 })
  }

  const doc = { fileName: n.labelFileName, fileHash: n.labelFileHash, contentType: n.labelContentType }
  const now = Date.now()

  // 24 h reuse: the newest successful read of THIS file (by hash) on this ingredient.
  if (!parsed.data.fresh) {
    const prior = await prisma.auditLog.findFirst({
      where: {
        organizationId: ctx.org.id,
        entityType: "Ingredient",
        entityId: ing.id,
        action: { in: ["nutrition.label.read", "nutrition.label.read.reused"] },
        createdAt: { gte: new Date(now - REUSE_MS) },
        metadata: { path: ["fileHash"], equals: n.labelFileHash },
      },
      orderBy: { createdAt: "desc" },
    })
    const meta = prior?.metadata as { output?: unknown; model?: string; readAt?: string } | null
    const reused = meta?.output !== undefined ? parseLabelOutput(meta.output) : null
    if (prior && reused?.ok) {
      const readAt = meta?.readAt ?? prior.createdAt.toISOString()
      const row = await nutritionAudit(prisma, ctx, "nutrition.label.read.reused", ing.id, {
        ...doc, model: meta?.model ?? null, reusedFromId: prior.id, readAt, output: reused.output,
      })
      return NextResponse.json({ readId: row.id, reused: true, readAt, model: meta?.model ?? null, output: reused.output })
    }
  }

  // Per-org limit, counted from the audit trail so it holds across instances.
  const windowRows = await prisma.auditLog.findMany({
    where: { organizationId: ctx.org.id, entityType: "Ingredient", action: { in: COUNTED }, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  })
  const lastHour = windowRows.filter((r) => r.createdAt.getTime() >= now - 60 * 60 * 1000)
  const limited = lastHour.length >= HOUR_LIMIT ? { rows: lastHour, span: 60 * 60 * 1000, what: `${HOUR_LIMIT} label reads an hour` }
    : windowRows.length >= DAY_LIMIT ? { rows: windowRows, span: 24 * 60 * 60 * 1000, what: `${DAY_LIMIT} label reads a day` }
    : null
  if (limited) {
    const minutes = Math.max(1, Math.ceil((limited.rows[0].createdAt.getTime() + limited.span - now) / 60000))
    return NextResponse.json({ error: `Your organization has used its ${limited.what}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, { status: 429 })
  }

  const started = Date.now()
  try {
    const { bytes } = await readLabelBytes(n.labelFileUrl)
    // The type checked against the file's first bytes at register (N-1b), not the store's header.
    const output = await readLabelWithModel(bytes, n.labelContentType!)
    const readAt = new Date().toISOString()
    const row = await nutritionAudit(prisma, ctx, "nutrition.label.read", ing.id, {
      ...doc, model: LABEL_READ_MODEL, ok: true, durationMs: Date.now() - started, readAt, output,
    })
    return NextResponse.json({ readId: row.id, reused: false, readAt, model: LABEL_READ_MODEL, output })
  } catch (err) {
    const known = err instanceof LabelReadError || err instanceof NutritionFileError
    if (!known) console.error("[api/nutrition/label/read] read failed:", err)
    await nutritionAudit(prisma, ctx, "nutrition.label.read.failed", ing.id, {
      ...doc, model: LABEL_READ_MODEL, ok: false, durationMs: Date.now() - started,
      error: err instanceof LabelReadError ? err.code : err instanceof NutritionFileError ? "storage" : "unexpected",
    })
    if (err instanceof LabelReadError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: "Reading the label failed. Try again." }, { status: 500 })
  }
}
