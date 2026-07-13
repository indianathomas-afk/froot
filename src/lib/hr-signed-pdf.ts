import { createHash } from "crypto"
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { streamHrFile, uploadHrFile } from "@/lib/hr-files"

// HR-4 signed-PDF service. When a staff member completes every required
// checkpoint of a document version, this produces the executed artifact the
// HR-0a spike validated: the ORIGINAL pdf bytes (version pin intact) with a
// compact completion banner on page 1 and appended Certificate of
// Acknowledgment page(s) carrying the source SHA-256, signer/store/org, auth
// method, IP, the ESIGN consent statement, per-checkpoint capture rows with
// timestamps, and the per-page initials grid. The certificate page is the
// authoritative record; precise in-page stamping at each pageRef is a future
// enhancement (pageRef is already captured).
//
// The result is uploaded to the PRIVATE froot-hr store and recorded as an
// append-only HrSignedRecord. Reusable by HR-5 (forms) and HR-7 (training
// certificates).

const PAGE_W = 612 // US Letter
const PAGE_H = 792
const MARGIN = 42
const INK = rgb(0.13, 0.13, 0.13)
const MUTED = rgb(0.42, 0.42, 0.42)
const ACCENT = rgb(0.16, 0.5, 0.24)
const RULE = rgb(0.85, 0.85, 0.85)

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
      } else {
        if (line) lines.push(line)
        // Hard-break tokens wider than the column (hashes, user agents).
        let chunk = word
        while (font.widthOfTextAtSize(chunk, size) > maxWidth && chunk.length > 1) {
          let cut = chunk.length - 1
          while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) cut--
          lines.push(chunk.slice(0, cut))
          chunk = chunk.slice(cut)
        }
        line = chunk
      }
    }
    lines.push(line)
  }
  return lines.length ? lines : [""]
}

function utc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC"
}

// pdf-lib's standard fonts only cover WinAnsi — replace anything outside it
// so a stray emoji in a field value can't kill generation.
function sanitize(text: string): string {
  return text.replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?")
}

export class SignedRecordError extends Error {}

