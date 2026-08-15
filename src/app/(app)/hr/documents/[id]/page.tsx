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
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { anchors: { orderBy: [{ page: "asc" }, { y: "desc" }] } },
      },
      checkpoints: {
        orderBy: { orderIndex: "asc" },
        // DOC-1 C: THIS COUNT IS UNFILTERED ON PURPOSE — every acknowledgment on
        // the checkpoint, every staff member, every version, every signing
        // cycle. It is never rendered as a number; its only consumer is the
        // edit/delete lock in document-detail-client.tsx ("this checkpoint has
        // been signed and is part of the permanent record"). Audience-filtering
        // it would be actively wrong: if the only person who ever signed has
        // since left the document's audience the count would read 0 and the
        // checkpoint would become DELETABLE — reaching backwards into a
        // signature already given, which ruling 5 forbids. "Has anyone ever
        // signed this" is a different question from "who owes it", and the
        // unfiltered count is the correct answer to it. Audited and ruled OUT
        // of Phase C; not a missed adoption site.
        include: { _count: { select: { acknowledgments: true } } },
      },
    },
  })
  if (!doc) notFound()

  // HR-11b: anchors are per-version — the confirm UI only ever edits the CURRENT
  // version's set (historical versions keep what they were signed against).
  const currentVersion = doc.versions.find((v) => v.isCurrent) ?? doc.versions[0]

  // HR-11n: resolve the names behind retiredByUserId for the Retired section.
  // Soft pointer (no FK), so a deleted user yields no row and the UI falls back
  // to "Unknown" rather than dropping the retirement from the list — WHO retired
  // it is secondary evidence; THAT it was retired is the record.
  const retiredByIds = [
    ...new Set(doc.checkpoints.map((c) => c.retiredByUserId).filter((v): v is string => !!v)),
  ]
  const retiredByUsers = retiredByIds.length
    ? await prisma.user.findMany({
        // Org-scoped: a soft pointer is not a trusted key (CLAUDE.md — never a
        // bare lookup by id alone on a page).
        where: { id: { in: retiredByIds }, organizationId: org.id },
        select: { id: true, name: true, email: true },
      })
    : []
  const retiredByName = new Map(
    retiredByUsers.map((u) => [u.id, u.name?.trim() || u.email || "Unknown"])
  )

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
          // HR-11n
          retiredAt: c.retiredAt?.toISOString() ?? null,
          retiredByName: c.retiredByUserId ? retiredByName.get(c.retiredByUserId) ?? "Unknown" : null,
          retiredReason: c.retiredReason,
        })),
        currentVersionId: currentVersion?.id ?? null,
        anchors: (currentVersion?.anchors ?? []).map((a) => ({
          id: a.id,
          page: a.page,
          anchorText: a.anchorText,
          markType: a.markType,
          placement: a.placement,
          confirmed: a.confirmed,
        })),
      }}
    />
  )
}
