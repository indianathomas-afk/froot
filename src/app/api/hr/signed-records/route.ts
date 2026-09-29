import { NextResponse } from "next/server"
import { loadSignedRecordsPage, parseSignedRecordFilters } from "@/lib/hr-signed-records-list"
import { requireHrDocumentAccess } from "../documents/access"

// GET /api/hr/signed-records?category=&document=&sort=&cursor= — SIGNED-1's
// "Load more": the next 50 rows of /hr/signed-records under the SAME filter and
// sort, through the same loader the page's first load uses. ADMIN-only, the
// same tier as the page itself.
export async function GET(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const params = Object.fromEntries(new URL(req.url).searchParams)
  const filters = parseSignedRecordFilters(params)
  const cursor = params.cursor?.trim() || null
  if (!cursor) return NextResponse.json({ error: "cursor is required" }, { status: 400 })

  return NextResponse.json(await loadSignedRecordsPage(access.org, filters, cursor))
}
