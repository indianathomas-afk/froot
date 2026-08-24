import { NextResponse } from "next/server"
import { z } from "zod"
import { PDFDocument } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { buildVersionScanReport, detectAndStoreVersionAnchors } from "@/lib/hr-anchors"
import { HrFileValidationError, readHrFileMeta, validateHrFileMeta } from "@/lib/hr-files"
import {
  EXTERNAL_URL_ERROR,
  HR_DOCUMENT_CATEGORIES,
  defaultAttestationText,
  isValidExternalDocumentUrl,
} from "@/lib/hr-documents"
import { sanitizeRichText } from "@/lib/sanitize-html"
import { isOrgHrBlobUrl, requireHrDocumentAccess } from "./access"

// pdfjs anchor detection runs inline at upload; needs Node + headroom.
export const runtime = "nodejs"
export const maxDuration = 60

// DOC-3: instructions ride on EVERY kind (ruling 3), so they are spread into
// both branches of the union below rather than living on one of them.
//
// instructionsVideoUrl takes the SAME validator as a Link's externalUrl —
// Gary's amendment 1, 2026-08-24. It is rendered as an href on the staff
// portal, so it is exactly as exposed as externalUrl is and there is no reason
// for it to be checked more loosely.
//
// COMMENT, NOT A FIX, AND DELIBERATELY SO: HR-28's own lesson videoUrl has no
// such validation — api/hr/training/route.ts:27 takes `z.string().nullish()`
// and training-module-view.tsx:207 renders it straight into an href for any
// non-YouTube value. DOC-3 does not touch the training write paths, and
// closing someone else's gap inside this row would put an unreviewed change to
// a shipped surface in a commit about documents. Recorded in DECISIONS.md
// (2026-08-24, amendment 1) so it is a known gap rather than a missed one.
const instructionsFields = {
  instructionsHtml: z.string().nullish(),
  instructionsVideoUrl: z
    .string()
    .trim()
    .refine(isValidExternalDocumentUrl, { message: EXTERNAL_URL_ERROR })
    .nullish(),
}

// A file document: Reference or Acknowledgment. Unchanged from before DOC-3
// apart from the instructions fields — `url` is still a blob reference that
// isOrgHrBlobUrl must accept, and fileName is still required.
const fileBodySchema = z.object({
  kind: z.enum(["Reference", "Acknowledgment"]),
  title: z.string().trim().min(1),
  category: z.enum(HR_DOCUMENT_CATEGORIES),
  url: z.string().url(),
  fileName: z.string().trim().min(1),
  ...instructionsFields,
})

// A Link: no url, no fileName, and an externalUrl the file branches never
// carry. The union is discriminated on `kind` so these are not merely
// "optional on one big object" — a Link that arrives with a `url`, or a
// Reference that arrives with an `externalUrl`, is a shape error rather than a
// field the handler has to remember to ignore.
const linkBodySchema = z.object({
  kind: z.literal("Link"),
  title: z.string().trim().min(1),
  category: z.enum(HR_DOCUMENT_CATEGORIES),
  externalUrl: z
    .string()
    .trim()
    .refine(isValidExternalDocumentUrl, { message: EXTERNAL_URL_ERROR }),
  ...instructionsFields,
})

// THE DEFAULT IS PRESERVED THROUGH A PREPROCESS, NOT DROPPED. `kind` used to
// carry `.default("Reference")`, and a discriminated union cannot default its
// own discriminator — the naive port silently turns every body that omits
// `kind` into a 400. The dialog always sends one, so nothing in this repo
// would have noticed; that is precisely why it is worth keeping rather than
// trading away for a tidier schema.
const bodySchema = z.preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value) && !("kind" in value)) {
    return { ...value, kind: "Reference" }
  }
  return value
}, z.discriminatedUnion("kind", [fileBodySchema, linkBodySchema]))

