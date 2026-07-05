type Dimension = "weight" | "volume" | "count"

// toBase = how many of the dimension's base unit one unit equals
// (weight base = "oz (dry)", volume base = "fl. oz"). Count units never
// cross-convert, even to each other ("each" vs "serving" are unrelated).
const UNIT_INFO: Record<string, { dimension: Dimension; toBase: number }> = {
  "oz (dry)": { dimension: "weight", toBase: 1 },
  "lbs": { dimension: "weight", toBase: 16 },
  "fl. oz": { dimension: "volume", toBase: 1 },
  "gal": { dimension: "volume", toBase: 128 },
  "L": { dimension: "volume", toBase: 33.814 },
  "qt": { dimension: "volume", toBase: 32 },
  "pt": { dimension: "volume", toBase: 16 },
  "cup": { dimension: "volume", toBase: 8 },
  "each": { dimension: "count", toBase: 1 },
  "serving": { dimension: "count", toBase: 1 },
}

export const ALL_UNITS = Object.keys(UNIT_INFO)

export function unitDimension(unit: string): Dimension | null {
  return UNIT_INFO[unit]?.dimension ?? null
}

// Units another unit is allowed to convert to (itself always included).
export function compatibleUnits(unit: string): string[] {
  const info = UNIT_INFO[unit]
  if (!info) return [unit]
  if (info.dimension === "count") return [unit]
  return ALL_UNITS.filter((u) => UNIT_INFO[u].dimension === info.dimension)
}

// Returns null when fromUnit/toUnit are different dimensions (or unknown) —
// callers must surface that as a validation error, never fall back to 0.
export function convert(amount: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return amount
  const from = UNIT_INFO[fromUnit]
  const to = UNIT_INFO[toUnit]
  if (!from || !to) return null
  if (from.dimension !== to.dimension) return null
  if (from.dimension === "count") return null
  return (amount * from.toBase) / to.toBase
}

// Cost of one `unit` of an ingredient, derived from its cost per reporting unit.
export function costPerUnit(
  ingredient: { purchaseCost: number; unitsPerPurchase: number; reportingUnit: string },
  unit: string
): number | null {
  const costPerReportingUnit = ingredient.purchaseCost / ingredient.unitsPerPurchase
  if (unit === ingredient.reportingUnit) return costPerReportingUnit
  const perUnitInReportingUnit = convert(1, unit, ingredient.reportingUnit)
  if (perUnitInReportingUnit === null) return null
  return costPerReportingUnit * perUnitInReportingUnit
}
