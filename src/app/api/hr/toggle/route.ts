import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin, hrModuleAvailable } from "@/lib/auth"

const bodySchema = z.object({ enabled: z.boolean() })

// Flips "hr" in the org's activeModules (Instagram-toggle pattern). Behind the
// availability gate: where HR doesn't exist, this endpoint doesn't either.
export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!hrModuleAvailable(orgId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const activeModules = parsed.data.enabled
    ? [...new Set([...org.activeModules, "hr"])]
    : org.activeModules.filter((m) => m !== "hr")

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { activeModules },
  })

  return NextResponse.json({ enabled: updated.activeModules.includes("hr") })
}
