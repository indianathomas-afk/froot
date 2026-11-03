import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireNutrition } from "@/lib/nutrition-access"
import {
  NutritionFileError, deleteLabelBlob, inspectStoredLabel, labelKeyPrefix, putLabelBytes, uniqueLabelPathname,
} from "@/lib/nutrition-files"
import { findOrgIngredient, nutritionAudit, serializeIngredient } from "@/lib/nutrition-record"
import { attachQuestion, proofRefusal } from "@/lib/nutrition-proof"
import { attachLabelDocument, questionResponse } from "@/lib/nutrition-label-attach"
import { LinkFetchError, fetchLabelFromLink, linkFileName, linkHost } from "@/lib/safe-fetch"

// POST /api/nutrition/ingredients/[id]/label/from-link — "Read from a link"
// in the ingredient dialog's Proof box (N-1e deliverable 4). ADMIN
// (nutrition.manage). The server fetches a direct link to a PDF or image
// through the N1E-F4 guard (src/lib/safe-fetch.ts); the file then behaves
// exactly like an upload — it becomes the label document through the same
// write (attachLabelDocument), and the record's sourceUrl is set to the link.
// A web page is refused: "Open the page, save the label image, and upload it."
//
// Asks "Replace current label?" (N1E-F5 / R4: the link path asks) and "Still
// verified?" BEFORE fetching, so answering a question never fetches twice.

export const maxDuration = 60

const Schema = z.object({
  url: z.string().trim().min(1).max(2000),
  replaceLabel: z.boolean().optional(),
  keepVerified: z.boolean().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireNutrition("nutrition.manage")
  if ("error" in ctx) return ctx.error
  const { id } = await params
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Paste a link to a PDF or image file" }, { status: 400 })
  const { url, replaceLabel, keepVerified } = parsed.data

  const ing = await findOrgIngredient(ctx.org.id, id)
  if (!ing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const refusal = proofRefusal(ing)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })
  const question = attachQuestion(ing.nutrition, { askReplace: true, replaceLabel, keepVerified })
  if (question) return questionResponse(question)

  let fetched
  try {
    fetched = await fetchLabelFromLink(url)
  } catch (err) {
    const e = err instanceof LinkFetchError ? err : new LinkFetchError("Couldn't fetch that link.", "unexpected", 502)
    if (!(err instanceof LinkFetchError)) console.error("[api/nutrition/label/from-link] fetch failed:", err)
    await nutritionAudit(prisma, ctx, "nutrition.inbox.fetch.failed", ing.id, { host: linkHost(url), code: e.code, via: "dialog" })
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
  }

  const fileName = linkFileName(fetched.finalUrl, fetched.contentType)
  const pathname = uniqueLabelPathname(labelKeyPrefix(ctx.org.id, ing.id), fileName)
  let storedUrl: string | null = null
  try {
    storedUrl = await putLabelBytes(pathname, fetched.bytes, fetched.contentType)
    const meta = await inspectStoredLabel(storedUrl)
    const { replaced } = await attachLabelDocument(ctx, ing, { meta, pathname, fileName }, {
      keepVerified,
      sourceUrl: url,
      audit: { via: "link", finalHost: linkHost(fetched.finalUrl), redirects: fetched.redirects },
    })
    const updated = await findOrgIngredient(ctx.org.id, ing.id)
    return NextResponse.json(await serializeIngredient(updated!, ctx.org.id), { status: replaced ? 200 : 201 })
  } catch (err) {
    if (storedUrl) await deleteLabelBlob(storedUrl)
    if (err instanceof NutritionFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
