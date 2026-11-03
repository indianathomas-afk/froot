import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PROOF_ONLY_NUMBERS } from "@/lib/nutrition"
import { ATTACH_QUESTION_TEXT, RESET_TO_ESTIMATED, type AttachQuestion } from "@/lib/nutrition-proof"
import { deleteLabelBlob, type StoredLabel } from "@/lib/nutrition-files"
import { findOrgIngredient, nutritionAudit } from "@/lib/nutrition-record"
import type { NutritionContext } from "@/lib/nutrition-access"
import { invalidatePublicMenu } from "@/lib/public-menu-data"

// ─── N-1e: THE way a file becomes an ingredient's label document ─────────────
// Lifted out of POST /api/nutrition/ingredients/[id]/label (N-1b) so the
// dialog upload, "Add from link" and the inbox's Apply share one write — the
// prompt's "no second write path". The caller has already inspected the
// stored bytes (inspectStoredLabel) and asked its questions (attachQuestion).

type Ingredient = NonNullable<Awaited<ReturnType<typeof findOrgIngredient>>>

export function questionResponse(q: AttachQuestion) {
  return NextResponse.json({ error: ATTACH_QUESTION_TEXT[q], code: q }, { status: 409 })
}

export async function attachLabelDocument(
  ctx: Pick<NutritionContext, "org" | "dbUser">,
  ing: Ingredient,
  file: { meta: StoredLabel; pathname: string; fileName: string },
  opts: {
    keepVerified?: boolean
    /** N-1e "Read from a link": the link the file came from. Undefined leaves the stored link alone. */
    sourceUrl?: string
    audit?: Record<string, Prisma.InputJsonValue | null>
  } = {}
): Promise<{ replaced: boolean }> {
  const existing = ing.nutrition
  const { meta, pathname, fileName } = file
  const replacedUrl = existing?.labelFileUrl ?? null
  const reset = existing?.status === "VERIFIED" && opts.keepVerified === false
  await prisma.$transaction(async (tx) => {
    const label = {
      labelFileUrl: meta.url,
      labelFilePathname: pathname,
      labelFileName: fileName,
      labelContentType: meta.contentType,
      labelSizeBytes: meta.sizeBytes,
      labelFileHash: meta.fileHash,
      labelUploadedByUserId: ctx.dbUser?.id ?? null,
      labelUploadedAt: new Date(),
      ...(opts.sourceUrl !== undefined && { sourceUrl: opts.sourceUrl }),
    }
    await tx.ingredientNutrition.upsert({
      where: { ingredientId: ing.id },
      create: { ingredientId: ing.id, ...PROOF_ONLY_NUMBERS, ...label },
      update: { ...label, ...(reset && RESET_TO_ESTIMATED) },
    })
    await nutritionAudit(tx, ctx, replacedUrl ? "nutrition.label.replaced" : "nutrition.label.uploaded", ing.id, {
      fileName,
      fileHash: meta.fileHash,
      contentType: meta.contentType,
      sizeBytes: meta.sizeBytes,
      ...(replacedUrl && { previousFileName: existing!.labelFileName, previousFileHash: existing!.labelFileHash }),
      ...opts.audit,
    })
    if (reset) await nutritionAudit(tx, ctx, "nutrition.status.reset", ing.id, { via: "label", reason: "changed" })
  })
  // N1E-F5: the old file goes only after the replace succeeded.
  if (replacedUrl && replacedUrl !== meta.url) await deleteLabelBlob(replacedUrl)
  invalidatePublicMenu(ctx.org.id) // N-3: the public menu shows this; stale-while-revalidate (R-3)
  return { replaced: Boolean(replacedUrl) }
}
