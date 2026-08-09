// ─── Checklist / template sections (CHK-1) ───────────────────────────────────
// ONE definition of "which heading does this task render under, and in what
// order", for every surface that renders sections. Deliberately free of Prisma
// and React imports so server components, client components and API routes can
// all use it — the src/lib/phases.ts precedent, and Prisma rows are passed in
// as plain shapes rather than imported as types.
//
// WHY THIS FILE EXISTS AT ALL. Before CHK-1 there were six sites deriving
// sections from the free-text `Task.sectionName`, each independently
// (docs/prompts/CHK-1_PLAN.md §1.2). Migrating them to the entity one at a time
// would have produced six independent *joins* instead — the same defect with a
// foreign key in it. DEBT-26's discipline: the resolution order lives here and
// nowhere else, and a comment elsewhere points at this file rather than
// restating it.
//
// THE RESOLUTION ORDER, stated once:
//   1. the checklist's frozen `sectionsSnapshot`, when one exists and the task
//      carries a `sectionId` that appears in it — the as-executed record;
//   2. the joined `Section` row — the live entity;
//   3. `Task.sectionName` — the LEGACY MIRROR, for a row whose `sectionId` is
//      null (nothing after the CHK-1 backfill should be);
//   4. "General" — a blank section, which both API choke points reject on write
//      and which the pre-CHK-1 render sites already displayed this way.
//
// A TEMPLATE render (print/template, /templates/[id]) has no checklist and
// therefore no snapshot: it passes `undefined` and starts at step 2, which is
// correct — a template print is a definition, not a record.

/** One entry of `Checklist.sectionsSnapshot`. */
export interface SectionSnapshotEntry {
  sectionId: string
  name: string
  sortOrder: number
}

/** The minimum a task must carry to be grouped. Structural, not a Prisma type. */
export interface SectionedTask {
  sectionId?: string | null
  sectionName?: string | null
  section?: { name: string; sortOrder: number } | null
}

export interface SectionGroup<T> {
  /** Stable React key: the section id, or `name:<name>` for an unmigrated row. */
  key: string
  name: string
  tasks: T[]
}

/**
 * Parse `Checklist.sectionsSnapshot` (Prisma `Json?`, so `unknown` here).
 * Returns null for absent or for anything that is not the expected shape —
 * a malformed snapshot falls back to the live join rather than throwing on a
 * print page. Never repairs or rewrites: the snapshot is frozen once.
 */
export function parseSectionsSnapshot(value: unknown): SectionSnapshotEntry[] | null {
  if (!Array.isArray(value)) return null
  const out: SectionSnapshotEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null
    const e = raw as Record<string, unknown>
    if (typeof e.sectionId !== "string" || typeof e.name !== "string") return null
    out.push({
      sectionId: e.sectionId,
      name: e.name,
      sortOrder: typeof e.sortOrder === "number" ? e.sortOrder : 0,
    })
  }
  return out.length ? out : null
}

/**
 * Group tasks into rendered sections, resolving the heading per the order at
 * the top of this file and sorting by `Section.sortOrder`.
 *
 * ONE HEADING PER SECTION — tasks that are non-contiguous in `orderIndex` land
 * in the same group, which is DEBT-36's second defect. Ties on sortOrder, and
 * every unmigrated/blank row, fall back to FIRST-APPEARANCE order, which is
 * exactly what the pre-CHK-1 `reduce`-into-a-Record sites did. Pass tasks
 * already ordered by `orderIndex` and the visible order is unchanged for every
 * template whose sections were already contiguous.
 *
 * @param snapshot raw `Checklist.sectionsSnapshot`; omit for a template render.
 */
export function groupTasksBySection<T extends SectionedTask>(
  tasks: T[],
  snapshot?: unknown
): SectionGroup<T>[] {
  const frozen = parseSectionsSnapshot(snapshot)
  const byId = frozen ? new Map(frozen.map((e) => [e.sectionId, e])) : null

  const groups = new Map<string, { group: SectionGroup<T>; sortOrder: number; seen: number }>()

  tasks.forEach((task, index) => {
    const id = task.sectionId ?? null
    const snap = id && byId ? byId.get(id) : undefined
    const name = snap?.name ?? task.section?.name ?? (task.sectionName ?? "").trim()
    const label = name || "General"
    const key = id ?? `name:${label}`
    const existing = groups.get(key)
    if (existing) {
      existing.group.tasks.push(task)
      return
    }
    groups.set(key, {
      group: { key, name: label, tasks: [task] },
      // An unmigrated row has no sortOrder of its own; `index` keeps it where
      // first appearance put it rather than sorting it to the front.
      sortOrder: snap?.sortOrder ?? task.section?.sortOrder ?? index,
      seen: index,
    })
  })

  return [...groups.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.seen - b.seen)
    .map((g) => g.group)
}
