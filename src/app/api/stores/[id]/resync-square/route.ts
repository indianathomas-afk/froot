import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { fetchSquareLocation } from "@/lib/square"

// POST /api/stores/[id]/resync-square — pull ONE store's current Square location
// record and make Square authoritative for the fields Froot mirrors from it.
//
// DEBT-8 / PERM-7 Task 0 (Ruling 3, Gary, 2026-07-28). The import dialog is the
// only writer of these fields, and it filters out already-imported locations —
// so before this route existed there was NO path to populate Store.contactEmail
// on a store that had already been imported. Production had it null on 10 of
// 10. A one-shot backfill would have fixed that day and nothing after it: the
// same gap reopens for the next store whose Square email changes, with nothing
// to notice it. This is the per-store counterpart to the per-member
// /api/staff/[id]/resync-square, and it is the remedy the PERM-7(d) drift
// indicator points at — see drift, click resync.
//
// SCOPE: exactly the field set the import dialog maps
// (stores/import-square-button.tsx), so import and resync cannot drift apart.
// Froot-native fields — storeNumber, brand, zip, isActive, hours — are NEVER
// touched, and neither is squareLocationId (the link itself is what we resync
// BY; repointing it stays a deliberate edit in the Edit Store dialog).
//
// Like the staff resync, this DOES overwrite: an admin clicking it is saying
// "fix this record from Square." The confirm dialog names the fields.
//
// ADMIN-only via stores.manage — the same tier that can edit these fields by
// hand on the same page, and the same tier GET /api/square/locations was gated
// to by PERM-6 Task 4. No new capability.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { actor } = await getUserStoreScope()
  if (!can(actor, "stores.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const { id } = await params
  const store = await prisma.store.findFirst({ where: { id, organizationId: org.id } })
  // Cross-org or unknown IDs 404 — don't leak existence.
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })
  if (!store.squareLocationId) {
    return NextResponse.json(
      { error: "This store isn't linked to a Square location, so there's nothing to resync" },
      { status: 400 }
    )
  }

  const location = await fetchSquareLocation(org, store.squareLocationId)
  if (!location) {
    return NextResponse.json(
      { error: "Couldn't find this location in Square. Check it still exists there." },
      { status: 404 }
    )
  }

  // Square's business_email is free text and frequently blank. An absent value
  // clears contactEmail rather than leaving a stale one behind — Square is
  // authoritative for this field on this action, and a silently-retained old
  // address is exactly the three-uncoordinated-answers confusion DEBT-8 is
  // about. Note this only ever moves Store.contactEmail: a device login's
  // credential is a one-way SEED taken at provisioning and is never rewritten
  // from here (DECISIONS.md 2026-07-27) — that divergence is what the PERM-7(d)
  // drift indicator surfaces.
  const updated = await prisma.store.update({
    where: { id: store.id },
    data: {
      name: location.name || store.name,
      address: location.address?.address_line_1 || null,
      city: location.address?.locality || null,
      state: location.address?.administrative_district_level_1 || null,
      timezone: location.timezone || store.timezone,
      phoneNumber: location.phone_number || null,
      contactEmail: location.business_email || null,
    },
    select: { name: true, contactEmail: true },
  })

  return NextResponse.json({ success: true, name: updated.name, contactEmail: updated.contactEmail })
}
