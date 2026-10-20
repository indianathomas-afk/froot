import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { requireMilestones } from "@/lib/milestones-access"
import { resolveSelfStaff } from "@/lib/hr"
import { buildMilestoneReport } from "@/lib/milestone-report"
import { ReportClient } from "./report-client"

// ─────────────────────────────────────────────────────────────────────────────
// MS-5 — /staff/milestones/report. READ-ONLY. F1 (Gary, 2026-10-19): "Yes —
// /staff/milestones/report, ADMIN + MANAGER (own stores), linked from /staff
// and the setup page."
//
// THREE GATES, in this order:
//   1. (app)/staff/layout.tsx — staff.view (MANAGE), before this file runs, so
//      STORE and STAFF are already sent to /dashboard;
//   2. requireMilestones() with NO capability — HR available + HR on +
//      milestonesEnabled, else notFound(): Milestones off = no report, 404 for
//      everyone, ADMIN included;
//   3. the ROLE, ADMIN or MANAGER, checked explicitly — the same test /staff
//      uses for the On-Time and Raise badges — so a capability grant can never
//      widen the report past the badges (ruling 2).
// The setup page next door stays milestones.manage (ADMIN only, MS-1 ruling 1).
//
// Everything the browser receives is buildMilestoneReport's return value; the
// redaction and the F3 / F9 rules live there (src/lib/milestone-report.ts).
// ─────────────────────────────────────────────────────────────────────────────

export default async function MilestoneReportPage() {
  let access
  try {
    access = await requireMilestones()
  } catch {
    redirect("/dashboard")
  }
  if (!access.ok) {
    if (access.reason === "disabled" || access.reason === "no-org") notFound()
    redirect("/dashboard")
  }

  // getCurrentUser(), never a bare clerkUserId lookup (CLAUDE.md § Page
  // Conventions). It also hands back the full Organization row the batched
  // readers take.
  const { org, dbUser, actor } = await getCurrentUser()
  const role = dbUser?.role ?? null
  if (role !== "ADMIN" && role !== "MANAGER") redirect("/dashboard")

  // F9 — whose row is the viewer's own. The /staff "You" marker's resolver.
  const self = dbUser ? await resolveSelfStaff(org.id, dbUser) : null

  const report = await buildMilestoneReport({
    org,
    viewer: {
      actor,
      role,
      isAdmin: role === "ADMIN",
      storeIds: access.storeIds,
      selfStaffId: self?.ok ? self.staffMember.id : null,
    },
  })

  return <ReportClient report={report} />
}