// POST /api/hr/documents — ADMIN. Second leg of the browser upload: after the
// client PUT the file to the presigned URL (see ./upload-url), this registers
// the document. Metadata is read back from the stored blob — size, content
// type, and the sha256 fileHash are never trusted from the client.
//
// kind:"Acknowledgment" (HR-4) additionally requires a PDF and auto-generates
// the default checkpoint set from the actual page count: one Initial per page
// plus a final Acknowledgment. Admins refine them at /hr/documents/[id].
//
// DOC-3: kind:"Link" registers a document that lives somewhere else. It
// returns BEFORE every blob step below — no isOrgHrBlobUrl, no readHrFileMeta,
// no PDF load, no anchor scan — and writes no version rows at all.
export async function POST(req: Request) {
  const access = await requireHrDocumentAccess({ admin: true })
  if (!access.ok) return access.response
  const { org, dbUser } = access
  if (!dbUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    // THE MESSAGE IS THE ZOD ISSUE, NOT A FIXED SENTENCE. The old constant —
    // "a title, a valid category, and an uploaded file are required" — names a
    // file, so on a Link with a bad URL it told the admin to fix something the
    // form does not have. The dialog renders whatever comes back, so a wrong
    // message here is a wrong message on screen.
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: issue?.message ?? "A title, a valid category, and a file or link are required" },
      { status: 400 }
    )
  }
  const body = parsed.data

  // Sanitized SERVER-SIDE, on every branch, before anything is written. The
  // client is never the gate — HR-28's rule, and its CSV importer is the proof
  // that a payload can reach a write path without passing an editor
  // (lib/sanitize-html.ts). sanitizeRichText returns null for empty/junk, so
  // the column holds real content or nothing.
  const instructionsHtml = sanitizeRichText(body.instructionsHtml)
  const instructionsVideoUrl = body.instructionsVideoUrl?.trim() || null

  if (body.kind === "Link") {
    const doc = await prisma.hrDocument.create({
      data: {
        organizationId: org.id,
        kind: "Link",
        title: body.title,
        category: body.category,
        externalUrl: body.externalUrl,
        instructionsHtml,
        instructionsVideoUrl,
        // A Link can never be signed: it pins no bytes, so there is nothing for
        // an acknowledgment to reference. Every signing surface already gates
        // on kind === "Acknowledgment", so this is belt to their braces.
        requiresAcknowledgment: false,
        isActive: true,
        // NO versions.create — THE POINT OF THE KIND. This is the cross-table
        // half of the invariant that hrdoc_link_shape cannot state; see
        // HrDocument in schema.prisma. `scan` is null so the response shape
        // matches the file branches and the dialog needs no special case.
      },
      include: { versions: true },
    })
    return NextResponse.json({ ...doc, scan: null }, { status: 201 })
  }

  const { title, category, url, fileName, kind } = body

  if (!isOrgHrBlobUrl(url, org.id)) {
    return NextResponse.json({ error: "Invalid file reference" }, { status: 400 })
  }

  const isAcknowledgment = kind === "Acknowledgment"
  let meta
  try {
    meta = await readHrFileMeta(url, { includeBytes: isAcknowledgment })
    validateHrFileMeta(meta.contentType, meta.sizeBytes)
  } catch (err) {
    if (err instanceof HrFileValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: "Uploaded file not found — try the upload again" },
      { status: 400 }
    )
  }

  // Signature documents get stamped and appended to by the signed-PDF service;
  // that only works on PDFs, and the page count drives the default checkpoints.
  let pageCount = 0
  if (isAcknowledgment) {
    if (meta.contentType !== "application/pdf") {
      return NextResponse.json(
        { error: "Signature documents must be PDFs" },
        { status: 400 }
      )
    }
    try {
      const pdf = await PDFDocument.load(meta.bytes!, { ignoreEncryption: true })
      pageCount = pdf.getPageCount()
    } catch {
      return NextResponse.json(
        { error: "The PDF could not be read — re-export it and try again" },
        { status: 400 }
      )
    }
    if (pageCount < 1) {
      return NextResponse.json({ error: "The PDF has no pages" }, { status: 400 })
    }
  }

  const doc = await prisma.hrDocument.create({
    data: {
      organizationId: org.id,
      kind,
      title,
      category,
      // DOC-3 ruling 3: instructions apply to every kind, so a Reference or an
      // Acknowledgment carries them exactly as a Link does. Already sanitized
      // above — one call, both branches.
      instructionsHtml,
      instructionsVideoUrl,
      requiresAcknowledgment: isAcknowledgment,
      isActive: true,
      versions: {
        create: {
          versionNumber: 1,
          fileUrl: meta.url,
          fileName,
          contentType: meta.contentType,
          sizeBytes: meta.sizeBytes,
          fileHash: meta.fileHash,
          isCurrent: true,
          uploadedByUserId: dbUser.id,
        },
      },
      ...(isAcknowledgment
        ? {
            checkpoints: {
              create: [
                ...Array.from({ length: pageCount }, (_, i) => ({
                  name: `Page ${i + 1} initials`,
                  type: "Initial" as const,
                  orderIndex: i,
                  pageRef: i + 1,
                })),
                {
                  name: "Final acknowledgment",
                  type: "Acknowledgment" as const,
                  orderIndex: pageCount,
                  pageRef: pageCount,
                  attestationText: defaultAttestationText(title),
                },
              ],
            },
          }
        : {}),
    },
    include: { versions: true },
  })

  // HR-11b: scan the version's text layer for field anchors and persist them as
  // unconfirmed proposals for the admin to confirm on /hr/documents/[id]. A scan
  // failure or an image-only PDF leaves zero anchors (certificate-only fallback)
  // and never blocks the upload. Clone the bytes: pdfjs may detach the buffer
  // during parsing.
  //
  // HR-11d 2a: R2 IS APPLIED HERE TOO, and this route is where it matters most.
  // §2a names the versions route, but R3(i-a) exists precisely because "a
  // brand-new document whose first version was never confirmed" is the case the
  // audit's proposed trip-wire missed — and this is the route that creates that
  // document. Reporting only on re-upload would leave the flag-at-upload layer
  // silent for exactly the population the ruling was written to catch. Same
  // discriminated shape, same message builder, no behaviour change to the
  // upload itself.
  const version = doc.versions[0]
  const scanned =
    isAcknowledgment && meta.bytes && version
      ? await detectAndStoreVersionAnchors(version.id, new Uint8Array(meta.bytes))
      : null
  const scan =
    isAcknowledgment && version ? await buildVersionScanReport(version.id, scanned, 0) : null

  return NextResponse.json({ ...doc, scan }, { status: 201 })
}
