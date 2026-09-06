import { prisma } from "@/lib/prisma"
import { searchIndex, type HelpScope } from "@/lib/help-access"
import {
  STORE_LIBRARY_WHERE,
  canReadTrainingModule,
  managerLibraryWhere,
} from "@/lib/training"

// SEARCH-1 — the global search bar's ONE assembly point.
//
// TWO SOURCES, AND THE COUNT IS THE GUARANTEE. Training content and help
// articles. The "Go to" nav group named in the SEARCH-1 prompt was DROPPED by
// Gary on 2026-09-06 rather than built: the sidebar's item array and its
// isVisible() filter live inside a "use client" module and isVisible() is a
// closure over component props, so neither is reachable from a route handler.
// The alternatives were to lift the array into src/lib — which breaks the
// parser in scripts/verify-nav1-url-sets.ts, itself a SEARCH-1 done criterion —
// or to write a third copy of the nav filter. Both were refused. The lift is
// filed as DEBT-91 and the "Go to" group is blocked on it.
//
// WHAT THIS FILE GUARANTEES, AT THE STRENGTH THE EVIDENCE ACTUALLY HAS. This
// file does not itself name any forbidden source, and the training query
// selects a fixed set of columns. That is what is proven. REACHABILITY THROUGH
// AN IMPORTED MODULE IS NOT PROVEN — lib/training.ts, imported below, reaches
// the assignment table inside recalcAssignmentStatus, a function nothing here
// calls. (The model name is deliberately not written out: it is on the grep's
// own list and this comment would trip it. That is the check working, and it
// is why the list lives in the script.) See DEBT-93.
//
// An earlier draft of this comment, and ba3d1e5's commit message, said search
// "never queries the tables they live in". That was stronger than anything
// measured it. The wording is corrected here; the commit message is not
// amended and stays wrong on the record.
//
// There is deliberately NO BLOCKLIST here: a blocklist would imply the query
// could reach those tables and must be talked out of it.
//
// scripts/verify-search-scope.ts GREPS THIS FILE against a list of forbidden
// model and relation names — personal data, training records, and the lesson
// document relation the preview page suppresses for STORE. That list lives in
// the script and is deliberately NOT repeated here: naming those identifiers in
// a comment would trip the grep, and a check that its own subject can defeat by
// mentioning it is not a check. Do not add a third source to round it out.

export type SearchGroupKey = "training" | "help"

/** Result rows carry this and nothing else — no entity bodies, no counts, no status. */
export type SearchRow = {
  group: SearchGroupKey
  id: string
  title: string
  subtitle: string
  href: string
  // HELP-1's ruling-2 module-preview flag, carried through so a preview article
  // does not read as a broken link.
  //
  // REQUIRED, NOT OPTIONAL, AND EVERY ROW SETS IT. The SEARCH-1 prompt marked
  // it `preview?`, which made a training row a five-key object and a help row a
  // six-key one — two shapes for one type, and a shape assertion that could
  // only ever be a subset check. Gary, 2026-09-06, ruled the assertion "count
  // and membership, not a subset check", and one uniform shape is what makes
  // that expressible. A training module has no module-preview concept, so it
  // answers false explicitly rather than by omission — the HR-25 required-prop
  // pattern, where each producer answers the question instead of inheriting a
  // default.
  preview: boolean
}

export type SearchGroup = { group: SearchGroupKey; rows: SearchRow[] }

/** Below this, return empty groups rather than an error. */
export const MIN_QUERY_LENGTH = 2
export const ROWS_PER_GROUP = 5
export const ROWS_TOTAL = 15

/**
 * The training gate's answer, resolved by the caller through
 * requireHrTrainingReadAccess() so the role question is ASKED where the page
 * asks it rather than retyped here. `null` means the gate refused — no HR in
 * this environment, module off for the org, or a role outside the read tier —
 * and the training group comes back empty.
 */
export type TrainingSearchAccess = {
  orgDbId: string
  role: string
  storeIds: string[]
} | null

export function normalizeQuery(query: string): string {
  return query.trim()
}

export function isSearchable(query: string): boolean {
  return normalizeQuery(query).length >= MIN_QUERY_LENGTH
}

/**
 * The library filter per role, delegated to lib/training rather than rebuilt.
 *
 * STORE IS NOT STORE-SCOPED AND THAT IS NOT AN OVERSIGHT — ruling R-h option
 * (i), Gary 2026-08-11, recorded in lib/training.ts. STORE reads the whole
 * org's live library; MANAGER is narrower, filtered by appliesTo and its own
 * stores, which preserves what HR-17 settled. ADMIN reaches drafts and archives
 * because it owns the builder. Search reuses these fragments so a row it offers
 * and the page behind it can never disagree about what may be opened.
 */
export function trainingLibraryWhere(role: string, storeIds: string[]) {
  if (role === "ADMIN") return {}
  if (role === "MANAGER") return managerLibraryWhere(storeIds)
  return STORE_LIBRARY_WHERE
}

