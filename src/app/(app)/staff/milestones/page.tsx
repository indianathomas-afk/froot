import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireMilestones } from "@/lib/milestones-access"
import { MilestonesClient } from "./milestones-client"

// ─────────────────────────────────────────────────────────────────────────────
// MS-1 — /staff/milestones. THE ADMIN SETUP PAGE (ruling 1: "Only ADMINs see the
// Milestone setup page").
//
// SHAPE COPIED FROM /staff/engagement (F0, Gary 2026-10-15: no design bundle
// for MS-1 — "Use existing Froot screens as the pattern"). Same sibling route,
// same three gates in the same order:
//   1. (app)/staff/layout.tsx — staff.view (MANAGE), before this file runs;
//   2. requireMilestones() — HR available + HR on + milestonesEnabled, else
//      notFound(): with Milestones off the page does not exist (step 2);
//   3. milestones.manage (ADMIN_ONLY, not grantable) — else /dashboard.
// The write routes re-check (2) and (3) independently (PERM-2: a gate on a
// page is not a gate on an endpoint).
//
// ONE LIVE SECTION. Attendance (MS-2), Raise eligibility (MS-3) and Checklists
// (MS-4) render as labelled "Coming soon" cards with NO controls — nothing in
// them is wired, and nothing in them may be mistaken for a setting.
// ─────────────────────────────────────────────────────────────────────────────

export default async function MilestonesSetupPage() {
  let access
  try {
    access = await requireMilestones("milestones.manage")
  } catch {
    redirect("/dashboard")
  }
  if (!access.ok) {
    if (access.reason === "disabled" || access.reason === "no-org") notFound()
    redirect("/dashboard")
  }

  const rows = await prisma.tenureMilestone.findMany({
    where: { organizationId: access.org.id },
    orderBy: [{ isArchived: "asc" }, { dayCount: "asc" }],
    select: { id: true, dayCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true },
  })

  return <MilestonesClient initial={rows} />
}
