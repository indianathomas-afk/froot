import { NextResponse } from "next/server"
import { bevspotImportContext, planForOrg, previewPayload, readBevSpotUpload } from "@/lib/bevspot/import-server"

// POST /api/inventory/import/bevspot/preview — multipart { file } (BevSpot's
// sales-items .xlsx). Returns what an apply would create and what it would
// skip, with reasons. Writes nothing; the file is not stored. ADMIN only
// (IV-3). BEV-1.

export const maxDuration = 60

export async function POST(req: Request) {
  const ctx = await bevspotImportContext()
  if ("error" in ctx) return ctx.error

  const upload = await readBevSpotUpload(req)
  if ("error" in upload) return upload.error

  const plan = await planForOrg(ctx.orgId, upload.rows)
  return NextResponse.json(previewPayload(plan))
}
