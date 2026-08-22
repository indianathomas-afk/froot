/**
 * R7 — BEFORE/AFTER capture and the STRICT INVARIANT DIFF.
 *
 *   npx tsx scripts/capture-labor-budget.ts normalize <in.json|in.jsonl> --out <path>
 *   npx tsx scripts/capture-labor-budget.ts diff <before.jsonl> <after.jsonl>
 *
 * `normalize` canonicalises raw /api/labor/budget responses into one line per
 * store, sorted by store name, with a FIXED key order. `diff` runs the strict
 * comparison. --out is MANDATORY on normalize so this script can never default
 * onto an existing BEFORE file and overwrite it (S5-D25).
 *
 * WHY BOTH SIDES GO THROUGH THIS SCRIPT (S5-D25, Gary): a diff between a
 * hand-built file and a script-built file shows key-order and float-rendering
 * noise that looks like real change. The failure direction is the bad one — a
 * diff full of noise trains the reader to skim, and the fields that matter sit on
 * the same lines.
 */
import * as fs from "fs"

// ─── THE CLOCK-DEPENDENCE HEADER (S5-D35) ─────────────────────────────────────
// Emitted into every capture file so nobody re-derives MEADOWOOD_DRIFT_AUDIT.md.
const HEADER = (branch: string, week: string, tip: string) => [
  `# R7 labor-budget capture — ${branch}, week ${week}, tip ${tip}`,
  `# One store per line, sorted by store name. Fixed key order. Compare with:`,
  `#   npx tsx scripts/capture-labor-budget.ts diff <before.jsonl> <after.jsonl>`,
  `#`,
  `# CLOCK-DEPENDENCE — READ BEFORE DIFFING (S5-D33/D35).`,
  `# adjustedTotalSchedulableHours IS A FUNCTION OF THE WALL CLOCK, NOT OF ANY`,
  `# WRITE. weekStart is pinned by the query param; \`today\` is not —`,
  `# budget/route.ts:26 computes it from new Date() at request time, and two`,
  `# split inputs are trailing-56-day windows anchored on it (labor-plan.ts:171,`,
  `# :228). It therefore moves on its own at midnight in the store's timezone,`,
  `# in 0.5-hour steps, with nothing written. Proof: MEADOWOOD_DRIFT_AUDIT.md`,
  `# (8203d2c) — reproduced on dev by changing only the today string, 176.0 ->`,
  `# 175.5, zero writes. IT IS EXCLUDED FROM THE STRICT DIFF.`,
  `#`,
  `# totalSchedulableHours IS A DIFFERENT FIELD, one word apart, and it is`,
  `# clock-independent (labor-budget.ts:100). IT STAYS IN THE STRICT DIFF.`,
  `# Do not confuse them.`,
  `#`,
  `# \`today\` is recorded on every line (S5-D32) so a later reader can tell a`,
  `# clock slide from a real change without an audit, and so a same-day pair can`,
  `# be identified for S5-D34 promotion.`,
].join("\n")

// ─── THE FIELD SETS — EXACT STRING MATCH, NEVER PREFIX ────────────────────────
//
// THE TRAP IN THIS GATE (Gary): `totalSchedulableHours` and
// `adjustedTotalSchedulableHours` are one word apart and one CONTAINS the other
// as a suffix. Any comparator written with `includes`, `startsWith`, `endsWith`
// or a regex would either exclude both or include both. Membership here is exact
// Set identity and nothing else, and the assertions below fail the run at startup
// if that ever stops being true.

/// Compared byte-for-byte. Gary's ruling: the whole budget block, plus forecast /
/// source / target / weekAdjustments, plus the null-store lines staying null.
const STRICT_FIELDS = new Set([
  "hasForecast",
  "source",
  "forecastTotal",
  "target",
  "budget",
  "salesBasis",
  "conservativeSales",
  "totalLaborBudget",
  "salariedCost",
  "salariedHours",
  "hourlyDollars",
  "blendedHourlyRate",
  "hourlyHours",
  "totalSchedulableHours",
  "projectedLaborPctAtForecast",
  "floorExceedsBudget",
  "weekAdjustments",
])

/// Excluded by ruling. `adjustedTotalSchedulableHours` drifts with the clock
/// (S5-D33); `today` is the clock and is what licenses the S5-D34 promotion.
const EXCLUDED_FIELDS = new Set(["adjustedTotalSchedulableHours", "today"])

