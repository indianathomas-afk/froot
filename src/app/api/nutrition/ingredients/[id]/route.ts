import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { ALLERGENS, NUTRIENT_KEYS, PROOF_ONLY_NUMBERS, nutritionInputError, sortAllergens, type NutrientValues } from "@/lib/nutrition"
import { storedNutritionInput } from "@/lib/nutrition-import"
import { RESET_TO_ESTIMATED, afterNumbersCleared, allergensChanged, hasProof, numbersChanged, parseSourceUrl } from "@/lib/nutrition-proof"
import { findOrgIngredient, nutritionAudit, serializeIngredient } from "@/lib/nutrition-record"

// GET /api/nutrition/ingredients/[id] — one ingredient's nutrition record,
// allergens and not-food flag (nutrition.view). PUT replaces all three
// (nutrition.manage — ADMIN, N1-F3). Writes never touch the Ingredient's other
// fields, so this route is separate from the inventory PATCH, which MANAGER may
// call. N-1.
//
// N-1b: the record also carries its proof (source link, label document) and
// its status. The SERVER decides whether a save changes anything that matters
// to a VERIFIED record, and answers 409 with a code the dialog turns into a
// question — Gary, F3: "dialog changes ask "Still verified?"".
//
// N-1d (Gary, 2026-11-02, DRAFT). `nutrition: null` means NO NUMBERS, not "no
// record":
//   F1a "Clearing the numbers no longer deletes the record. It keeps the label
//       document and link as a proof-only record (counts as "No nutrition").
//       Deleting the label file is only done with the Remove button."
//   F1b "a source link can be saved with no numbers."
// So the record is deleted only when nothing is left to keep — no numbers, no
// document, no link — and this route never deletes a label file. N-1b F7's
// "Clear and remove the proof?" question is gone with it. F2a: the link is
// reference only, so editing it never asks "Still verified?". The link moved
// to the top level of the body, since it no longer needs numbers to live on.

const nutrientSchema = z.number().nonnegative().nullable()

const PutSchema = z.object({
  nutrition: z
    .object({
      basisAmount: z.number().positive(),
      basisUnit: z.string().min(1),
      values: z.object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, nutrientSchema])) as Record<keyof NutrientValues, typeof nutrientSchema>),
      sourceNote: z.string().max(500).nullable(),
    })
    .nullable(),
  // N-1b / N1D-F1b. Absent = leave the stored link as is; null clears it.
  sourceUrl: z.string().max(2100).nullable().optional(),
  allergens: z.array(z.enum(ALLERGENS.map((a) => a.value) as [string, ...string[]])),
  nutritionExempt: z.boolean(),
  // N-1b answer to the dialog's "Still verified?"; absent = not asked yet.
  keepVerified: z.boolean().optional(),
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
  if (data.sourceUrl !== undefined) {
    const u = parseSourceUrl(data.sourceUrl)
    if ("error" in u) return NextResponse.json({ error: u.error }, { status: 400 })
    sourceUrl = u.url
  }
  if (ing.kind === "PREPARED" && sourceUrl) {
    return NextResponse.json({ error: "A prepared ingredient's nutrition is computed from its recipe" }, { status: 400 })
  }

  const allergens = sortAllergens(data.allergens as (typeof ALLERGENS)[number]["value"][])
  const existing = ing.nutrition
  const nextUrl = sourceUrl === undefined ? existing?.sourceUrl ?? null : sourceUrl

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

  // F2 / F3 on a VERIFIED record. Numbers cleared → reset, never asked: a
  // proof-only record cannot be verified (N1D-F1). Basis, numbers or allergens
  // changed → ask. The link never counts (N1D-F2a).
  let reset: "numbers-cleared" | "changed" | null = null
  if (existing?.status === "VERIFIED") {
    const stored = storedNutritionInput(existing)
    if (!data.nutrition) {
      reset = "numbers-cleared"
    } else if (!stored || numbersChanged(stored, data.nutrition) || allergensChanged(ing.allergens, allergens)) {
      if (data.keepVerified === undefined) {
        return NextResponse.json(
          { error: "This nutrition is verified. Is it still verified after this change?", code: "CONFIRM_STILL_VERIFIED" },
          { status: 409 }
        )
      }
      if (!data.keepVerified) reset = "changed"
    }
  }

  // No numbers: keep a proof-only record while a document or link remains
  // (F1a, F1b); otherwise there is nothing left and the record goes.
  const keepProofOnly = !data.nutrition && afterNumbersCleared(existing, nextUrl) === "keep-proof-only"
  await prisma.$transaction(async (tx) => {
    await tx.ingredient.update({
      where: { id: ing.id },
      data: { allergens, nutritionExempt: data.nutritionExempt },
    })
    if (data.nutrition || keepProofOnly) {
      const numbers = data.nutrition
        ? {
            basisAmount: data.nutrition.basisAmount,
            basisUnit: data.nutrition.basisUnit,
            ...data.nutrition.values,
            sourceNote: data.nutrition.sourceNote?.trim() || null,
          }
        : PROOF_ONLY_NUMBERS
      const row = {
        ...numbers,
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
    } else if (existing) {
      // Nothing to keep: no numbers, no document, and the link cleared here.
      await tx.ingredientNutrition.deleteMany({ where: { ingredientId: ing.id } })
      if (hasProof(existing)) {
        await nutritionAudit(tx, ctx, "nutrition.record.cleared", ing.id, {
          status: existing.status,
          sourceUrl: existing.sourceUrl,
          labelFileName: existing.labelFileName,
          labelFileHash: existing.labelFileHash,
        })
      }
    }
  })

  const updated = await findOrgIngredient(ctx.org.id, ing.id)
  return NextResponse.json(await serializeIngredient(updated!, ctx.org.id))
}
