import { createHash } from "crypto"
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import { prisma } from "@/lib/prisma"
import { streamHrFile, uploadHrFile } from "@/lib/hr-files"
import type { SubmittedFormValue } from "@/lib/hr-forms"

// HR-4/HR-5 signed-PDF service — the ONE place executed HR artifacts are
// generated.
//
// ensureSignedRecord (HR-4): when a staff member completes every required
// checkpoint of a document version, this produces the executed artifact the
// HR-0a spike validated: the ORIGINAL pdf bytes (version pin intact) with a
// compact completion banner on page 1 and appended Certificate of
// Acknowledgment page(s) carrying the source SHA-256, signer/store/org, auth
// method, IP, the ESIGN consent statement, per-checkpoint capture rows with
// timestamps, and the per-page initials grid.
//
// ensureFormSignedPdf (HR-5): a completed dual-signature FormSubmission is
// rendered from scratch — title, agreement body text, filled field values,
// both signature blocks — plus the same certificate language, pinned to the
// DEFINITION hash instead of file bytes. The PDF pointer lives on the
// FormSubmission itself (write-once), NOT on HrSignedRecord, because form
// executions recur (key re-issues, pay changes) while HrSignedRecord is
// one-per-(version, staff).
//
// Both paths upload to the PRIVATE froot-hr store. HR-7 training certificates
// will reuse the same writer.

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

// pdf-lib's standard fonts only cover WinAnsi — map common typographic
// characters (dashes, curly quotes, ellipsis) to safe equivalents, then
// replace anything else outside Latin-1 so a stray emoji in a field value
// can't kill generation.
const TYPOGRAPHIC: Record<string, string> = {
  "—": "-", // em dash
  "–": "-", // en dash
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "•": "-",
}
function sanitize(text: string): string {
  return text
    .replace(/[—–‘’“”…•]/g, (c) => TYPOGRAPHIC[c])
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?")
}

export class SignedRecordError extends Error {}

interface CertFonts {
  helv: PDFFont
  helvBold: PDFFont
  courier: PDFFont
}

// Shared page scaffolding for certificate-style pages (extracted verbatim
// from the HR-4 closures so acknowledgment output is unchanged). `page` and
// `y` are deliberately public — table layouts drive the cursor directly.
class CertificateWriter {
  page!: PDFPage
  y = 0

  constructor(
    private pdf: PDFDocument,
    readonly fonts: CertFonts
  ) {}

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  ensureRoom(needed: number) {
    if (this.y - needed < MARGIN) this.newPage()
  }

  drawLines(
    lines: string[],
    {
      x = MARGIN,
      size = 9,
      font = this.fonts.helv,
      color = INK,
      gap = 3,
    }: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}
  ) {
    for (const line of lines) {
      this.ensureRoom(size + gap)
      this.page.drawText(sanitize(line), { x, y: this.y - size, size, font, color })
      this.y -= size + gap
    }
  }

  labeled(label: string, value: string, valueFont: PDFFont = this.fonts.helv) {
    this.ensureRoom(12)
    this.page.drawText(sanitize(label), {
      x: MARGIN,
      y: this.y - 9,
      size: 8,
      font: this.fonts.helvBold,
      color: MUTED,
    })
    const lines = wrapText(sanitize(value), valueFont, 9, PAGE_W - MARGIN * 2 - 130)
    for (const [i, line] of lines.entries()) {
      if (i > 0) this.ensureRoom(12)
      this.page.drawText(line, { x: MARGIN + 130, y: this.y - 9, size: 9, font: valueFont, color: INK })
      this.y -= 12
    }
  }

  rule() {
    this.ensureRoom(14)
    this.y -= 7
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.5,
      color: RULE,
    })
    this.y -= 7
  }

  heading(title: string, generatedFor: string) {
    this.page.drawText(title, { x: MARGIN, y: this.y - 18, size: 18, font: this.fonts.helvBold, color: INK })
    this.y -= 26
    this.drawLines([`Generated by Froot for ${generatedFor}`], { size: 9, color: MUTED })
    this.rule()
  }
}

