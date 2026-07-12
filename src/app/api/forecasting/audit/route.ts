import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { requireForecastContext } from "@/lib/forecasting-access"
import { GOAL_ENTITY_TYPES } from "@/lib/audit"

// GET /api/forecasting/audit?storeId=&month=&limit= — read-only goal-edit
// history (Phase F-5), newest first. Admins see any org store; managers see
// only their assigned stores (tighter than forecasting reads on purpose —
// the audit trail names who changed what). month= (yyyy-mm) narrows to edits
// of that month's goals, including plan-level (whole-year) changes.

const MAX_LIMIT = 100

export async function GET(req: Request) {
  const ctx = await requireForecastContext()
  if ("error" in ctx) return ctx.error

  const url = new URL(req.url)
  const storeId = url.searchParams.get("storeId")
  const month = url.searchParams.get("month") // yyyy-mm
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || 30))

  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be yyyy-mm" }, { status: 400 })
  }

  const assignedIds = ctx.dbUser?.storeAssignments.map((a) => a.storeId) ?? []
  if (!ctx.isAdmin && storeId && !assignedIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Store scoping lives in metadata.storeId (AuditLog is entity-generic).
  const storeFilter: Prisma.AuditLogWhereInput[] = storeId
    ? [{ metadata: { path: ["storeId"], equals: storeId } }]
    : ctx.isAdmin
      ? []
      : assignedIds.map((id) => ({ metadata: { path: ["storeId"], equals: id } }))
  if (!ctx.isAdmin && !storeId && assignedIds.length === 0) {
    return NextResponse.json({ entries: [] })
  }

  const monthFilter: Prisma.AuditLogWhereInput[] = month
    ? [
        // Day ("yyyy-mm-dd") and month ("yyyy-mm") periods share the prefix;
        // plan-level entries carry the bare year.
        { metadata: { path: ["period"], string_starts_with: month } },
        { metadata: { path: ["period"], equals: month.slice(0, 4) } },
      ]
    : []

  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId: ctx.org.id,
      entityType: { in: [...GOAL_ENTITY_TYPES] },
      ...(storeFilter.length > 0 ? { OR: storeFilter } : {}),
      ...(monthFilter.length > 0 ? { AND: [{ OR: monthFilter }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  // AuditLog.userId is a Clerk id (same convention as GoalPlan.updatedById) —
  // resolve to names for display.
  const clerkIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))]
  const users = clerkIds.length
    ? await prisma.user.findMany({
        where: { clerkUserId: { in: clerkIds } },
        select: { clerkUserId: true, name: true, email: true },
      })
    : []
  const byClerkId = new Map(users.map((u) => [u.clerkUserId, u]))

  return NextResponse.json({
    entries: rows.map((r) => {
      const user = r.userId ? byClerkId.get(r.userId) : undefined
      return {
        id: r.id,
        action: r.action,
        createdAt: r.createdAt,
        user: user ? { name: user.name, email: user.email } : null,
        metadata: r.metadata,
      }
    }),
  })
}
