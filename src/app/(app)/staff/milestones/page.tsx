import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireMilestones } from "@/lib/milestones-access"
import { checklistMilestonesEnabled } from "@/lib/milestones-db"
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
// FOUR LIVE SECTIONS since MS-4a: Tenure milestones (MS-1), On-time (MS-2,
// src/app/api/milestones/attendance), Raise eligibility (MS-3a,
// src/app/api/milestones/raise) and Checklists (MS-4a,
// src/app/api/milestones/checklist) — the last shows only its switch until the
// F13 "Checklist milestones" switch is on, and no rows are read while it is off.
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
  const [settings, org, raise, raiseOptions, checklistOn] = await Promise.all([
    getMilestoneSettings(access.org.id),
    prisma.organization.findUniqueOrThrow({ where: { id: access.org.id } }),
    getRaiseSettings(access.org.id),
    getRaisePickerOptions(access.org.id),
    checklistMilestonesEnabled(access.org.id),
  ])

  // MS-4a F13: switch off = the section shows only the switch, so the rows are
  // not even read.
  const checklistRows = checklistOn
    ? await prisma.checklistMilestone.findMany({
        where: { organizationId: access.org.id },
        orderBy: [{ isArchived: "asc" }, { taskCount: "asc" }],
        select: { id: true, taskCount: true, title: true, recognition: true, employeeMessage: true, isArchived: true },
      })
    : []

  return (
    <MilestonesClient
      initial={rows}
      checklist={{
        enabled: checklistOn,
        rows: checklistRows.map(({ taskCount, ...r }) => ({ ...r, count: taskCount })),
      }}
      attendance={settings}
      raise={raise}
      raiseOptions={raiseOptions}
      squareLaborOn={laborOverlayOn(org)}
    />
  )
}
