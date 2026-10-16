import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireMilestones } from "@/lib/milestones-access"
import { MilestonesClient } from "./milestones-client"
import { getMilestoneSettings } from "@/lib/attendance"
import { laborOverlayOn } from "@/lib/labor-dashboard"
import { getRaisePickerOptions, getRaiseSettings } from "@/lib/raise-eligibility"

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
// THREE LIVE SECTIONS since MS-3a: Tenure milestones (MS-1), On-time (MS-2,
// src/app/api/milestones/attendance) and Raise eligibility (MS-3a,
// src/app/api/milestones/raise). Checklists (MS-4) still renders as a labelled
// "Coming soon" card with NO controls — nothing in it is wired, and nothing in
// it may be mistaken for a setting.
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

  // MS-2. The On-time section's values (defaults until the first save) and
  // whether the Square labor overlay is on — F5: with it off the section still
  // saves, and says every badge is grey until schedule data exists.
  // MS-3a adds the raise rules and the trainings / documents an ADMIN may
  // require (titles only, this org, live ones — getRaisePickerOptions).
  const [settings, org, raise, raiseOptions] = await Promise.all([
    getMilestoneSettings(access.org.id),
    prisma.organization.findUniqueOrThrow({ where: { id: access.org.id } }),
    getRaiseSettings(access.org.id),
    getRaisePickerOptions(access.org.id),
  ])

  return (
    <MilestonesClient
      initial={rows}
      attendance={settings}
      raise={raise}
      raiseOptions={raiseOptions}
      squareLaborOn={laborOverlayOn(org)}
    />
  )
}
