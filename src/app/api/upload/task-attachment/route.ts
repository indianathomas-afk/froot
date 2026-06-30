import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { put, del } from "@vercel/blob"

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const form = await req.formData()
  const file = form.get("file") as File | null
  const taskId = form.get("taskId") as string | null
  const label = (form.get("label") as string | null) ?? ""

  if (!file || !taskId) return NextResponse.json({ error: "file and taskId required" }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Only PDF, JPG, and PNG files are allowed" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 413 })

  // Verify the task belongs to this org
  const task = await prisma.task.findFirst({
    where: { id: taskId, template: { organizationId: org.id } },
    include: { attachment: true },
  })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  // Delete old blob if one exists
  if (task.attachment) {
    await del(task.attachment.url).catch(() => {})
    await prisma.taskAttachment.delete({ where: { taskId } })
  }

  const ext = file.name.split(".").pop() ?? "bin"
  const blob = await put(`task-attachments/${org.id}/${taskId}/${Date.now()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  })

  const attachment = await prisma.taskAttachment.create({
    data: {
      taskId,
      label: label || file.name,
      url: blob.url,
      contentType: file.type,
      sizeBytes: file.size,
    },
  })

  return NextResponse.json(attachment, { status: 201 })
}
