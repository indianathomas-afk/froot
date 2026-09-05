// Build step for the in-app help surface (HELP-1a).
//
// Reads docs/guide/*.md, validates the frontmatter, checks route coverage, and
// emits src/generated/guide.ts (gitignored). Runs via the `prebuild` and
// `predev` npm hooks, so every Vercel build and every local `npm run dev`
// regenerates it — the articles can't fall out of date with the files.
//
// Why build time and not runtime, following scripts/generate-roadmap.mjs:
//   1. docs/guide/*.md sits outside the import graph, so it would need an
//      outputFileTracingIncludes entry to reach the serverless bundle.
//   2. The coverage gate walks src/app for page.tsx files. That is a
//      filesystem sweep of the SOURCE tree, which does not exist in a lambda.
//
// STRICTLY READ-ONLY with respect to docs/ and src/app: this script parses
// markdown and lists files. It never writes back.
//
// WHAT IS **NOT** CHECKED HERE, ON PURPOSE: whether a `capability:` names a
// real Capability. The emitted file is typed as GuideArticle[], whose
// capability fields are the Capability union — so a typo is a tsc error with a
// precise location, which is strictly better than a string comparison against a
// list this script would have to keep in sync by hand.

import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_DIR = join(ROOT, "docs", "guide")
const APP_DIR = join(ROOT, "src", "app")
const OUTPUT = join(ROOT, "src", "generated", "guide.ts")
const SOURCE_FOR_GIT = "docs/guide"

// ─── EXEMPT ROUTES ───────────────────────────────────────────────────────────
//
// Ruling 5 (2026-09-04): the marketing landing page and both print views get no
// article. THE LIST LIVES HERE AND NOT IN FRONTMATTER, deliberately — an
// article must not be able to exempt a route by declining to mention it, or the
// gate would be satisfied by forgetting, which is the one way a coverage check
// can be worse than no check at all.
const EXEMPT_ROUTES = new Set([
  "/", // public marketing landing; not an in-app surface
  "/print/checklist/[id]", // print view — ruling 5
  "/print/template/[id]", // print view — ruling 5
  // RULED (Gary, 2026-09-04): the help surface does not document itself. "The
  // coverage gate is a to-do list of undocumented product surfaces; help
  // documenting itself is a hall of mirrors and would sit in the warn list
  // forever teaching nothing."
  //
  // Note these four appeared in the warn list the moment HELP-1a created them,
  // which is the gate behaving correctly — it discovered new routes with no
  // article. The ruling is that they are not product surfaces a reader needs
  // help ON, so they are exempt rather than owed an article.
  "/help",
  "/help/[slug]",
  "/my/help",
  "/my/help/[slug]",
])

/**
 * The git commit date of docs/guide, or null.
 *
 * Vercel shallow-clones (~10 commits). If the directory's last change predates
 * that window, `git log` exits 0 with EMPTY output rather than failing — hence
 * the explicit empty check. The fallback is labelled in the build log, so a
 * silent fallback is impossible.
 */
function gitCommitDate() {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", SOURCE_FOR_GIT], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
    return out || null
  } catch {
    // No .git in the build container, git not on PATH, or not a repo.
    return null
  }
}

/** Every route in the app, derived from page.tsx files. Route groups drop out. */
function discoverRoutes(dir = APP_DIR, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      discoverRoutes(full, out)
    } else if (name === "page.tsx") {
      const rel = relative(APP_DIR, dirname(full))
      const segments = rel
        .split("/")
        .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")))
      out.push("/" + segments.join("/"))
    }
  }
  return out
}

/** Split `---\nyaml\n---\nbody` into the two halves. */
function splitFrontmatter(raw, file) {
  const text = raw.replace(/^﻿/, "")
  if (!text.startsWith("---")) {
    throw new Error(`${file}: no frontmatter block — the file must open with "---"`)
  }
  const end = text.indexOf("\n---", 3)
  if (end === -1) {
    throw new Error(`${file}: frontmatter block is never closed`)
  }
  const yamlText = text.slice(3, end)
  const body = text.slice(text.indexOf("\n", end + 1) + 1)
  return { front: parse(yamlText) ?? {}, body }
}

