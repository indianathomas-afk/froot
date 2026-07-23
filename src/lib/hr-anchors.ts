// HR-11b — server-side field-anchor detection.
//
// Scans a PDF's text layer for the anchor vocabulary and records each hit with
// its page + coordinates, so the signed PDF can later stamp captured values
// (initials, name, date, store, signature) directly onto the document body.
//
// Runs headless in the Node runtime via the pdfjs legacy build (confirmed by
// the HR-11b D1 spike). pdf-lib and pdfjs share the same absolute PDF content
// coordinate space (origin bottom-left, y-up) — verified against a shifted
// MediaBox in the spike — so a coordinate detected here maps straight to a
// pdf-lib drawText call in hr-signed-pdf.ts. Page /Rotate and MediaBox origin
// are carried through for the stamping layer to handle explicitly (D2); this
// module reports raw content-space coordinates and does not pre-transform them.
//
// This file is SERVER-ONLY (imports pdfjs). Client-safe labels/enum unions live
// in hr-documents.ts.

import { prisma } from "@/lib/prisma"
import type { HrAnchorMarkTypeName, HrAnchorPlacementName } from "@/lib/hr-documents"

export interface AnchorCandidate {
  page: number // 1-based
  x: number // PDF content space, bottom-left origin
  y: number
  width: number // approx width of the matched token
  pageRotation: number // page /Rotate (0 | 90 | 180 | 270)
  pageView: [number, number, number, number] // MediaBox/crop [x0,y0,x1,y1] (D2)
  anchorText: string // the matched token, verbatim from the PDF
  markType: HrAnchorMarkTypeName
  placement: HrAnchorPlacementName
}

// Default anchor vocabulary → mark mapping. Order is irrelevant here; the
// tokenizer sorts by descending length so longest-match wins (so
// "Employee Name (Print):" never also registers as "Name:"). Matching is
// case-insensitive; the verbatim matched substring is recorded as anchorText.
export const ANCHOR_VOCABULARY: ReadonlyArray<{
  token: string
  markType: HrAnchorMarkTypeName
}> = [
  { token: "Employee Name (Print):", markType: "PrintedName" },
  { token: "Employee Signature:", markType: "SignatureStamp" },
  { token: "Employee's Signature", markType: "SignatureStamp" },
  { token: "Employee Name", markType: "PrintedName" },
  { token: "Initial:", markType: "Initial" },
  { token: "Store:", markType: "Store" },
  { token: "Name:", markType: "PrintedName" },
  { token: "Date:", markType: "DateStamp" },
]

// Longest-match-wins ordering, precomputed once.
const VOCAB_BY_LENGTH = [...ANCHOR_VOCABULARY].sort((a, b) => b.token.length - a.token.length)

// ── Line reassembly ─────────────────────────────────────────────────────────
// pdfjs emits one text item per drawn run, so an anchor like "Employee Name"
// or "Employee Name (Print):" can be split across items. We group items on the
// same baseline (similar y) into a line, concatenate their strings in x order —
// inserting a single space across word-sized gaps — and keep a per-character
// coordinate map so a token match can be traced back to an (x, y).

interface Segment {
  str: string
  x: number
  y: number
  width: number
}

interface AssembledLine {
  text: string
  // Per-character origin/advance, parallel to `text`.
  charX: number[]
  charY: number[]
  charW: number[]
}

// Two baselines count as the same line when within this many PDF units.
const LINE_Y_TOLERANCE = 3

