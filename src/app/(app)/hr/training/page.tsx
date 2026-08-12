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
// behind this page still refuses non-ADMINs at requireHrTrainingAccess and
// every assignment route refuses STORE at requireHrTrainingManageAccess —
// unchanged by this session — and the client's read data comes from a separate
// trimmed route.
//
// HR-26 (Gary, 2026-08-12): MANAGER is admitted, and ONE FLAG NO LONGER
// SUFFICES. Three tiers now view this page with three different action sets —
// ADMIN everything, MANAGER read + assign, STORE read — and a single boolean can
// only express two of them. So there are TWO, each named for the action set it
// governs rather than for a role, which is what keeps this from becoming a
// role-conditional tangle in the client:
//
//   canManage  ADMIN            authoring — create, import, export, categories,
//                               edit, duplicate, lifecycle
//   canAssign  ADMIN + MANAGER  the Assign button and the bulk-assign dialog
//
// canManage implies canAssign, and the client asserts nothing beyond these two.
// The ASSIGN half is not a new write path: POST .../assignments/bulk and GET
// .../bulk/recipients have admitted store-scoped MANAGER at
// requireHrTrainingManageAccess since HR-22, with every scope rule enforced
// server-side. This page gate was the only thing keeping managers out.
//
// Same gate stack as /hr: availability gate first (notFound while HR doesn't
// exist here), then the per-org toggle (redirect to /hr, which renders the
// upsell).
export default async function HrTrainingPage() {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  const role = dbUser?.role
  if (role !== "ADMIN" && role !== "MANAGER" && role !== "STORE") redirect("/hr")

  return (
    <TrainingClient
      canManage={role === "ADMIN"}
      canAssign={role === "ADMIN" || role === "MANAGER"}
    />
  )
}
