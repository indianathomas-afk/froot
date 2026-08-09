import type { Prisma } from "@prisma/client"

// CHK-1. The one place a template's sections are written — the
// `template-type.ts` precedent, one layer down and per-template rather than
// per-org. POST /api/templates, PATCH /api/templates/[id] and
// POST /api/templates/import all funnel through `syncTemplateSections`, so
// "resolve by name, rename by id, create what is missing" has exactly one
// implementation and the three routes cannot drift apart.
//
// READ SIDE IS SOMEWHERE ELSE ON PURPOSE: src/lib/sections.ts owns the render
// order and the snapshot fallback. This file owns the write.

/** A section as the client describes it. `id` present ⇒ it is an existing row. */
export interface IncomingSection {
  id?: string | null
  name: string
  sortOrder?: number
}

/** The task shape this module needs. Structural — not a Prisma type. */
export interface SectionedTaskInput {
  sectionName?: string | null
  orderIndex?: number | null
}

/**
 * Derive the section list from the tasks alone, for a caller that sends no
 * explicit `sections` array — the Duplicate button (templates-client.tsx), the
 * CSV import, and any older client. ORDER IS RECOVERED FROM THE DATA, exactly
 * the migration's rule: a section's position is its smallest `orderIndex`.
 * Ties (and tasks with no orderIndex) fall back to first appearance.
 */
export function sectionsFromTasks(tasks: SectionedTaskInput[]): IncomingSection[] {
  const seen = new Map<string, { order: number; seen: number }>()
  tasks.forEach((t, i) => {
    const name = (t.sectionName ?? "").trim()
    if (!name) return
    const order = typeof t.orderIndex === "number" ? t.orderIndex : i
    const existing = seen.get(name)
    if (!existing) seen.set(name, { order, seen: i })
    else if (order < existing.order) existing.order = order
  })
  return [...seen.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].seen - b[1].seen)
    .map(([name], i) => ({ name, sortOrder: i }))
}

export type SectionSyncResult =
  | { ok: true; byName: Map<string, string> }
  | { ok: false; error: string }

/**
 * Thrown to abort the caller's transaction on a section-name conflict, and
 * caught at the route boundary to become a 400 that names the section.
 * A conflict is an operator mistake with an actionable message, not a 500 —
 * the same shape as the `operationalPhase` and `typeId` rejections beside it.
 */
export class SectionConflict extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SectionConflict"
  }
}

/**
 * Bring a template's `Section` rows in line with what the client sent, inside
 * the caller's transaction. Returns trimmed-name → section id, which the caller
 * uses to stamp `sectionId` on every task (and `sectionName` alongside it — the
 * legacy mirror stays written, per TPL-1a's shape).
 *
 * A RENAME IS A RENAME, and that is the whole reason this takes ids rather than
 * just names. An incoming section carrying an `id` UPDATES that row's name, so
 * every task pointing at it follows for free and every TaskLog keeps pointing
 * at the same section — which is what makes the frozen `sectionsSnapshot` the
 * only thing history depends on. Resolving purely by name would instead create
 * a second row and strand the first, which is the pre-CHK-1 behaviour with a
 * foreign key bolted on.
 *
 * Ids are scoped to `templateId` on every lookup: an id from another template —
 * or another tenant — resolves to nothing and is treated as a new section by
 * name, never as a cross-template write.
 *
 * DOES NOT DELETE. Emptied sections are pruned by `pruneEmptySections` AFTER
 * the caller has finished moving tasks; running it here would see every task
 * still attached to its old section and prune nothing.
 */
export async function syncTemplateSections(
  tx: Prisma.TransactionClient,
  templateId: string,
  incoming: IncomingSection[]
): Promise<SectionSyncResult> {
  // Normalise: trim, drop blanks, and reject two entries claiming one name.
  // Caught here rather than left to the @@unique constraint, so the operator
  // gets the name back instead of a 500 — renaming "Prep" to "Closing" when
  // "Closing" already exists is a real thing to do by accident.
  const wanted: IncomingSection[] = []
  const claimed = new Set<string>()
  for (const s of incoming) {
    const name = (s.name ?? "").trim()
    if (!name) continue
    if (claimed.has(name)) {
      return { ok: false, error: `Two sections are both named "${name}" — section names must be unique within a template.` }
    }
    claimed.add(name)
    wanted.push({ id: s.id ?? null, name, sortOrder: wanted.length })
  }

  const current = await tx.section.findMany({
    where: { templateId },
    select: { id: true, name: true },
  })
  const currentById = new Map(current.map((s) => [s.id, s]))
  const currentByName = new Map(current.map((s) => [s.name, s]))

  const byName = new Map<string, string>()

  for (let i = 0; i < wanted.length; i++) {
    const s = wanted[i]
    const existingById = s.id ? currentById.get(s.id) : undefined

    if (existingById) {
      // Rename and/or reorder in place. The id — and therefore every task and
      // every TaskLog pointing at it — is untouched.
      const collision = currentByName.get(s.name)
      if (collision && collision.id !== existingById.id) {
        return { ok: false, error: `A section named "${s.name}" already exists in this template.` }
      }
      await tx.section.update({ where: { id: existingById.id }, data: { name: s.name, sortOrder: i } })
      byName.set(s.name, existingById.id)
      continue
    }

    const existingByName = currentByName.get(s.name)
    if (existingByName) {
      await tx.section.update({ where: { id: existingByName.id }, data: { sortOrder: i } })
      byName.set(s.name, existingByName.id)
      continue
    }

    const created = await tx.section.create({
      data: { templateId, name: s.name, sortOrder: i },
      select: { id: true },
    })
    byName.set(s.name, created.id)
  }

  return { ok: true, byName }
}

/**
 * Delete this template's sections that hold no tasks AND that no `TaskLog`
 * references. Call it at the END of the caller's transaction, after tasks have
 * been created, updated and deleted.
 *
 * The TaskLog guard is not belt-and-braces: the FK is RESTRICT, so a referenced
 * section could not be deleted anyway, and checking first turns a 500 into a
 * section that quietly survives — which is the correct outcome (history stays
 * resolvable) rather than a failed save the operator cannot act on.
 */
export async function pruneEmptySections(tx: Prisma.TransactionClient, templateId: string): Promise<void> {
  const sections = await tx.section.findMany({ where: { templateId }, select: { id: true } })
  if (!sections.length) return
  const ids = sections.map((s) => s.id)

  const holding = new Set(
    (await tx.task.findMany({ where: { sectionId: { in: ids } }, select: { sectionId: true }, distinct: ["sectionId"] }))
      .map((t) => t.sectionId)
      .filter((v): v is string => !!v)
  )
  const referenced = new Set(
    (await tx.taskLog.findMany({ where: { sectionId: { in: ids } }, select: { sectionId: true }, distinct: ["sectionId"] }))
      .map((l) => l.sectionId)
      .filter((v): v is string => !!v)
  )

  const deletable = ids.filter((id) => !holding.has(id) && !referenced.has(id))
  if (deletable.length) {
    await tx.section.deleteMany({ where: { id: { in: deletable }, templateId } })
  }
}
