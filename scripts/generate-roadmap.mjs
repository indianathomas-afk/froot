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
  `[roadmap] ${phases.length} phases, ${bugs.length} bugs, ${debt.length} debt — last updated from ${sourceNote}`,
)
