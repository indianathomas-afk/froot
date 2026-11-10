// TAB-3 — the Display settings card picker: which cards the desktop dashboard
// and the Tablet home show, and in what order. PURE (no Prisma, no React), so
// scripts/verify-tab3-layout.ts exercises exactly the code the page, the save
// route and the two renderers run.
//
// Gary's rulings, 2026-11-10 ("yes to all" to the TAB-3 leans, then "Yes to
// all, go" to audit forks F1–F9 — docs/prompts/TAB-3_AUDIT.md):
//
//   - ONE LAYOUT PER ORG, on Organization.dashboardLayout / .tabletLayout.
//     NULL = the defaults below, so nothing changes until an ADMIN edits, and
//     "Reset to defaults" writes NULL back (so a card Froot adds later still
//     reaches a reset org at its default position).
//   - DESKTOP: every card gets a toggle and a position; cards keep their
//     widths and flow in the chosen order; nothing is locked, but at least
//     one card stays on. F6 AS REFINED BY GARY, 2026-11-10: that card must be
//     one that is never module-gated — Sales performance, Monthly goal, Team
//     messages or Shift checklist (`anchor: true` below) — so no org can save
//     a dashboard that is empty because its only card's module is off.
//   - TABLET: Tasks and Messages are locked on and fixed as the two columns,
//     Tasks left. Below them, the stat strip's optional tiles — Sales, Monthly
//     Goal, Labor % — each with a toggle and an order, all OFF by default.
//   - PERMISSIONS STILL APPLY. This module decides what an ADMIN *allowed*.
//     The renderers still ask every gate they asked before; a card turned on
//     here is never shown to someone who could not see it already.
//
// NOT IN THE REGISTRY, ON PURPOSE:
//   - The two banners above the dashboard (ComplianceBanner, CalendarDueBanner
//     — the design's "Overdue alerts"). F1: they are obligations, not content,
//     and stay pinned and un-hideable.
//   - Handoff notes ("Notes for this shift"). F2: they ride inside the
//     shift-checklist slot, stacked above it, exactly as today.
//   - The All-locations rollup. F3: untouched; only inventory-count follows
//     its toggle in both modes.

export type Surface = "dashboard" | "tablet"
export const SURFACES: readonly Surface[] = ["dashboard", "tablet"]

export type LayoutEntry = { key: string; enabled: boolean }

/** Share of a 3-unit desktop row. 3 = a full-width block, rendered bare. */
export type Span = 1 | 2 | 3

export type CardDef = {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
  /** Tablet only: forced on and pinned to the front, in registry order. */
  locked?: boolean
  /** Desktop only. */
  span?: Span
  /** Desktop only. Never module-gated, so it renders for every viewer of an
   *  assigned store. F6 (refined): a save must keep at least one of these on. */
  anchor?: boolean
  /** Settings-page hint for a card that only appears under some condition. */
  note?: string
}

// DEFAULT ORDER = TODAY'S RENDER ORDER (dashboard-client.tsx at 1487091), and
// the spans reproduce today's four rows when packed — see packRows() and the
// fixture's null-layout case. Reordering this list changes every org that has
// never saved a layout; don't, unless that is the ruling.
const DASHBOARD_CARDS: CardDef[] = [
  { key: "sales-performance", label: "Sales performance", description: "Today vs the same day last year", defaultEnabled: true, span: 2, anchor: true },
  { key: "monthly-goal", label: "Monthly goal", description: "Progress to this month's sales goal", defaultEnabled: true, span: 1, anchor: true },
  { key: "labor-coverage", label: "Labor coverage", description: "Suggested staff on the floor by hour", defaultEnabled: true, span: 2, note: "Shows only when the Labor module is on" },
  { key: "labor-budget", label: "Labor budget", description: "Schedulable hours left this week", defaultEnabled: true, span: 1, note: "Shows only when the Labor module is on" },
  { key: "team-messages", label: "Team messages", description: "Latest posts from the store feed", defaultEnabled: true, span: 1, anchor: true },
  { key: "corporate-update", label: "Corporate update", description: "Latest announcement from the office", defaultEnabled: true, span: 1, note: "Hidden while no update is active" },
  { key: "shift-checklist", label: "Shift checklist", description: "Current checklist and progress, with handoff notes above it", defaultEnabled: true, span: 1, anchor: true },
  { key: "instagram", label: "Instagram", description: "Latest posts, full width", defaultEnabled: true, span: 3, note: "Shows only when Instagram is connected and enabled" },
  { key: "inventory-count", label: "Inventory count", description: "Days since the last count, per store", defaultEnabled: true, span: 3, note: "Inventory module; managers and admins only" },
]

