import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { can, type PermissionUser } from "@/lib/permissions"

// PERM-5C. Shared guard for the /api/stores WRITE handlers — POST (create),
// PATCH and DELETE. Same shape as api/templates/access.ts.
//
// Deliberately not applied to GET /api/stores, which has never had a role
// check: it is the store list the dashboard, checklists, inventory and
// forecasting all read, already narrowed to the caller's assignments by
// getUserStoreScope(). Gating it on stores.view would take the store list away
// from every STORE and STAFF login — a restriction, not a migration, and
// Session C changes who enforces rather than who is allowed. That asymmetry is
// exactly why stores.view is kept out of the override grid; see the comment in
// (app)/stores/layout.tsx.
//
// stores.manage is ADMIN_ONLY, matching the requireAdmin() this replaces.
export async function denyUnlessStoresManage(): Promise<NextResponse | null> {
  let actor: PermissionUser = { role: null }
  try {
    actor = (await getCurrentUser()).actor
  } catch {
    actor = { role: null }
  }
  if (!can(actor, "stores.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}
