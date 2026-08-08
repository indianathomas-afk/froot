// TPL-1a — the colour palette a TemplateType may carry.
//
// WHY A KEY AND NOT A CLASS STRING. This repo runs Tailwind CSS 4 CSS-first:
// src/app/globals.css:1 is `@import "tailwindcss"`, there is no
// tailwind.config.* anywhere, and there is no safelist. Tailwind generates
// utilities by scanning source text for literal class names, so a class string
// read out of the database is never generated and renders unstyled. Every class
// below is therefore written out literally, in this file, and the database
// stores only the KEY. Do not build these strings by interpolation — a
// `bg-${key}-100` would defeat the scanner exactly the same way.
// See docs/prompts/TYPE-1_AUDIT.md §7.
//
// The palette is the seven distinct colours the hardcoded TYPE_COLORS map used
// (templates-client.tsx:12-22) plus the neutral it fell back to. `yellow` is
// absent deliberately: it styled only the orphaned "Audit" key, which no write
// path has ever produced and which Gary ruled out of the seed on 2026-08-08
// (Q1). Adding a colour here is additive and safe; the DB column is free text
// with a 'gray' default, and unknownPreset() below is what makes that survivable.

export const BADGE_PRESETS = {
  gray: { label: "Grey", badge: "bg-gray-100 text-gray-700 border-gray-200", dot: "bg-gray-400" },
  orange: { label: "Orange", badge: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-400" },
  amber: { label: "Amber", badge: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-400" },
  green: { label: "Green", badge: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-400" },
  blue: { label: "Blue", badge: "bg-blue-100 text-blue-700 border-blue-200", dot: "bg-blue-400" },
  purple: { label: "Purple", badge: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-400" },
  pink: { label: "Pink", badge: "bg-pink-100 text-pink-700 border-pink-200", dot: "bg-pink-400" },
  red: { label: "Red", badge: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-400" },
} as const

export type BadgePresetKey = keyof typeof BADGE_PRESETS

export const BADGE_PRESET_KEYS = Object.keys(BADGE_PRESETS) as BadgePresetKey[]

export function isBadgePresetKey(v: unknown): v is BadgePresetKey {
  return typeof v === "string" && v in BADGE_PRESETS
}

// Deny-by-default in the cosmetic direction: an unrecognised key renders
// neutral rather than throwing or rendering nothing. This is the same tolerance
// TypeBadge already has for unknown type strings, kept so a colour added to the
// database ahead of a deploy cannot break the page.
export function badgePreset(key: string | null | undefined) {
  return isBadgePresetKey(key) ? BADGE_PRESETS[key] : BADGE_PRESETS.gray
}
