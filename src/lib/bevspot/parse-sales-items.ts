import * as XLSX from "xlsx"

// ─── BevSpot sales-items export parser (BEV-1) ───────────────────────────────
// Pure: bytes in, typed rows out. No DB, no I/O. Reads BevSpot's "Sales Items"
// sheet, which is a run of blocks:
//   <menu group title>                     ← only column A filled
//   Name | POS ID | Recipe | … | Menu Group ← header row
//   <item rows>
//   <blank row>
// The group comes from the block TITLE, not the Menu Group column: the
// "Unassigned" block leaves that column empty (BEV-1 audit § B1).
//
// A Recipe cell is one string, `Name (qty unit), Name (qty unit), …`. Names
// can contain commas and end in their own parentheses, and units nest
// parentheses (`1 bottle (1L)`, `0.181 container (96oz (dry))`), so lines are
// split on TOP-LEVEL commas and a piece without a trailing quantity group is
// glued to the next one. The quantity group is the last balanced top-level
// parenthetical of a line.

export const SALES_ITEMS_SHEET = "Sales Items"

export type BevLine = {
  raw: string
  name: string
  qty: number
  unitRaw: string
}

export type BevRow = {
  rowNumber: number // 1-based spreadsheet row
  group: string
  name: string
  posId: string | null
  squareId: string | null // posId when it is a 24-char Square-style id
  recipeRaw: string | null
  lines: BevLine[] | null // null when there is no recipe or it failed to parse
  parseError: string | null
}

export class BevSpotFormatError extends Error {}

const SQUARE_ID = /^[A-Z0-9]{24}$/
const QTY_GROUP = /^(-?\d*\.?\d+)\s+(.+)$/

function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === "" ? null : s
}

function isBlank(row: unknown[] | undefined): boolean {
  return !row || row.every((c) => cellText(c) === null)
}

// Splits on commas outside parentheses. Pieces keep their original text.
function splitTopLevel(s: string): string[] {
  const pieces: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "(") depth++
    else if (ch === ")") depth = Math.max(0, depth - 1)
    else if (ch === "," && depth === 0) {
      pieces.push(s.slice(start, i))
      start = i + 1
    }
  }
  pieces.push(s.slice(start))
  return pieces
}

// `Name (qty unit)` → parts, or null when the text has no trailing quantity
// group (its last parenthetical is part of the name, or there is none).
function splitTrailingQty(text: string): { name: string; qty: number; unitRaw: string } | null {
  const t = text.trim()
  if (!t.endsWith(")")) return null
  let depth = 0
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ")") depth++
    else if (t[i] === "(") {
      depth--
      if (depth === 0) {
        const inner = t.slice(i + 1, -1).trim()
        const name = t.slice(0, i).trim()
        const m = inner.match(QTY_GROUP)
        if (!m || !name) return null
        return { name, qty: Number(m[1]), unitRaw: m[2].trim() }
      }
    }
  }
  return null
}

export function parseRecipeString(recipe: string): { lines: BevLine[] } | { error: string } {
  const lines: BevLine[] = []
  let pending: string | null = null
  for (const piece of splitTopLevel(recipe)) {
    const text: string = pending === null ? piece : `${pending},${piece}`
    const parts = splitTrailingQty(text)
    if (parts) {
      lines.push({ raw: text.trim(), ...parts })
      pending = null
    } else {
      pending = text
    }
  }
  if (pending !== null && pending.trim() !== "") {
    return { error: `Couldn't find a quantity in "${pending.trim()}"` }
  }
  if (lines.length === 0) return { error: "Recipe is empty" }
  return { lines }
}

export function parseSalesItemsRows(rows: unknown[][]): BevRow[] {
  const out: BevRow[] = []
  let group: string | null = null
  let col: { name: number; pos: number; recipe: number } | null = null
  let inBlock = false

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    if (isBlank(row)) {
      inBlock = false
      continue
    }
    const first = cellText(row[0])
    if (first === "Name" && cellText(row[1]) === "POS ID") {
      const headers = row.map(cellText)
      const recipe = headers.indexOf("Recipe")
      if (recipe < 0) throw new BevSpotFormatError("The header row has no Recipe column")
      col = { name: 0, pos: 1, recipe }
      inBlock = group !== null
      continue
    }
    const filled = row.filter((c) => cellText(c) !== null).length
    if (!inBlock && filled === 1 && first !== null) {
      group = first
      continue
    }
    if (!inBlock || !col || group === null) continue

    const name = cellText(row[col.name])
    if (name === null) continue
    const posId = cellText(row[col.pos])
    const recipeRaw = cellText(row[col.recipe])
    let lines: BevLine[] | null = null
    let parseError: string | null = null
    if (recipeRaw !== null) {
      const parsed = parseRecipeString(recipeRaw)
      if ("error" in parsed) parseError = parsed.error
      else lines = parsed.lines
    }
    out.push({
      rowNumber: i + 1,
      group,
      name,
      posId,
      squareId: posId !== null && SQUARE_ID.test(posId) ? posId : null,
      recipeRaw,
      lines,
      parseError,
    })
  }

  if (col === null) {
    throw new BevSpotFormatError("This doesn't look like a BevSpot sales-items export (no Name / POS ID header row)")
  }
  return out
}

export function parseSalesItemsWorkbook(bytes: ArrayBuffer | Uint8Array): BevRow[] {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(bytes, { type: "array" })
  } catch {
    throw new BevSpotFormatError("Couldn't read that file as a spreadsheet")
  }
  const sheet = wb.Sheets[SALES_ITEMS_SHEET]
  if (!sheet) {
    throw new BevSpotFormatError(`This file has no "${SALES_ITEMS_SHEET}" sheet — export Sales Items from BevSpot`)
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true })
  return parseSalesItemsRows(rows)
}
