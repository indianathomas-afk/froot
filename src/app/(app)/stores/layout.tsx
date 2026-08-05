import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

// PERM-5C. Was requireManagerOrAdmin(). stores.view is MANAGE, so the role
// baseline is unchanged and the sidebar has asked this same capability since
// PERM-1.
//
// stores.view is NOT in ENFORCED_CAPABILITIES and must not be added without
// the work named here first. Denying it would remove this page and the nav
// entry — but GET /api/stores has never had a role check and serves any org
// member by design: it is the store list that the dashboard, checklists,
// inventory and forecasting all read. Hiding the page while that endpoint
// keeps answering is the PERM-2 bug class, and gating that endpoint instead
// would take the store list away from every STORE and STAFF login. So the
// enforcement here is real and honest, and the toggle stays out until someone
// rules on what a "stores read" tier should mean app-wide. stores.manage — the
// writes below — is a clean toggle and is already in the grid.
export default async function StoresLayout({ children }: { children: React.ReactNode }) {
  let actor
  try {
    ;({ actor } = await getUserStoreScope())
  } catch {
    redirect("/dashboard")
  }
  if (!can(actor, "stores.view")) redirect("/dashboard")
  return children
}
