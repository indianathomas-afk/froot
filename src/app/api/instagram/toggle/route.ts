import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"

const bodySchema = z.object({ enabled: z.boolean() })

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })
  if (!org.instagramAccessToken) {
    return NextResponse.json({ error: "Instagram is not connected" }, { status: 400 })
  }

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { instagramEnabled: parsed.data.enabled },
  })

  return NextResponse.json({ enabled: updated.instagramEnabled })
}
