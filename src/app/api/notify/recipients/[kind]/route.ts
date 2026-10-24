import { NextResponse } from "next/server"
import { getOrganization, requireAdmin } from "@/lib/auth"
import { replaceContactPicks, validatePicks } from "@/lib/notifications/contacts"

// PUT /api/notify/recipients/[kind] — NOTIFY-12, replace one kind's "Also send
// to" list. ADMIN only (F7), re-checked per PERM-2.
//
// Admin (403) → org → validatePicks, whose gates are listed where they live
// (src/lib/notifications/contacts.ts): the kind takes extras, hr.ack needs HR
// here, CONTACTS ONLY until DEBT-106 (Gary, 2026-10-23), at most 10, every
// contact this org's and active. Then replaceContactPicks, which leaves an
// archived contact's picks alone (F5).

export async function PUT(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const org = await getOrganization().catch(() => null)
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const { kind } = await params
  const v = await validatePicks(org, kind, await req.json().catch(() => null))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })

  return NextResponse.json({ contactIds: await replaceContactPicks(org.id, kind, v.contactIds) })
}