export function assembleLines(segments: Segment[]): AssembledLine[] {
  const usable = segments.filter((s) => s.str.length > 0)
  if (usable.length === 0) return []

  // Group by baseline y (descending — PDF y grows upward, reading order is
  // top-to-bottom so higher y first).
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: Segment[][] = []
  for (const seg of sorted) {
    const g = groups.find((grp) => Math.abs(grp[0].y - seg.y) <= LINE_Y_TOLERANCE)
    if (g) g.push(seg)
    else groups.push([seg])
  }

  return groups.map((group) => {
    const inOrder = group.sort((a, b) => a.x - b.x)
    let text = ""
    const charX: number[] = []
    const charY: number[] = []
    const charW: number[] = []
    let prevEndX: number | null = null

    for (const seg of inOrder) {
      const perChar = seg.str.length > 0 ? seg.width / seg.str.length : 0
      // Insert a joining space when the gap to the previous run is word-sized.
      if (prevEndX !== null) {
        const gap = seg.x - prevEndX
        if (gap > perChar * 0.4 && !text.endsWith(" ")) {
          text += " "
          charX.push(prevEndX)
          charY.push(seg.y)
          charW.push(gap)
        }
      }
      for (let k = 0; k < seg.str.length; k++) {
        text += seg.str[k]
        charX.push(seg.x + perChar * k)
        charY.push(seg.y)
        charW.push(perChar)
      }
      prevEndX = seg.x + seg.width
    }
    return { text, charX, charY, charW }
  })
}

// ── Longest-match tokenizer ───────────────────────────────────────────────────
// Scans one assembled line for anchor tokens. A claimed[] mask enforces
// longest-match-wins and prevents overlapping matches (so a shorter token can
// never re-claim characters already consumed by a longer one).

interface LineMatch {
  anchorText: string
  markType: HrAnchorMarkTypeName
  x: number
  y: number
  width: number
}

export function matchLine(line: AssembledLine): LineMatch[] {
  const haystack = line.text.toLowerCase()
  const claimed = new Array<boolean>(line.text.length).fill(false)
  const matches: LineMatch[] = []

  for (const { token, markType } of VOCAB_BY_LENGTH) {
    const needle = token.toLowerCase()
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      const end = at + needle.length
      let free = true
      for (let i = at; i < end; i++) if (claimed[i]) { free = false; break }
      if (free) {
        for (let i = at; i < end; i++) claimed[i] = true
        const lastCharIdx = end - 1
        matches.push({
          anchorText: line.text.slice(at, end),
          markType,
          x: line.charX[at],
          y: line.charY[at],
          width: line.charX[lastCharIdx] + line.charW[lastCharIdx] - line.charX[at],
        })
      }
      from = at + 1
    }
  }
  return matches
}

// ── Detection entry point ─────────────────────────────────────────────────────

interface PdfjsTextItem {
  str: string
  transform: number[] // [a,b,c,d,e,f]; e,f = x,y origin at scale 1
  width: number
}

/**
 * Detect anchor candidates in a PDF's text layer. Returns [] for image-only /
 * scanned PDFs with no text layer — the caller falls back to certificate-only
 * mode. Never throws for an unreadable-as-text PDF; only genuinely corrupt
 * bytes reject.
 */
export async function detectAnchors(pdfBytes: Uint8Array): Promise<AnchorCandidate[]> {
  // Legacy build = no DOM, safe in the Node runtime (D1 spike). standardFontDataUrl
  // is intentionally omitted: it only affects glyph rendering, not text extraction,
  // so it emits a harmless warning we accept rather than bundling the font pack.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    useSystemFonts: false,
    disableFontFace: true,
  })
  const doc = await loadingTask.promise

  const candidates: AnchorCandidate[] = []
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const view = page.view as [number, number, number, number]
      const rotation = page.rotate as number
      const content = await page.getTextContent()

      const segments: Segment[] = (content.items as PdfjsTextItem[])
        .filter((it) => typeof it.str === "string")
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
        }))

      for (const line of assembleLines(segments)) {
        for (const m of matchLine(line)) {
          candidates.push({
            page: pageNum,
            x: m.x,
            y: m.y,
            width: m.width,
            pageRotation: rotation,
            pageView: view,
            anchorText: m.anchorText,
            markType: m.markType,
            placement: "Right",
          })
        }
      }
    }
  } finally {
    await loadingTask.destroy()
  }
  return candidates
}

/**
 * Detect anchors in a version's PDF and persist them as UNCONFIRMED proposals,
 * replacing any prior unconfirmed set for the version (re-detection idempotency,
 * DECISIONS ruling #5). Confirmed anchors are never touched. Detection failure
 * or a text-less (image-only) PDF stores nothing → the version falls back to
 * certificate-only mode. Returns the number of anchors stored. Never throws.
 */
