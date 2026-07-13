import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { HrDocumentsClient } from "./documents-client"

// HR-3 Reference Library + HR-4 signature documents. Both kinds are readable
// by every authenticated org member (staff must be able to read what they are
// asked to sign). Upload/manage is ADMIN-only (enforced by the API; the UI
// hides the controls). Same gate stack as /hr: availability gate first
// (notFound while HR doesn't exist here), then the per-org toggle (redirect
// to /hr, which renders the upsell).
export default async function HrDocumentsPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")

  const docs = await prisma.hrDocument.findMany({
    where: { organizationId: org.id, kind: { in: ["Reference", "Acknowledgment"] }, isActive: true },
    include: { versions: { where: { isCurrent: true }, take: 1 } },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  })

  const documents = docs.map((d) => ({
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