// Required keys. `capability` and `module` are REQUIRED WITH AN EXPLICIT null
// rather than omittable (audit §G.2): an absent key and a deliberate "this page
// is unrestricted" look identical otherwise, and the difference is exactly
// ruling 3's blast radius.
const REQUIRED = ["id", "title", "entry", "routes", "summary", "capability", "module", "order"]

function parseArticle(file) {
  const raw = readFileSync(join(SOURCE_DIR, file), "utf8")
  const { front, body } = splitFrontmatter(raw, file)

  for (const key of REQUIRED) {
    if (!(key in front)) {
      throw new Error(`${file}: missing required frontmatter key \`${key}\``)
    }
  }
  if (!Array.isArray(front.routes) || front.routes.length === 0) {
    throw new Error(`${file}: \`routes\` must be a non-empty list`)
  }
  // `entry` is the UI's question and `routes` is the gate's; collapsing them is
  // what forces one-to-one mapping back in. They may differ, but an entry
  // outside its own claimed set is always a mistake.
  if (!front.routes.includes(front.entry)) {
    throw new Error(`${file}: \`entry\` (${front.entry}) is not a member of \`routes\``)
  }

  const sections = (front.sections ?? []).map((section, i) => {
    // RULED (audit §G.2): a `sections` entry without a `capability` is a PARSE
    // ERROR, not an ungated section. The whole point of the block is gating; an
    // entry that forgot its capability would render to everyone, which is the
    // failure direction ruling 6 exists to prevent. Ungated prose lives outside
    // `sections` — in the body.
    if (!section || typeof section.capability !== "string" || section.capability.length === 0) {
      throw new Error(
        `${file}: sections[${i}] ("${section?.heading ?? "?"}") has no \`capability\`. ` +
          `A gated section must name one; ungated prose belongs in the body, not in \`sections\`.`,
      )
    }
    if (!section.id || !section.heading) {
      throw new Error(`${file}: sections[${i}] needs both \`id\` and \`heading\``)
    }
    // A section may claim the sub-routes it documents. Those routes are removed
    // from the article's route list for any reader who cannot see the section —
    // a route string is a disclosure on its own, since it travels to the client
    // on every search-index row. A section route outside the article's own
    // `routes` is always a mistake: the coverage gate unions article routes, so
    // a section route it does not contain would be claimed by nothing.
    for (const route of section.routes ?? []) {
      if (!front.routes.includes(route)) {
        throw new Error(
          `${file}: sections[${i}] claims route ${route}, which is not in the article's \`routes\``,
        )
      }
    }
    return section
  })

  // Pull each declared section's prose out of the markdown by its `## heading`.
  // Everything not claimed by a declared section stays in the body, which is
  // how ungated `##` prose keeps working without being listed in `sections`.
  const blocks = splitHeadings(body)
  const declared = new Map(sections.map((s) => [s.heading.trim(), s]))
  const bodyParts = []
  const built = []
  for (const block of blocks) {
    const match = block.heading === null ? null : declared.get(block.heading.trim())
    if (match) {
      built.push({
        id: match.id,
        heading: match.heading,
        capability: match.capability,
        routes: match.routes ?? [],
        body: block.body.trim(),
        images: imagesFor(front.images, match.id),
      })
      declared.delete(block.heading.trim())
    } else {
      bodyParts.push(block.heading === null ? block.body : `## ${block.heading}\n${block.body}`)
    }
  }
  if (declared.size > 0) {
    throw new Error(
      `${file}: frontmatter declares gated section(s) with no matching "## " heading in the body: ` +
        [...declared.keys()].map((h) => `"${h}"`).join(", "),
    )
  }

  return {
    // `pending` is deliberately NOT returned. It is an authoring marker, not
    // article data, and must never reach a payload or an index — see the warn
    // block below, which is where it surfaces instead.
    id: front.id,
    title: front.title,
    entry: front.entry,
    routes: front.routes,
    summary: front.summary.trim(),
    keywords: front.keywords ?? [],
    capability: front.capability ?? null,
    module: front.module ?? null,
    order: front.order,
    body: bodyParts.join("\n\n").trim(),
    sections: built,
    images: imagesFor(front.images, null),
  }
}

