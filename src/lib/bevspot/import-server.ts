import "server-only"
import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin, requireModule } from "@/lib/auth"
import { loadCostGraph } from "@/lib/recipe-cost"
import { BevSpotFormatError, parseSalesItemsWorkbook, type BevRow } from "./parse-sales-items"
import { planBevSpotImport, summarizePlan, type ImportPlan } from "./plan-import"

// ─── BevSpot import, server side (BEV-1) ─────────────────────────────────────
// Shared by the preview and apply routes so both plan from the same inputs.
// IV-3 bulk import: ADMIN only + inventory module, the same gate as
// ingredients/import (docs/PERMISSIONS_INVENTORY.md).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

type Ctx = { orgId: string; clerkUserId: string }

export async function bevspotImportContext(): Promise<Ctx | { error: NextResponse }> {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { error: NextResponse.json({ error: "Org not found" }, { status: 404 }) }

  try {
    await requireModule("inventory")
  } catch {
    return { error: NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 }) }
  }
  try {
    await requireAdmin()
  } catch {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { orgId: org.id, clerkUserId: userId }
}

// The upload is parsed in memory and never stored.
export async function readBevSpotUpload(
  req: Request
): Promise<{ rows: BevRow[]; fileName: string; fileSize: number } | { error: NextResponse }> {
  let file: File | null
  try {
    file = (await req.formData()).get("file") as File | null
  } catch {
    return { error: NextResponse.json({ error: "Expected a file upload" }, { status: 400 }) }
  }
  if (!file || typeof file === "string") {
    return { error: NextResponse.json({ error: "Choose BevSpot's sales-items export (.xlsx)" }, { status: 400 }) }
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { error: NextResponse.json({ error: "Upload the .xlsx file BevSpot exports from Sales Items" }, { status: 400 }) }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 413 }) }
  }
  try {
    const rows = parseSalesItemsWorkbook(new Uint8Array(await file.arrayBuffer()))
    return { rows, fileName: file.name, fileSize: file.size }
  } catch (e) {
    const message = e instanceof BevSpotFormatError ? e.message : "Couldn't read that file"
    return { error: NextResponse.json({ error: message }, { status: 400 }) }
  }
}

export async function planForOrg(organizationId: string, rows: BevRow[]): Promise<ImportPlan> {
  const [graph, ingredients, salesItems, modifiers] = await Promise.all([
    loadCostGraph(organizationId),
    // F5 matches live ingredients only.
    prisma.ingredient.findMany({
      where: { organizationId, deletedAt: null, isActive: true, isArchived: false },
      select: { id: true, name: true, brand: true, reportingUnit: true },
    }),
    prisma.salesItem.findMany({
      where: { organizationId, isDeleted: false },
      select: { id: true, squareVariationId: true, displayName: true, recipeStatus: true, recipe: { select: { id: true } } },
    }),
    // N-5: live synced modifiers, so their BevSpot rows import as modifier recipes.
    prisma.squareModifier.findMany({
      where: { organizationId, isDeleted: false },
      select: { id: true, squareModifierId: true, name: true, recipeStatus: true, recipe: { select: { id: true } } },
    }),
  ])
  return planBevSpotImport({
    rows,
    ingredients,
    salesItems: salesItems.map((s) => ({
      id: s.id,
      squareVariationId: s.squareVariationId,
      displayName: s.displayName,
      recipeStatus: s.recipeStatus,
      recipeId: s.recipe?.id ?? null,
    })),
    modifiers: modifiers.map((m) => ({
      id: m.id,
      squareModifierId: m.squareModifierId,
      name: m.name,
      recipeStatus: m.recipeStatus,
      recipeId: m.recipe?.id ?? null,
    })),
    graph,
  })
}

// What the page shows. Ids stay server-side; apply re-plans from the file.
export function previewPayload(plan: ImportPlan) {
  return {
    summary: summarizePlan(plan),
    ready: plan.toCreate.map((r) => ({
      kind: r.kind,
      name: r.name,
      lineCount: r.lines.length,
      recipeRaw: r.recipeRaw,
    })),
    skipped: plan.skipped,
  }
}
