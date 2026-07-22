import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireHrTrainingAccess } from "../../access"

// DELETE /api/hr/training/resources/[id] — ADMIN. Removes the row only; the
// private blob stays (HR never deletes blobs — duplicated modules share them).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireHrTrainingAccess()
  if (!access.ok) return access.response

  const { id } = await params
  const resource = await prisma.trainingResource.findFirst({
    where: { id, trainingLesson: { trainingModule: { organizationId: access.org.id } } },
  })
  if (!resource) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.trainingResource.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
