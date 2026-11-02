import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import {
  NutritionFileError, deleteLabelBlob, getLabelDownloadUrl, labelKeyPrefix, labelPathnameFromUrl, readLabelMeta,
  sniffMatches, validateLabelMeta,
} from "@/lib/nutrition-files"
import { RESET_TO_ESTIMATED } from "@/lib/nutrition-proof"
import { findOrgIngredient, nutritionAudit, serializeIngredient } from "@/lib/nutrition-record"

// /api/nutrition/ingredients/[id]/label — the one label document on an
// ingredient's nutrition record (N-1b deliverable 1).
//
//   GET    view it (nutrition.view — ADMIN, MANAGER, STORE): 307 to a 5-minute
//          signed URL. Unknown, cross-org, and "no document" all 404.
//   POST   register an uploaded file / replace the current one (ADMIN)
//   DELETE remove it (ADMIN)
//
// On a VERIFIED record, replacing the document or removing it while a source
// link remains is a change to the proof, so it asks (Gary, F3: "A change means
// the basis, any number, the allergens, or the proof"). Removing the LAST proof
// resets without asking (F2). Replacing keeps no history; the AuditLog row
// carries the old and new file names and hashes.

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.view")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const ing = await findOrgIngredient(ctx.org.id, id)
  const fileUrl = ing?.nutrition?.labelFileUrl
  if (!fileUrl) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    return NextResponse.redirect(await getLabelDownloadUrl(labelPathnameFromUrl(fileUrl)), 307)
  } catch (err) {
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}

const RegisterSchema = z.object({
  // The store URL the presigned PUT returned (it carries the store's own suffix).
  fileUrl: z.string().url(),
  fileName: z.string().trim().min(1).max(255),
  keepVerified: z.boolean().optional(),
})

const askStillVerified = () =>
  NextResponse.json(
    { error: "This nutrition is verified. Is it still verified with the new proof?", code: "CONFIRM_STILL_VERIFIED" },
    { status: 409 }
  )

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const parsed = RegisterSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { fileUrl, fileName, keepVerified } = parsed.data

  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const existing = ing.nutrition
  if (!existing) return NextResponse.json({ error: "Save nutrition before adding a label document" }, { status: 409 })

  // Namespace pin: the blob must sit in THIS org's and THIS ingredient's
  // folder, so a registration cannot point at another org's file.
  let pathname: string
  try {
    pathname = labelPathnameFromUrl(fileUrl)
  } catch {
    return NextResponse.json({ error: "Invalid file URL" }, { status: 400 })
  }
  if (!pathname.startsWith(`${labelKeyPrefix(ctx.org.id, ing.id)}/`)) {
    return NextResponse.json({ error: "File is outside this ingredient's upload space" }, { status: 400 })
  }
  if (existing.labelFileUrl === fileUrl) return NextResponse.json(await serializeIngredient(ing, ctx.org.id))

  if (existing.status === "VERIFIED" && keepVerified === undefined) return askStillVerified()

  // Authoritative metadata from the stored bytes, never the client's word.
  let meta: Awaited<ReturnType<typeof readLabelMeta>>
  try {
    meta = await readLabelMeta(fileUrl)
    validateLabelMeta(meta.contentType, meta.sizeBytes)
  } catch (err) {
    await deleteLabelBlob(fileUrl)
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: "Uploaded file could not be read" }, { status: 400 })
  }
  // Gary, N-1b: "file-type check by first bytes".
  if (!sniffMatches(meta.contentType, meta.sniffedType)) {
    await deleteLabelBlob(fileUrl)
    return NextResponse.json(
      { error: "That file's contents don't match its type. Upload a PDF, PNG, JPG, WEBP or HEIC file." },
      { status: 400 }
    )
  }

  const replacedUrl = existing.labelFileUrl
  const reset = existing.status === "VERIFIED" && keepVerified === false
  await prisma.$transaction(async (tx) => {
    await tx.ingredientNutrition.update({
      where: { ingredientId: ing.id },
      data: {
        labelFileUrl: meta.url,
        labelFilePathname: pathname,
        labelFileName: fileName,
        labelContentType: meta.contentType,
        labelSizeBytes: meta.sizeBytes,
        labelFileHash: meta.fileHash,
        labelUploadedByUserId: ctx.dbUser?.id ?? null,
        labelUploadedAt: new Date(),
        ...(reset && RESET_TO_ESTIMATED),
      },
    })
    await nutritionAudit(tx, ctx, replacedUrl ? "nutrition.label.replaced" : "nutrition.label.uploaded", ing.id, {
      fileName,
      fileHash: meta.fileHash,
      contentType: meta.contentType,
      sizeBytes: meta.sizeBytes,
      ...(replacedUrl && { previousFileName: existing.labelFileName, previousFileHash: existing.labelFileHash }),
    })
    if (reset) await nutritionAudit(tx, ctx, "nutrition.status.reset", ing.id, { via: "label", reason: "changed" })
  })
  await deleteLabelBlob(replacedUrl)

  const updated = await findOrgIngredient(ctx.org.id, ing.id)
  return NextResponse.json(await serializeIngredient(updated!, ctx.org.id), { status: replacedUrl ? 200 : 201 })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const keep = new URL(req.url).searchParams.get("keepVerified")
  const keepVerified = keep === "true" ? true : keep === "false" ? false : undefined

  const ing = await findOrgIngredient(ctx.org.id, id)
  const existing = ing?.nutrition
  if (!ing || !existing?.labelFileUrl) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let reset: "proof-removed" | "changed" | null = null
  if (existing.status === "VERIFIED") {
    if (!existing.sourceUrl) reset = "proof-removed" // F2, never asked
    else if (keepVerified === undefined) return askStillVerified()
    else if (!keepVerified) reset = "changed"
  }

  await prisma.$transaction(async (tx) => {
    await tx.ingredientNutrition.update({
      where: { ingredientId: ing.id },
      data: {
        labelFileUrl: null, labelFilePathname: null, labelFileName: null, labelContentType: null,
        labelSizeBytes: null, labelFileHash: null, labelUploadedByUserId: null, labelUploadedAt: null,
        ...(reset && RESET_TO_ESTIMATED),
      },
    })
    await nutritionAudit(tx, ctx, "nutrition.label.removed", ing.id, {
      fileName: existing.labelFileName,
      fileHash: existing.labelFileHash,
    })
    if (reset) await nutritionAudit(tx, ctx, "nutrition.status.reset", ing.id, { via: "label", reason: reset })
  })
  await deleteLabelBlob(existing.labelFileUrl)

  const updated = await findOrgIngredient(ctx.org.id, ing.id)
  return NextResponse.json(await serializeIngredient(updated!, ctx.org.id))
}
