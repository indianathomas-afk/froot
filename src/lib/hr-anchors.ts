// HR-11b — server-side field-anchor detection.
//
// Scans a PDF's text layer for the anchor vocabulary and records each hit with
// its page + coordinates, so the signed PDF can later stamp captured values
// (initials, name, date, store, signature) directly onto the document body.
//
// Runs headless in the Node/serverless runtime via unpdf's serverless build of
// pdf.js (the direct pdfjs-dist legacy build threw "DOMMatrix is not defined" in
// the Vercel function — see DECISIONS). pdf-lib and pdf.js share the same
// absolute PDF content
// coordinate space (origin bottom-left, y-up) — verified against a shifted
// MediaBox in the spike — so a coordinate detected here maps straight to a
// pdf-lib drawText call in hr-signed-pdf.ts. Page /Rotate and MediaBox origin
// are carried through for the stamping layer to handle explicitly (D2); this
// module reports raw content-space coordinates and does not pre-transform them.
//
// This file is SERVER-ONLY (imports pdfjs). Client-safe labels/enum unions live
// in hr-documents.ts.

import { prisma } from "@/lib/prisma"
import type {
  HrAnchorMarkTypeName,
  HrAnchorPlacementName,
  HrVersionScanReport,
} from "@/lib/hr-documents"

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
// case-insensitive and runs against curly-quote-normalized text, so
// "Employee's Signature" with a typographic apostrophe (U+2019) still matches.
// The verbatim matched substring is recorded as anchorText.
//
// requiresFill: a generic bare word (no colon) that also occurs in body prose —
// accepted ONLY when a fill line (an underscore run) sits beside or just above
// it, so the word "Date" inside a policy sentence is not mistaken for a field.
//
// discard (HR-11d 2d): the token is RECOGNIZED so it claims its span under
// longest-match-wins, and then produces nothing — no candidate, no row, and no
// contribution to the matched count. It exists purely to stop a shorter token
// stealing a line that must never be stamped. See MANAGER_SIGNATURE below.
export const ANCHOR_VOCABULARY: ReadonlyArray<{
  token: string
  markType: HrAnchorMarkTypeName
  requiresFill?: boolean
  discard?: boolean
}> = [
  { token: "Employee Name (Print):", markType: "PrintedName" },
  { token: "Employee Signature:", markType: "SignatureStamp" },
  { token: "Employee's Signature", markType: "SignatureStamp" },
  { token: "Employee Name", markType: "PrintedName" },
  { token: "Initial:", markType: "Initial" },
  { token: "Store:", markType: "Store" },
  { token: "Name:", markType: "PrintedName" },
  { token: "Date:", markType: "DateStamp" },
  // Bare "Date" (no colon) — pages 22/24 signature blocks. Gated on a nearby
  // fill line so body-text "Date" is ignored.
  { token: "Date", markType: "DateStamp", requiresFill: true },

  // ── HR-11d 2d: the real 2023 Keva handbook ────────────────────────────────
  // Tokens the vocabulary above walks past. All ruled by Gary 2026-08-14; the
  // HR-11d ROADMAP row is the spec.
  //
  // MANAGER SIGNATURE IS A DISCARD, AND THE ORDER OF THESE TWO LINES IS NOT
  // WHAT MAKES IT WORK — the tokenizer sorts by descending length, so
  // "Manager Signature:" (18) always claims its span before bare "Signature:"
  // (10) can reach it. Without this entry the bare token matches the substring
  // and stamps the EMPLOYEE's signature on the MANAGER's line. Recognized and
  // left alone: it emits no candidate, writes no row, and never enters the
  // matched count — so the 2b guard needs no carve-out for a document whose
  // only signature line belongs to a manager. Countersignature is HR-11h.
  { token: "Manager Signature:", markType: "SignatureStamp", discard: true },
  { token: "Signature:", markType: "SignatureStamp" }, // bare form, pp. 9 and 19
  { token: "Store Location:", markType: "Store" }, // "Store:" does not match this
  { token: "Acceptance (PRINT):", markType: "PrintedName" }, // p. 9
  // p. 13 is a signature line, so SignatureStamp is the default — and it is
  // fill-gated, because bare "Employee:" also opens prose rows elsewhere in the
  // handbook. A wrong default here costs an admin one unchecked box at confirm;
  // the reverse error (PrintedName) types a name onto a signature line with no
  // signer act behind it, which is not recoverable at all.
  { token: "Employee:", markType: "SignatureStamp", requiresFill: true },
]