// Idempotently generate the signed PDF + HrSignedRecord for (version, staff).
// Returns the existing record when one is already on file — records are
// append-only and never regenerated. Throws SignedRecordError when required
// checkpoints are incomplete.
export async function ensureSignedRecord(hrDocumentVersionId: string, staffMemberId: string) {
  const existing = await prisma.hrSignedRecord.findUnique({
    where: { hrDocumentVersionId_staffMemberId: { hrDocumentVersionId, staffMemberId } },
  })
  if (existing) return existing

  const version = await prisma.hrDocumentVersion.findUnique({
    where: { id: hrDocumentVersionId },
    include: {
      hrDocument: {
        include: { organization: true, checkpoints: { orderBy: { orderIndex: "asc" } } },
      },
    },
  })
  if (!version) throw new SignedRecordError("Document version not found")
  const doc = version.hrDocument

  const acks = await prisma.hrDocumentAcknowledgment.findMany({
    where: { hrDocumentVersionId, staffMemberId },
  })
  const ackByCheckpoint = new Map(acks.map((a) => [a.checkpointId, a]))
  const missing = doc.checkpoints.filter((c) => c.required && !ackByCheckpoint.has(c.id))
  if (missing.length > 0) {
    throw new SignedRecordError(`Required checkpoints incomplete (${missing.length} outstanding)`)
  }

  // Snapshot-first: the certificate is built from the acknowledgment rows'
  // frozen fields, not live lookups. completedAt = the last required capture.
  const orderedAcks = doc.checkpoints
    .map((c) => ({ checkpoint: c, ack: ackByCheckpoint.get(c.id) }))
    .filter((x): x is { checkpoint: (typeof doc.checkpoints)[number]; ack: (typeof acks)[number] } => !!x.ack)
  const lastAck = orderedAcks.reduce((a, b) => (a.ack.signedAt > b.ack.signedAt ? a : b)).ack
  const completedAt = new Date(
    Math.max(
      ...orderedAcks.filter((x) => x.checkpoint.required).map((x) => x.ack.signedAt.getTime())
    )
  )

  // ── Assemble the PDF ──────────────────────────────────────────────────────
  const originalRes = await streamHrFile(version.fileUrl)
  const originalBytes = Buffer.from(await originalRes.arrayBuffer())
  const pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true })
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const courier = await pdf.embedFont(StandardFonts.Courier)

  // Page-1 completion banner (compact — the certificate is the full record).
  const first = pdf.getPage(0)
  const { width: fw, height: fh } = first.getSize()
  const bannerText = sanitize(
    `Completed by ${lastAck.staffName} on ${utc(completedAt)} - Certificate of Acknowledgment appended`
  )
  const bannerSize = 8
  const bannerWidth = helvBold.widthOfTextAtSize(bannerText, bannerSize) + 16
  first.drawRectangle({
    x: fw - bannerWidth - 10,
    y: fh - 24,
    width: bannerWidth,
    height: 16,
    color: rgb(0.93, 0.97, 0.93),
    borderColor: ACCENT,
    borderWidth: 0.75,
    opacity: 0.92,
  })
  first.drawText(bannerText, {
    x: fw - bannerWidth - 2,
    y: fh - 19.5,
    size: bannerSize,
    font: helvBold,
    color: ACCENT,
  })

  // Certificate page scaffolding.
  let page: PDFPage
  let y = 0
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }
  const ensureRoom = (needed: number) => {
    if (y - needed < MARGIN) newPage()
  }
  const drawLines = (
    lines: string[],
    { x = MARGIN, size = 9, font = helv, color = INK, gap = 3 }: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}
  ) => {
    for (const line of lines) {
      ensureRoom(size + gap)
      page.drawText(sanitize(line), { x, y: y - size, size, font, color })
      y -= size + gap
    }
  }
  const labeled = (label: string, value: string, valueFont: PDFFont = helv) => {
    ensureRoom(12)
    page.drawText(sanitize(label), { x: MARGIN, y: y - 9, size: 8, font: helvBold, color: MUTED })
    const lines = wrapText(sanitize(value), valueFont, 9, PAGE_W - MARGIN * 2 - 130)
    for (const [i, line] of lines.entries()) {
      if (i > 0) ensureRoom(12)
      page.drawText(line, { x: MARGIN + 130, y: y - 9, size: 9, font: valueFont, color: INK })
      y -= 12
    }
  }
  const rule = () => {
    ensureRoom(14)
    y -= 7
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: RULE })
    y -= 7
  }

  newPage()
  page!.drawText("Certificate of Acknowledgment", {
    x: MARGIN,
    y: y - 18,
    size: 18,
    font: helvBold,
    color: INK,
  })
  y -= 26
  drawLines([`Generated by Froot for ${doc.organization.name}`], { size: 9, color: MUTED })
  rule()

  labeled("Document", `${lastAck.documentTitle} (version ${lastAck.documentVersionNumber})`)
  labeled("Source file", version.fileName)
  labeled("Source SHA-256", lastAck.documentFileHash, courier)
  rule()
  labeled("Signer", lastAck.staffName)
  labeled("Store", lastAck.storeName ?? "-")
  labeled("Organization", doc.organization.name)
  labeled("Completed at", utc(completedAt))
  labeled("Auth method", lastAck.authMethod)
  labeled("IP address", lastAck.ipAddress ?? "-")
  labeled("Device", lastAck.userAgent ?? "-")
  rule()

  drawLines(["Electronic signature consent" + (lastAck.consentVersion ? ` (${lastAck.consentVersion})` : "")], {
    size: 8,
    font: helvBold,
    color: MUTED,
  })
  drawLines(wrapText(sanitize(lastAck.consentText ?? "-"), helv, 8.5, PAGE_W - MARGIN * 2), {
    size: 8.5,
  })
  rule()

  // ── Checkpoint table ──────────────────────────────────────────────────────
  const col = { idx: MARGIN, name: MARGIN + 24, captured: MARGIN + 208, page: MARGIN + 344, at: MARGIN + 378 }
  const nameW = col.captured - col.name - 8
  const capturedW = col.page - col.captured - 8
  const header = () => {
    ensureRoom(16)
    page.drawText("#", { x: col.idx, y: y - 8, size: 8, font: helvBold, color: MUTED })
    page.drawText("CHECKPOINT", { x: col.name, y: y - 8, size: 8, font: helvBold, color: MUTED })
    page.drawText("CAPTURED", { x: col.captured, y: y - 8, size: 8, font: helvBold, color: MUTED })
    page.drawText("PAGE", { x: col.page, y: y - 8, size: 8, font: helvBold, color: MUTED })
    page.drawText("SIGNED AT (UTC)", { x: col.at, y: y - 8, size: 8, font: helvBold, color: MUTED })
    y -= 13
  }
  drawLines(["Checkpoints"], { size: 11, font: helvBold })
  y -= 2
  header()
  for (const [i, { checkpoint, ack }] of orderedAcks.entries()) {
    const captured =
      ack.method === "Attested"
        ? `Attested by ${ack.typedName ?? "-"}`
        : checkpoint.type === "Field"
          ? ack.fieldValue ?? "-"
          : ack.typedName ?? "-"
    const nameLines = wrapText(sanitize(`${checkpoint.name} [${checkpoint.type}]`), helv, 8, nameW)
    const capturedLines = wrapText(sanitize(captured), helv, 8, capturedW)
    const rowLines = Math.max(nameLines.length, capturedLines.length)
    const rowHeight = rowLines * 10 + 3
    if (y - rowHeight < MARGIN) {
      newPage()
      header()
    }
    page!.drawText(String(i + 1), { x: col.idx, y: y - 8, size: 8, font: helv, color: MUTED })
    for (const [j, line] of nameLines.entries()) {
      page!.drawText(line, { x: col.name, y: y - 8 - j * 10, size: 8, font: helv, color: INK })
    }
    for (const [j, line] of capturedLines.entries()) {
      page!.drawText(line, { x: col.captured, y: y - 8 - j * 10, size: 8, font: helv, color: INK })
    }
    page!.drawText(checkpoint.pageRef != null ? String(checkpoint.pageRef) : "-", {
      x: col.page,
      y: y - 8,
      size: 8,
      font: helv,
      color: INK,
    })
    page!.drawText(utc(ack.signedAt).replace(" UTC", ""), { x: col.at, y: y - 8, size: 8, font: courier, color: INK })
    y -= rowHeight
  }
  rule()

  // ── Per-page initials grid (spike layout): p1: GT   p2: GT   … ───────────
  const initialAcks = orderedAcks.filter((x) => x.checkpoint.type === "Initial" && x.checkpoint.pageRef != null)
  if (initialAcks.length > 0) {
    drawLines(["Per-page initials"], { size: 11, font: helvBold })
    y -= 2
    const cellW = 66
    const perRow = Math.floor((PAGE_W - MARGIN * 2) / cellW)
    for (let i = 0; i < initialAcks.length; i += perRow) {
      ensureRoom(14)
      for (const [j, { checkpoint, ack }] of initialAcks.slice(i, i + perRow).entries()) {
        const initials = ack.method === "Attested" ? "att." : ack.typedName ?? "-"
        page!.drawText(sanitize(`p${checkpoint.pageRef}: ${initials}`), {
          x: MARGIN + j * cellW,
          y: y - 9,
          size: 8.5,
          font: courier,
          color: INK,
        })
      }
      y -= 13
    }
    rule()
  }

  drawLines(
    [
      `This certificate was generated at ${utc(new Date())} and is bound to the source document by its SHA-256 fingerprint above.`,
      `Acknowledgment records are append-only; altering the source document produces a new version requiring new signatures.`,
    ],
    { size: 7.5, color: MUTED }
  )

  const signedBytes = Buffer.from(await pdf.save())
  const signedPdfHash = createHash("sha256").update(signedBytes).digest("hex")

  // Into the PRIVATE store, under a signed-records prefix separate from the
  // source documents. File name carries staff + version for humans; the
  // record row is the authoritative link.
  const safeStaff = lastAck.staffName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)
  const uploaded = await uploadHrFile(
    new File([new Uint8Array(signedBytes)], `signed-${safeStaff}-v${version.versionNumber}.pdf`, {
      type: "application/pdf",
    }),
    { keyPrefix: `hr/${doc.organizationId}/signed-records` }
  )

  try {
    return await prisma.hrSignedRecord.create({
      data: {
        hrDocumentVersionId,
        staffMemberId,
        completedAt,
        signedPdfPathname: uploaded.pathname,
        signedPdfHash,
      },
    })
  } catch (err) {
    // Concurrent completion: the unique (version, staff) pair means someone
    // else just created it — theirs is the record.
    const race = await prisma.hrSignedRecord.findUnique({
      where: { hrDocumentVersionId_staffMemberId: { hrDocumentVersionId, staffMemberId } },
    })
    if (race) return race
    throw err
  }
}
