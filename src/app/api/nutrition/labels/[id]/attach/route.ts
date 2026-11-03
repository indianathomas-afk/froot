import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import {
  NutritionFileError, copyLabelBlob, deleteLabelBlob, inspectStoredLabel, labelKeyPrefix, uniqueLabelPathname,
} from "@/lib/nutrition-files"
import { findOrgIngredient, serializeIngredient } from "@/lib/nutrition-record"
import { attachQuestion, proofRefusal } from "@/lib/nutrition-proof"
import { attachLabelDocument, questionResponse } from "@/lib/nutrition-label-attach"
import { recordReuse } from "@/lib/label-read-run"
import { findInboxItem } from "@/lib/label-inbox"
import { applyBlocker } from "@/lib/label-match"

// POST /api/nutrition/labels/[id]/attach — step 1 of the review queue's
// Apply (N-1e deliverable 3). ADMIN (nutrition.manage).
//
// Apply in the queue is the dialog's Apply with one step in front (audit § A):
//   1. THIS route: the inbox file becomes the confirmed ingredient's label
//      document — a copy inside the store into the ingredient's folder (R2),
//      written by attachLabelDocument, the same write as a dialog upload — and
//      the inbox read is recorded on the ingredient as a `.reused` read, so
//      the response carries a readId the existing PUT accepts. No model call:
//      the item's read is reusable for its life in the inbox (R1).
//   2–3. the client sends the EXISTING PUT /api/nutrition/ingredients/[id]
//      with appliedFromRead, then POST …/verify — byte-for-byte the dialog's
//      applyRead. Neither route changed: no second write path.
//
// Refused until an ADMIN has confirmed the ingredient (N1E-F2). Asks "Replace
// current label?" when the ingredient already has one (N1E-F5), then "Still
// verified?" (N-1b F3) — both before anything is copied. The old document is
// deleted only after the replace succeeds; the inbox copy after that.

export const maxDuration = 60

const Schema = z.object({ replaceLabel: z.boolean().optional(), keepVerified: z.boolean().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })

  const item = await findInboxItem(ctx.org.id, id)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const blocker = applyBlocker(item)
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 })

  const ing = await findOrgIngredient(ctx.org.id, item.ingredientId!)
  if (!ing) return NextResponse.json({ error: "The confirmed ingredient no longer exists — pick another" }, { status: 409 })
  const refusal = proofRefusal(ing)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })

  const question = attachQuestion(ing.nutrition, { askReplace: true, ...parsed.data })
  if (question) return questionResponse(question)

  const readRow = await prisma.auditLog.findFirst({ where: { id: item.readAuditId!, organizationId: ctx.org.id } })
  if (!readRow) return NextResponse.json({ error: "Read the label again first" }, { status: 409 })

  const pathname = uniqueLabelPathname(labelKeyPrefix(ctx.org.id, ing.id), item.fileName)
  let copiedUrl: string | null = null
  try {
    copiedUrl = await copyLabelBlob(item.fileUrl!, pathname, item.contentType)
    const meta = await inspectStoredLabel(copiedUrl)
    if (meta.fileHash !== item.fileHash) {
      await deleteLabelBlob(copiedUrl)
      return NextResponse.json({ error: "The stored file changed. Discard it and add it again." }, { status: 409 })
    }
    await attachLabelDocument(ctx, ing, { meta, pathname, fileName: item.fileName }, {
      keepVerified: parsed.data.keepVerified,
      ...(item.sourceUrl && { sourceUrl: item.sourceUrl }),
      audit: { inboxItemId: item.id, via: item.sourceUrl ? "inbox-link" : "inbox" },
    })
  } catch (err) {
    if (copiedUrl) await deleteLabelBlob(copiedUrl)
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  const read = await recordReuse(ctx, { entityType: "Ingredient", entityId: ing.id }, readRow, {
    fileName: item.fileName, fileHash: item.fileHash, contentType: item.contentType,
  })
  await prisma.nutritionLabelInboxItem.update({
    where: { id: item.id },
    data: { status: "APPLIED", appliedAt: new Date(), fileUrl: null, filePathname: null },
  })
  await deleteLabelBlob(item.fileUrl)

  const updated = await findOrgIngredient(ctx.org.id, ing.id)
  return NextResponse.json({ readId: read?.readId ?? null, ingredient: await serializeIngredient(updated!, ctx.org.id) })
}
