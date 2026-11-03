import { randomUUID } from "crypto"
import { compatibleUnits } from "@/lib/units"
import { validateRecipeLines } from "@/lib/recipe-api"
import { recipeKind, type CostGraph, type GraphRecipe } from "@/lib/recipe-cost"
import type { BevLine, BevRow } from "./parse-sales-items"
import { UNIT_MARKER, mapBevSpotQty } from "./units"

// ─── BevSpot recipe import planner (BEV-1) ───────────────────────────────────
// Pure: parsed rows + the org's ingredients, sales items and recipe graph in,
// a plan out. Writes nothing. The apply route re-runs this server-side and
// writes exactly plan.toCreate.
//
// Rulings it implements (docs/DECISIONS.md, 2026-11-01 BEV-1, Gary's words):
// F3  Drop Archived/Unassigned rows first; expanded recipe beats a wrapper;
//     true conflicts skip.
// F4  Never create an empty sub-recipe.
// F5  Exact match after whitespace/case folding on name, or brand + " " +
//     name; otherwise the recipe skips.
// F6  Never overwrite. Sub-recipes from an earlier run are reused by exact
//     name.
// F7  "Modifier" = the Square id is not a Froot sales item. Negatives skip.
// F10 Prep/kit rows become sub-recipes; a wrapper line points at the target
//     sales item's recipe; if the target skips, so does the wrapper.
// F11 Ingredient wins on a name collision; disagreeing definitions skip.
// F12 Whole package/bag/tub/case/container amounts skip as SUSPECT_QTY.
// F13 `unit` / `other (1 unit)` become `each` for ingredients counted each.
// BEV-1b A row another recipe uses as a sub-recipe imports as prep even if it
//     is Archived/Unassigned or its Square id isn't a sales item; F3/F7 only
//     decide its sales-item attachment. Outside Archived/Unassigned wins;
//     two definitions left after that skip (F11).
// N-5 (N5-F4) A row whose Square id is not a sales item but IS a synced
//     Square modifier imports as that modifier's recipe, under every rule
//     above (exact match, never overwrite, conflicts skip). Negative lines are
//     allowed for these rows ONLY — a prep row or a sales row with one still
//     skips as NEGATIVE_QTY. NOT_IN_SQUARE now means "neither".
//
// A recipe is all or nothing: one unresolved line skips it, and a skipped
// sub-recipe skips everything that uses it, carrying the root cause.

export const DROPPED_GROUPS = ["Archived", "Unassigned"]

export type SkipReason =
  | "DROPPED_GROUP" // Archived / Unassigned block (F3)
  | "NO_RECIPE"
  | "PARSE_ERROR"
  | "NO_SQUARE_ID" // not a Square item and not used as a sub-recipe
  | "NOT_IN_SQUARE" // Square id is neither a Froot sales item nor a synced modifier (F7, N-5)
  | "ALREADY_HAS_RECIPE" // F6
  | "MARKED_NON_RECIPE" // sales item set to "no recipe" in Froot (F6)
  | "CONFLICT" // F3
  | "MISSING_INGREDIENT" // no ingredient or recipe by that name (F5)
  | "AMBIGUOUS_NAME" // 2+ ingredients, recipes or definitions answer to it (F11)
  | "BAD_UNIT"
  | "SUSPECT_QTY" // F12
  | "NEGATIVE_QTY" // F7
  | "LOOP"
  | "INVALID" // rejected by the shared recipe validators

export type PlanIngredient = { id: string; name: string; brand: string | null; reportingUnit: string }
export type PlanSalesItem = {
  id: string
  squareVariationId: string
  displayName: string
  recipeStatus: string
  recipeId: string | null
}

// N-5: a synced Square modifier the importer may attach a recipe to.
export type PlanModifier = {
  id: string
  squareModifierId: string
  name: string
  recipeStatus: string
  recipeId: string | null
}

export type PlanLine = {
  ingredientId: string | null
  subRecipeId: string | null
  amount: number
  unit: string
  raw: string
}

export type PlanRecipe = {
  id: string
  kind: "sales" | "sub" | "modifier"
  name: string
  salesItemId: string | null
  squareModifierId: string | null
  rowNumbers: number[]
  recipeRaw: string
  lines: PlanLine[]
}

