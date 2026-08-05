import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

// PERM-5C. Was requireManagerOrAdmin(). reports.view is MANAGE — same
// baseline, now override-aware, and the same capability the sidebar has asked
// since PERM-1.
//
// This is the cleanest entry in the whole sweep and the reason is worth
// stating: there is no /api/reports. The page is a server component that
// queries Prisma directly (already store-scoped via getUserStoreScope), so nav
// + page IS the entire surface. Ruling 2 asks that denying a capability kill
// the nav entry, the page and every API route together; here the third set is
// empty, so this one line satisfies it completely. Compare stores.view in the
// sibling layout, where a shared endpoint makes the same thing impossible.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  let actor
  try {
    ;({ actor } = await getUserStoreScope())
  } catch {
    redirect("/dashboard")
  }
  if (!can(actor, "reports.view")) redirect("/dashboard")
  return children
}
