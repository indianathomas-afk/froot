import { NextResponse } from "next/server"
import { z } from "zod"
import { requireNutrition } from "@/lib/nutrition-access"
import { findOrgIngredient } from "@/lib/nutrition-record"
import { labelReadConfigured, unreadableTypeReason } from "@/lib/label-read"
import { findRecentRead, recordReuse, runLabelRead } from "@/lib/label-read-run"

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
//
// N-1e: the limit, the model call and the audit rows live in
// src/lib/label-read-run.ts, shared with the label inbox, and the limit now
// counts inbox reads too. This route's own reuse is unchanged: a read of THIS
// file on THIS ingredient within 24 h.

export const maxDuration = 60

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

  const subject = { entityType: "Ingredient" as const, entityId: ing.id }
  const doc = { fileUrl: n.labelFileUrl, fileName: n.labelFileName, fileHash: n.labelFileHash, contentType: n.labelContentType! }

  // 24 h reuse: the newest successful read of THIS file (by hash) on this ingredient.
  if (!parsed.data.fresh) {
    const prior = await findRecentRead(ctx.org.id, doc.fileHash, [subject])
    const reused = prior ? await recordReuse(ctx, subject, prior, doc) : null
    if (reused) return NextResponse.json(reused)
  }

  const out = await runLabelRead(ctx, subject, doc)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ readId: out.readId, reused: out.reused, readAt: out.readAt, model: out.model, output: out.output })
}
