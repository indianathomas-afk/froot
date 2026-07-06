import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"

const GoalSchema = z.object({
  storeId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}-01$/), // first of month
  goalAmount: z.number().positive(),
})

// PUT /api/dashboard/goal — upsert a store's monthly sales goal (manager/admin,
// within store scope).
export async function PUT(req: Request) {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { org, dbUser } = ctx
  const isAdmin = dbUser?.role === "ADMIN"
  if (!isAdmin && dbUser?.role !== "MANAGER") {
    return NextResponse.json({ error: "Manager or Admin access required" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = GoalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { storeId, month, goalAmount } = parsed.data

  const scopedStoreIds = dbUser?.storeAssignments.map((a) => a.storeId) ?? []
  if (!isAdmin && !scopedStoreIds.includes(storeId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const store = await prisma.store.findFirst({ where: { id: storeId, organizationId: org.id } })
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })

  const monthDate = new Date(`${month}T00:00:00.000Z`)
  const goal = await prisma.storeMonthlyGoal.upsert({
    where: { storeId_month: { storeId, month: monthDate } },
    create: { organizationId: org.id, storeId, month: monthDate, goalAmount },
    update: { goalAmount },
  })

  return NextResponse.json({ id: goal.id, storeId, month, goalAmount: goal.goalAmount })
}
