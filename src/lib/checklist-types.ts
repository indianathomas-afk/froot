import { Briefcase, ClipboardCheck, Moon, Sparkles, Sun, Sunrise, type LucideIcon } from "lucide-react"

// TAB-13 — THE CHECKLIST TYPE KEY: one colour and one icon per checklist type,
// used the same way wherever a checklist's type is drawn. Design source: the
// "Checklist type key" board of the "Froot Tablet — Checklists" PDF. First
// reader: the tablet Home switcher (src/app/(app)/dashboard/
// tablet-checklist-switcher.tsx). The Checklists-page phase reuses this module
// as is — it is the reason this lives in src/lib and not next to the tablet.
//
// WHAT IT IS KEYED ON (R4 + RN-2, Gary 2026-11-11). The structured field is
// Template.typeId → TemplateType, but TemplateType is PER ORG and renameable:
// its only identity is its name. So the match is on the TemplateType NAME,
// case-insensitive and ignoring everything but letters ("Mid-Shift",
// "Mid Shift" and "MIDSHIFT" are one key), never on the template's own display
// name. Aliases: "Closer" (the starter type's name, src/lib/template-types.ts)
// reads as Closing. Anything else falls back to OTHER — grey, clipboard-check.
//
// KNOWN GAP (logged as a DEBT row by TAB-13): TemplateType also carries an
// ADMIN-CHOSEN colorKey (/templates → Manage types), and this map ignores it,
// so the tablet and the /templates badge can disagree (starter Mid-Shift is
// blue there, orange here). Reconcile before multi-tenant.
//
// LITERAL CLASS STRINGS ONLY. Tailwind 4 generates a utility only when it sees
// the whole class name in source (src/lib/badge-presets.ts:1-11 says why), so
// every class below is written out in full and nothing is ever interpolated.
// Colours are tokens only: --color-primary / --color-cal-* from globals.css,
// and Tailwind's own amber / slate scale. No hex.

export type ChecklistTypeKey = "opener" | "midshift" | "cleaning" | "closing" | "management" | "other"

export interface ChecklistTypeStyle {
  key: ChecklistTypeKey
  Icon: LucideIcon
  /** The type's fill, as a background. */
  fill: string
  /** Text/icon colour on that fill. */
  ink: string
  /** A soft square behind the icon when the icon sits ON the fill. */
  onFillChip: string
  /** Progress bar on the fill: the track and the done part. */
  onFillTrack: string
  onFillBar: string
  /** The type's colour as text on a white/card chip (the hero's Due chip). */
  chipText: string
}

const WHITE_ON_FILL = {
  ink: "text-white",
  onFillChip: "bg-white/20",
  onFillTrack: "bg-white/30",
  onFillBar: "bg-white",
} as const

export const CHECKLIST_TYPE_STYLES: Record<ChecklistTypeKey, ChecklistTypeStyle> = {
  opener: {
    key: "opener",
    Icon: Sunrise,
    fill: "bg-amber-400",
    ink: "text-amber-950",
    onFillChip: "bg-amber-950/10",
    onFillTrack: "bg-amber-950/15",
    onFillBar: "bg-amber-950",
    chipText: "text-amber-950",
  },
  midshift: { key: "midshift", Icon: Sun, fill: "bg-[var(--color-primary)]", ...WHITE_ON_FILL, chipText: "text-[var(--color-primary)]" },
  cleaning: {
    key: "cleaning",
    Icon: Sparkles,
    fill: "bg-[var(--color-cal-cleaning)]",
    ...WHITE_ON_FILL,
    chipText: "text-[var(--color-cal-cleaning)]",
  },
  closing: {
    key: "closing",
    Icon: Moon,
    fill: "bg-[var(--color-cal-ordering)]",
    ...WHITE_ON_FILL,
    chipText: "text-[var(--color-cal-ordering)]",
  },
  management: { key: "management", Icon: Briefcase, fill: "bg-slate-800", ...WHITE_ON_FILL, chipText: "text-slate-800" },
  other: {
    key: "other",
    Icon: ClipboardCheck,
    fill: "bg-[var(--color-cal-other)]",
    ...WHITE_ON_FILL,
    chipText: "text-[var(--color-cal-other)]",
  },
}

/** Letters only, lower case: "Mid-Shift" → "midshift". */
export function normalizeTypeName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z]/g, "")
}

const BY_NAME: Record<string, ChecklistTypeKey> = {
  opener: "opener",
  midshift: "midshift",
  cleaning: "cleaning",
  closing: "closing",
  closer: "closing", // the starter TemplateType's name (src/lib/template-types.ts)
  management: "management",
}

export function checklistTypeKey(typeName: string | null | undefined): ChecklistTypeKey {
  return BY_NAME[normalizeTypeName(typeName)] ?? "other"
}

export function checklistTypeStyle(typeName: string | null | undefined): ChecklistTypeStyle {
  return CHECKLIST_TYPE_STYLES[checklistTypeKey(typeName)]
}
