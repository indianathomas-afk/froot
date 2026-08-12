import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import TrainingClient from "./training-client"

// HR-6 training builder list. HR-24 (Gary, 2026-08-11) added a second tier:
// STORE reads the same library read-only, following the /hr/documents shape —
// read access broad, manage ADMIN-only at the API, UI controls hidden for
// non-managers. The page comment used to say "authoring is ADMIN-only, so
// unlike the document library the whole page is gated, not just the controls";
// that is now true of the CONTROLS, not the page.
//
// canManage is the /hr/documents `isAdmin` prop by another name and does the
// same job: it hides affordances. It is NEVER the gate. Every authoring route
// behind this page still refuses STORE at requireHrTrainingAccess and every
// assignment route at requireHrTrainingManageAccess — unchanged by this
// session — and the client's read data comes from a separate trimmed route.
//
// Same gate stack as /hr: availability gate first (notFound while HR doesn't
// exist here), then the per-org toggle (redirect to /hr, which renders the
// upsell). MANAGER still redirects: MANAGER page access is its own future row.
export default async function HrTrainingPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  const role = dbUser?.role
  if (role !== "ADMIN" && role !== "STORE") redirect("/hr")

  return <TrainingClient canManage={role === "ADMIN"} />
}
