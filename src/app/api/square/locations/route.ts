import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getUserStoreScope } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { squareBaseUrl } from "@/lib/square"

// Fields the two callers actually consume — the store import dialog
// (stores/import-square-button.tsx:59-65) and the Edit Store location picker
// (stores/store-actions.tsx:244-246). Everything else Square returns is
// withheld. See the PERM-6 Task 4 note below.
type SquareLocation = Record<string, unknown> & {
  id?: string
  name?: string
  address?: { address_line_1?: string; locality?: string; administrative_district_level_1?: string }
  phone_number?: string
  timezone?: string
}

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // PERM-6 Task 4. This route had NO role gate at all — only auth() — so any
  // authenticated org member including STORE and STAFF could read the org's
  // full Square location list. Gated at stores.manage (ADMIN), the same tier as
  // the store-management UI: both callers already render only under isAdmin
  // (stores/page.tsx:64,115), so this matches today's surface exactly rather
  // than widening it. Deliberately NOT stores.view (MANAGE) — no manager page
  // requests this payload, and narrowing later, once something depends on it,
  // is the hard direction.
  const { role } = await getUserStoreScope()
  if (!can({ role }, "stores.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org?.squareAccessToken) return NextResponse.json({ error: "Square not connected" }, { status: 400 })

  const baseUrl = squareBaseUrl()

  const res = await fetch(`${baseUrl}/v2/locations`, {
    headers: { Authorization: `Bearer ${org.squareAccessToken}`, "Square-Version": "2024-01-17" },
  })

  if (!res.ok) return NextResponse.json({ error: "Square API error" }, { status: 500 })

  const data = await res.json()
  const existingIds = new Set(
    (await prisma.store.findMany({ where: { organizationId: org.id }, select: { squareLocationId: true } }))
      .map((s) => s.squareLocationId)
      .filter(Boolean)
  )

  // The missing authorization above was the finding; this allow-list is the
  // second, separate improvement. The route used to spread the ENTIRE Square
  // location object (`...loc`), so business_email, coordinates, merchant_id,
  // tax ids and every other field reached the client on every import. Nothing
  // consumes them — verified against both callers. DEBT-8 (map business_email
  // → Store.contactEmail at import, and PERM-7(d)'s device-login email seed)
  // is the one known future consumer: it re-adds `business_email` HERE, one
  // line, at the point a consumer actually exists.
  const locations = (data.locations ?? []).map((loc: SquareLocation) => ({
    id: loc.id,
    name: loc.name,
    address: loc.address
      ? {
          address_line_1: loc.address.address_line_1,
          locality: loc.address.locality,
          administrative_district_level_1: loc.address.administrative_district_level_1,
        }
      : undefined,
    phone_number: loc.phone_number,
    timezone: loc.timezone,
    alreadyImported: existingIds.has(loc.id as string),
  }))

  return NextResponse.json({ locations })
}
