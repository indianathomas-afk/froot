import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import { NutritionFileError, deleteLabelBlob, inboxKeyPrefix, inspectStoredLabel, putLabelBytes, uniqueLabelPathname } from "@/lib/nutrition-files"
import { INBOX_ENTITY, nutritionAudit } from "@/lib/nutrition-record"
import { createInboxItem, serializeInboxItems } from "@/lib/label-inbox"
import { LinkFetchError, fetchLabelFromLink, linkFileName, linkHost } from "@/lib/safe-fetch"

// POST /api/nutrition/labels/from-link — "Add from link" in the label inbox
// (N-1e deliverable 4). ADMIN (nutrition.manage). The server fetches a direct
// link to a PDF or image through the N1E-F4 guard (src/lib/safe-fetch.ts),
// stores it in the inbox folder, and from there it is exactly an uploaded
// inbox file, with sourceUrl set. A web page is refused: "Open the page, save
// the label image, and upload it."

export const maxDuration = 60

const Schema = z.object({ url: z.string().trim().min(1).max(2000) })

export async function POST(req: Request) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Paste a link to a PDF or image file" }, { status: 400 })
  const { url } = parsed.data

  let fetched
  try {
    fetched = await fetchLabelFromLink(url)
  } catch (err) {
    const e = err instanceof LinkFetchError ? err : new LinkFetchError("Couldn't fetch that link.", "unexpected", 502)
    if (!(err instanceof LinkFetchError)) console.error("[api/nutrition/labels/from-link] fetch failed:", err)
    // The host only — never the full link, which may carry tokens.
    await nutritionAudit(prisma, ctx, "nutrition.inbox.fetch.failed", null, { host: linkHost(url), code: e.code }, INBOX_ENTITY)
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
  }

  const fileName = linkFileName(fetched.finalUrl, fetched.contentType)
  const pathname = uniqueLabelPathname(inboxKeyPrefix(ctx.org.id), fileName)
  let storedUrl: string | null = null
  try {
    storedUrl = await putLabelBytes(pathname, fetched.bytes, fetched.contentType)
    const meta = await inspectStoredLabel(storedUrl)
    const item = await createInboxItem(
      ctx,
      { meta, pathname, fileName, sourceUrl: url },
      { action: "nutrition.inbox.fetched", extra: { finalHost: linkHost(fetched.finalUrl), redirects: fetched.redirects } }
    )
    const [out] = await serializeInboxItems([item])
    return NextResponse.json(out, { status: 201 })
  } catch (err) {
    if (storedUrl) await deleteLabelBlob(storedUrl)
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