/** Images whose `section` matches, mapped to the runtime shape. */
function imagesFor(images, sectionId) {
  return (images ?? [])
    .filter((img) => (img.section ?? null) === sectionId)
    .map((img) => ({ id: img.id, alt: img.alt, sectionId }))
}

/** Split markdown into blocks at `## ` headings. The first block may be intro. */
function splitHeadings(body) {
  const lines = body.split("\n")
  const blocks = []
  let heading = null
  let buffer = []
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match) {
      if (heading !== null || buffer.join("").trim().length > 0) {
        blocks.push({ heading, body: buffer.join("\n") })
      }
      heading = match[1]
      buffer = []
    } else {
      buffer.push(line)
    }
  }
  if (heading !== null || buffer.join("").trim().length > 0) {
    blocks.push({ heading, body: buffer.join("\n") })
  }
  return blocks
}

// ─── PARSE ───────────────────────────────────────────────────────────────────

let files = []
try {
  files = readdirSync(SOURCE_DIR)
} catch {
  // The directory is allowed not to exist — HELP-1a creates it, and a build on
  // a branch without it should not fail.
  console.log("[guide] docs/guide/ does not exist yet — emitting an empty article set")
}

// Ruling 1 (2026-09-04): docs/guide/ holds .md ONLY. Raw and redacted captures
// live in gitignored directories and reach the app by upload, so an image file
// appearing here means a screenshot is about to be committed to git history —
// the one thing that ruling exists to make impossible. Underscore-prefixed
// directories (_raw, _review) are the gitignored capture dirs and are skipped.
const stray = files.filter((f) => !f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("."))
if (stray.length > 0) {
  console.warn(
    `[guide] WARNING — docs/guide/ should hold .md files only, but ${stray.length} other ` +
      `file(s) are present: ${stray.join(", ")}. Guide images belong in Blob (ruling 8), ` +
      `never in git.`,
  )
}

const articles = files
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map(parseArticle)
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

// ─── COVERAGE GATE ───────────────────────────────────────────────────────────
//
// RULED (2026-09-04): the gate WARNS and does not fail for missing coverage —
// permanently, not as a temporary concession. Exactly one condition hard-fails.
//
// The precedent is scripts/generate-roadmap.mjs, which made this same call and
// wrote down why: "a warning that is wrong only asks a human to look", and "A
// NOISY CHECK WOULD BE WORSE THAN NONE."
//
// A gate that failed on missing coverage would turn every future route-adding
// phase into a route-adding-plus-article-writing phase, and the pressure it
// creates is to write a stub article that satisfies the gate and teaches
// nothing — which defeats the gate rather than passing it. There is no
// threshold to tune and no escape hatch to remember to remove, which is the
// moment gates like this usually die.

// ─── PENDING CLAIMS ──────────────────────────────────────────────────────────
//
// An article may carry a `pending:` list in frontmatter: a claim that was
// drafted, JUDGED UNVERIFIED, and PULLED before shipping rather than shipped
// with a hedge. The marker lives in frontmatter so it cannot render, and it is
// dropped from the article object so it cannot reach a payload or the search
// index.
//
// IT WARNS ON EVERY BUILD BECAUSE THE ALTERNATIVE IS FORGETTING. A claim held
// back for verification is invisible the moment the session that held it ends —
// the prose reads fine without it, nothing is broken, and nobody knows a
// sentence is owed. This is the same reasoning as the unclaimed-route warning:
// a to-do the build states out loud rather than a note in a document.
const pendingClaims = []
for (const file of files.filter((f) => f.endsWith(".md"))) {
  const raw = readFileSync(join(SOURCE_DIR, file), "utf8")
  const { front } = splitFrontmatter(raw, file)
  for (const claim of front.pending ?? []) {
    pendingClaims.push({ file, claim: String(claim).replace(/\s+/g, " ").trim() })
  }
}

const routes = discoverRoutes().sort()
const routeSet = new Set(routes)

const claimedBy = new Map() // route -> [articleId]
for (const article of articles) {
  for (const route of article.routes) {
    if (!claimedBy.has(route)) claimedBy.set(route, [])
    claimedBy.get(route).push(article.id)
  }
}

