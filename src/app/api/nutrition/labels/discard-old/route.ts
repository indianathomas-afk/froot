import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { deleteLabelBlob } from "@/lib/nutrition-files"
import { INBOX_ENTITY, nutritionAudit } from "@/lib/nutrition-record"
import { ABANDONED_AFTER_DAYS, ACTIVE_INBOX, ageDays } from "@/lib/label-match"

// POST /api/nutrition/labels/discard-old — "Discard all older than 7 days"
// (N-1e deliverable 5). ADMIN (nutrition.manage). Every open inbox file
// (never applied, never discarded) whose createdAt is 7+ whole days ago is
// discarded: file deleted, row DISCARDED, one audit row each. createdAt is a
// UTC instant and the cut-off is computed here, so no client zone is involved.
// A scheduled purge is out of scope (audit: no ROW needed yet).

export async function POST() {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const now = new Date()
  const open = await prisma.nutritionLabelInboxItem.findMany({
    where: { organizationId: ctx.org.id, status: { in: ACTIVE_INBOX } },
  })
  const old = open.filter((i) => ageDays(i.createdAt, now) >= ABANDONED_AFTER_DAYS)
  if (old.length === 0) return NextResponse.json({ discarded: 0 })

  await prisma.$transaction(async (tx) => {
    await tx.nutritionLabelInboxItem.updateMany({
      where: { id: { in: old.map((i) => i.id) }, organizationId: ctx.org.id },
      data: { status: "DISCARDED", fileUrl: null, filePathname: null },
    })
    for (const i of old) {
      await nutritionAudit(tx, ctx, "nutrition.inbox.discarded", i.id, {
        fileName: i.fileName, fileHash: i.fileHash, bulk: true, ageDays: ageDays(i.createdAt, now),
      }, INBOX_ENTITY)
    }
  })
  for (const i of old) await deleteLabelBlob(i.fileUrl)
  return NextResponse.json({ discarded: old.length })
}