// Longest-match-wins ordering, precomputed once.
const VOCAB_BY_LENGTH = [...ANCHOR_VOCABULARY].sort((a, b) => b.token.length - a.token.length)

// Normalize typographic punctuation to ASCII before matching so curly quotes /
// apostrophes / dashes in the PDF text layer don't defeat the vocabulary.
function normalizePunct(s: string): string {
  return s
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
}

// A run of underscores (a fill line) — the discriminator for bare fields and
// for Above vs Right placement.
const FILL_RUN = /_{2,}/

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
  y: number // baseline y of the line (for above/below neighbor lookups)
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
    return { text, y: inOrder[0].y, charX, charY, charW }
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
  end: number // index just past the match in line.text (for trailing-fill test)
  requiresFill: boolean // bare generic token that must sit beside/under a fill line
  discard: boolean // recognized to claim its span, then dropped (2d)
}

export function matchLine(line: AssembledLine): LineMatch[] {
  // Length-preserving normalization → indices still map to line.text.
  const haystack = normalizePunct(line.text).toLowerCase()
  const claimed = new Array<boolean>(line.text.length).fill(false)
  const matches: LineMatch[] = []

  for (const { token, markType, requiresFill, discard } of VOCAB_BY_LENGTH) {
    const needle = normalizePunct(token).toLowerCase()
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
          end,
          requiresFill: requiresFill ?? false,
          discard: discard ?? false,
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

export interface DetectionResult {
  anchors: AnchorCandidate[]
  pagesScanned: number
  textItemCount: number // 0 ⇒ no text layer (image-only / scanned)
}

// Above-line lookups: a caption sits at most this far below its signature line.
const ABOVE_LINE_WINDOW = 26

// Decide a match's placement and whether to keep it, using the line it sits on
// plus the line immediately above (for under-line caption blocks). A trailing
// underscore run means a fill line to the right (Right); an underscore run on
// the line just above, roughly over the label, means the label captions a
// signature line (Above). Bare `requiresFill` tokens are dropped when neither
// fill signal is present, so prose "Date" is ignored.
function resolveMatch(
  m: LineMatch,
  line: AssembledLine,
  lines: AssembledLine[]
): { placement: HrAnchorPlacementName; keep: boolean } {
  const trailing = line.text.slice(m.end)
  const trailingFill = FILL_RUN.test(trailing)

  const matchRight = m.x + m.width
  const aboveFill = lines.some((other) => {
    if (other === line) return false
    const dy = other.y - line.y
    if (dy <= 2 || dy > ABOVE_LINE_WINDOW) return false // must sit just above
    if (!FILL_RUN.test(other.text)) return false
    const lineMinX = other.charX[0]
    const lineMaxX = other.charX[other.charX.length - 1]
    return matchRight >= lineMinX - 40 && m.x <= lineMaxX + 40 // roughly overlapping x
  })

  const placement: HrAnchorPlacementName = trailingFill ? "Right" : aboveFill ? "Above" : "Right"
  const keep = m.requiresFill ? trailingFill || aboveFill : true
  return { placement, keep }
}

/**
 * Detect anchor candidates in a PDF's text layer, with diagnostics. A zero
 * textItemCount means no text layer (image-only / scanned) — the caller falls
 * back to certificate-only mode. Throws only on genuinely unreadable bytes or a
 * runtime failure to load pdfjs; callers decide whether to surface or swallow.
 */
export async function detectAnchors(pdfBytes: Uint8Array): Promise<DetectionResult> {
  // unpdf ships a serverless build of pdf.js that does NOT reference browser DOM
  // globals (DOMMatrix, Path2D, ImageData, …). The direct pdfjs-dist legacy
  // build referenced those and threw "DOMMatrix is not defined" when Vercel's
  // Node runtime evaluated it (staging 7-23). getDocumentProxy returns the same
  // PDFDocumentProxy, so getPage/getTextContent/getViewport are unchanged.
  const { getDocumentProxy } = await import("unpdf")
  // Clone into a fresh Uint8Array: pdf.js may detach the underlying buffer.
  const doc = await getDocumentProxy(new Uint8Array(pdfBytes))

  const candidates: AnchorCandidate[] = []
  let textItemCount = 0
  const pagesScanned = doc.numPages
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const view = page.view as [number, number, number, number]
      const rotation = page.rotate as number
      const content = await page.getTextContent()

      const segments: Segment[] = (content.items as PdfjsTextItem[])
        .filter((it) => typeof it.str === "string" && it.str.length > 0)
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
        }))
      textItemCount += segments.length

      const lines = assembleLines(segments)
      for (const line of lines) {
        for (const m of matchLine(line)) {
          // 2d: a discard token has already done its only job — claiming its
          // span inside matchLine so a shorter token could not take the line.
          // It never becomes a candidate, so it never becomes a row and never
          // counts as matched.
          if (m.discard) continue
          const { placement, keep } = resolveMatch(m, line, lines)
          if (!keep) continue
          candidates.push({
            page: pageNum,
            x: m.x,
            y: m.y,
            width: m.width,
            pageRotation: rotation,
            pageView: view,
            anchorText: m.anchorText,
            markType: m.markType,
            placement,
          })
        }
      }
    }
  } finally {
    await doc.destroy?.()
  }
  return { anchors: dedupeAnchors(candidates), pagesScanned, textItemCount }
}

