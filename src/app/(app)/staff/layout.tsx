import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

// PERM-5C. Was requireManagerOrAdmin(). staff.view is MANAGE, so the role
// baseline is byte-identical — what changes is that the per-user override is
// now consulted, which is what makes Gary's example (a) expressible: deny
// staff.view and Staff disappears from the nav (sidebar.tsx already asks the
// same capability), /staff and /staff/[id] bounce here, and GET /api/staff
// refuses. Nav, page and API together — PERM-2's discipline.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  let actor
  try {
    ;({ actor } = await getUserStoreScope())
  } catch {
    redirect("/dashboard")
  }
  if (!can(actor, "staff.view")) redirect("/dashboard")
  return children
}
