import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import {
  requireForecastContext,
  requireForecastStore,
  forecastWindowForStore,
  forecastWindowForCaller,
} from "@/lib/forecasting-access"
import { GOAL_ENTITY_TYPES } from "@/lib/audit"
import { windowYears, type ForecastWindow } from "@/lib/forecast-window"

// GET /api/forecasting/audit?storeId=&month=&limit= — read-only goal-edit
// history (Phase F-5), newest first. Admins see any org store; managers see
// only their assigned stores (which PERM-3 made true of every forecasting read,
// so this route is no longer the strict outlier it was) and only entries inside
// their forecast window. month= (yyyy-mm) narrows to edits of that month's
// goals, including plan-level (whole-year) changes.

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

  // storeId present → requireForecastStore enforces org + assignment (the check
  // this route already did by hand) and hands back the row whose timezone
  // defines the window. Absent → fall back to the caller's deterministic store.
  let win: ForecastWindow | null
  if (storeId) {
    const store = await requireForecastStore(ctx, storeId)
    if ("error" in store) return store.error
    win = forecastWindowForStore(ctx, store)
  } else {
    win = await forecastWindowForCaller(ctx)
  }

  // Store scoping lives in metadata.storeId (AuditLog is entity-generic).
  // PERM-6 Task 5: this filter is a SCOPING decision, so it asks unscoped —
  // not canEdit. It read ctx.isAdmin when that one flag meant both.
  const storeFilter: Prisma.AuditLogWhereInput[] = storeId
    ? [{ metadata: { path: ["storeId"], equals: storeId } }]
    : ctx.unscoped
      ? []
      : assignedIds.map((id) => ({ metadata: { path: ["storeId"], equals: id } }))
  if (!ctx.unscoped && !storeId && assignedIds.length === 0) {
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

  // PERM-3: a manager's audit trail is limited to their forecast window —
  // otherwise the before/after goal dollars in the metadata are a back-door
  // read of exactly the values /calendar withholds. Filtered in the QUERY, not
  // after the fetch, so `limit` still returns a full page of visible entries.
  //
  // A window month prefix matches both the day periods inside it ("2026-12-05")
  // and the month period itself ("2026-12"); plan-level entries carry a bare
  // year, and those are kept for the window's years because the annual
  // aggregates they hold are visible to managers anyway (Gary, Q2).
  const windowFilter: Prisma.AuditLogWhereInput[] = win
    ? [
        ...win.months.map((mo) => ({
          metadata: { path: ["period"], string_starts_with: mo },
        })) satisfies Prisma.AuditLogWhereInput[],
        ...windowYears(win).map((y) => ({
          metadata: { path: ["period"], equals: String(y) },
        })) satisfies Prisma.AuditLogWhereInput[],
      ]
    : []

  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId: ctx.org.id,
      entityType: { in: [...GOAL_ENTITY_TYPES] },
      ...(storeFilter.length > 0 ? { OR: storeFilter } : {}),
      AND: [
        ...(monthFilter.length > 0 ? [{ OR: monthFilter }] : []),
        ...(windowFilter.length > 0 ? [{ OR: windowFilter }] : []),
      ],
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
