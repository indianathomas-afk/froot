import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { TrainingForm } from "../training-form"

export default async function NewTrainingModulePage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") redirect("/hr")

  const [stores, categories, linkedDocuments] = await Promise.all([
    prisma.store.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, storeNumber: true },
      orderBy: { name: "asc" },
    }),
    prisma.trainingCategory.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, colorKey: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    // HR-32: a fourth entry in the Promise.all this page already runs, rather
    // than a new API route — a route would be a new permission surface for a
    // list an ADMIN-only page can just query. Active Links only: a new lesson
    // has nothing pointing at a deactivated document, so unlike the edit page
    // there is nothing to widen for.
    prisma.hrDocument.findMany({
      where: { organizationId: org.id, kind: "Link", isActive: true },
      select: { id: true, title: true, isActive: true },
      orderBy: { title: "asc" },
    }),
  ])

  return <TrainingForm stores={stores} categories={categories} linkedDocuments={linkedDocuments} />
}
