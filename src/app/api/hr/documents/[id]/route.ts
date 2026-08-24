import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  EXTERNAL_URL_ERROR,
  HR_DOCUMENT_CATEGORIES,
  HR_DOCUMENT_KINDS,
  isValidExternalDocumentUrl,
} from "@/lib/hr-documents"
import { sanitizeRichText } from "@/lib/sanitize-html"
import { requireHrDocumentAccess } from "../access"

const patchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    category: z.enum(HR_DOCUMENT_CATEGORIES).optional(),
    isActive: z.boolean().optional(),
    // DOC-3. Same validator as the create route, imported from the same module
    // — the client's required-ness and the server's cannot drift if there is
    // only one rule. externalUrl is Link-only and that is enforced AFTER the
    // lookup below, because the body does not carry `kind` and the row's kind
    // is the only trustworthy source of it.
    externalUrl: z
      .string()
      .trim()
      .refine(isValidExternalDocumentUrl, { message: EXTERNAL_URL_ERROR })
      .optional(),
    instructionsHtml: z.string().nullish(),
    instructionsVideoUrl: z
      .string()
      .trim()
      .refine(isValidExternalDocumentUrl, { message: EXTERNAL_URL_ERROR })
      .nullish(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" })

// PATCH /api/hr/documents/[id] — ADMIN edit of a doc's title/category, and
// soft archive via isActive:false. No hard delete and no blob deletion —
// archived docs keep their versions, files, and signed records intact.
// Covers Reference, Acknowledgment and (DOC-3) Link; FillableForm gets its own
// flow in HR-5.
//
// THE KIND GATE BELOW WIDENED FOR FREE and that is why archive works on a Link
// with no edit here: it spreads HR_DOCUMENT_KINDS rather than listing literals.
// Three sibling call sites do NOT, and DOC-3 had to edit them by hand — see the
// note on HR_DOCUMENT_KINDS in lib/hr-documents.ts.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue?.message ?? "Invalid body" }, { status: 400 })
  }

  const doc = await prisma.hrDocument.findFirst({
    where: { id, organizationId: access.org.id, kind: { in: [...HR_DOCUMENT_KINDS] } },
  })
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 })

  // externalUrl on a non-Link is refused rather than ignored. Accepting it
  // silently would write a URL onto a Reference — which hrdoc_link_shape would
  // then reject with a 23514 the caller sees as a 500, and which, if the CHECK
  // were ever dropped by a baseline squash (MIGRATIONS.md Hazard 1), would
  // simply be wrong data. 400 says what happened.
  const { externalUrl, instructionsHtml, instructionsVideoUrl, ...rest } = parsed.data
  if (externalUrl !== undefined && doc.kind !== "Link") {
    return NextResponse.json(
      { error: "Only a Link document has an external URL" },
      { status: 400 }
    )
  }

  const updated = await prisma.hrDocument.update({
    where: { id: doc.id },
    data: {
      ...rest,
      ...(externalUrl !== undefined ? { externalUrl } : {}),
      // Sanitized server-side on the way in, exactly as on create. An `undefined`
      // means "not part of this PATCH" and must not become a null write, which is
      // why both fields are spread conditionally rather than passed through.
      ...(instructionsHtml !== undefined
        ? { instructionsHtml: sanitizeRichText(instructionsHtml) }
        : {}),
      ...(instructionsVideoUrl !== undefined
        ? { instructionsVideoUrl: instructionsVideoUrl?.trim() || null }
        : {}),
    },
  })
  return NextResponse.json(updated)
}
