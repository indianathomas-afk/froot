import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

// ─── Audit log (Phase F-5) ───────────────────────────────────────────────────
// Tamper-evident record of goal mutations: who, when, before → after. Writes
// NEVER block the user action — a failed audit insert is logged and swallowed.
//
// Metadata convention for goal entries (read by /api/forecasting/audit and the
// Edit history panel):
//   storeId / storeName — which store
//   period  — what changed: "yyyy-mm-dd" (day), "yyyy-mm" (month), "yyyy" (plan)
//   before / after — goal dollar amounts (null when there was no prior value)
//   source  — "day" | "month" | "plan" | "import" | "manual"
//   ...extras per action (increasePct, applyScope, shape, fileUrl, …)

export const GOAL_ENTITY_TYPES = ["goal_plan", "daily_goal", "store_monthly_goal"] as const

export type GoalAuditAction =
  | "goal.day_override"
  | "goal.month_redistribute"
  | "goal.plan_regenerate"
  | "goal.import_commit"
  | "goal.manual_set"

export type AuditEntry = {
  organizationId: string
  userId: string | null // Clerk user id (same convention as GoalPlan.updatedById)
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Prisma.InputJsonValue
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
      },
    })
  } catch (e) {
    console.error(`[audit] write failed (${entry.action}):`, e instanceof Error ? e.message : e)
  }
}
