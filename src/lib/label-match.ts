import { VARIANT_WORDS, nameWarning, words } from "@/lib/label-review"

// ─── N-1e: which ingredient is this label for? ───────────────────────────────
// PURE — no database. N1E-F2 (Gary, 2026-11-02, "Accept all leans"): SUGGEST,
// NEVER ASSIGN. Froot suggests from the filename and, after reading, from the
// product name on the label; the ADMIN confirms every file's ingredient before
// Apply is enabled. Nothing here sets NutritionLabelInboxItem.ingredientId —
// only the assign route does, on an ADMIN's click.
//
// The scorer is the N-1c name check's own measure (audit § C): the share of an
// ingredient's significant words (variant words and size tokens aside) found
// in the text, with words() folding "almond milk" and "almondmilk" together.
// A label suggestion must also pass nameWarning() — a variant conflict
// ("Unsweetened" vs "Original") is never suggested. A suggestion is made only
// when the best candidate covers more than half its words AND beats the
// runner-up outright; a tie suggests nothing.

export type MatchCandidate = { id: string; name: string; brand: string | null }
export type ScoredCandidate = MatchCandidate & { score: number }
export type Suggestion = { suggestedId: string | null; options: ScoredCandidate[] }

// Filename noise: what people and scanners put in label file names.
const FILENAME_NOISE = new Set([
  "label", "labels", "nutrition", "nutritional", "facts", "fact", "panel", "spec", "specs", "sheet", "specsheet",
  "img", "image", "photo", "scan", "screenshot", "pdf", "png", "jpg", "jpeg", "webp", "copy", "final", "front", "back", "new",
])

/** The product words in a file name: extension dropped, separators and camelCase split, noise removed. */
export function filenameText(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, "")
  return base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !FILENAME_NOISE.has(w.toLowerCase()))
    .join(" ")
}

const significant = (ws: string[]) => ws.filter((w) => !VARIANT_WORDS.has(w) && !/\d/.test(w))

/** 0–1: how much of this ingredient's name the text names, plus a small brand bonus. */
export function matchScore(text: string, c: MatchCandidate): number {
  const tw = words(text)
  if (tw.length === 0) return 0
  const squashed = tw.join("")
  const nameWords = significant(words(c.name))
  if (nameWords.length === 0) return 0
  const covered = nameWords.filter((w) => squashed.includes(w)).length / nameWords.length
  const brandWords = significant(words(c.brand ?? ""))
  const brandHit = brandWords.length > 0 && brandWords.every((w) => squashed.includes(w)) ? 0.1 : 0
  // A variant the text names that the ingredient lacks (or the reverse) costs a little, so
  // "Vanilla Oatmilk" ranks "Vanilla Oat Milk" above "Oat Milk" — and never ties them.
  const tv = tw.filter((w) => VARIANT_WORDS.has(w))
  const cv = words(c.name).filter((w) => VARIANT_WORDS.has(w))
  const variantMiss = tv.filter((w) => !cv.includes(w)).length + cv.filter((w) => !tv.includes(w)).length
  return Math.round((covered + brandHit - 0.05 * variantMiss) * 1000) / 1000
}

function suggest(text: string, candidates: MatchCandidate[], eligible: (c: MatchCandidate) => boolean): Suggestion {
  const scored = candidates
    .map((c) => ({ ...c, score: matchScore(text, c) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const options = scored.slice(0, 3)
  const [top, next] = scored
  const confident = top && top.score > 0.5 && (!next || top.score > next.score) && eligible(top)
  return { suggestedId: confident ? top.id : null, options }
}

/** Before reading: from the file name alone. Often nothing (IMG_4021.jpg). */
export function suggestFromFilename(fileName: string, candidates: MatchCandidate[]): Suggestion {
  return suggest(filenameText(fileName), candidates, () => true)
}

/** After reading: from the printed brand + product name; must pass the N-1c name check. */
export function suggestFromLabel(label: { brand: string; productName: string }, candidates: MatchCandidate[]): Suggestion {
  return suggest(`${label.brand} ${label.productName}`, candidates, (c) => nameWarning(label, c) === null)
}

// ─── Inbox item rules shared by the routes, the page and the fixture ─────────

export type InboxStatus = "UPLOADED" | "READ" | "FAILED" | "APPLIED" | "DISCARDED"
export const ACTIVE_INBOX: InboxStatus[] = ["UPLOADED", "READ", "FAILED"]

/** Apply needs a read AND an ADMIN-confirmed ingredient — a suggestion is never enough (N1E-F2). */
export function applyBlocker(item: { status: InboxStatus; ingredientId: string | null; readAuditId: string | null; fileUrl: string | null }): string | null {
  if (item.status === "APPLIED") return "Already applied"
  if (item.status === "DISCARDED" || !item.fileUrl) return "This file was discarded"
  if (item.status !== "READ" || !item.readAuditId) return "Read the label first"
  if (!item.ingredientId) return "Confirm which ingredient this label is for"
  return null
}

export const ABANDONED_AFTER_DAYS = 7

/** Whole days since createdAt — both UTC instants, so no zone math. */
export function ageDays(createdAt: Date, now: Date): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
}

// ─── Batch read (N1E-F3): one at a time, stop cleanly at a limit ─────────────

export type BatchStep = { ok: true } | { ok: false; limited: true; retryAt: string; error: string } | { ok: false; limited: false; error: string }
export type BatchResult = { done: string[]; failed: { id: string; error: string }[]; left: string[]; stoppedAt: { retryAt: string; error: string } | null }

/** Read `ids` sequentially. A failure is that row's alone; a rate limit stops the
 *  batch with the rest left for later ("N left — continue after …"). */
export async function runBatch(ids: string[], readOne: (id: string) => Promise<BatchStep>, onStep?: (r: BatchResult) => void): Promise<BatchResult> {
  const r: BatchResult = { done: [], failed: [], left: [...ids], stoppedAt: null }
  while (r.left.length > 0) {
    const id = r.left[0]
    const step = await readOne(id)
    if (!step.ok && step.limited) {
      r.stoppedAt = { retryAt: step.retryAt, error: step.error }
      break
    }
    r.left.shift()
    if (step.ok) r.done.push(id)
    else r.failed.push({ id, error: step.error })
    onStep?.({ ...r, left: [...r.left] })
  }
  onStep?.({ ...r, left: [...r.left] })
  return r
}
