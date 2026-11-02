import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { ALLERGENS, NUTRIENT_KEYS, nutritionInputError, sortAllergens, type NutrientValues } from "@/lib/nutrition"
import { storedNutritionInput } from "@/lib/nutrition-import"
import { RESET_TO_ESTIMATED, allergensChanged, hasProof, numbersChanged, parseSourceUrl } from "@/lib/nutrition-proof"
import { deleteLabelBlob } from "@/lib/nutrition-files"
import { findOrgIngredient, nutritionAudit, serializeIngredient } from "@/lib/nutrition-record"

// GET /api/nutrition/ingredients/[id] — one ingredient's nutrition record,
// allergens and not-food flag (nutrition.view). PUT replaces all three
// (nutrition.manage — ADMIN, N1-F3). `nutrition: null` removes the record.
// Writes never touch the Ingredient's other fields, so this route is separate
// from the inventory PATCH, which MANAGER may call. N-1.
//
// N-1b: the record also carries its proof (source link, label document) and
// its status. The SERVER decides whether a save changes anything that matters
// to a VERIFIED record, and answers 409 with a code the dialog turns into a
// question — Gary, F3: "dialog changes ask "Still verified?"", F7: "Clearing
// the numbers when a document exists asks first; a confirmed clear removes the
// record, its proof and the file together."

const nutrientSchema = z.number().nonnegative().nullable()