export async function detectAndStoreVersionAnchors(
  hrDocumentVersionId: string,
  pdfBytes: Uint8Array
): Promise<number> {
  let anchors: AnchorCandidate[] = []
  try {
    anchors = await detectAnchors(pdfBytes)
  } catch (err) {
    console.error(`[hr-anchors] detection failed for version ${hrDocumentVersionId}:`, err)
    return 0
  }

  await prisma.documentAnchor.deleteMany({
    where: { hrDocumentVersionId, confirmed: false },
  })
  if (anchors.length === 0) return 0

  await prisma.documentAnchor.createMany({
    data: anchors.map((a) => ({
      hrDocumentVersionId,
      page: a.page,
      x: a.x,
      y: a.y,
      width: a.width,
      pageRotation: a.pageRotation,
      anchorText: a.anchorText,
      markType: a.markType,
      placement: a.placement,
      confirmed: false,
    })),
  })
  return anchors.length
}

/**
 * After an admin confirms a version's anchors, link each action-requiring
 * anchor to the checkpoint it drives, generating one only when none exists.
 * Link-first (the auto per-page Initial + final Acknowledgment checkpoints
 * created at upload already capture initials + typed name), so this rarely
 * creates anything and never adds a ceremony step to docs that already have an
 * Acknowledgment checkpoint.
 *
 *   Initial        → the page's Initial checkpoint (reuse by pageRef, else create)
 *   SignatureStamp → an existing Signature checkpoint, else the final
 *                    Acknowledgment checkpoint (where the typed legal name is
 *                    captured); a Signature checkpoint is created only if the
 *                    document has neither.
 *   PrintedName / Store / DateStamp → stamp-only (derived values), no checkpoint.
 *
 * G1 integrity rule: this NEVER deletes or modifies a checkpoint. Removing a
 * generated checkpoint stays the admin's manual (ack-count-guarded) action.
 * Idempotent — safe to re-run after every confirmation.
 */
export async function syncCheckpointsForConfirmedAnchors(
  hrDocumentId: string,
  hrDocumentVersionId: string
): Promise<void> {
  const anchors = await prisma.documentAnchor.findMany({
    where: { hrDocumentVersionId, confirmed: true },
    orderBy: [{ page: "asc" }, { y: "desc" }],
  })
  const checkpoints = await prisma.hrDocumentCheckpoint.findMany({ where: { hrDocumentId } })
  let nextOrder = checkpoints.reduce((m, c) => Math.max(m, c.orderIndex), -1) + 1

  const link = async (anchorId: string, checkpointId: string, current: string | null) => {
    if (current !== checkpointId) {
      await prisma.documentAnchor.update({ where: { id: anchorId }, data: { generatedCheckpointId: checkpointId } })
    }
  }

  for (const a of anchors) {
    if (a.markType === "Initial") {
      let cp = checkpoints.find((c) => c.type === "Initial" && c.pageRef === a.page)
      if (!cp) {
        cp = await prisma.hrDocumentCheckpoint.create({
          data: { hrDocumentId, name: `Page ${a.page} initials`, type: "Initial", orderIndex: nextOrder++, pageRef: a.page, required: true },
        })
        checkpoints.push(cp)
      }
      await link(a.id, cp.id, a.generatedCheckpointId)
    } else if (a.markType === "SignatureStamp") {
      let cp = checkpoints.find((c) => c.type === "Signature") ?? checkpoints.find((c) => c.type === "Acknowledgment")
      if (!cp) {
        cp = await prisma.hrDocumentCheckpoint.create({
          data: { hrDocumentId, name: "Signature", type: "Signature", orderIndex: nextOrder++, pageRef: a.page, required: true },
        })
        checkpoints.push(cp)
      }
      await link(a.id, cp.id, a.generatedCheckpointId)
    }
    // PrintedName / Store / DateStamp: derived stamp-only, no checkpoint.
  }
}
