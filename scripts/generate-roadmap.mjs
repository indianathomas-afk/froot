// Build step for /internal/roadmap.
//
// Reads docs/ROADMAP.yaml, resolves the "last updated" timestamp from git, and
// emits src/generated/roadmap.ts (gitignored). Runs via the `prebuild` and
// `predev` npm hooks, so every Vercel build and every local `npm run dev`
// regenerates it — the page can't fall out of date with the file.
//
// Why build time and not runtime:
//   1. docs/ROADMAP.yaml sits outside the import graph, so it would need an
//      outputFileTracingIncludes entry to reach the serverless bundle.
//   2. There is no .git directory in a lambda, so the commit date is only
//      obtainable here regardless.
// Doing both in one step keeps it to one mechanism.
//
// STRICTLY READ-ONLY with respect to ROADMAP.yaml and the database: this script
// parses the YAML and shells out to `git log`. It never writes back.

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE = join(ROOT, "docs", "ROADMAP.yaml")
const OUTPUT = join(ROOT, "src", "generated", "roadmap.ts")
// Path as git knows it — POSIX separators, relative to the repo root.
const SOURCE_FOR_GIT = "docs/ROADMAP.yaml"

/**
 * The git commit date of docs/ROADMAP.yaml, or null.
 *
 * Vercel shallow-clones (~10 commits). If the file's last change predates that
 * window, `git log` exits 0 with EMPTY output rather than failing — hence the
 * explicit empty check. The caller falls back to meta.updated and the page
 * labels which source it used, so a fallback is always visible.
 */
function gitCommitDate() {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", SOURCE_FOR_GIT],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim()
    return out || null
  } catch {
    // No .git in the build container, git not on PATH, or not a repo.
    return null
  }
}

/** YAML dates parse to Date objects; normalize the whole tree to JSON scalars. */
function normalize(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    )
  }
  if (typeof value === "string") return value.trim()
  return value
}

