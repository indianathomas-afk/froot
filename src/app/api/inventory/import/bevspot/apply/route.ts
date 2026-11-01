import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { bevspotImportContext, planForOrg, previewPayload, readBevSpotUpload } from "@/lib/bevspot/import-server"
import { summarizePlan } from "@/lib/bevspot/plan-import"

// POST /api/inventory/import/bevspot/apply — multipart { file }. Re-plans
// server-side from the uploaded file (a client-sent plan is never trusted),
// then in ONE transaction creates the recipes and their lines, marks those
// sales items MAPPED, and writes the AuditLog row an undo can be built from
// (F9: tx.auditLog.create, so it cannot silently go missing). Never
// overwrites: a sales item that gained a recipe since the preview fails the
// whole apply on Recipe.salesItemId's unique index. ADMIN only (IV-3). BEV-1.

export const maxDuration = 60

export async function POST(req: Request) {
  const ctx = await bevspotImportContext()
  if ("error" in ctx) return ctx.error

  const upload = await readBevSpotUpload(req)
  if ("error" in upload) return upload.error

  const plan = await planForOrg(ctx.orgId, upload.rows)
  const summary = summarizePlan(plan)
  if (plan.toCreate.length === 0) {
    return NextResponse.json({ created: 0, createdSubRecipes: 0, ...previewPayload(plan) })
  }

  const salesItemIds = plan.toCreate.flatMap((r) => (r.salesItemId ? [r.salesItemId] : []))
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.recipe.createMany({
          data: plan.toCreate.map((r) => ({
            id: r.id,
            organizationId: ctx.orgId,
            name: r.name,
            salesItemId: r.salesItemId,
            yieldQty: 1,
            yieldUnit: "serving",
          })),
        })
        await tx.recipeLine.createMany({
          data: plan.toCreate.flatMap((r) =>
            r.lines.map((l, i) => ({
              recipeId: r.id,
              ingredientId: l.ingredientId,
              subRecipeId: l.subRecipeId,
              amount: l.amount,
              unit: l.unit,
              sortOrder: i,
            }))
          ),
        })
        const mapped = await tx.salesItem.updateMany({
          where: { id: { in: salesItemIds }, organizationId: ctx.orgId, recipeStatus: { not: "NON_RECIPE" } },
          data: { recipeStatus: "MAPPED" },
        })
        if (mapped.count !== salesItemIds.length) throw new StaleImportError()
        await tx.auditLog.create({
          data: {
            organizationId: ctx.orgId,
            userId: ctx.clerkUserId,
            action: "bevspot.recipes.applied",
            entityType: "Import",
            metadata: {
              fileName: upload.fileName,
              fileSize: upload.fileSize,
              createdRecipeIds: plan.toCreate.map((r) => r.id),
              salesRecipeCount: summary.ready,
              subRecipeCount: summary.readySubRecipes,
              skippedByReason: summary.skippedByReason,
            },
          },
        })
      },
      { timeout: 30_000, maxWait: 10_000 }
    )
  } catch (e) {
    const stale =
      e instanceof StaleImportError ||
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    if (stale) {
      return NextResponse.json(
        { error: "Recipes changed since the preview. Nothing was imported. Preview the file again." },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ created: summary.ready, createdSubRecipes: summary.readySubRecipes, ...previewPayload(plan) })
}

class StaleImportError extends Error {}
