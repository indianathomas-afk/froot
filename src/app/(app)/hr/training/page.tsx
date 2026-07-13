import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import TrainingClient from "./training-client"

// HR-6 training builder list — authoring is ADMIN-only, so unlike the
// document library the whole page is gated, not just the controls (staff
// self-service arrives as /my/training in HR-7). Same gate stack as /hr:
// availability gate first (notFound while HR doesn't exist here), then the
// per-org toggle (redirect to /hr, which renders the upsell).
export default async function HrTrainingPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") redirect("/hr")

  return <TrainingClient />
}