// FAIL — the only one. A typo or a deleted page; it cannot be a
// work-in-progress state, and it produces a help article pointing at a 404.
const phantom = [...claimedBy.keys()].filter((r) => !routeSet.has(r)).sort()
if (phantom.length > 0) {
  throw new Error(
    `[guide] ${phantom.length} article route(s) do not exist in src/app:\n` +
      phantom.map((r) => `  ${r}  (claimed by ${claimedBy.get(r).join(", ")})`).join("\n") +
      `\nA help article pointing at a route that does not exist is a 404 with a link to it.`,
  )
}

const claimable = routes.filter((r) => !EXEMPT_ROUTES.has(r))
const unclaimed = claimable.filter((r) => !claimedBy.has(r))
const doubleClaimed = [...claimedBy.entries()].filter(([, ids]) => ids.length > 1)
const exemptClaimed = [...claimedBy.keys()].filter((r) => EXEMPT_ROUTES.has(r)).sort()

const lastUpdated = gitCommitDate()
const sourceNote = lastUpdated
  ? `git commit date ${lastUpdated}`
  : "unknown (FALLBACK — git date unavailable)"

// ONE SUMMARY LINE, then the list. Not 59 interleaved warnings — a build log
// that scrolls is a build log nobody reads, which is the same failure the
// roadmap generator's "noisy check" note warns about.
console.log(
  `[guide] ${articles.length} articles, ${routes.length} routes — ` +
    `${claimable.length - unclaimed.length} claimed, ${EXEMPT_ROUTES.size} exempt, ` +
    `${unclaimed.length} unclaimed — last updated from ${sourceNote}`,
)

if (unclaimed.length > 0) {
  console.warn(
    `[guide] WARNING — ${unclaimed.length} of ${claimable.length} claimable routes are not ` +
      `claimed by any article, so a reader on those pages gets no help:`,
  )
  for (const route of unclaimed) console.warn(`[guide]   ${route}`)
}

if (pendingClaims.length > 0) {
  const one = pendingClaims.length === 1
  console.warn(
    `[guide] WARNING — ${pendingClaims.length} drafted claim${one ? " is" : "s are"} held back pending` +
      ` verification, so ${one ? "an article is" : "articles are"} shipping without ${one ? "it" : "them"}:`,
  )
  for (const p of pendingClaims) {
    console.warn(`[guide]   ${p.file}: ${p.claim.slice(0, 140)}${p.claim.length > 140 ? "…" : ""}`)
  }
}

if (doubleClaimed.length > 0) {
  console.warn(`[guide] WARNING — ${doubleClaimed.length} route(s) claimed by more than one article,`)
  console.warn(`[guide]   so the "?" target is ambiguous:`)
  for (const [route, ids] of doubleClaimed) console.warn(`[guide]   ${route}  ← ${ids.join(", ")}`)
}

if (exemptClaimed.length > 0) {
  console.warn(
    `[guide] WARNING — ${exemptClaimed.length} route(s) are exempt by ruling but claimed anyway;` +
      ` the ruling and the frontmatter disagree:`,
  )
  for (const route of exemptClaimed) console.warn(`[guide]   ${route}  ← ${claimedBy.get(route).join(", ")}`)
}

// ─── EMIT ────────────────────────────────────────────────────────────────────

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(
  OUTPUT,
  `// GENERATED FILE — DO NOT EDIT.
// Written by scripts/generate-guide.mjs from docs/guide/*.md via the prebuild
// and predev npm hooks. Gitignored; regenerate with \`node scripts/generate-guide.mjs\`.
import type { GuideArticle } from "@/lib/help-access"

export const GUIDE_ARTICLES: GuideArticle[] = ${JSON.stringify(articles, null, 2)}

/** Routes that deliberately have no article (ruling 5). Surfaced for the coverage report. */
export const GUIDE_EXEMPT_ROUTES: string[] = ${JSON.stringify([...EXEMPT_ROUTES].sort(), null, 2)}

export const GUIDE_LAST_UPDATED: string | null = ${JSON.stringify(lastUpdated)}
`,
  "utf8",
)