// Idempotently generate the signed PDF + HrSignedRecord for (version, staff)
// under the staff member's CURRENT signing cycle (HR-15 Policy B: a rehire's
// prior-cycle record stands but doesn't satisfy the new tenure — completion
// is judged, and the record keyed, per cycle). Returns the existing
// current-cycle record when one is already on file — records are append-only
// and never regenerated. Throws SignedRecordError when required checkpoints
// are incomplete.
export async function ensureSignedRecord(hrDocumentVersionId: string, staffMemberId: string) {
  const staff = await prisma.staffMember.findUnique({
    where: { id: staffMemberId },
    select: { signingCycle: true },
  })
  if (!staff) throw new SignedRecordError("Staff member not found")
  const signingCycle = staff.signingCycle

  const existing = await prisma.hrSignedRecord.findUnique({
    where: {
      hrDocumentVersionId_staffMemberId_signingCycle: { hrDocumentVersionId, staffMemberId, signingCycle },
    },
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
    where: { hrDocumentVersionId, staffMemberId, signingCycle },
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

  const w = new CertificateWriter(pdf, { helv, helvBold, courier })
  w.newPage()
  w.heading("Certificate of Acknowledgment", doc.organization.name)

  w.labeled("Document", `${lastAck.documentTitle} (version ${lastAck.documentVersionNumber})`)
  w.labeled("Source file", version.fileName)
  w.labeled("Source SHA-256", lastAck.documentFileHash, courier)
  w.rule()
  w.labeled("Signer", lastAck.staffName)
  w.labeled("Store", lastAck.storeName ?? "-")
  w.labeled("Organization", doc.organization.name)
  w.labeled("Completed at", utc(completedAt))
  w.labeled("Auth method", lastAck.authMethod)
  w.labeled("IP address", lastAck.ipAddress ?? "-")
  w.labeled("Device", lastAck.userAgent ?? "-")
  w.rule()

  w.drawLines(
    ["Electronic signature consent" + (lastAck.consentVersion ? ` (${lastAck.consentVersion})` : "")],
    { size: 8, font: helvBold, color: MUTED }
  )
  w.drawLines(wrapText(sanitize(lastAck.consentText ?? "-"), helv, 8.5, PAGE_W - MARGIN * 2), {
    size: 8.5,
  })
  w.rule()

  // ── Checkpoint table ──────────────────────────────────────────────────────
  const col = { idx: MARGIN, name: MARGIN + 24, captured: MARGIN + 208, page: MARGIN + 344, at: MARGIN + 378 }
  const nameW = col.captured - col.name - 8
  const capturedW = col.page - col.captured - 8
  const header = () => {
    w.ensureRoom(16)
    w.page.drawText("#", { x: col.idx, y: w.y - 8, size: 8, font: helvBold, color: MUTED })
    w.page.drawText("CHECKPOINT", { x: col.name, y: w.y - 8, size: 8, font: helvBold, color: MUTED })
    w.page.drawText("CAPTURED", { x: col.captured, y: w.y - 8, size: 8, font: helvBold, color: MUTED })
    w.page.drawText("PAGE", { x: col.page, y: w.y - 8, size: 8, font: helvBold, color: MUTED })
    w.page.drawText("SIGNED AT (UTC)", { x: col.at, y: w.y - 8, size: 8, font: helvBold, color: MUTED })
    w.y -= 13
  }
  w.drawLines(["Checkpoints"], { size: 11, font: helvBold })
  w.y -= 2
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
    if (w.y - rowHeight < MARGIN) {
      w.newPage()
      header()
    }
    w.page.drawText(String(i + 1), { x: col.idx, y: w.y - 8, size: 8, font: helv, color: MUTED })
    for (const [j, line] of nameLines.entries()) {
      w.page.drawText(line, { x: col.name, y: w.y - 8 - j * 10, size: 8, font: helv, color: INK })
    }
    for (const [j, line] of capturedLines.entries()) {
      w.page.drawText(line, { x: col.captured, y: w.y - 8 - j * 10, size: 8, font: helv, color: INK })
    }
    w.page.drawText(checkpoint.pageRef != null ? String(checkpoint.pageRef) : "-", {
      x: col.page,
      y: w.y - 8,
      size: 8,
      font: helv,
      color: INK,
    })
    w.page.drawText(utc(ack.signedAt).replace(" UTC", ""), { x: col.at, y: w.y - 8, size: 8, font: courier, color: INK })
    w.y -= rowHeight
  }
  w.rule()

  // ── Per-page initials grid (spike layout): p1: GT   p2: GT   … ───────────
  const initialAcks = orderedAcks.filter((x) => x.checkpoint.type === "Initial" && x.checkpoint.pageRef != null)
  if (initialAcks.length > 0) {
    w.drawLines(["Per-page initials"], { size: 11, font: helvBold })
    w.y -= 2
    const cellW = 66
    const perRow = Math.floor((PAGE_W - MARGIN * 2) / cellW)
    for (let i = 0; i < initialAcks.length; i += perRow) {
      w.ensureRoom(14)
      for (const [j, { checkpoint, ack }] of initialAcks.slice(i, i + perRow).entries()) {
        const initials = ack.method === "Attested" ? "att." : ack.typedName ?? "-"
        w.page.drawText(sanitize(`p${checkpoint.pageRef}: ${initials}`), {
          x: MARGIN + j * cellW,
          y: w.y - 9,
          size: 8.5,
          font: courier,
          color: INK,
        })
      }
      w.y -= 13
    }
    w.rule()
  }

  w.drawLines(
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
        signingCycle,
        completedAt,
        signedPdfPathname: uploaded.pathname,
        signedPdfHash,
      },
    })
  } catch (err) {
    // Concurrent completion: the unique (version, staff, cycle) key means
    // someone else just created it — theirs is the record.
    const race = await prisma.hrSignedRecord.findUnique({
      where: {
        hrDocumentVersionId_staffMemberId_signingCycle: { hrDocumentVersionId, staffMemberId, signingCycle },
      },
    })
    if (race) return race
    throw err
  }
}

