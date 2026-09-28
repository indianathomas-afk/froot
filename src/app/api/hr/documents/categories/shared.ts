import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isBadgePresetKey } from "@/lib/badge-presets"

// DOC-5. Shared by the collection route and /[id], so the two cannot validate
// the same fields differently — copied from api/hr/training/categories/shared.ts
// (HR-20/21), fifth instance of the taxonomy pattern.

export const DocumentCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // A KEY from src/lib/badge-presets.ts, never a class string — Tailwind 4
  // runs CSS-first here with no safelist. TYPE-1_AUDIT §7.
  colorKey: z.string().refine(isBadgePresetKey, "Unknown colour"),
  sortOrder: z.number().int().optional(),
})

// Case-insensitive, because @@unique([organizationId, name]) is case-SENSITIVE.
// The constraint remains the actual guarantee; callers still catch P2002.
export async function findNameConflict(
  organizationId: string,
  name: string,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const rows = await prisma.hrDocumentCategory.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  })
  const target = name.trim().toLowerCase()
  return rows.find((r) => r.id !== excludeId && r.name.toLowerCase() === target) ?? null
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}

// "3 documents" / "1 document" — the in-use count covers library documents AND
// agreement forms (F7: one taxonomy), archived included, because every one of
// them holds the FK and trips ON DELETE RESTRICT.
export function documentCountPhrase(n: number): string {
  return `${n} document${n === 1 ? "" : "s"}`
}