// Within-pass dedup: a caption drawn as two coincident runs (faux-bold, shadow,
// exact overlap) otherwise mints two anchors for one visual field → two
// checkpoints/affordances/stamps. Collapse anchors that share page + normalized
// text + markType AND sit within DEDUP_TOL on BOTH axes. Distinct fields (lines
// >font-size apart in y, side-by-side fields far apart in x) exceed the
// tolerance and are preserved. Deterministic survivor: sort by
// (page, normText, markType, x, y, width desc, text) and keep-first, so
// re-detecting a future version always yields the same survivor.
const DEDUP_TOL = 3
export function dedupeAnchors(anchors: AnchorCandidate[]): AnchorCandidate[] {
  const norm = (t: string) => normalizePunct(t).toLowerCase()
  const sorted = [...anchors].sort(
    (a, b) =>
      a.page - b.page ||
      norm(a.anchorText).localeCompare(norm(b.anchorText)) ||
      a.markType.localeCompare(b.markType) ||
      a.x - b.x ||
      a.y - b.y ||
      b.width - a.width ||
      a.anchorText.localeCompare(b.anchorText)
  )
  const kept: AnchorCandidate[] = []
  for (const c of sorted) {
    const isDup = kept.some(
      (k) =>
        k.page === c.page &&
        k.markType === c.markType &&
        norm(k.anchorText) === norm(c.anchorText) &&
        Math.abs(k.x - c.x) <= DEDUP_TOL &&
        Math.abs(k.y - c.y) <= DEDUP_TOL
    )
    if (!isDup) kept.push(c)
  }
  return kept
}

export interface StoreAnchorsResult {
  stored: number // anchors written (unconfirmed)
  matched: number // anchors detected this scan (== stored on success)
  pagesScanned: number
  hadTextLayer: boolean // false ⇒ image-only / no text layer
  error: string | null // non-null ⇒ detection threw; nothing was scanned
}

/**
 * Detect anchors in a version's PDF and persist them as UNCONFIRMED proposals,
 * replacing any prior unconfirmed set for the version (re-detection idempotency,
 * DECISIONS ruling #5). Confirmed anchors are never touched.
 *
 * Returns a DISCRIMINATED result — never collapses distinct outcomes into a
 * bare 0. `error` set ⇒ detection threw (e.g. pdfjs failed to load in the
 * runtime); `hadTextLayer` false ⇒ image-only PDF; otherwise `matched`/`stored`
 * report what was found. Always logs a server-side summary. Does not throw:
 * callers (upload = best-effort, rescan = surfaces) decide how to react.
 */
