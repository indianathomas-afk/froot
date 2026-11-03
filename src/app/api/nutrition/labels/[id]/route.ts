import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { deleteLabelBlob } from "@/lib/nutrition-files"
import { INBOX_ENTITY, findOrgIngredient, nutritionAudit } from "@/lib/nutrition-record"
import { proofRefusal } from "@/lib/nutrition-proof"
import { findInboxItem, serializeInboxItems } from "@/lib/label-inbox"
import { ACTIVE_INBOX, type InboxStatus } from "@/lib/label-match"

// /api/nutrition/labels/[id] — one inbox file. ADMIN (nutrition.manage).
//
//   PATCH  { ingredientId } — the ADMIN's confirm of which ingredient this
//          label is for (null clears it). THE ONLY WRITER of ingredientId:
//          N1E-F2 (Gary, 2026-11-02, "Accept all leans") "suggest, never
//          assign; the ADMIN confirms every file's ingredient before Apply is
//          enabled".
//   DELETE discard — the file is deleted from storage (deliverable 5); the row
//          stays as DISCARDED so its audit trail still resolves.

const PatchSchema = z.object({ ingredientId: z.string().min(1).nullable() })

const isActive = (s: InboxStatus) => ACTIVE_INBOX.includes(s)

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Expected { ingredientId }" }, { status: 400 })

  const item = await findInboxItem(ctx.org.id, id)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isActive(item.status)) return NextResponse.json({ error: "This file is no longer in the inbox" }, { status: 409 })

  const { ingredientId } = parsed.data
  if (ingredientId) {
    const ing = await findOrgIngredient(ctx.org.id, ingredientId)
    if (!ing) return NextResponse.json({ error: "Ingredient not found" }, { status: 404 })
    const refusal = proofRefusal(ing)
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.nutritionLabelInboxItem.update({ where: { id: item.id }, data: { ingredientId } })
    await nutritionAudit(tx, ctx, "nutrition.inbox.assigned", item.id, {
      from: item.ingredientId, to: ingredientId, wasSuggested: ingredientId !== null && ingredientId === item.suggestedIngredientId,
    }, INBOX_ENTITY)
    return row
  })
  const [out] = await serializeInboxItems([updated])
  return NextResponse.json(out)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const item = await findInboxItem(ctx.org.id, id)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isActive(item.status)) return NextResponse.json({ error: "This file is no longer in the inbox" }, { status: 409 })

  await prisma.$transaction(async (tx) => {
    await tx.nutritionLabelInboxItem.update({ where: { id: item.id }, data: { status: "DISCARDED", fileUrl: null, filePathname: null } })
    await nutritionAudit(tx, ctx, "nutrition.inbox.discarded", item.id, { fileName: item.fileName, fileHash: item.fileHash, bulk: false }, INBOX_ENTITY)
  })
  await deleteLabelBlob(item.fileUrl)
  return NextResponse.json({ success: true })
}
