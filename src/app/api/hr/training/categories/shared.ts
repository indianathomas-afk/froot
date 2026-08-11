import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isBadgePresetKey } from "@/lib/badge-presets"

// HR-21. Shared by the collection route and /[id], so the two cannot validate
// the same fields differently — the template-types/shared.ts shape, fourth
// instance of the taxonomy pattern.

export const TrainingCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // The colour is a KEY from src/lib/badge-presets.ts, never a class string and
  // never freeform hex — Tailwind 4 runs CSS-first here with no safelist, so a
  // class string from the database is never generated. TYPE-1_AUDIT §7.
  colorKey: z.string().refine(isBadgePresetKey, "Unknown colour"),
  sortOrder: z.number().int().optional(),
})

// Case-insensitive, because @@unique([organizationId, name]) is case-SENSITIVE
// and "Safety"/"safety" would both be accepted by the database while reading as
// the same category to a human. The constraint remains the actual guarantee —
// this check exists to produce a good message before hitting it, and callers
// must still catch P2002 for the race.
export async function findNameConflict(
  organizationId: string,
  name: string,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const rows = await prisma.trainingCategory.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  })
  const target = name.trim().toLowerCase()
  return rows.find((r) => r.id !== excludeId && r.name.toLowerCase() === target) ?? null
}

// Prisma's unique-constraint violation, turned into an ordinary 409 by callers.
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}