const TABLET_CARDS: CardDef[] = [
  { key: "tasks", label: "Daily tasks", description: "Left column · this shift's checklists", defaultEnabled: true, locked: true },
  { key: "messages", label: "Messages", description: "Right column · corporate update and team thread", defaultEnabled: true, locked: true },
  { key: "sales", label: "Sales today", description: "Today's sales vs the same day last year", defaultEnabled: false, note: "Needs a Square-linked store" },
  { key: "monthly-goal", label: "Monthly goal", description: "Progress to this month's sales goal", defaultEnabled: false },
  { key: "labor-pct", label: "Labor %", description: "Month-to-date labor vs the store's target", defaultEnabled: false, note: "Only for people who can already see labor %" },
]

export const DISPLAY_REGISTRY: Record<Surface, readonly CardDef[]> = {
  dashboard: DASHBOARD_CARDS,
  tablet: TABLET_CARDS,
}

export function cardDef(surface: Surface, key: string): CardDef | undefined {
  return DISPLAY_REGISTRY[surface].find((c) => c.key === key)
}

export function defaultLayout(surface: Surface): LayoutEntry[] {
  return DISPLAY_REGISTRY[surface].map((c) => ({ key: c.key, enabled: c.defaultEnabled }))
}

// ─── The merge rule (audit § 5) ───────────────────────────────────────────────
//
// FORGIVING ON READ. A saved layout is old data: Froot may have added or
// retired a card since it was written. So:
//   1. null / not an array → the defaults.
//   2. Saved order kept for KNOWN keys, first occurrence wins; unknown keys and
//      duplicates are dropped; a non-boolean `enabled` falls back to default.
//   3. A registry key missing from the saved list is inserted at its default
//      position — directly after the nearest preceding (default-order) key
//      already in the list, else at the start — with its default state.
//   4. Locked keys are forced on and pinned to the front in registry order.
// The output is total: every registry key for the surface, exactly once.

export function resolveLayout(surface: Surface, saved: unknown): LayoutEntry[] {
  const registry = DISPLAY_REGISTRY[surface]
  if (!Array.isArray(saved)) return defaultLayout(surface)

  const known = new Map(registry.map((c) => [c.key, c]))
  const out: LayoutEntry[] = []
  const seen = new Set<string>()
  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue
    const key = (raw as { key?: unknown }).key
    if (typeof key !== "string" || !known.has(key) || seen.has(key)) continue
    const enabled = (raw as { enabled?: unknown }).enabled
    seen.add(key)
    out.push({ key, enabled: typeof enabled === "boolean" ? enabled : known.get(key)!.defaultEnabled })
  }

  registry.forEach((card, i) => {
    if (seen.has(card.key)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex((e) => e.key === registry[j].key)
      if (idx !== -1) {
        at = idx + 1
        break
      }
    }
    out.splice(at, 0, { key: card.key, enabled: card.defaultEnabled })
    seen.add(card.key)
  })

  const locked = registry.filter((c) => c.locked).map((c) => ({ key: c.key, enabled: true }))
  if (locked.length === 0) return out
  const lockedKeys = new Set(locked.map((l) => l.key))
  return [...locked, ...out.filter((e) => !lockedKeys.has(e.key))]
}

/** The keys a renderer should consider, in order. Per-viewer gates come after. */
export function enabledKeys(surface: Surface, saved: unknown): string[] {
  return resolveLayout(surface, saved)
    .filter((e) => e.enabled)
    .map((e) => e.key)
}

/**
 * The tablet stat strip's tiles, in the saved order: the enabled tablet keys
 * minus the locked columns. Empty = the strip does not render. Per-viewer
 * gates (the tile's data being absent from the payload) still apply after.
 */
export function stripTileKeys(saved: unknown): string[] {
  const locked = new Set(TABLET_CARDS.filter((c) => c.locked).map((c) => c.key))
  return enabledKeys("tablet", saved).filter((k) => !locked.has(k))
}

// ─── Validation (audit § 6) — STRICT ON WRITE ─────────────────────────────────
//
// The merge forgives old data; the save route refuses new bad data. A body is
// `null` (reset) or the FULL list for that surface, every key exactly once
// (F5) — the page always sends the whole list, so a save never relies on the
// merge to guess. What is stored is the normalised list (locked keys pinned).

