import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isRestrictViolation as isForeignKeyViolation } from "@/lib/db/restrict-violation"

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

// R4. The 409 text, verbatim — the form shows `body.error` as-is. Reworded by
// Gary at the BUG-23 PRE-PUSH-CHECK (2026-11-04) so it is true for a template
// whose only reference is a calendar event, which R1 also counts as history.
export const TEMPLATE_HAS_HISTORY_MESSAGE = "This template is used by past checklists or calendar events — archive it instead."

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

// ── THE MATCHER MOVED (BUG-24, R3) ────────────────────────────────────────────
// isForeignKeyViolation now lives in src/lib/db/restrict-violation.ts as
// isRestrictViolation, with the measured 23001 note that used to sit here. It is
// re-exported under its BUG-23 name so this file's catch and
// scripts/verify-bug23.ts import it unchanged.
export { isRestrictViolation as isForeignKeyViolation } from "@/lib/db/restrict-violation"
