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
import { computeWeeklyLaborBudget } from "../src/lib/labor-budget"

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

/// R7-C. NOT STRICT, and for the same reason adjustedTotalSchedulableHours is
/// not: it is not a computed labor figure. hasIncompleteAllocation describes a
/// DATA-ENTRY state — someone's percentages do not total 100% — so it can
/// legitimately differ between a BEFORE taken before the data was entered and an
/// AFTER taken after. It is CAPTURED and REPORTED so a human sees it, and it is
/// never counted as a mismatch.
const REPORTED_FIELDS = new Set(["hasIncompleteAllocation"])

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
for (const f of REPORTED_FIELDS) if (STRICT_FIELDS.has(f)) throw new Error(`reported field must not be strict: ${f}`)
// R7-C: the canary and the salaried pair, asserted at startup so a later edit
// cannot quietly drop the three fields the promotion actually turns on.
if (!STRICT_FIELDS.has("blendedHourlyRate")) throw new Error("blendedHourlyRate MUST be strict — it is the promotion canary")
if (!STRICT_FIELDS.has("salariedCost")) throw new Error("salariedCost MUST be strict")
if (!STRICT_FIELDS.has("salariedHours")) throw new Error("salariedHours MUST be strict")

// ─── CANONICAL LINE ORDER ─────────────────────────────────────────────────────
// Matches docs/prompts/r7_budget_BEFORE_staging_2026-08-22.jsonl exactly, with
// `today` APPENDED so every pre-existing key keeps its position and a BEFORE/AFTER
// pair differs only by the trailing key.
const ORDER_BUDGETED = [
  "name", "id", "tz", "hasForecast", "source", "forecastTotal",
  "salesBasis", "conservativeSales", "totalLaborBudget", "salariedCost", "salariedHours",
  "hourlyDollars", "blendedHourlyRate", "hourlyHours", "totalSchedulableHours",
  "projectedLaborPctAtForecast", "floorExceedsBudget",
  "adjustedTotalSchedulableHours", "weekAdjustments", "target", "hasIncompleteAllocation", "today",
]
const ORDER_NULL = [
  "name", "id", "tz", "hasForecast", "source", "forecastTotal", "budget",
  "adjustedTotalSchedulableHours", "weekAdjustments", "target", "hasIncompleteAllocation", "today",
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
    ...(r.hasIncompleteAllocation !== undefined ? { hasIncompleteAllocation: r.hasIncompleteAllocation } : {}),
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

// ─── PREDICT + MANIFEST (R7-C) ────────────────────────────────────────────────
//
// THE GATE FLIPS ITS REFERENCE SIDE, NOT ITS FIELD SETS. Under R7-B the
// assertion was AFTER == BEFORE, and an empty diff meant "nothing moved". The
// allocation ruling moves stores ON PURPOSE, so that assertion is now guaranteed
// to fail for a reason unrelated to correctness. The replacement is
// AFTER == PREDICTED, where PREDICTED is computed BEFORE the deploy from the
// BEFORE capture and the same pure engine the app runs, and signed off per store.
//
// Everything else is unchanged: the strict fields, the exclusions, the
// totalSchedulableHours / adjustedTotalSchedulableHours separation, and the
// S5-D34 same-day promotion all behave exactly as they did.

/// `--declare "Las Brisas=500:20"` — this store carries $500.00/wk and 20 hours.
/// Stores not named carry nothing, which IS the ruling ("absent means zero").
function parseDeclarations(rest: string[]): Map<string, { cost: number; hours: number }> {
  const out = new Map<string, { cost: number; hours: number }>()
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== "--declare") continue
    const raw = rest[i + 1] ?? ""
    const m = raw.match(/^(.+)=([0-9.]+):([0-9.]+)$/)
    if (!m) throw new Error(`bad --declare "${raw}" — expected "Store Name=<weeklyCost>:<weeklyHours>"`)
    out.set(m[1], { cost: Number(m[2]), hours: Number(m[3]) })
  }
  return out
}