// Startup assertions. These are the guard against a future edit that "tidies" the
// two names together — the exact failure Gary named as this gate's trap.
if (!STRICT_FIELDS.has("totalSchedulableHours")) throw new Error("totalSchedulableHours MUST be strict")
if (STRICT_FIELDS.has("adjustedTotalSchedulableHours")) throw new Error("adjustedTotalSchedulableHours MUST NOT be strict")
if (!EXCLUDED_FIELDS.has("adjustedTotalSchedulableHours")) throw new Error("adjustedTotalSchedulableHours MUST be excluded")
if (EXCLUDED_FIELDS.has("totalSchedulableHours")) throw new Error("totalSchedulableHours MUST NOT be excluded")
for (const f of STRICT_FIELDS) if (EXCLUDED_FIELDS.has(f)) throw new Error(`field in both sets: ${f}`)

// ─── CANONICAL LINE ORDER ─────────────────────────────────────────────────────
// Matches docs/prompts/r7_budget_BEFORE_staging_2026-08-22.jsonl exactly, with
// `today` APPENDED so every pre-existing key keeps its position and a BEFORE/AFTER
// pair differs only by the trailing key.
const ORDER_BUDGETED = [
  "name", "id", "tz", "hasForecast", "source", "forecastTotal",
  "salesBasis", "conservativeSales", "totalLaborBudget", "salariedCost", "salariedHours",
  "hourlyDollars", "blendedHourlyRate", "hourlyHours", "totalSchedulableHours",
  "projectedLaborPctAtForecast", "floorExceedsBudget",
  "adjustedTotalSchedulableHours", "weekAdjustments", "target", "today",
]
const ORDER_NULL = [
  "name", "id", "tz", "hasForecast", "source", "forecastTotal", "budget",
  "adjustedTotalSchedulableHours", "weekAdjustments", "target", "today",
]

type Raw = Record<string, unknown>

/// Flatten one /api/labor/budget response into the canonical shape.
function toLine(r: Raw): string {
  const store = (r.store ?? {}) as Raw
  const budget = (r.budget ?? null) as Raw | null
  const flat: Raw = {
    name: r.name ?? store.name,
    id: r.id ?? store.id,
    tz: r.tz ?? store.timezone,
    hasForecast: r.hasForecast,
    source: r.source ?? null,
    forecastTotal: r.forecastTotal ?? ((r.forecast as Raw | null)?.total ?? null),
    ...(budget ? budget : { budget: null }),
    // Present-but-flattened budgeted captures carry the block inline already.
    ...(!budget && r.salesBasis !== undefined ? { budget: undefined } : {}),
    adjustedTotalSchedulableHours: r.adjustedTotalSchedulableHours ?? null,
    weekAdjustments: r.weekAdjustments ?? [],
    ...(r.target !== undefined ? { target: r.target } : {}),
    ...(r.today !== undefined ? { today: r.today } : {}),
  }
  // A pre-flattened budgeted line: copy its inline budget fields through.
  if (!budget && r.salesBasis !== undefined) {
    delete flat.budget
    for (const k of ORDER_BUDGETED) if (r[k] !== undefined && flat[k] === undefined) flat[k] = r[k]
  }
  const order = flat.hasForecast ? ORDER_BUDGETED : ORDER_NULL
  const out: Raw = {}
  for (const k of order) if (flat[k] !== undefined) out[k] = flat[k]
  return JSON.stringify(out)
}

function readRecords(path: string): Raw[] {
  const text = fs.readFileSync(path, "utf8")
  const lines = text.split("\n").filter((l) => l.trim() && !l.trimStart().startsWith("#"))
  if (lines.length === 1) {
    const parsed = JSON.parse(lines[0])
    if (Array.isArray(parsed)) return parsed as Raw[]
  }
  return lines.map((l) => JSON.parse(l) as Raw)
}

function cmdNormalize(inPath: string, outPath: string, branch: string, week: string, tip: string) {
  const recs = readRecords(inPath)
  const lines = recs
    .map((r) => ({ name: String(r.name ?? (r.store as Raw)?.name ?? ""), line: toLine(r) }))
    // CODEPOINT SORT, NOT localeCompare — and this line was written twice.
    // localeCompare is case-insensitive, so it orders "University Village"
    // before "UNR"; the hand-built BEFORE sorted by codepoint and puts "UNR"
    // first ('N' 78 < 'n' 110). The two orderings differ on exactly one pair in
    // this estate, and the S5-D25 acceptance test — normalize the hand-built
    // file, then strict-diff it against itself — is what caught it. That is the
    // formatting noise Gary's rule exists to keep out of a real diff.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((x) => x.line)
  fs.writeFileSync(outPath, HEADER(branch, week, tip) + "\n" + lines.join("\n") + "\n")
  console.log(`wrote ${lines.length} store lines -> ${outPath}`)
}