// HR-5: idempotently generate the executed-form PDF for a COMPLETED dual-
// signature FormSubmission and stamp its write-once pointer columns. Returns
// the submission row (with the pointer). One PDF per submission, never
// regenerated; refuses anything not carrying both signatures.
export async function ensureFormSignedPdf(formSubmissionId: string) {
  const submission = await prisma.formSubmission.findUnique({
    where: { id: formSubmissionId },
    include: { version: { include: { hrDocument: { include: { organization: true } } } } },
  })
  if (!submission) throw new SignedRecordError("Form submission not found")
  if (submission.signedPdfPathname) return submission

  if (
    submission.status !== "Completed" ||
    !submission.employeeTypedName ||
    !submission.supervisorTypedName ||
    !submission.employeeSignedAt ||
    !submission.supervisorSignedAt
  ) {
    throw new SignedRecordError("Both signatures are required before the record can be generated")
  }

  const doc = submission.version.hrDocument
  const org = doc.organization
  const values = (submission.values ?? []) as unknown as SubmittedFormValue[]
  const formTitle = submission.formTitle ?? doc.title
  const versionNumber = submission.formVersionNumber ?? submission.version.versionNumber
  const staffName = submission.staffName ?? "-"
  const definitionHash = submission.definitionHash ?? submission.version.fileHash
  const completedAt = submission.supervisorSignedAt

  const supervisorUser = submission.supervisorUserId
    ? await prisma.user.findUnique({
        where: { id: submission.supervisorUserId },
        select: { name: true, email: true },
      })
    : null
  const supervisorIdentity = supervisorUser?.name ?? supervisorUser?.email ?? "-"

  // ── Render the executed form from scratch ─────────────────────────────────
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const courier = await pdf.embedFont(StandardFonts.Courier)
  const w = new CertificateWriter(pdf, { helv, helvBold, courier })

  w.newPage()
  w.page.drawText(sanitize(formTitle), { x: MARGIN, y: w.y - 18, size: 18, font: helvBold, color: INK })
  w.y -= 26
  w.drawLines(
    [
      `${org.name} · version ${versionNumber} · executed for ${staffName}${submission.storeName ? ` (${submission.storeName})` : ""}`,
    ],
    { size: 9, color: MUTED }
  )
  w.rule()

  const bodyText = (doc.bodyText ?? "").trim()
  if (bodyText) {
    w.drawLines(wrapText(sanitize(bodyText), helv, 9.5, PAGE_W - MARGIN * 2), { size: 9.5, gap: 3.5 })
    w.rule()
  }

  if (values.length > 0) {
    w.drawLines(["Details"], { size: 11, font: helvBold })
    w.y -= 2
    for (const v of values) {
      w.labeled(v.label, v.value || "-")
    }
    w.rule()
  }

  // Typed-name signature blocks — the name over a line, caption underneath.
  const signatureBlock = (typedName: string, caption: string) => {
    w.ensureRoom(58)
    w.page.drawText(sanitize(typedName), { x: MARGIN, y: w.y - 22, size: 14, font: helvOblique, color: INK })
    w.page.drawLine({
      start: { x: MARGIN, y: w.y - 28 },
      end: { x: MARGIN + 260, y: w.y - 28 },
      thickness: 0.75,
      color: INK,
    })
    w.page.drawText(sanitize(caption), { x: MARGIN, y: w.y - 40, size: 8, font: helv, color: MUTED })
    w.y -= 52
  }
  w.drawLines(["Signatures"], { size: 11, font: helvBold })
  w.y -= 4
  signatureBlock(
    submission.employeeTypedName,
    `Employee — ${staffName} · signed ${utc(submission.employeeSignedAt)}`
  )
  signatureBlock(
    submission.supervisorTypedName,
    `Supervisor — ${supervisorIdentity} · signed ${utc(submission.supervisorSignedAt)}`
  )

  // ── Certificate page (HR-4 language, definition hash as the pin) ─────────
  w.newPage()
  w.heading("Certificate of Execution", org.name)

  w.labeled("Form", `${formTitle} (version ${versionNumber})`)
  w.labeled("Definition SHA-256", definitionHash, courier)
  w.labeled("Organization", org.name)
  w.labeled("Completed at", utc(completedAt))
  w.rule()
  w.labeled("Employee", staffName)
  w.labeled("Store", submission.storeName ?? "-")
  w.labeled("Signed as", submission.employeeTypedName)
  w.labeled("Signed at", utc(submission.employeeSignedAt))
  w.labeled("IP address", submission.ipAddress ?? "-")
  w.labeled("Device", submission.userAgent ?? "-")
  w.rule()
  w.labeled("Supervisor", supervisorIdentity)
  w.labeled("Signed as", submission.supervisorTypedName)
  w.labeled("Signed at", utc(submission.supervisorSignedAt))
  w.labeled("IP address", submission.supervisorIpAddress ?? "-")
  w.labeled("Device", submission.supervisorUserAgent ?? "-")
  w.rule()
  w.labeled("Auth method", "ClerkSession — employee signed in the supervisor's presence")
  w.rule()

  w.drawLines(
    [
      "Electronic signature consent" +
        (submission.consentVersion ? ` (${submission.consentVersion})` : ""),
    ],
    { size: 8, font: helvBold, color: MUTED }
  )
  w.drawLines(wrapText(sanitize(submission.consentText ?? "-"), helv, 8.5, PAGE_W - MARGIN * 2), {
    size: 8.5,
  })
  w.rule()

  w.drawLines(
    [
      `This certificate was generated at ${utc(new Date())} and is bound to the form definition by its SHA-256 fingerprint above.`,
      `Form submissions are append-only; editing the form definition produces a new version while this record stays pinned to the definition signed.`,
    ],
    { size: 7.5, color: MUTED }
  )

  const signedBytes = Buffer.from(await pdf.save())
  const signedPdfHash = createHash("sha256").update(signedBytes).digest("hex")

  const safeStaff = staffName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)
  const uploaded = await uploadHrFile(
    new File(
      [new Uint8Array(signedBytes)],
      `signed-form-${safeStaff}-v${versionNumber}.pdf`,
      { type: "application/pdf" }
    ),
    { keyPrefix: `hr/${doc.organizationId}/signed-records` }
  )

  // Write-once: only stamp the pointer if nobody else has. A concurrent
  // generation loses the race harmlessly — the first PDF stands.
  const { count } = await prisma.formSubmission.updateMany({
    where: { id: submission.id, signedPdfPathname: null },
    data: {
      signedPdfPathname: uploaded.pathname,
      signedPdfHash,
      generatedAt: new Date(),
    },
  })
  if (count === 0) {
    const race = await prisma.formSubmission.findUnique({
      where: { id: submission.id },
      include: { version: { include: { hrDocument: { include: { organization: true } } } } },
    })
    if (race?.signedPdfPathname) return race
    throw new SignedRecordError("Failed to record the generated PDF")
  }

  return (await prisma.formSubmission.findUnique({
    where: { id: submission.id },
    include: { version: { include: { hrDocument: { include: { organization: true } } } } },
  }))!
}

