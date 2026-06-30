import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { del } from "@vercel/blob"

export async function DELETE(_: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { taskId } = await params
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const attachment = await prisma.taskAttachment.findFirst({
    where: { taskId, task: { template: { organizationId: org.id } } },
  })
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await del(attachment.url).catch(() => {})
  await prisma.taskAttachment.delete({ where: { taskId } })

  return NextResponse.json({ ok: true })
}
