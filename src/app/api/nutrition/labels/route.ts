import { NextResponse } from "next/server"
import { z } from "zod"
import { requireNutrition } from "@/lib/nutrition-access"
import { NutritionFileError, deleteLabelBlob, inboxKeyPrefix, inspectStoredLabel, labelPathnameFromUrl } from "@/lib/nutrition-files"
import { activeInboxItems, createInboxItem, inboxCandidates, serializeInboxItems } from "@/lib/label-inbox"
import { readLimitReached } from "@/lib/label-read-run"
import { labelReadConfigured } from "@/lib/label-read"

// /api/nutrition/labels — the N-1e label inbox. ADMIN (nutrition.manage).
//
//   GET   the org's open inbox (uploaded, read, failed), with ages for the
//         leftovers list, the ingredients a label can be for, and whether the
//         read limit is reached right now.
//   POST  register a file the browser PUT to the inbox folder (the N-1b
//         two-leg upload; upload-url is the first leg). Same checks as an
//         ingredient upload — stored size/type/hash, first bytes — plus HEIC
//         refused (an inbox file must be readable). Suggests an ingredient
//         from the file name; NEVER assigns one (N1E-F2).

export async function GET() {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const [items, ingredients, limit] = await Promise.all([
    activeInboxItems(ctx.org.id),
    inboxCandidates(ctx.org.id),
    readLimitReached(ctx.org.id),
  ])
  return NextResponse.json({
    items: await serializeInboxItems(items),
    ingredients,
    limit: limit ? { message: limit.message, retryAt: limit.retryAt.toISOString() } : null,
    readConfigured: labelReadConfigured(),
  })
}

const RegisterSchema = z.object({
  fileUrl: z.string().url(),
  fileName: z.string().trim().min(1).max(255),
})

export async function POST(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const parsed = RegisterSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  const { fileUrl, fileName } = parsed.data

  // Namespace pin: only THIS org's inbox folder.
  let pathname: string
  try {
    pathname = labelPathnameFromUrl(fileUrl)
  } catch {
    return NextResponse.json({ error: "Invalid file URL" }, { status: 400 })
  }
  if (!pathname.startsWith(`${inboxKeyPrefix(ctx.org.id)}/`)) {
    return NextResponse.json({ error: "File is outside this organization's label inbox" }, { status: 400 })
  }

  try {
    const meta = await inspectStoredLabel(fileUrl)
    const item = await createInboxItem(ctx, { meta, pathname, fileName }, { action: "nutrition.inbox.uploaded" })
    const [out] = await serializeInboxItems([item])
    return NextResponse.json(out, { status: 201 })
  } catch (err) {
    if (err instanceof NutritionFileError) {
      await deleteLabelBlob(fileUrl)
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