export async function detectAndStoreVersionAnchors(
  hrDocumentVersionId: string,
  pdfBytes: Uint8Array
): Promise<StoreAnchorsResult> {
  let result: DetectionResult
  try {
    result = await detectAnchors(pdfBytes)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[hr-anchors] detection FAILED for version ${hrDocumentVersionId} (${pdfBytes.byteLength} bytes):`,
      err
    )
    return { stored: 0, matched: 0, pagesScanned: 0, hadTextLayer: false, error: message }
  }

  // Don't re-propose a field that's already CONFIRMED at the same spot — else
  // rescanning an already-confirmed document piles a duplicate unconfirmed
  // anchor on top of every confirmed one. Same file ⇒ identical coordinates, so
  // match on page + normalized text + near-exact position.
  const confirmed = await prisma.documentAnchor.findMany({
    where: { hrDocumentVersionId, confirmed: true },
    select: { page: true, x: true, y: true, anchorText: true },
  })
  const isConfirmedDup = (a: AnchorCandidate) =>
    confirmed.some(
      (c) =>
        c.page === a.page &&
        normalizePunct(c.anchorText).toLowerCase() === normalizePunct(a.anchorText).toLowerCase() &&
        Math.abs(c.x - a.x) < 1 &&
        Math.abs(c.y - a.y) < 1
    )
  const fresh = result.anchors.filter((a) => !isConfirmedDup(a))

  await prisma.documentAnchor.deleteMany({
    where: { hrDocumentVersionId, confirmed: false },
  })
  if (fresh.length > 0) {
    await prisma.documentAnchor.createMany({
      data: fresh.map((a) => ({
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
  }

  console.info(
    `[hr-anchors] version ${hrDocumentVersionId}: ${pdfBytes.byteLength} bytes, ` +
      `${result.pagesScanned} pages, ${result.textItemCount} text items, ` +
      `${result.anchors.length} detected, ${fresh.length} new (rest already confirmed)`
  )
  return {
    stored: fresh.length,
    matched: result.anchors.length,
    pagesScanned: result.pagesScanned,
    hadTextLayer: result.textItemCount > 0,
    error: null,
  }
}

// ── HR-11d 2b: the anchor readiness predicate ────────────────────────────────

export interface AnchorReadiness {
  matched: number // anchor rows on the version — detection's surviving proposals + confirmed
  confirmed: number
  blocked: boolean
}

/**
 * THE TRIP-WIRE, and the ONE definition of it (HR-11d R3(i-a), Gary
 * 2026-08-14). Detection matched fields and NOT ONE is confirmed ⇒ the version
 * would mint a record that claims completion and stamps nothing. Refuse.
 *
 * THIS CORRECTS THE AUDIT, which proposed "a prior version had anchors and the
 * current one has none". That test needs a document with history; a brand-new
 * document whose first version was never confirmed sails straight through it,
 * and new documents are most of what gets uploaded.
 *
 * matched == 0 is LEGITIMATE and stays signable — an image-only PDF, a document
 * that predates anchoring and was never scanned, or one whose admin confirmed
 * the screen and discarded every proposal (which deletes the rows, so the count
 * is a real zero, not an unexamined one). Those are certificate-only by design.
 *
 * Pure, so the fixture can assert it without a database.
 */
export function isSigningBlocked(matched: number, confirmed: number): boolean {
  return matched > 0 && confirmed === 0
}

/** Count a version's anchors and apply isSigningBlocked. */
export async function getVersionAnchorReadiness(
  hrDocumentVersionId: string
): Promise<AnchorReadiness> {
  const [matched, confirmed] = await Promise.all([
    prisma.documentAnchor.count({ where: { hrDocumentVersionId } }),
    prisma.documentAnchor.count({ where: { hrDocumentVersionId, confirmed: true } }),
  ])
  return { matched, confirmed, blocked: isSigningBlocked(matched, confirmed) }
}

// ── HR-11d 2a: the upload's scan report ──────────────────────────────────────

/**
 * Turn a detection result into the discriminated report the upload routes
 * return and the upload dialog renders (R2). Pass `result: null` when detection
 * was never attempted — that is its own outcome, not a zero.
 *
 * Note the ORDER: carry-forward wins over everything, because on an identical
 * re-upload the anchors are already active and there is genuinely nothing for
 * the operator to do. `scanFailed` is checked before the text-layer question,
 * since a throw tells us nothing about whether a text layer exists.
 */
export async function buildVersionScanReport(
  hrDocumentVersionId: string,
  result: StoreAnchorsResult | null,
  carriedForward: number
): Promise<HrVersionScanReport> {
  const confirmed = await prisma.documentAnchor.count({
    where: { hrDocumentVersionId, confirmed: true },
  })
  const base = {
    matched: result?.matched ?? 0,
    stored: result?.stored ?? 0,
    confirmed,
    carriedForward,
    pagesScanned: result?.pagesScanned ?? 0,
    error: result?.error ?? null,
  }
  if (carriedForward > 0) return { ...base, outcome: "carriedForward" }
  if (!result) return { ...base, outcome: "notScanned" }
  if (result.error) return { ...base, outcome: "scanFailed" }
  if (result.matched > 0) return { ...base, outcome: "needsConfirm" }
  return { ...base, outcome: result.hadTextLayer ? "noFieldsMatched" : "noTextLayer" }
}

// ── HR-11d 2e: hash-match anchor carry-forward ───────────────────────────────

/**
 * When a new version's file hash equals the hash of the version it replaces,
 * copy that version's CONFIRMED anchors forward as confirmed. Identical bytes
 * cannot have different coordinates — that is arithmetic, not inference, so
 * there is no admin judgment left to exercise. Staging shows nine versions of
 * the Keva handbook all carrying sha256 7d60912ccf4b; the 8-12 signer signed a
 * file byte-identical to one that stamped correctly and got nothing, purely
 * because the anchor rows did not travel.
 *
 * CONFIRMED ONLY. Unconfirmed proposals do not carry forward — an admin who has
 * not reviewed them on the old version has not reviewed them on the new one
 * either, and detection re-proposes them anyway.
 *
 * This moves STAMP COORDINATES AND NOTHING ELSE. Signed records stay bound to
 * the version signed, and a new version still requires new acknowledgment
 * (HR-11f: current behavior stands). Nothing here touches compliance or
 * re-signing.
 *
 * Returns the number carried. Runs BEFORE detection, so detection's
 * already-confirmed dedup sees them and re-proposes nothing on top.
 */
export async function carryForwardConfirmedAnchors(
  fromVersionId: string,
  toVersionId: string
): Promise<number> {
  const prior = await prisma.documentAnchor.findMany({
    where: { hrDocumentVersionId: fromVersionId, confirmed: true },
  })
  if (prior.length === 0) return 0

  await prisma.documentAnchor.createMany({
    data: prior.map((a) => ({
      hrDocumentVersionId: toVersionId,
      page: a.page,
      x: a.x,
      y: a.y,
      width: a.width,
      pageRotation: a.pageRotation,
      anchorText: a.anchorText,
      markType: a.markType,
      placement: a.placement,
      confirmed: true,
      // Checkpoints are DOCUMENT-scoped and carry forward on their own, so the
      // link still resolves — and keeping it means syncCheckpointsForConfirmedAnchors
      // reuses each signature's existing checkpoint instead of minting a
      // duplicate ceremony step for the same line.
      generatedCheckpointId: a.generatedCheckpointId,
    })),
  })
  console.info(
    `[hr-anchors] carried ${prior.length} confirmed anchor(s) forward from version ` +
      `${fromVersionId} to ${toVersionId} (identical file hash)`
  )
  return prior.length
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
 *   SignatureStamp → its OWN Signature checkpoint, one per anchor, so each is a
 *                    distinct signer act with its own timestamp (like initials).
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
      // Each signature anchor is a DISTINCT attestation → its own Signature
      // checkpoint the signer acts on during the ceremony, with its own
      // per-interaction timestamp (like initials). Reuse only the Signature
      // checkpoint already linked to THIS anchor (idempotent re-confirm); never
      // reuse another anchor's, and never the final Acknowledgment (the prior
      // behavior, which collapsed all signatures onto one timestamp).
      let cp = a.generatedCheckpointId
        ? checkpoints.find((c) => c.id === a.generatedCheckpointId && c.type === "Signature")
        : undefined
      if (!cp) {
        cp = await prisma.hrDocumentCheckpoint.create({
          data: { hrDocumentId, name: `Page ${a.page} signature`, type: "Signature", orderIndex: nextOrder++, pageRef: a.page, required: true },
        })
        checkpoints.push(cp)
      }
      await link(a.id, cp.id, a.generatedCheckpointId)
    }
    // PrintedName / Store / DateStamp: derived stamp-only, no checkpoint.
  }
}