/** The shape trainingRows() needs — deliberately narrower than the Prisma model. */
export type SearchableTrainingModule = {
  id: string
  title: string
  subject: string | null
  description: string | null
  organizationId: string
  isActive: boolean
  isArchived: boolean
  appliesTo: string
  storeAssignments: { storeId: string }[]
  lessons: { id: string; title: string }[]
}

/**
 * PURE. Maps fetched modules to rows and re-asks the policy function per module,
 * the same belt-and-braces the preview page uses at its line 128: the WHERE
 * above is the rule as a query, canReadTrainingModule is the rule itself, and a
 * module must pass both. Kept pure so verify-search-scope.ts can drive it with
 * fixtures and no database.
 *
 * A LESSON HIT ROLLS UP TO ITS MODULE. The result is always the module — there
 * is no lesson-level route in the tree to point at (every training page route
 * was enumerated in this phase's audit) — and the matched lesson's title
 * becomes the subtitle so the reader can see why the row matched.
 */
export function trainingRows(
  modules: SearchableTrainingModule[],
  viewer: { orgDbId: string; role: string; storeIds: string[] }
): SearchRow[] {
  return modules
    .filter((m) => canReadTrainingModule(m, viewer))
    .map((m) => ({
      group: "training" as const,
      id: m.id,
      title: m.title,
      subtitle: m.lessons[0] ? `Lesson: ${m.lessons[0].title}` : (m.subject ?? m.description ?? "Training"),
      href: `/hr/training/${m.id}/preview`,
      // Never a module preview — that flag is HELP-1's, about an article for an
      // unbought module. Answered rather than omitted; see the type.
      preview: false,
    }))
}

/**
 * PURE. Help rows come from searchIndex(scope), never from GUIDE_ARTICLES, and
 * are not filtered here beyond the text match.
 *
 * DECISIONS.md ruling 4 of 2026-09-04 — ONE PLACE DECIDES WHO SEES WHAT. The
 * scope handed in has already dropped articles this reader may not see and
 * section headings they may not read. Reading the articles directly, or adding
 * an audience test here, would be a second door around HELP-1's section ruling:
 * the precedent is the `routes` field, which shipped /inventory/ingredients/deleted
 * to STORE readers and was caught by verify-help-access.ts rather than by review.
 */
export function helpRows(scope: HelpScope, query: string): SearchRow[] {
  const q = normalizeQuery(query).toLowerCase()
  return searchIndex(scope)
    .filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.keywords.some((k) => k.toLowerCase().includes(q))
    )
    .map((r) => ({
      group: "help" as const,
      id: r.id,
      title: r.title,
      subtitle: r.summary,
      href: r.entry,
      preview: r.preview,
    }))
}

/**
 * IMPURE. The only database read in this file.
 *
 * SELECTS NOTHING IT DOES NOT NEED, on purpose. Assignment, progress, quiz and
 * certification fields are not merely filtered out of the response — they are
 * never selected, so a later refactor of the row mapping cannot surface one.
 * The lesson's linked-document relation is absent for the same reason: the
 * preview page serves it to neither STORE nor a search result, and search must
 * not reintroduce what that page suppresses.
 */
async function fetchTrainingModules(
  access: NonNullable<TrainingSearchAccess>,
  query: string
): Promise<SearchableTrainingModule[]> {
  const q = normalizeQuery(query)
  const contains = { contains: q, mode: "insensitive" as const }

  return prisma.trainingModule.findMany({
    where: {
      organizationId: access.orgDbId,
      ...trainingLibraryWhere(access.role, access.storeIds),
      OR: [
        { title: contains },
        { subject: contains },
        { description: contains },
        { lessons: { some: { title: contains } } },
      ],
    },
    select: {
      id: true,
      title: true,
      subject: true,
      description: true,
      organizationId: true,
      isActive: true,
      isArchived: true,
      appliesTo: true,
      storeAssignments: { select: { storeId: true } },
      // Only the lesson that matched, for the subtitle. Nothing else about it.
      lessons: {
        where: { title: contains },
        select: { id: true, title: true },
        orderBy: { orderIndex: "asc" },
        take: 1,
      },
    },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    take: ROWS_PER_GROUP,
  })
}

/**
 * The one function that assembles the sources. Groups come back in render
 * order — Training, then Help — with empty groups included so the caller can
 * decide whether to omit them.
 */
export async function searchAll(
  training: TrainingSearchAccess,
  helpScope: HelpScope,
  query: string
): Promise<SearchGroup[]> {
  if (!isSearchable(query)) {
    return [
      { group: "training", rows: [] },
      { group: "help", rows: [] },
    ]
  }

  const trainingResults = training
    ? trainingRows(await fetchTrainingModules(training, query), {
        orgDbId: training.orgDbId,
        role: training.role,
        storeIds: training.storeIds,
      })
    : []

  const groups: SearchGroup[] = [
    { group: "training", rows: trainingResults.slice(0, ROWS_PER_GROUP) },
    { group: "help", rows: helpRows(helpScope, query).slice(0, ROWS_PER_GROUP) },
  ]

  // Total cap applied across groups in render order.
  let budget = ROWS_TOTAL
  for (const g of groups) {
    g.rows = g.rows.slice(0, Math.max(0, budget))
    budget -= g.rows.length
  }
  return groups
}