/** The four cards that are never module-gated (F6 as refined by Gary). */
export const ANCHOR_KEYS: readonly string[] = DASHBOARD_CARDS.filter((c) => c.anchor).map((c) => c.key)

export const ANCHOR_REQUIRED_ERROR =
  "Keep at least one of Sales performance, Monthly goal, Team messages or Shift checklist on."

/**
 * F6, refined by Gary 2026-11-10: "the 'at least one card on' rule counts only
 * cards that are never module-gated (sales-performance, monthly-goal,
 * team-messages, shift-checklist); a save with none of those enabled is
 * refused." Shared by the route (via validateLayout) and the page, which
 * disables Save on the same test.
 */
export function hasAnchorOn(entries: readonly LayoutEntry[]): boolean {
  return entries.some((e) => e.enabled && ANCHOR_KEYS.includes(e.key))
}

export type ValidationResult =
  | { ok: true; layout: LayoutEntry[] | null }
  | { ok: false; error: string }

export function validateLayout(surface: Surface, layout: unknown): ValidationResult {
  if (layout === null) return { ok: true, layout: null }
  if (!Array.isArray(layout)) return { ok: false, error: "Layout must be a list of cards." }

  const registry = DISPLAY_REGISTRY[surface]
  const known = new Set(registry.map((c) => c.key))
  const seen = new Set<string>()
  for (const entry of layout) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "Each card needs a key and an on/off state." }
    const { key, enabled } = entry as { key?: unknown; enabled?: unknown }
    if (typeof key !== "string" || typeof enabled !== "boolean") {
      return { ok: false, error: "Each card needs a key and an on/off state." }
    }
    if (!known.has(key)) return { ok: false, error: `Unknown card: ${key}` }
    if (seen.has(key)) return { ok: false, error: `Card listed twice: ${key}` }
    seen.add(key)
  }
  if (seen.size !== known.size) return { ok: false, error: "The layout must list every card exactly once." }

  const entries = layout as LayoutEntry[]
  if (surface === "dashboard" && !hasAnchorOn(entries)) {
    return { ok: false, error: ANCHOR_REQUIRED_ERROR }
  }
  if (surface === "tablet") {
    for (const card of registry.filter((c) => c.locked)) {
      if (!entries.find((e) => e.key === card.key)!.enabled) {
        return { ok: false, error: `${card.label} is always on in Tablet mode.` }
      }
    }
  }
  return { ok: true, layout: resolveLayout(surface, entries) }
}

/**
 * Who may save a layout. ADMIN only (ruling 1) — the role test requireAdmin()
 * applies, kept here so the fixture checks the same predicate the route runs.
 * The page's own gate is can(actor, "settings.access"), ADMIN_ONLY and held
 * out of the override grid; the route re-checks per PERM-2.
 */
export function canEditDisplayLayout(role: string | null | undefined): boolean {
  return role === "ADMIN"
}

// ─── Desktop row packing (audit § 8) ──────────────────────────────────────────
//
// WHY NOT ONE FLEX-WRAP CONTAINER: in a single container Sales (min 420px) +
// Goal (min 260px) + Coverage (min 420px) share a line on a wide screen, which
// is not today's render. So the ordered, gate-filtered cards are packed
// greedily into rows of capacity 3: a card that does not fit the row's
// remaining capacity starts a new row; a span-3 card is a bare full-width
// block of its own. Packing today's default order reproduces today's rows
// exactly — [Sales, Goal] [Coverage, Budget] [Messages, Corporate, Checklist]
// [Instagram] [Inventory count] — with or without the labor pair.
//
// Packing counts what an ADMIN enabled and the viewer may see, NOT what renders
// at runtime: Corporate Update with no active update still holds its slot and
// renders nothing, so its row reflows to 50/50 exactly as it does today.

export type PackedRow = { kind: "row"; keys: string[] } | { kind: "full"; key: string }

export function packRows(keys: string[], spanOf: (key: string) => Span): PackedRow[] {
  const rows: PackedRow[] = []
  let current: string[] = []
  let used = 0
  const flush = () => {
    if (current.length > 0) rows.push({ kind: "row", keys: current })
    current = []
    used = 0
  }
  for (const key of keys) {
    const span = spanOf(key)
    if (span === 3) {
      flush()
      rows.push({ kind: "full", key })
      continue
    }
    if (used + span > 3) flush()
    current.push(key)
    used += span
  }
  flush()
  return rows
}

export function dashboardSpan(key: string): Span {
  return cardDef("dashboard", key)?.span ?? 1
}
