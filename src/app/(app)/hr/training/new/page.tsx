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

  const stores = await prisma.store.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, storeNumber: true },
    orderBy: { name: "asc" },
  })

  return <TrainingForm stores={stores} />
}