const PutSchema = z.object({
  nutrition: z
    .object({
      basisAmount: z.number().positive(),
      basisUnit: z.string().min(1),
      values: z.object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nutrientSchema])) as Record<keyof NutrientValues, typeof nutrientSchema>),
      sourceNote: z.string().max(500).nullable(),
      // N-1b. Absent = leave the stored link as is.
      sourceUrl: z.string().max(2100).nullable().optional(),
    })
    .nullable(),
  allergens: z.array(z.enum(ALLERGENS.map((a) => a.value) as [string, ...string[]])),
  nutritionExempt: z.boolean(),
  // N-1b answers to the dialog's questions; absent = not asked yet.
  keepVerified: z.boolean().optional(),
  confirmClearProof: z.boolean().optional(),
  // N-1c: this save is the Apply of a label read. Changes nothing about the
  // save; adds the one audit row per apply (deliverable 5). `edited` = the
  // fields the ADMIN changed away from what the label read proposed.
  appliedFromRead: z
    .object({
      readId: z.string().min(1),
      intent: z.enum(["apply-and-verify", "apply-only"]),
      edited: z.array(z.string().max(40)).max(40),
      nameWarningAcknowledged: z.boolean(),
    })
    .optional(),
})

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.view")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(await serializeIngredient(ing, ctx.org.id))
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params

  const parsed = PutSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 })
  const data = parsed.data

  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (ing.kind === "PREPARED" && data.nutrition) {
    return NextResponse.json({ error: "A prepared ingredient's nutrition is computed from its recipe" }, { status: 400 })
  }
  if (data.nutrition) {
    const err = nutritionInputError(data.nutrition, ing.reportingUnit)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }
  let sourceUrl: string | null | undefined = undefined
  if (data.nutrition && data.nutrition.sourceUrl !== undefined) {
    const u = parseSourceUrl(data.nutrition.sourceUrl)
    if ("error" in u) return NextResponse.json({ error: u.error }, { status: 400 })
    sourceUrl = u.url
  }

  const allergens = sortAllergens(data.allergens as (typeof ALLERGENS)[number]["value"][])
  const existing = ing.nutrition

  // N-1c: an Apply must name a read of THIS ingredient in THIS org, and only
  // ever fills numbers — it never clears a record.
  let appliedRead: { id: string; fileHash: unknown } | null = null
  if (data.appliedFromRead) {
    if (!data.nutrition) return NextResponse.json({ error: "Apply always saves nutrition" }, { status: 400 })
    const read = await prisma.auditLog.findFirst({
      where: {
        id: data.appliedFromRead.readId,
        organizationId: ctx.org.id,
        entityType: "Ingredient",
        entityId: ing.id,
        action: { in: ["nutrition.label.read", "nutrition.label.read.reused"] },
      },
      select: { id: true, metadata: true },
    })
    if (!read) return NextResponse.json({ error: "That label read wasn't found for this ingredient" }, { status: 400 })
    appliedRead = { id: read.id, fileHash: (read.metadata as { fileHash?: unknown } | null)?.fileHash ?? null }
  }

  // F7: clearing the numbers on a record that holds proof asks first.
  if (!data.nutrition && existing && hasProof(existing) && data.confirmClearProof !== true) {
    return NextResponse.json(
      {
        error: "Clearing the nutrition also removes its source link and label document",
        code: "CONFIRM_CLEAR_PROOF",
        hasDocument: Boolean(existing.labelFileUrl),
      },
      { status: 409 }
    )
  }

  // F2 / F3 on a VERIFIED record.
  let reset: "proof-removed" | "changed" | null = null
  if (data.nutrition && existing?.status === "VERIFIED") {
    const nextUrl = sourceUrl === undefined ? existing.sourceUrl : sourceUrl
    const stored = storedNutritionInput(existing)!
    const changed =
      numbersChanged(stored, data.nutrition) || allergensChanged(ing.allergens, allergens) || nextUrl !== existing.sourceUrl
    if (!hasProof({ sourceUrl: nextUrl, labelFileUrl: existing.labelFileUrl })) {
      reset = "proof-removed" // F2: "Removing the last proof resets to Estimated." Never asked.
    } else if (changed) {
      if (data.keepVerified === undefined) {
        return NextResponse.json(
          { error: "This nutrition is verified. Is it still verified after this change?", code: "CONFIRM_STILL_VERIFIED" },
          { status: 409 }
        )
      }
      if (!data.keepVerified) reset = "changed"
    }
  }

  const removedLabelUrl = !data.nutrition && existing ? existing.labelFileUrl : null
  await prisma.$transaction(async (tx) => {
    await tx.ingredient.update({
      where: { id: ing.id },
      data: { allergens, nutritionExempt: data.nutritionExempt },
    })
    if (data.nutrition) {
      const row = {
        basisAmount: data.nutrition.basisAmount,
        basisUnit: data.nutrition.basisUnit,
        ...data.nutrition.values,
        sourceNote: data.nutrition.sourceNote?.trim() || null,
        ...(sourceUrl !== undefined && { sourceUrl }),
        ...(reset && RESET_TO_ESTIMATED),
        updatedByUserId: ctx.dbUser?.id ?? null,
      }
      await tx.ingredientNutrition.upsert({ where: { ingredientId: ing.id }, create: { ingredientId: ing.id, ...row }, update: row })
      if (reset) {
        await nutritionAudit(tx, ctx, "nutrition.status.reset", ing.id, { via: "dialog", reason: reset })
      }
      if (appliedRead && data.appliedFromRead) {
        await nutritionAudit(tx, ctx, "nutrition.label.applied", ing.id, {
          readId: appliedRead.id,
          fileHash: appliedRead.fileHash as string | null,
          intent: data.appliedFromRead.intent,
          edited: data.appliedFromRead.edited,
          nameWarningAcknowledged: data.appliedFromRead.nameWarningAcknowledged,
        })
      }
    } else {
      await tx.ingredientNutrition.deleteMany({ where: { ingredientId: ing.id } })
      if (existing && hasProof(existing)) {
        await nutritionAudit(tx, ctx, "nutrition.record.cleared", ing.id, {
          status: existing.status,
          sourceUrl: existing.sourceUrl,
          labelFileName: existing.labelFileName,
          labelFileHash: existing.labelFileHash,
        })
        if (existing.labelFileUrl) {
          await nutritionAudit(tx, ctx, "nutrition.label.removed", ing.id, {
            via: "record cleared",
            fileName: existing.labelFileName,
            fileHash: existing.labelFileHash,
          })
        }
      }
    }
  })
  // After the commit, so a failed transaction never loses a file still referenced.
  await deleteLabelBlob(removedLabelUrl)

  const updated = await findOrgIngredient(ctx.org.id, ing.id)
  return NextResponse.json(await serializeIngredient(updated!, ctx.org.id))
}
