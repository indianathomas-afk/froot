import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import {
  AUDIENCE_INCLUDE,
  canReadHrDocument,
  resolveDocumentViewer,
  viewerAudienceWhere,
} from "@/lib/hr-documents-access"
import { HrDocumentsClient } from "./documents-client"

// HR-3 Reference Library + HR-4 signature documents. Upload/manage is
// ADMIN-only (enforced by the API; the UI hides the controls). Same gate stack
// as /hr: availability gate first (notFound while HR doesn't exist here), then
// the per-org toggle (redirect to /hr, which renders the upsell).
//
// DOC-1 A: this page's rule was "both kinds are readable by every authenticated
// org member". It is now "readable by the document's audience" — narrowed by
// viewerAudienceWhere, then re-filtered through canReadHrDocument so the
// fragment and the function cannot disagree in the caller's favour
// (lib/hr-documents-access.ts, the training.ts pattern). This page still has no
// role gate of its own, deliberately: the audience IS the gate now, and ADMIN
// gets an empty fragment because document config is ADMIN territory (HR-2).
export default async function HrDocumentsPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")

  const viewer = await resolveDocumentViewer(org.id, dbUser)

  const docs = await prisma.hrDocument.findMany({
    where: {
      organizationId: org.id,
      kind: { in: ["Reference", "Acknowledgment"] },
      isActive: true,
      ...viewerAudienceWhere(viewer),
    },
    include: { versions: { where: { isCurrent: true }, take: 1 }, ...AUDIENCE_INCLUDE },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  })

  const documents = docs
    .filter((d) => canReadHrDocument(d, viewer))
    .map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      kind: d.kind as "Reference" | "Acknowledgment",
      fileName: d.versions[0]?.fileName ?? "",
      sizeBytes: d.versions[0]?.sizeBytes ?? 0,
      uploadedAt: (d.versions[0]?.createdAt ?? d.createdAt).toISOString(),
    }))

  return <HrDocumentsClient documents={documents} isAdmin={dbUser?.role === "ADMIN"} />
}