export type PlanSkip = {
  reason: SkipReason
  label: string // what was skipped, for the owner: item or row name
  squareId: string | null
  rowNumbers: number[]
  detail: string
  recipeRaw: string[] // the BevSpot recipe text(s) involved
  names: string[] // names the owner has to act on (missing, ambiguous, bad unit, …)
}

export type ImportPlan = {
  toCreate: PlanRecipe[] // dependency order: anything referenced comes first
  skipped: PlanSkip[]
}

export type PlanInput = {
  rows: BevRow[]
  ingredients: PlanIngredient[]
  salesItems: PlanSalesItem[]
  /** N-5: synced, live Square modifiers. Absent = none (BEV-1 behaviour). */
  modifiers?: PlanModifier[]
  graph: CostGraph // the org's current recipes + ingredients, for the shared validators
  newId?: () => string
}

export function normName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

// One comparable form per recipe: lines folded and sorted, so two rows that
// differ only in spacing, case or line order are the same recipe.
function recipeKey(lines: BevLine[]): string {
  return lines
    .map((l) => `${normName(l.name)}|${l.qty}|${normName(l.unitRaw)}`)
    .sort()
    .join("\n")
}

type Failure = { reason: SkipReason; detail: string; names: string[] }

type Node = {
  key: string
  kind: "sales" | "sub" | "modifier"
  name: string
  salesItemId: string | null
  squareModifierId: string | null
  rows: BevRow[]
  lines: BevLine[]
  state: "new" | "visiting" | "ok" | "failed"
  failure: Failure | null
  id: string | null
  resolved: PlanLine[]
  deps: Set<string> // node keys this node's lines point at
}