// ── HR-7: training certification ─────────────────────────────────────────────
// Idempotently generate the signed training-certificate PDF for a co-signed
// TrainingAssignment (each executed thing owns its PDF — HR-5 pattern; the
// pointer lives on the assignment, write-once). Requires the certify route to
// have stamped certifiedAt/certifiedByUserId/trainerTypedName first. Built
// only from data already persisted, so a regeneration race is harmless.
// Downloads are ADMIN / in-scope MANAGER only (rule 5) — /my shows status.
export async function ensureTrainingCertPdf(trainingAssignmentId: string) {
  const assignment = await prisma.trainingAssignment.findUnique({
    where: { id: trainingAssignmentId },
    include: {
      trainingModule: {
        include: {
          organization: true,
          lessons: { orderBy: { orderIndex: "asc" }, select: { id: true, title: true } },
        },
      },
      staffMember: {
        include: {
          storeAssignments: {
            include: { store: true },
            orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
          },
        },
      },
      lessonProgress: { select: { trainingLessonId: true, completedAt: true, authMethod: true } },
      quizAttempts: { orderBy: { submittedAt: "desc" } },
    },
  })
  if (!assignment) throw new SignedRecordError("Training assignment not found")
  if (assignment.certPdfPathname) return assignment

  if (!assignment.certifiedAt || !assignment.trainerTypedName || !assignment.certifiedByUserId) {
    throw new SignedRecordError("Trainer co-sign is required before the certificate can be generated")
  }
  if (assignment.status !== "Completed" || assignment.hoursLogged === null) {
    throw new SignedRecordError("Certification requires a completed module and logged hours")
  }

  const org = assignment.trainingModule.organization
  const staff = assignment.staffMember
  const staffName = staff.fullName ?? staff.displayName
  const primaryStore = staff.storeAssignments[0]?.store.name ?? null
  const trainer = await prisma.user.findUnique({
    where: { id: assignment.certifiedByUserId },
    select: { name: true, email: true },
  })
  const trainerIdentity = trainer?.name ?? trainer?.email ?? "-"
  const passedAttempt = assignment.quizAttempts.find((a) => a.status === "Passed")
  const progressByLesson = new Map(assignment.lessonProgress.map((p) => [p.trainingLessonId, p]))

  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const courier = await pdf.embedFont(StandardFonts.Courier)
  const w = new CertificateWriter(pdf, { helv, helvBold, courier })

  // ── Certificate page ───────────────────────────────────────────────────────
  w.newPage()
  w.heading("Certificate of Training", org.name)

  w.labeled("Trainee", staffName)
  w.labeled("Store", primaryStore ?? "-")
  w.labeled("Module", assignment.trainingModule.title)
  w.labeled("Hours logged", `${assignment.hoursLogged}`)
  w.labeled(
    "Quiz result",
    passedAttempt
      ? `Passed${passedAttempt.scorePct !== null ? ` — ${passedAttempt.scorePct}%` : ""} (threshold ${passedAttempt.passThresholdSnapshot}%) at ${utc(passedAttempt.submittedAt)}`
      : "No quiz on this module"
  )
  w.labeled("Certified at", utc(assignment.certifiedAt))
  w.rule()

  w.labeled("Trainer", trainerIdentity)
  // Typed-name co-sign block, HR-5 signature styling.
  w.ensureRoom(58)
  w.page.drawText(sanitize(assignment.trainerTypedName), {
    x: MARGIN,
    y: w.y - 22,
    size: 14,
    font: helvOblique,
    color: INK,
  })
  w.page.drawLine({
    start: { x: MARGIN, y: w.y - 28 },
    end: { x: MARGIN + 260, y: w.y - 28 },
    thickness: 0.75,
    color: INK,
  })
  w.page.drawText(
    sanitize(`Trainer co-signature — ${trainerIdentity} · signed ${utc(assignment.certifiedAt)}`),
    { x: MARGIN, y: w.y - 40, size: 8, font: helv, color: MUTED }
  )
  w.y -= 52
  w.rule()

  // ── Lesson completion table ────────────────────────────────────────────────
  w.drawLines(["Lesson completion"], { size: 11, font: helvBold })
  w.y -= 2
  for (const lesson of assignment.trainingModule.lessons) {
    const p = progressByLesson.get(lesson.id)
    w.labeled(
      lesson.title.slice(0, 60),
      p
        ? `${utc(p.completedAt)} · ${p.authMethod === "ManagerAttested" ? "manager-attested" : "self-completed (signed in)"}`
        : "-"
    )
  }
  w.rule()

  w.drawLines(
    [
      `The trainer named above attests that ${staffName} completed every lesson of this module, passed`,
      `the module quiz where one exists, and received ${assignment.hoursLogged} hour(s) of training.`,
    ],
    { size: 8.5 }
  )
  w.rule()
  w.drawLines(
    [
      `This certificate was generated at ${utc(new Date())}. Training records are append-only; the`,
      `completions and quiz attempts above are stored with their original timestamps and auth methods.`,
    ],
    { size: 7.5, color: MUTED }
  )

  const signedBytes = Buffer.from(await pdf.save())
  const certPdfHash = createHash("sha256").update(signedBytes).digest("hex")

  const safeStaff = staffName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)
  const uploaded = await uploadHrFile(
    new File([new Uint8Array(signedBytes)], `training-cert-${safeStaff}.pdf`, {
      type: "application/pdf",
    }),
    { keyPrefix: `hr/${org.id}/signed-records` }
  )

  // Write-once: only stamp the pointer if nobody else has (HR-5 race rule).
  const { count } = await prisma.trainingAssignment.updateMany({
    where: { id: assignment.id, certPdfPathname: null },
    data: { certPdfPathname: uploaded.pathname, certPdfHash },
  })
  if (count === 0) {
    const race = await prisma.trainingAssignment.findUnique({ where: { id: assignment.id } })
    if (race?.certPdfPathname) return race
    throw new SignedRecordError("Failed to record the generated certificate")
  }

  return (await prisma.trainingAssignment.findUnique({ where: { id: assignment.id } }))!
}
