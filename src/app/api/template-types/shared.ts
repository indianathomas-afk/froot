import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isBadgePresetKey } from "@/lib/badge-presets"

// TPL-1b. Shared by the collection route and /[id], so the two cannot validate
// the same fields differently. The IngredientCategory precedent duplicates its
// schema across both files; that is the one thing here not copied from it.

export const TemplateTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // The colour is a KEY from src/lib/badge-presets.ts, never a class string and
  // never freeform hex — Tailwind 4 runs CSS-first here with no safelist, so a
  // class string from the database is never generated. TYPE-1_AUDIT §7.
  colorKey: z.string().refine(isBadgePresetKey, "Unknown colour"),
  sortOrder: z.number().int().optional(),
})

// Case-insensitive, because @@unique([organizationId, name]) is case-SENSITIVE
// and "Opener"/"opener" would both be accepted by the database while reading as
// the same type to a human. The constraint remains the actual guarantee — this
// check exists to produce a good message before hitting it, and callers must
// still catch P2002 for the race.
export async function findNameConflict(
  organizationId: string,
  name: string,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const rows = await prisma.templateType.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  })
  const target = name.trim().toLowerCase()
  return rows.find((r) => r.id !== excludeId && r.name.toLowerCase() === target) ?? null
}

// Prisma's unique-constraint violation. The precedent routes let this reach the
// client as a 500; here a duplicate name is an ordinary user mistake and gets a
// 409 like any other.
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
}
