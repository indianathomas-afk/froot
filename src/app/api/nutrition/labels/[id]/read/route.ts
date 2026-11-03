import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { INBOX_ENTITY } from "@/lib/nutrition-record"
import { labelReadConfigured } from "@/lib/label-read"
import { READ_ENTITIES, findRecentRead, recordReuse, runLabelRead, type ReadResult, type ReadSubject } from "@/lib/label-read-run"
import { findInboxItem, inboxCandidates, serializeInboxItems } from "@/lib/label-inbox"
import { suggestFromLabel } from "@/lib/label-match"

// POST /api/nutrition/labels/[id]/read — read one inbox file. ADMIN
// (nutrition.manage). "Read all" calls this once per file, ONE AT A TIME
// (N1E-F3). Writes no nutrition.
//
// Reuse, in order — none of them is a model call or counts toward the limit:
//   1. this item's own read, for as long as the item is in the inbox
//      (R1, Gary 2026-11-02, "Accept all leans": paid reads survive a closed
//      tab and a day's gap);
//   2. N-1c's 24 h reuse, widened to the org: a read of the same file (by
//      hash) on any ingredient or inbox item within 24 h.
// Otherwise the shared read (src/lib/label-read-run.ts): the per-org 30/hour,
// 300/day limit counted across the dialog and the inbox, a 429 with retryAt
// that stops the batch cleanly, and one AuditLog row per outcome. A failure is
// this row's alone. { fresh: true } skips both reuses ("Read again").
//
// After a read, if no ingredient is confirmed yet, the label's printed product
// name replaces the filename suggestion — a SUGGESTION only (N1E-F2).

export const maxDuration = 60

const Schema = z.object({ fresh: z.boolean().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })

  const item = await findInboxItem(ctx.org.id, id)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!item.fileUrl || (item.status !== "UPLOADED" && item.status !== "READ" && item.status !== "FAILED")) {
    return NextResponse.json({ error: "This file is no longer in the inbox" }, { status: 409 })
  }
  if (!labelReadConfigured()) {
    return NextResponse.json({ error: "Label reading isn't set up in this environment (ANTHROPIC_API_KEY is not set)" }, { status: 503 })
  }

  const subject: ReadSubject = { entityType: INBOX_ENTITY, entityId: item.id }
  const doc = { fileUrl: item.fileUrl, fileName: item.fileName, fileHash: item.fileHash, contentType: item.contentType }
  let result: ReadResult | null = null

  if (!parsed.data.fresh && item.readAuditId) {
    const own = await prisma.auditLog.findFirst({ where: { id: item.readAuditId, organizationId: ctx.org.id } })
    if (own) {
      const [out] = await serializeInboxItems([item])
      if (out.read) return NextResponse.json(out)
    }
  }
  if (!parsed.data.fresh) {
    const prior = await findRecentRead(ctx.org.id, item.fileHash, READ_ENTITIES.map((entityType) => ({ entityType })))
    if (prior) result = await recordReuse(ctx, subject, prior, doc)
  }
  if (!result) {
    const out = await runLabelRead(ctx, subject, doc)
    if (!out.ok) {
      if (out.status === 429) {
        // The limit is not this file's failure: the row stays as it was.
        return NextResponse.json({ error: out.error, code: "RATE_LIMITED", retryAt: out.retryAt }, { status: 429 })
      }
      await prisma.nutritionLabelInboxItem.update({ where: { id: item.id }, data: { status: "FAILED", readError: out.error } })
      return NextResponse.json({ error: out.error }, { status: out.status })
    }
    result = { readId: out.readId, reused: out.reused, readAt: out.readAt, model: out.model, output: out.output }
  }

  const suggestion = item.ingredientId
    ? null
    : suggestFromLabel(result.output, await inboxCandidates(ctx.org.id))
  const updated = await prisma.nutritionLabelInboxItem.update({
    where: { id: item.id },
    data: {
      status: "READ",
      readAuditId: result.readId,
      readError: null,
      // A label suggestion replaces the filename one; it never touches a confirmed ingredient.
      ...(suggestion && suggestion.suggestedId && { suggestedIngredientId: suggestion.suggestedId }),
    },
  })
  const [out] = await serializeInboxItems([updated])
  return NextResponse.json(out)
}