function cmdDiff(beforePath: string, afterPath: string) {
  const key = (r: Raw) => String(r.id ?? r.name)
  const before = new Map(readRecords(beforePath).map((r) => [key(r), r]))
  const after = new Map(readRecords(afterPath).map((r) => [key(r), r]))

  console.log(`BEFORE ${beforePath}  (${before.size} lines)`)
  console.log(`AFTER  ${afterPath}  (${after.size} lines)\n`)

  // S5-D26 — ALL store lines are in the gate, including hasForecast:false ones.
  // A store appearing or disappearing is itself a finding.
  const onlyBefore = [...before.keys()].filter((k) => !after.has(k))
  const onlyAfter = [...after.keys()].filter((k) => !before.has(k))
  for (const k of onlyBefore) console.log(`  ✗ STORE MISSING FROM AFTER: ${before.get(k)!.name}`)
  for (const k of onlyAfter) console.log(`  ✗ STORE ONLY IN AFTER: ${after.get(k)!.name}`)

  let mismatches = onlyBefore.length + onlyAfter.length
  let compared = 0
  const unpaired: string[] = []

  for (const [k, b] of before) {
    const a = after.get(k)
    if (!a) continue
    for (const f of STRICT_FIELDS) {
      const inB = b[f] !== undefined
      const inA = a[f] !== undefined
      // A field on exactly ONE side is NOT silently passed and NOT counted as a
      // mismatch: the hand-built BEFORE predates some keys. It is surfaced as
      // UNPAIRED so a human decides, rather than the script deciding for them.
      if (inB !== inA) { unpaired.push(`${b.name}.${f} (before:${inB} after:${inA})`); continue }
      if (!inB) continue
      compared++
      const bv = JSON.stringify(b[f]), av = JSON.stringify(a[f])
      if (bv !== av) { mismatches++; console.log(`  ✗ ${String(b.name).padEnd(22)} ${f}: ${bv} -> ${av}`) }
    }
  }

  // S5-D34 — the promotion. Only legal when BOTH sides recorded `today` and they
  // agree; without a recorded `today` the pair cannot be shown to qualify.
  const todays = new Set<string>()
  let missingToday = 0
  for (const [k, b] of before) {
    const a = after.get(k); if (!a) continue
    if (b.today === undefined || a.today === undefined) missingToday++
    else { todays.add(String(b.today)); todays.add(String(a.today)) }
  }
  const sameDay = missingToday === 0 && todays.size === 1
  let adjMismatch = 0
  if (sameDay) {
    console.log(`\n  S5-D34 PROMOTION: both captures are same-day (today=${[...todays][0]}), so`)
    console.log(`  adjustedTotalSchedulableHours is deterministic and IS compared:`)
    for (const [k, b] of before) {
      const a = after.get(k); if (!a) continue
      const bv = JSON.stringify(b.adjustedTotalSchedulableHours), av = JSON.stringify(a.adjustedTotalSchedulableHours)
      if (bv !== av) { adjMismatch++; console.log(`  ✗ ${String(b.name).padEnd(22)} adjustedTotalSchedulableHours: ${bv} -> ${av}`) }
    }
    if (adjMismatch === 0) console.log(`  ✓ identical at every store`)
  } else {
    console.log(`\n  S5-D34 PROMOTION DECLINED — adjustedTotalSchedulableHours NOT compared.`)
    console.log(missingToday > 0
      ? `  ${missingToday} line(s) do not record \`today\`, so the pair cannot be shown to be same-day.`
      : `  The captures span days (today=${[...todays].sort().join(", ")}); the field drifts with the clock.`)
  }

  if (unpaired.length) {
    console.log(`\n  ⚠ ${unpaired.length} UNPAIRED FIELD(S) — present on one side only, decide by eye:`)
    for (const u of unpaired) console.log(`      ${u}`)
  }

  const total = mismatches + adjMismatch
  console.log(`\n  ${compared} strict field comparisons · ${total} mismatch(es)`)
  console.log(total === 0 ? "  STRICT DIFF EMPTY." : "  STRICT DIFF NOT EMPTY.")
  process.exit(total === 0 ? 0 : 1)
}

const [cmd, ...rest] = process.argv.slice(2)
const flag = (n: string, d: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d }
if (cmd === "normalize") {
  const out = flag("out", "")
  if (!rest[0] || !out) { console.error("usage: normalize <in> --out <path> [--branch b] [--week w] [--tip sha]"); process.exit(2) }
  cmdNormalize(rest[0], out, flag("branch", "unknown"), flag("week", "unknown"), flag("tip", "unknown"))
} else if (cmd === "diff") {
  if (!rest[0] || !rest[1]) { console.error("usage: diff <before.jsonl> <after.jsonl>"); process.exit(2) }
  cmdDiff(rest[0], rest[1])
} else {
  console.error("usage: capture-labor-budget.ts normalize|diff …"); process.exit(2)
}
