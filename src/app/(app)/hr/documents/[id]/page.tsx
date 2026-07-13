import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { DocumentDetailClient } from "./document-detail-client"

// HR-4 admin document manager: version history + re-upload and the checkpoint
// editor for signature documents. ADMIN-only — everyone else gets the same
// notFound as a nonexistent id, so the URL leaks nothing.
export default async function HrDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") notFound()

  const doc = await prisma.hrDocument.findFirst({
    where: { id: (await params).id, organizationId: org.id },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      checkpoints: {
        orderBy: { orderIndex: "asc" },
        include: { _count: { select: { acknowledgments: true } } },
      },
    },
  })
  if (!doc) notFound()

  return (
    <DocumentDetailClient
      doc={{
        id: doc.id,
        title: doc.title,
        category: doc.category,
        kind: doc.kind,
        isActive: doc.isActive,
        versions: doc.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          fileName: v.fileName,
          sizeBytes: v.sizeBytes,
          fileHash: v.fileHash,
          isCurrent: v.isCurrent,
          createdAt: v.createdAt.toISOString(),
        })),
        checkpoints: doc.checkpoints.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          orderIndex: c.orderIndex,
          pageRef: c.pageRef,
          attestationText: c.attestationText,
          required: c.required,
          acknowledgmentCount: c._count.acknowledgments,
        })),
      }}
    />
  )
}
