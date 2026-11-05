import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// ── BUG-23 — A TEMPLATE WITH HISTORY CANNOT BE DELETED, ONLY ARCHIVED ──────────
//
// R1 (draft, Gary ratifies at PRE-PUSH-CHECK): a template "has history" if
// ANYTHING RESTRICT-REFERENCES IT OR ITS TASKS. Before this file DELETE
// /api/templates/[id] called prisma.template.delete with no pre-check and no
// catch, so any template that had ever generated a checklist threw P2003 and
// came back a bare 500 — every retry the same.
//
// THE FK CENSUS, READ FROM THE MIGRATION SQL (not the schema's annotations —
// an unannotated required relation is RESTRICT only because Prisma defaults it
// so). Every FK that points at Template, at Task, or at Section (which cascades
// off Template), as of BUG-23:
//
//   RESTRICT  Checklist.templateId          → Template   (init)
//   RESTRICT  CalendarEvent.templateId      → Template   (cal2)
//   RESTRICT  TaskLog.taskId                → Task       (init)
//   RESTRICT  TaskLog.sectionId             → Section    (chk1)
//   RESTRICT  Task.sectionId                → Section    (chk1) — INTRA-template:
//             both rows cascade off the same Template delete, so it never blocks
//   CASCADE   Task.templateId, Section.templateId, TemplateStoreAssignment.templateId
//   CASCADE   TaskAttachment.taskId (schema annotation; see note below)
//   SET NULL  TeamMessage.postedToTemplateId (handoff note target)
//
// The four RESTRICT paths that reach OUTSIDE the template are the four checks
// below. ADD A CHECK HERE WHEN YOU ADD A RESTRICT FK TO ANY OF THESE TABLES —
// the FK-violation catch in deleteTemplateUnlessHistory() turns a missed one into a
// 409 rather than a 500, but the edit page would still offer Delete for it.
//
// NOTE: TaskAttachment appears in NO migration file — the table predates the
// migration baseline. Its Cascade comes from the schema annotation, unverified
// against SQL. It cannot block a delete either way that matters here: a
// Cascade deletes it, and a Restrict would surface as an FK violation → 409.
//
// One cheap `exists`-style read per path (findFirst + select id), in parallel.
export async function templateHasHistory(
  templateId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const [checklist, calendarEvent, logByTask, logBySection] = await Promise.all([
    db.checklist.findFirst({ where: { templateId }, select: { id: true } }),
    db.calendarEvent.findFirst({ where: { templateId }, select: { id: true } }),
    // Retired tasks included on purpose — a retired task exists precisely
    // BECAUSE it has TaskLog history (TPL-3), so filtering retiredAt here would
    // skip the one case this path is for.
    db.taskLog.findFirst({ where: { task: { templateId } }, select: { id: true } }),
    db.taskLog.findFirst({ where: { section: { templateId } }, select: { id: true } }),
  ])
  return !!(checklist || calendarEvent || logByTask || logBySection)
}

// R4. The 409 text, verbatim — the form shows `body.error` as-is.
export const TEMPLATE_HAS_HISTORY_MESSAGE = "This template has checklist history — archive it instead."

export type DeleteTemplateResult = { ok: true } | { ok: false; reason: "history" }

// R3 + R4. Hard-deletes a template with no history; refuses one with history.
// The ROUTE is the gate, not the button: a stale tab or a direct call lands
// here too. The FK-violation catch is the backstop for an FK the census above missed,
// or a checklist generated between the check and the delete — either way the
// answer is the same 409, never a 500. Anything else rethrows.
//
// Delete NEVER quietly archives (R2). Archive is its own PATCH.
export async function deleteTemplateUnlessHistory(templateId: string): Promise<DeleteTemplateResult> {
  if (await templateHasHistory(templateId)) return { ok: false, reason: "history" }
  try {
    await prisma.template.delete({ where: { id: templateId } })
    return { ok: true }
  } catch (err) {
    if (isForeignKeyViolation(err)) return { ok: false, reason: "history" }
    throw err
  }
}

// ── P2003 ALONE DOES NOT CATCH THIS. MEASURED, NOT ASSUMED ─────────────────────
// Every FK in the census above is ON DELETE RESTRICT, and Postgres reports a
// RESTRICT violation as SQLSTATE 23001 (restrict_violation), NOT 23503
// (foreign_key_violation). Under @prisma/adapter-neon the 23001 is NOT mapped
// to a P2003 PrismaClientKnownRequestError: it arrives as a `DriverAdapterError`
// with `cause: { kind: "postgres", code: "23001" }` and no `.code` of its own.
// Observed on dev br-broad-wave-a6vpjdw0, 2026-11-04, by scripts/verify-bug23.ts
// (B5), which was written to expect P2003 and failed. A catch keyed on P2003
// would have let the exact BUG-23 failure through as a 500.
//
// So: the Prisma code (for a NO ACTION FK the adapter does map) OR either raw
// SQLSTATE on the adapter's cause.
export function isForeignKeyViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return true
  const cause = (err as { cause?: { kind?: unknown; code?: unknown } } | null)?.cause
  return cause?.kind === "postgres" && (cause.code === "23001" || cause.code === "23503")
}