/** meta.updated is a bare YAML date (no time) — widen it to an ISO instant. */
function metaUpdatedToIso(metaUpdated) {
  if (!metaUpdated) return null
  const normalized = normalize(metaUpdated)
  if (typeof normalized !== "string") return null
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const raw = parse(readFileSync(SOURCE, "utf8"))
if (!raw || !Array.isArray(raw.phases)) {
  // Fail the build loudly rather than shipping an empty board.
  throw new Error(`${SOURCE_FOR_GIT}: expected a top-level "phases" list`)
}

/**
 * A short SHA that YAML reads as a NUMBER makes `commits` come back as a mixed
 * string/number array. Coerce to string — otherwise the shape drifts from the
 * Phase/Bug/DebtItem types and `next build` fails type-checking the generated
 * file.
 *
 * TWO shapes trigger it, not one (DEBT-21, widened 2026-07-30):
 *   - all-digit:            2081401, 9743899
 *   - scientific notation:  84437e5  ->  84437 x 10^5  =  8443700000
 * The second is the likelier of the two — it needs only a single `e` between
 * digits — and it is what actually broke the build on 2026-07-30, one commit
 * after DEBT-21 was filed describing the all-digit case alone.
 *
 * Quoting the SHA in the YAML also works, but relies on whoever edits the file
 * remembering. This does not.
 */
function withStringCommits(entries) {
  return entries.map((entry) =>
    Array.isArray(entry.commits)
      ? { ...entry, commits: entry.commits.map((sha) => String(sha)) }
      : entry,
  )
}

const phases = withStringCommits(normalize(raw.phases))
const bugs = withStringCommits(normalize(raw.bugs ?? []))
const debt = withStringCommits(normalize(raw.debt ?? []))
// Rulings carry no `commits` by design (see the header comment above `rulings:`
// in the YAML), so they skip withStringCommits rather than being run through it
// defensively — a coercion for a field the type does not have would only hide
// the type error that is supposed to catch it.
const rulings = normalize(raw.rulings ?? [])

const fromGit = gitCommitDate()
const fromMeta = metaUpdatedToIso(raw.meta?.updated)

let lastUpdated = null
let lastUpdatedSource = "unknown"
if (fromGit) {
  lastUpdated = fromGit
  lastUpdatedSource = "git"
} else if (fromMeta) {
  lastUpdated = fromMeta
  lastUpdatedSource = "meta"
}

const data = {
  phases,
  bugs,
  debt,
  rulings,
  lastUpdated,
  lastUpdatedSource,
  generatedAt: new Date().toISOString(),
}

const banner = `// GENERATED FILE — DO NOT EDIT.
// Written by scripts/generate-roadmap.mjs from docs/ROADMAP.yaml on every
// build (\`prebuild\`) and dev start (\`predev\`). Gitignored. Edit the YAML.
`

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(
  OUTPUT,
  `${banner}
import type { RoadmapData } from "@/lib/roadmap"

export const roadmap: RoadmapData = ${JSON.stringify(data, null, 2)}
`,
  "utf8",
)

// Surfaced in the Vercel build log so a silent fallback is auditable there too.
const sourceNote =
  lastUpdatedSource === "git"
    ? `git commit date ${lastUpdated}`
    : lastUpdatedSource === "meta"
      ? `meta.updated ${lastUpdated} (FALLBACK — git date unavailable)`
      : "unknown (FALLBACK — neither git nor meta.updated resolved)"

console.log(
  `[roadmap] ${phases.length} phases, ${bugs.length} bugs, ${debt.length} debt, ${rulings.length} rulings — last updated from ${sourceNote}`,
)

// ─── UNFLAGGED-CLOSURE WARNING ───────────────────────────────────────────────
//
// ROADMAP.yaml's header says only the `resolved:` flag is read, and P-4 built
// the flag for exactly that reason. But PERM-6's older convention — closing a
// blocker by PREPENDING a note above it — never went away, so for a while both
// ran at once. An entry closed in prose and never flagged keeps counting as a
// LIVE blocker on /internal/roadmap. R7-C carried one for a day: its second
// entry opened "CLEARED 2026-08-22" and closed the third by the prepend
// convention, and neither had a flag until af407b3.
//
// THIS IS A WARNING AND IT MUST NEVER FAIL THE BUILD. It closes nothing, it
// decides nothing, and a false positive costs a line in a log rather than a
// deploy.
//
// IT IS NOT THE PREFIX DETECTION P-4 REJECTED, AND THE DIFFERENCE IS THE JOB.
// P-4 rejected prefix matching as a CLASSIFIER — something that reads the
// leading words and decides an entry is closed — on the evidence that F-5's
// LIVE blocker opens "VERIFIED STILL TRUE" and F-4's opens "CONFIRMED LIVE".
// That rejection stands and nothing here weakens it: a classifier that is wrong
// fails toward UNDERSTATING, which is worse than the bug it fixes, while a
// warning that is wrong only asks a human to look.
//
// It is also far narrower than a prefix matcher. The closing verb must be
// IMMEDIATELY FOLLOWED BY A DATE, so "VERIFIED STILL TRUE 2026-07-27" and
// "CONFIRMED LIVE 2026-07-27" do not match at all — the two entries P-4 named
// as the counter-examples are structurally out of range rather than luckily
// missed.
//
// THE REMAINDER CLAUSE IS WHAT KEEPS IT QUIET. The 2026-08-23 audit found five
// entries that announce a closure and then name something still live in their
// own text — "that half of the entry below stays open" (F-4), "STAGED, NOT
// PROMOTED" and "ADDED, NOT YET GRANTED" (L-2). Those are accurate prose and
// Gary ruled them left alone; warning on them would be nagging about entries
// that are correct as written.
//
// BACKTESTED BEFORE IT WAS BUILT, which is the only reason to trust the
// silence. Against 7533613 — the commit before af407b3 — it fires ONCE, on
// R7-C's second entry, which is precisely the over-count af407b3 found by hand.
// Against HEAD it fires ZERO times. One true positive, no false positives, on
// both sides of the fix.
//
// A NOISY CHECK WOULD BE WORSE THAN NONE. The coarse prose matcher that audit
// opened with produced five hits and all five were false; a warning built on
// that would have been ignored inside a week. If this one ever starts crying
// wolf, narrow it or delete it — do not learn to scroll past it.
const CLOSING_OPENER = /^(CLEARED|RESOLVED|CLOSED|WITHDRAWN)\s+20\d\d-\d\d-\d\d\b/i
const SURVIVING_REMAINDER =
  /\b(STILL OPEN|STAYS OPEN|REMAINS OPEN|STILL LIVE|STILL ABSENT|NOT CLOSED|STILL OWED|DOES NOT CLOSE|ONE LIVE ITEM|NOT YET|STILL UNRESOLVED|not a live blocker)\b/i

const unflaggedClosures = []
for (const phase of phases) {
  const entries = Array.isArray(phase.blockers) ? phase.blockers : []
  for (const [index, entry] of entries.entries()) {
    // Only BARE strings are candidates. An entry already carrying `resolved:`
    // or `narrowed:` has been classified by a human and is not this check's
    // business.
    if (typeof entry !== "string") continue
    const text = entry.replace(/\s+/g, " ").trim()
    if (!CLOSING_OPENER.test(text)) continue
    if (SURVIVING_REMAINDER.test(text)) continue
    unflaggedClosures.push({ id: phase.id, index, text })
  }
}

if (unflaggedClosures.length > 0) {
  const one = unflaggedClosures.length === 1
  console.warn(
    `[roadmap] WARNING — ${unflaggedClosures.length} blocker ${one ? "entry opens" : "entries open"}` +
      ` with a closing verb and a date but ${one ? "carries" : "carry"} NO \`resolved:\` flag, so` +
      ` /internal/roadmap counts ${one ? "it" : "them"} as LIVE:`,
  )
  for (const hit of unflaggedClosures) {
    console.warn(`[roadmap]   ${hit.id} blockers[${hit.index}]: "${hit.text.slice(0, 100)}…"`)
  }
  console.warn(
    "[roadmap]   Only the flag is read (see ROADMAP.yaml's header). If the entry is closed, add" +
      " `resolved: true` without editing its prose. If something in it is still live, say so in the" +
      " entry and this warning stops.",
  )
}
