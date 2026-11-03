import type { AuditLog, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { NutritionFileError, readLabelBytes } from "@/lib/nutrition-files"
import { INBOX_ENTITY, nutritionAudit, type NutritionAuditEntity } from "@/lib/nutrition-record"
import type { NutritionContext } from "@/lib/nutrition-access"
import { LABEL_READ_MODEL, LabelReadError, readLabelWithModel } from "@/lib/label-read"
import { parseLabelOutput, type LabelOutput } from "@/lib/label-review"

// ─── N-1e: THE label read, shared by the ingredient dialog and the inbox ─────
// Audit § A: one model call site, one counting rule, one set of audit actions.
// The rulings are N-1c's, unchanged — Gary, 2026-11-02: "Rate limit 30
// reads/hour and 300/day per org via audit rows; 24 h reuse of a result for the
// same file". N1E-F3 (Gary, "Accept all leans"): batch reads are sequential,
// inside those limits, and stop at a limit — no limit increase.
//
// The limit counts BOTH subjects (entityType Ingredient and the inbox). The
// N-1c query filtered entityType "Ingredient", so an inbox read logged any
// other way would have had its own second 30/300 budget (audit § A).

export const READ_HOUR_LIMIT = 30
export const READ_DAY_LIMIT = 300
export const READ_REUSE_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const READ_ENTITIES: NutritionAuditEntity[] = ["Ingredient", INBOX_ENTITY]
const COUNTED: string[] = ["nutrition.label.read", "nutrition.label.read.failed"]
export const READ_ACTIONS: string[] = ["nutrition.label.read", "nutrition.label.read.reused"]

export type ReadLimit = { message: string; retryAt: Date }

/** PURE. The limit hit by these counted reads (ms timestamps, any order), or null. */
export function readLimitFrom(times: number[], now: number): ReadLimit | null {
  const day = times.filter((t) => t >= now - DAY_MS).sort((a, b) => a - b)
  const hour = day.filter((t) => t >= now - HOUR_MS)
  const hit = hour.length >= READ_HOUR_LIMIT ? { rows: hour, span: HOUR_MS, what: `${READ_HOUR_LIMIT} label reads an hour` }
    : day.length >= READ_DAY_LIMIT ? { rows: day, span: DAY_MS, what: `${READ_DAY_LIMIT} label reads a day` }
    : null
  if (!hit) return null
  // The oldest counted read in the window ages out first.
  const retryAt = new Date(hit.rows[0] + hit.span)
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - now) / 60000))
  return { message: `Your organization has used its ${hit.what}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, retryAt }
}

/** Per-org limit, counted from the audit trail so it holds across instances. */
// `db` defaults to the app client; the fixture passes a transaction it rolls back.
export async function readLimitReached(orgId: string, now = Date.now(), db: Prisma.TransactionClient = prisma): Promise<ReadLimit | null> {
  const rows = await db.auditLog.findMany({
    where: { organizationId: orgId, entityType: { in: READ_ENTITIES }, action: { in: COUNTED }, createdAt: { gte: new Date(now - DAY_MS) } },
    select: { createdAt: true },
  })
  return readLimitFrom(rows.map((r) => r.createdAt.getTime()), now)
}

export type ReadSubject = { entityType: NutritionAuditEntity; entityId: string }
export type ReadDoc = { fileUrl: string; fileName: string | null; fileHash: string; contentType: string }
export type ReadResult = { readId: string; reused: boolean; readAt: string; model: string | null; output: LabelOutput }
export type ReadOutcome = ({ ok: true } & ReadResult) | { ok: false; status: number; error: string; retryAt?: string }

const docMeta = (d: ReadDoc) => ({ fileName: d.fileName, fileHash: d.fileHash, contentType: d.contentType })

/** Record a reuse of an earlier successful read as a `.reused` row on `subject`
 *  (never counted). Null when the prior row carries no usable output. */
export async function recordReuse(
  ctx: Pick<NutritionContext, "org" | "dbUser">,
  subject: ReadSubject,
  prior: Pick<AuditLog, "id" | "metadata" | "createdAt">,
  doc: Omit<ReadDoc, "fileUrl"> & { fileUrl?: string },
  db: Prisma.TransactionClient = prisma
): Promise<ReadResult | null> {
  const meta = prior.metadata as { output?: unknown; model?: string; readAt?: string } | null
  const parsed = meta?.output !== undefined ? parseLabelOutput(meta.output) : null
  if (!parsed?.ok) return null
  const readAt = meta?.readAt ?? prior.createdAt.toISOString()
  const row = await nutritionAudit(db, ctx, "nutrition.label.read.reused", subject.entityId, {
    fileName: doc.fileName, fileHash: doc.fileHash, contentType: doc.contentType,
    model: meta?.model ?? null, reusedFromId: prior.id, readAt, output: parsed.output,
  }, subject.entityType)
  return { readId: row.id, reused: true, readAt, model: meta?.model ?? null, output: parsed.output }
}

/** The newest successful read of this file (by hash) on these subjects within 24 h. */
export function findRecentRead(
  orgId: string,
  fileHash: string,
  where: { entityType: NutritionAuditEntity; entityId?: string }[],
  now = Date.now(),
  db: Prisma.TransactionClient = prisma
) {
  return db.auditLog.findFirst({
    where: {
      organizationId: orgId,
      OR: where,
      action: { in: READ_ACTIONS },
      createdAt: { gte: new Date(now - READ_REUSE_MS) },
      metadata: { path: ["fileHash"], equals: fileHash },
    },
    orderBy: { createdAt: "desc" },
  })
}

/** Limit check, model call, one AuditLog row for the outcome. Never reuses —
 *  callers decide reuse first. Writes no nutrition. */
export async function runLabelRead(ctx: Pick<NutritionContext, "org" | "dbUser">, subject: ReadSubject, doc: ReadDoc): Promise<ReadOutcome> {
  const limited = await readLimitReached(ctx.org.id)
  if (limited) return { ok: false, status: 429, error: limited.message, retryAt: limited.retryAt.toISOString() }

  const started = Date.now()
  try {
    const { bytes } = await readLabelBytes(doc.fileUrl)
    // The type checked against the file's first bytes at register (N-1b), not the store's header.
    const output = await readLabelWithModel(bytes, doc.contentType)
    const readAt = new Date().toISOString()
    const row = await nutritionAudit(prisma, ctx, "nutrition.label.read", subject.entityId, {
      ...docMeta(doc), model: LABEL_READ_MODEL, ok: true, durationMs: Date.now() - started, readAt, output,
    }, subject.entityType)
    return { ok: true, readId: row.id, reused: false, readAt, model: LABEL_READ_MODEL, output }
  } catch (err) {
    const known = err instanceof LabelReadError || err instanceof NutritionFileError
    if (!known) console.error("[label-read-run] read failed:", err)
    await nutritionAudit(prisma, ctx, "nutrition.label.read.failed", subject.entityId, {
      ...docMeta(doc), model: LABEL_READ_MODEL, ok: false, durationMs: Date.now() - started,
      error: err instanceof LabelReadError ? err.code : err instanceof NutritionFileError ? "storage" : "unexpected",
    }, subject.entityType)
    if (err instanceof LabelReadError) return { ok: false, status: err.status, error: err.message }
    if (err instanceof NutritionFileError) return { ok: false, status: err.status, error: err.message }
    return { ok: false, status: 500, error: "Reading the label failed. Try again." }
  }
}
