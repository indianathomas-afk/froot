import { NextResponse } from "next/server"
import type { Organization, User } from "@prisma/client"
import { getCurrentUser, actorFor } from "@/lib/auth"
import { can } from "@/lib/permissions"

// ─── Nutrition gates (N-1) ───────────────────────────────────────────────────
// R-4 (Gary, 2026-11-01): "Nutrition pages require both the inventory and
// nutrition modules." Recipes and ingredients live under inventory, so an org
// with nutrition alone would have nutrition pages and nothing to compute from.
// There is no env availability gate: no org has "nutrition" in activeModules
// and nothing in the app can add it (R-2 — Gary enables it in the Neon
// console), so the module flag alone keeps N-1 dark where it is not switched on.
//
// F3: "Only ADMIN edits nutrition, allergens, the not-food flag, and runs the
// import. ADMIN, MANAGER and STORE can view; STAFF cannot." → nutrition.manage /
// nutrition.view in src/lib/permissions.ts.

export function nutritionActive(org: { activeModules: string[] }): boolean {
  return org.activeModules.includes("inventory") && org.activeModules.includes("nutrition")
}

export type NutritionContext = {
  org: Organization
  dbUser: User | null
  actor: ReturnType<typeof actorFor>
}

export async function requireNutrition(
  capability: "nutrition.view" | "nutrition.manage"
): Promise<NutritionContext | { error: NextResponse }> {
  let current: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    current = await getCurrentUser()
  } catch (err) {
    console.error("[api/nutrition] auth/context error:", err)
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  // Same status the inventory routes use for a module that is off.
  if (!nutritionActive(current.org)) {
    return { error: NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 }) }
  }
  if (!current.dbUser || !can(current.actor, capability)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { org: current.org, dbUser: current.dbUser, actor: current.actor }
}