function cmdPredict(inPath: string, outPath: string, rest: string[], branch: string, week: string, tip: string) {
  const declared = parseDeclarations(rest)
  const recs = readRecords(inPath)

  // The HOURLY archetypes are read OFF THE BEFORE CAPTURE, not assumed: the
  // capture's blendedHourlyRate is the mean the live legend produced, so
  // reproducing it exactly is what proves the prediction used the real legend.
  const sample = recs.find((r) => r.hasForecast) as Record<string, number> | undefined
  if (!sample) throw new Error("no budgeted store in the BEFORE capture — nothing to predict")
  const blended = Number(sample.blendedHourlyRate)
  const targetPct = Number(sample.totalLaborBudget) / Number(sample.conservativeSales) * 100
  const increment = 1000

  const lines = recs
    .map((r) => {
      const rec = r as Record<string, unknown>
      if (!rec.hasForecast) return { name: String(rec.name), line: toLine(rec) }
      const d = declared.get(String(rec.name))
      const positions = [
        ...(d && d.hours > 0
          ? [{ payType: "SALARIED" as const, defaultHourlyRate: d.cost / d.hours, impliedWeeklyHours: d.hours, active: true, weeklyCost: d.cost }]
          : []),
        // ONE synthetic hourly position carrying the captured mean. The engine's
        // blended rate is the MEAN of the hourly rates, and the mean of a single
        // value is that value — so this reproduces the legend's rate exactly
        // without needing to know the legend's rows.
        { payType: "HOURLY" as const, defaultHourlyRate: blended, impliedWeeklyHours: null, active: true },
      ]
      const b = computeWeeklyLaborBudget({
        settings: { laborTargetPct: targetPct, roundingIncrement: increment, plannedBlendedRate: null },
        positions,
        forecast: { total: Number(rec.forecastTotal) },
      })!
      return {
        name: String(rec.name),
        line: toLine({
          ...rec,
          salesBasis: b.salesBasis,
          conservativeSales: b.conservativeSales,
          totalLaborBudget: b.totalLaborBudget,
          salariedCost: b.salariedCost,
          salariedHours: b.salariedHours,
          hourlyDollars: b.hourlyDollars,
          blendedHourlyRate: b.blendedHourlyRate,
          hourlyHours: b.hourlyHours,
          totalSchedulableHours: b.totalSchedulableHours,
          projectedLaborPctAtForecast: b.projectedLaborPctAtForecast,
          floorExceedsBudget: b.floorExceedsBudget,
          // NOT PREDICTED — it is a function of the wall clock, not of any write
          // (S5-D33). Carried through from the BEFORE so the file has the key.
          adjustedTotalSchedulableHours: rec.adjustedTotalSchedulableHours ?? null,
        }),
      }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((x) => x.line)

  const rule = ["# PREDICTED — rule: person-allocation (absent means zero).",
                `# Declared: ${declared.size === 0 ? "(none)" : [...declared].map(([n, d]) => `${n} $${d.cost}/wk ${d.hours}h`).join(" · ")}`,
                "# Every store NOT named above carries no salaried cost and no salaried hours.",
                "# adjustedTotalSchedulableHours is CARRIED THROUGH, not predicted — it is a",
                "# function of the wall clock and is excluded from the strict diff anyway."].join("\n")
  fs.writeFileSync(outPath, HEADER(branch, week, tip) + "\n" + rule + "\n" + lines.join("\n") + "\n")
  console.log(`predicted ${lines.length} store lines -> ${outPath}`)
}

/// The per-store sign-off table. THIS IS THE ARTIFACT GARY SIGNS, and it is
/// produced BEFORE the deploy, not after.
function cmdManifest(beforePath: string, predictedPath: string) {
  const before = readRecords(beforePath)
  const pred = new Map(readRecords(predictedPath).map((r) => [String(r.id ?? r.name), r]))
  const n = (v: unknown) => (v == null ? "—" : String(v))
  console.log(`PROMOTION MANIFEST — ${beforePath}  ->  ${predictedPath}\n`)
  console.log("store                | salariedHrs | salariedCost  | hourlyHours      | totalSched       | blended")
  console.log("---------------------|-------------|---------------|------------------|------------------|--------")
  let movers = 0, unchanged = 0
  for (const b of before) {
    const a = pred.get(String(b.id ?? b.name))
    if (!a) { console.log(`${String(b.name).padEnd(20)} | *** MISSING FROM PREDICTED ***`); continue }
    if (!b.hasForecast) { unchanged++; console.log(`${String(b.name).padEnd(20)} | no forecast — budget:null, UNCHANGED`); continue }
    const moved = b.salariedHours !== a.salariedHours || b.hourlyHours !== a.hourlyHours
    if (moved) movers++
    console.log(
      `${String(b.name).padEnd(20)} | ${n(b.salariedHours).padStart(3)} -> ${n(a.salariedHours).padStart(4)} | ` +
      `${n(b.salariedCost).padStart(5)} -> ${n(a.salariedCost).padStart(4)}  | ` +
      `${n(b.hourlyHours).padStart(6)} -> ${n(a.hourlyHours).padStart(6)}  | ` +
      `${n(b.totalSchedulableHours).padStart(6)} -> ${n(a.totalSchedulableHours).padStart(6)}  | ${n(a.blendedHourlyRate)}`
    )
  }
  const rates = new Set(before.concat([...pred.values()]).filter((r) => r.hasForecast).map((r) => r.blendedHourlyRate))
  console.log(`\n${movers} store(s) move · ${unchanged} unchanged (no forecast) · ${before.length} lines`)
  console.log(rates.size === 1
    ? `blendedHourlyRate ${[...rates][0]} on BOTH sides at every store — THE CANARY HOLDS.`
    : `*** blendedHourlyRate DIFFERS: ${[...rates].join(", ")} — THE PERSON RECORD LEAKED INTO RATE MATH. STOP. ***`)
  console.log("\nSIGN THIS LINE BY LINE BEFORE PROMOTING. An empty strict diff afterwards then means")
  console.log("\"the estate moved exactly as predicted and signed\", not \"nothing moved\".")
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
} else if (cmd === "predict") {
  const out = flag("out", "")
  if (!rest[0] || !out) { console.error('usage: predict <before.jsonl> --out <path> [--declare "Store=cost:hours"] ...'); process.exit(2) }
  cmdPredict(rest[0], out, rest, flag("branch", "unknown"), flag("week", "unknown"), flag("tip", "unknown"))
} else if (cmd === "manifest") {
  if (!rest[0] || !rest[1]) { console.error("usage: manifest <before.jsonl> <predicted.jsonl>"); process.exit(2) }
  cmdManifest(rest[0], rest[1])
} else {
  console.error("usage: capture-labor-budget.ts normalize|predict|manifest|diff …"); process.exit(2)
}
