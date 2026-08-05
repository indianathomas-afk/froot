import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { can, type PermissionUser } from "@/lib/permissions"

// PERM-5C. Shared guard for every purchase-order WRITE — create, edit, submit,
// cancel, and the invoice upload that hangs off a PO. Same shape as
// api/templates/access.ts and api/stores/access.ts.
//
// inventory.po.manage is MANAGE, matching the requireManagerOrAdmin() this
// replaces exactly. It was B's second held-out grid row: the /inventory/
// purchase-orders/new page already asked the capability while every endpoint
// behind it was still on an inline role check, so denying it would have hidden
// the page and left the APIs answering. Migrating these five is what releases
// the toggle.
//
// NOT applied to the READ paths. GET /api/inventory/purchase-orders and the PO
// list/detail pages are inventory.po.view (OPERATIONAL, and includes receiving
// by design per IV-7) — a different tier serving the floor, untouched here.
export async function denyUnlessPoManage(): Promise<NextResponse | null> {
  let actor: PermissionUser = { role: null }
  try {
    actor = (await getCurrentUser()).actor
  } catch {
    actor = { role: null }
  }
  if (!can(actor, "inventory.po.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}
