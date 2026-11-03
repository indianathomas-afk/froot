import type { NutritionLabelInboxItem } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { NutritionFileError, type StoredLabel } from "@/lib/nutrition-files"
import { INBOX_ENTITY, nutritionAudit } from "@/lib/nutrition-record"
import type { NutritionContext } from "@/lib/nutrition-access"
import { unreadableTypeReason } from "@/lib/label-read"
import { parseLabelOutput } from "@/lib/label-review"
import { ACTIVE_INBOX, ageDays, applyBlocker, suggestFromFilename, type MatchCandidate } from "@/lib/label-match"

// ─── N-1e: the label inbox (server side) ─────────────────────────────────────
// Rulings: docs/DECISIONS.md 2026-11-02 N-1e (Gary, DRAFT: "Accept all leans");
// audit docs/prompts/N-1e_AUDIT.md. Every route under /api/nutrition/labels is
// ADMIN (nutrition.manage) and finds items by id AND organizationId.

/** Ingredients a label can be for: food, not prepared, not deleted. */
export function inboxCandidates(orgId: string): Promise<MatchCandidate[]> {
  return prisma.ingredient.findMany({
    where: { organizationId: orgId, deletedAt: null, kind: { not: "PREPARED" }, nutritionExempt: false },
    select: { id: true, name: true, brand: true },
    orderBy: { name: "asc" },
  })
}

export function findInboxItem(orgId: string, id: string) {
  return prisma.nutritionLabelInboxItem.findFirst({ where: { id, organizationId: orgId } })
}

/** Inbox files must be readable — HEIC is refused here with the N-1c note
 *  (the dialog still accepts HEIC as proof). Checked on the sniffed type. */
export function inboxTypeRefusal(contentType: string): string | null {
  return unreadableTypeReason(contentType)
}

export async function createInboxItem(
  ctx: Pick<NutritionContext, "org" | "dbUser">,
  file: { meta: StoredLabel; pathname: string; fileName: string; sourceUrl?: string | null },
  audit: { action: "nutrition.inbox.uploaded" | "nutrition.inbox.fetched"; extra?: Record<string, string | number | null> }
): Promise<NutritionLabelInboxItem> {
  const reason = inboxTypeRefusal(file.meta.contentType)
  if (reason) throw new NutritionFileError(reason, 415)
  const suggestion = suggestFromFilename(file.fileName, await inboxCandidates(ctx.org.id))
  return prisma.$transaction(async (tx) => {
    const item = await tx.nutritionLabelInboxItem.create({
      data: {
        organizationId: ctx.org.id,
        fileUrl: file.meta.url,
        filePathname: file.pathname,
        fileName: file.fileName,
        contentType: file.meta.contentType,
        sizeBytes: file.meta.sizeBytes,
        fileHash: file.meta.fileHash,
        sourceUrl: file.sourceUrl ?? null,
        suggestedIngredientId: suggestion.suggestedId,
        uploadedByUserId: ctx.dbUser?.id ?? null,
      },
    })
    await nutritionAudit(tx, ctx, audit.action, item.id, {
      fileName: file.fileName, fileHash: file.meta.fileHash, contentType: file.meta.contentType, sizeBytes: file.meta.sizeBytes,
      suggestedIngredientId: suggestion.suggestedId, ...(file.sourceUrl && { sourceUrl: file.sourceUrl }), ...audit.extra,
    }, INBOX_ENTITY)
    return item
  })
}

/** What the page sees. Never the blob URL, pathname or hash. */
export async function serializeInboxItems(items: NutritionLabelInboxItem[], now = new Date()) {
  const readIds = items.map((i) => i.readAuditId).filter((x): x is string => Boolean(x))
  const reads = readIds.length
    ? await prisma.auditLog.findMany({ where: { id: { in: readIds } }, select: { id: true, action: true, createdAt: true, metadata: true } })
    : []
  return items.map((i) => {
    const row = reads.find((r) => r.id === i.readAuditId)
    const meta = row?.metadata as { output?: unknown; readAt?: string; model?: string } | undefined
    const parsed = meta?.output !== undefined ? parseLabelOutput(meta.output) : null
    return {
      id: i.id,
      status: i.status,
      fileName: i.fileName,
      contentType: i.contentType,
      sizeBytes: i.sizeBytes,
      sourceUrl: i.sourceUrl,
      suggestedIngredientId: i.suggestedIngredientId,
      ingredientId: i.ingredientId,
      readError: i.readError,
      createdAt: i.createdAt,
      ageDays: ageDays(i.createdAt, now),
      applyBlocker: applyBlocker(i),
      read: row && parsed?.ok
        ? { readId: row.id, readAt: meta?.readAt ?? row.createdAt.toISOString(), reused: row.action === "nutrition.label.read.reused", output: parsed.output }
        : null,
    }
  })
}

export function activeInboxItems(orgId: string) {
  return prisma.nutritionLabelInboxItem.findMany({
    where: { organizationId: orgId, status: { in: ACTIVE_INBOX } },
    orderBy: { createdAt: "asc" },
  })
}
