// ─── BevSpot units → Froot units (BEV-1) ─────────────────────────────────────
// Maps the unit text of one BevSpot recipe line onto Froot's vocabulary
// (src/lib/units.ts). Never guesses a density: `fl. oz` and `oz (dry)` stay in
// their own dimensions, and anything unrecognised is an error the planner
// lists, never a silent 0.
//
// Rulings (docs/DECISIONS.md, 2026-11-01 BEV-1):
// - F13: `g` is a Froot unit. `unit` and `other (1 unit)` come back as the
//   marker "unit"; the planner maps it to `each` when the matched ingredient is
//   counted each, and calls it a bad unit otherwise.
// - F12: one or more WHOLE package / bag / tub / case / container is flagged
//   wholePackage (the planner skips it as SUSPECT_QTY). Single-serve can and
//   bottle amounts import normally.

export const UNIT_MARKER = "unit"

export type MappedQty =
  | { ok: true; amount: number; unit: string; wholePackage: boolean }
  | { ok: false; error: string }

const SIMPLE: Record<string, string> = {
  "fl. oz": "fl. oz",
  "oz (dry)": "oz (dry)",
  "lbs": "lbs",
  "g": "g",
  "L": "L",
  "gal": "gal",
  "serving": "serving",
  "servings": "serving",
  "serving(s)": "serving",
  "EA": "each",
  "EAs": "each",
  "EA(s)": "each",
  "ea": "each",
  "unit": UNIT_MARKER,
  "units": UNIT_MARKER,
  "unit(s)": UNIT_MARKER,
}

// Package words whose size is written in the unit text. F12: whole amounts of
// the first five are suspect; can and bottle are single-serve.
const SUSPECT_PACKAGES = new Set(["package", "bag", "tub", "case", "container"])
const PACKAGES = new Set([...SUSPECT_PACKAGES, "can", "bottle"])

// `5lbs`, `18oz (dry)`, `8.4fl. oz`, `1L`, `3gal`, `1 ea`
const SIZE = /^(\d*\.?\d+)\s*(lbs|oz \(dry\)|fl\. oz|L|gal|g|ea)$/
// `24 x 8.4fl. oz (can)`, `5 x 2lbs (package)`, `4 x 6 ea (package)`
const MULTI = /^(\d*\.?\d+)\s*x\s*(.+?)\s*\(([a-z]+)\)$/

function packageWord(word: string): string | null {
  const w = word.replace(/\(s\)$/, "")
  if (PACKAGES.has(w)) return w
  if (w.endsWith("s") && PACKAGES.has(w.slice(0, -1))) return w.slice(0, -1)
  return null
}

function parseSize(text: string): { amount: number; unit: string } | null {
  const t = text.trim()
  const single = t.match(SIZE)
  if (single) return { amount: Number(single[1]), unit: SIMPLE[single[2]] ?? single[2] }
  const multi = t.match(MULTI)
  if (multi) {
    const inner = parseSize(multi[2])
    if (!inner) return null
    return { amount: Math.round(Number(multi[1]) * inner.amount * 1e6) / 1e6, unit: inner.unit }
  }
  return null
}

export function mapBevSpotQty(qty: number, unitRaw: string): MappedQty {
  const unit = unitRaw.trim().replace(/\s+/g, " ")
  const simple = SIMPLE[unit]
  if (simple) return { ok: true, amount: qty, unit: simple, wholePackage: false }

  if (unit === "other (1 unit)") return { ok: true, amount: qty, unit: UNIT_MARKER, wholePackage: false }

  // `<package word> (<size>)`
  const m = unit.match(/^([a-z]+(?:\(s\))?)\s*\((.+)\)$/)
  if (m) {
    const word = packageWord(m[1])
    const size = parseSize(m[2])
    if (word && size) {
      return {
        ok: true,
        amount: Math.round(qty * size.amount * 1e6) / 1e6,
        unit: size.unit,
        wholePackage: SUSPECT_PACKAGES.has(word) && qty >= 1,
      }
    }
  }
  return { ok: false, error: `Unknown BevSpot unit "${unitRaw}"` }
}