export function planBevSpotImport(input: PlanInput): ImportPlan {
  const newId = input.newId ?? randomUUID
  const skipped: PlanSkip[] = []
  const skip = (reason: SkipReason, rows: BevRow[], detail: string, label?: string, names: string[] = []) =>
    skipped.push({
      reason,
      label: label ?? rows[0]?.name ?? "",
      squareId: rows[0]?.squareId ?? null,
      rowNumbers: rows.map((r) => r.rowNumber),
      detail,
      recipeRaw: [...new Set(rows.map((r) => r.recipeRaw).filter((r): r is string => !!r))],
      names,
    })

  // ── Lookups ────────────────────────────────────────────────────────────────
  const ingredientsByKey = new Map<string, Map<string, PlanIngredient>>()
  for (const ing of input.ingredients) {
    const keys = [normName(ing.name)]
    if (ing.brand && ing.brand.trim()) keys.push(normName(`${ing.brand} ${ing.name}`))
    for (const k of keys) {
      if (!ingredientsByKey.has(k)) ingredientsByKey.set(k, new Map())
      ingredientsByKey.get(k)!.set(ing.id, ing)
    }
  }
  const salesBySquareId = new Map(input.salesItems.map((s) => [s.squareVariationId, s]))
  const modifiersBySquareId = new Map((input.modifiers ?? []).map((m) => [m.squareModifierId, m]))
  const existingSubsByName = new Map<string, GraphRecipe[]>()
  for (const r of input.graph.recipes.values()) {
    // N-5: only prep recipes are reusable by name — never a modifier recipe.
    if (recipeKind(r) !== "prep") continue
    const k = r.name.trim()
    existingSubsByName.set(k, [...(existingSubsByName.get(k) ?? []), r])
  }

  // ── F3 step 1: drop Archived / Unassigned, then rows that can't be used ───
  const live: BevRow[] = []
  for (const row of input.rows) {
    if (DROPPED_GROUPS.includes(row.group)) skip("DROPPED_GROUP", [row], `In BevSpot's "${row.group}" group`)
    else live.push(row)
  }
  const withRecipe = live.filter((r) => r.lines !== null)
  for (const row of live) {
    if (row.parseError) skip("PARSE_ERROR", [row], row.parseError)
  }

  // Every row with a recipe defines its name, for lines that reference it.
  const defsByName = new Map<string, BevRow[]>()
  for (const row of withRecipe) {
    const k = normName(row.name)
    defsByName.set(k, [...(defsByName.get(k) ?? []), row])
  }
  // BEV-1b: prep definitions come from ALL rows, Archived and Unassigned
  // included. F3/F7 decide a row's sales-item attachment, not its use as prep.
  const allDefsByName = new Map<string, BevRow[]>()
  for (const row of input.rows) {
    if (row.lines === null) continue
    const k = normName(row.name)
    allDefsByName.set(k, [...(allDefsByName.get(k) ?? []), row])
  }

  // ── Sales-item nodes, one per Square id (F3 conflicts, F6, F7) ────────────
  const nodes = new Map<string, Node>()
  const salesSkip = new Map<string, { reason: SkipReason; detail: string }>() // why a Square id has no node
  const salesRowsBySquareId = new Map<string, BevRow[]>()
  for (const row of live) {
    if (!row.squareId) continue
    salesRowsBySquareId.set(row.squareId, [...(salesRowsBySquareId.get(row.squareId) ?? []), row])
  }
  // Wrapper: a single `(n serving)` line naming another row of the export.
  const isWrapper = (lines: BevLine[]) =>
    lines.length === 1 &&
    mapBevSpotQty(lines[0].qty, lines[0].unitRaw).ok &&
    normName(lines[0].unitRaw).startsWith("serving") &&
    defsByName.has(normName(lines[0].name))

  for (const [squareId, rows] of salesRowsBySquareId) {
    const recipeRows = rows.filter((r) => r.lines !== null)
    const sales = salesBySquareId.get(squareId)
    // N-5: a sales item wins; otherwise a synced modifier with this id.
    const modifier = sales ? undefined : modifiersBySquareId.get(squareId)
    const target = sales
      ? { kind: "sales" as const, name: sales.displayName, recipeId: sales.recipeId, recipeStatus: sales.recipeStatus }
      : modifier
        ? { kind: "modifier" as const, name: modifier.name, recipeId: modifier.recipeId, recipeStatus: modifier.recipeStatus }
        : null
    const noNode = (reason: SkipReason, detail: string, report = true) => {
      salesSkip.set(squareId, { reason, detail })
      if (report) skip(reason, rows, detail, target?.name)
    }
    if (!target) {
      noNode("NOT_IN_SQUARE", "this Square id isn't one of Froot's sales items or synced modifiers")
      continue
    }
    if (target.recipeId) {
      noNode("ALREADY_HAS_RECIPE", "it already has a recipe in Froot, left as is")
      continue
    }
    if (target.recipeStatus === "NON_RECIPE") {
      noNode("MARKED_NON_RECIPE", "it is marked \"no recipe\" in Froot, left as is")
      continue
    }
    if (!recipeRows.length) {
      noNode(rows.some((r) => r.parseError) ? "PARSE_ERROR" : "NO_RECIPE", "it has no recipe in BevSpot", !rows.some((r) => r.parseError))
      continue
    }
    const distinct = new Map<string, BevRow[]>()
    for (const r of recipeRows) {
      const k = recipeKey(r.lines!)
      distinct.set(k, [...(distinct.get(k) ?? []), r])
    }
    let chosen: BevRow[]
    if (distinct.size === 1) {
      chosen = recipeRows
    } else {
      const expanded = [...distinct.values()].filter((g) => !isWrapper(g[0].lines!))
      if (expanded.length !== 1) {
        noNode("CONFLICT", `BevSpot has ${distinct.size} different recipes for "${target.name}"`)
        continue
      }
      chosen = expanded[0]
    }
    nodes.set(`sq:${squareId}`, {
      key: `sq:${squareId}`,
      kind: target.kind,
      name: target.name,
      salesItemId: sales?.id ?? null,
      squareModifierId: modifier?.id ?? null,
      rows: chosen,
      lines: chosen[0].lines!,
      state: "new",
      failure: null,
      id: null,
      resolved: [],
      deps: new Set(),
    })
  }

  // ── Line resolution (F5, F10, F11, F12, F13) ──────────────────────────────
  // A line resolves to an ingredient, an existing Froot recipe, or a node of
  // this batch (depKey); the node's id is filled in once it has resolved.
  type Resolved = { line: PlanLine; depKey: string | null } | { failure: Failure }

  function subNodeFor(rows: BevRow[]): Node {
    const key = `sub:${normName(rows[0].name)}`
    let node = nodes.get(key)
    if (!node) {
      node = {
        key,
        kind: "sub",
        name: rows[0].name.trim(),
        salesItemId: null,
        squareModifierId: null,
        rows,
        lines: rows[0].lines!,
        state: "new",
        failure: null,
        id: null,
        resolved: [],
        deps: new Set(),
      }
      nodes.set(key, node)
    }
    return node
  }

  // allowNegative: N5-F4 — true only while resolving a modifier's own lines.
  function resolveLine(line: BevLine, allowNegative: boolean): Resolved {
    const name = line.name.trim()
    const fail = (reason: SkipReason, detail: string, names = [name]): Resolved => ({
      failure: { reason, detail, names },
    })
    if (line.qty < 0 && !allowNegative) return fail("NEGATIVE_QTY", `Negative amount: ${line.raw}`)
    // Mapped on the magnitude, so F12's whole-package check and the unit
    // reading are the same for a removal as for an addition; the sign is put
    // back on the amount.
    const sign = line.qty < 0 ? -1 : 1
    const magnitude = mapBevSpotQty(Math.abs(line.qty), line.unitRaw)
    if (!magnitude.ok) return fail("BAD_UNIT", magnitude.error)
    if (magnitude.wholePackage) return fail("SUSPECT_QTY", `Whole-package amount: ${line.raw}`)
    if (magnitude.amount <= 0) return fail("BAD_UNIT", `Zero amount: ${line.raw}`)
    const mapped = { ...magnitude, amount: sign * magnitude.amount }

    const key = normName(line.name)

    // F11: an ingredient wins.
    const ings = ingredientsByKey.get(key)
    if (ings && ings.size > 1) return fail("AMBIGUOUS_NAME", `${ings.size} ingredients match "${name}"`)
    if (ings && ings.size === 1) {
      const ing = [...ings.values()][0]
      let unit = mapped.unit
      if (unit === UNIT_MARKER) {
        if (ing.reportingUnit !== "each") {
          return fail("BAD_UNIT", `"${line.unitRaw}" only works for ingredients counted each; "${ing.name}" is counted in ${ing.reportingUnit}`)
        }
        unit = "each"
      }
      if (!compatibleUnits(ing.reportingUnit).includes(unit)) {
        return fail("BAD_UNIT", `${line.raw}: "${ing.name}" is counted in ${ing.reportingUnit}, which ${unit} can't convert to`)
      }
      return { line: { ingredientId: ing.id, subRecipeId: null, amount: mapped.amount, unit, raw: line.raw }, depKey: null }
    }

    // Not an ingredient, so a recipe. Batch recipes always yield 1 serving.
    // A line measured in anything but servings that only matches a BevSpot
    // ROW is almost always a product missing from Froot's ingredients (the
    // F11 collisions: "Kale (1 EA)" where BevSpot also sells "Kale"), so it
    // is listed as a missing ingredient, not a unit problem.
    const toRecipe = (yieldUnit: string, existingId: string | null, depKey: string | null): Resolved => {
      if (!compatibleUnits(yieldUnit).includes(mapped.unit)) {
        if (existingId === null) {
          return fail("MISSING_INGREDIENT", `No ingredient named "${name}" (BevSpot also has a "${name}" item, but this line measures it in ${mapped.unit}, not servings)`)
        }
        return fail("BAD_UNIT", `${line.raw}: "${name}" is a recipe measured in ${yieldUnit}`)
      }
      return { line: { ingredientId: null, subRecipeId: existingId, amount: mapped.amount, unit: mapped.unit, raw: line.raw }, depKey }
    }

    const defs = defsByName.get(key) ?? []
    const isFrootSalesRow = (d: BevRow) => !!d.squareId && salesBySquareId.has(d.squareId)

    if (defs.some(isFrootSalesRow)) {
      // F11: two disagreeing definitions → ambiguous. Rows that all belong to
      // ONE Square item are not: that item's own F3 resolution decides it.
      const recipes = new Set(defs.map((d) => recipeKey(d.lines!)))
      const squareIds = new Set(defs.map((d) => d.squareId).filter((s): s is string => !!s))
      const oneSalesItem = squareIds.size === 1 && defs.every((d) => d.squareId)
      if (squareIds.size > 1 || (recipes.size > 1 && !oneSalesItem)) {
        return fail("AMBIGUOUS_NAME", `BevSpot defines "${name}" more than one way`)
      }


      // F10: a wrapper points at the target sales item's recipe; if the
      // target skips, so does the wrapper.
      const sq = [...squareIds][0]
      const sales = salesBySquareId.get(sq)
      const existing = sales?.recipeId ? input.graph.recipes.get(sales.recipeId) : undefined
      if (existing) return toRecipe(existing.yieldUnit, existing.id, null)
      const target = nodes.get(`sq:${sq}`)
      if (!target) {
        const why = salesSkip.get(sq) ?? { reason: "MISSING_INGREDIENT" as SkipReason, detail: "it has no recipe that can import" }
        return fail(why.reason, `Uses "${name}", which can't import: ${why.detail}`)
      }
      return toRecipe("serving", null, target.key)
    }

    // F10 + F6 + BEV-1b: a prep/kit row, wherever it sits in the export and
    // whatever its own Square id. A Froot sub-recipe by exact name is reused
    // and never overwritten, so no second one is ever created for that name.
    const prepDefs = allDefsByName.get(key) ?? []
    const exactNames = [...new Set([name, ...prepDefs.map((d) => d.name.trim())])]
    const exact = [...new Map(exactNames.flatMap((n) => existingSubsByName.get(n) ?? []).map((r) => [r.id, r])).values()]
    if (exact.length > 1) return fail("AMBIGUOUS_NAME", `${exact.length} Froot recipes are named "${name}"`)
    if (exact.length === 1) return toRecipe(exact[0].yieldUnit, exact[0].id, null)
    // F4: not defined in the export and not in Froot → nothing, never an
    // empty sub-recipe.
    if (prepDefs.length === 0) return fail("MISSING_INGREDIENT", `No ingredient or recipe named "${name}"`)
    // Rows outside Archived/Unassigned beat rows inside; two different
    // definitions left after that are ambiguous (F11).
    const active = prepDefs.filter((d) => !DROPPED_GROUPS.includes(d.group))
    const pool = active.length ? active : prepDefs
    if (new Set(pool.map((d) => recipeKey(d.lines!))).size > 1) {
      return fail("AMBIGUOUS_NAME", `BevSpot defines "${name}" more than one way`)
    }
    return toRecipe("serving", null, subNodeFor(pool).key)
  }

  function resolveNode(node: Node): void {
    if (node.state !== "new") return
    node.state = "visiting"
    const failures: Failure[] = []
    for (const l of node.lines) {
      const r = resolveLine(l, node.kind === "modifier")
      if ("failure" in r) {
        failures.push(r.failure)
        continue
      }
      if (r.depKey) {
        const dep = nodes.get(r.depKey)!
        if (dep.state === "visiting") {
          failures.push({ reason: "LOOP", detail: `"${node.name}" and "${dep.name}" use each other`, names: [dep.name] })
          continue
        }
        resolveNode(dep)
        if (dep.state === "failed") {
          const f = dep.failure!
          failures.push({ reason: f.reason, detail: `Uses "${dep.name}": ${f.detail}`, names: f.names })
          continue
        }
        node.deps.add(dep.key)
        r.line.subRecipeId = dep.id
      }
      node.resolved.push(r.line)
    }
    if (failures.length) {
      node.state = "failed"
      node.failure = {
        reason: failures[0].reason,
        detail: failures.map((f) => f.detail).join("; "),
        names: [...new Set(failures.flatMap((f) => f.names))],
      }
    } else {
      node.state = "ok"
      node.id = newId()
    }
  }

  for (const node of [...nodes.values()]) if (node.kind !== "sub") resolveNode(node)

  // ── Shared validators over the whole batch (units + loops) ────────────────
  const graph: CostGraph = {
    recipes: new Map(input.graph.recipes),
    ingredients: input.graph.ingredients,
    preparedByRecipeId: input.graph.preparedByRecipeId,
  }
  const toGraph = (n: Node): GraphRecipe => ({
    id: n.id!,
    name: n.name,
    salesItemId: n.salesItemId,
    squareModifierId: n.squareModifierId,
    yieldQty: 1,
    yieldUnit: "serving",
    servingSizeQty: null,
    servingSizeUnit: null,
    isActive: true,
    lines: n.resolved.map((l, i) => ({
      id: `__bev_${n.id}_${i}__`,
      ingredientId: l.ingredientId,
      subRecipeId: l.subRecipeId,
      amount: l.amount,
      unit: l.unit,
      sortOrder: i,
    })),
  })
  let ok = [...nodes.values()].filter((n) => n.state === "ok")
  for (const n of ok) graph.recipes.set(n.id!, toGraph(n))
  for (;;) {
    let changed = false
    for (const n of ok) {
      const v = validateRecipeLines(graph, toGraph(n))
      if (v) {
        n.state = "failed"
        n.failure = { reason: v.loopRecipeIds ? "LOOP" : "INVALID", detail: v.error, names: [] }
        changed = true
      }
    }
    // A failed node takes down everything that uses it.
    for (const n of ok) {
      if (n.state !== "ok") continue
      const bad = [...n.deps].map((k) => nodes.get(k)!).find((d) => d.state === "failed")
      if (bad) {
        n.state = "failed"
        n.failure = { reason: bad.failure!.reason, detail: `Uses "${bad.name}": ${bad.failure!.detail}`, names: bad.failure!.names }
        changed = true
      }
    }
    if (!changed) break
    for (const n of ok) if (n.state === "failed") graph.recipes.delete(n.id!)
    ok = ok.filter((n) => n.state === "ok")
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  // F4: create a sub-recipe only when a sales recipe being created uses it.
  const needed = new Set<string>()
  const mark = (n: Node) => {
    if (needed.has(n.key)) return
    needed.add(n.key)
    for (const d of n.deps) mark(nodes.get(d)!)
  }
  for (const n of ok) if (n.kind !== "sub") mark(n)

  // Dependency order: depth-first, deps before dependents.
  const toCreate: PlanRecipe[] = []
  const placed = new Set<string>()
  const place = (n: Node) => {
    if (placed.has(n.key)) return
    placed.add(n.key)
    for (const d of n.deps) place(nodes.get(d)!)
    toCreate.push({
      id: n.id!,
      kind: n.kind,
      name: n.name,
      salesItemId: n.salesItemId,
      squareModifierId: n.squareModifierId,
      rowNumbers: n.rows.map((r) => r.rowNumber),
      recipeRaw: n.rows[0].recipeRaw ?? "",
      lines: n.resolved,
    })
  }
  for (const n of ok) if (needed.has(n.key)) place(n)

  for (const n of nodes.values()) {
    if (n.kind !== "sub" && n.state === "failed") {
      skip(n.failure!.reason, n.rows, n.failure!.detail, n.name, n.failure!.names)
    }
  }

  // Rows that are neither a Square item nor a sub-recipe something uses.
  const usedSubRows = new Set(
    [...nodes.values()].filter((n) => n.kind === "sub" && needed.has(n.key)).flatMap((n) => n.rows.map((r) => r.rowNumber))
  )
  for (const row of live) {
    if (row.squareId || row.parseError || usedSubRows.has(row.rowNumber)) continue
    const sub = nodes.get(`sub:${normName(row.name)}`)
    if (row.lines === null) skip("NO_RECIPE", [row], "No recipe and no Square id in BevSpot")
    else if (sub?.state === "failed") skip("NO_SQUARE_ID", [row], `Prep recipe can't import: ${sub.failure!.detail}`)
    else skip("NO_SQUARE_ID", [row], "Not linked to Square in BevSpot, and no imported recipe uses it")
  }

  return { toCreate, skipped }
}

export type PlanSummary = {
  ready: number
  readySubRecipes: number
  /** N-5: modifier recipes ready to create */
  readyModifiers: number
  skippedByReason: Partial<Record<SkipReason, number>>
  // Names the owner has to act on, with how many recipes each one blocks.
  actionNames: { reason: SkipReason; name: string; blocks: number }[]
}

export function summarizePlan(plan: ImportPlan): PlanSummary {
  const skippedByReason: Partial<Record<SkipReason, number>> = {}
  const tally = new Map<string, { reason: SkipReason; name: string; blocks: number }>()
  for (const s of plan.skipped) {
    skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1
    for (const name of s.names) {
      const k = `${s.reason}|${normName(name)}`
      const t = tally.get(k) ?? { reason: s.reason, name, blocks: 0 }
      t.blocks++
      tally.set(k, t)
    }
  }
  return {
    ready: plan.toCreate.filter((r) => r.kind === "sales").length,
    readySubRecipes: plan.toCreate.filter((r) => r.kind === "sub").length,
    readyModifiers: plan.toCreate.filter((r) => r.kind === "modifier").length,
    skippedByReason,
    actionNames: [...tally.values()].sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name)),
  }
}
