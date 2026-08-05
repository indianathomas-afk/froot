import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { can, type PermissionUser } from "@/lib/permissions"

// PERM-5C. Shared guard for every /api/templates handler — the same shape as
// api/staff/access.ts and api/staff/[id]/notes/access.ts, which is the house
// pattern for "one capability, several routes".
//
// Seven handlers previously carried `try { await requireAdmin() } catch { 403 }`
// inline. templates.manage is ADMIN_ONLY, so the role baseline is identical;
// what changes is that the per-user override is consulted. Collapsing them here
// is what makes the guard auditable in one place: templates.manage is entering
// the override grid this session, and a grid row whose enforcement is scattered
// over four files is a row nobody can verify.
//
// Returns a 403 response when denied, or null when the caller may proceed —
// callers write `const denied = await denyUnlessTemplatesManage(); if (denied)
// return denied`. Deny-by-default: an unresolvable session (no Clerk user, no
// org, no User row) yields { role: null }, which can() refuses.
export async function denyUnlessTemplatesManage(): Promise<NextResponse | null> {
  let actor: PermissionUser = { role: null }
  try {
    actor = (await getCurrentUser()).actor
  } catch {
    actor = { role: null }
  }
  if (!can(actor, "templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}
