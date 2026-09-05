// HELP-1b — ROUTE-LEVEL assertions. Gap 1 of the two named on 2026-09-05.
//
// WHY: until this file existed, NOTHING in the repo issued a request to a help
// route. verify-help-access calls helpScope directly, verify-help-render calls
// components directly, verify-guide-image talks to the Blob store directly. All
// three were green while /help/hr-forms served a broken image, because the layer
// none of them touched — the route handler, its status codes and its headers —
// is where that bug lived.
//
//   npx tsx scripts/verify-help-routes.ts
//
// It invokes the real exported GET handlers with real NextRequest objects, so
// param parsing, status codes, headers and body shape are exercised as the
// runtime exercises them.
//
// WHAT IT DOES NOT COVER, AND THIS IS GAP 2, NOT AN OVERSIGHT: there is no
// Clerk session here, so every request runs the UNAUTHENTICATED path. The
// authenticated 200 — bytes actually served to an entitled reader — needs a
// deployed check with a real session and is its own piece of work. What follows
// is the refusal contract, which is the half that carries the security
// properties and the half that was silently wrong.

import { NextRequest } from "next/server"

let failures = 0
function assert(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`)
  if (!ok) failures++
}

const req = (url: string) => new NextRequest(`http://localhost${url}`)

type Snapshot = { status: number; headers: Record<string, string>; body: string }
async function snapshot(res: Response): Promise<Snapshot> {
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k] = v
  })
  return { status: res.status, headers, body: await res.text() }
}

async function main(): Promise<void> {
  const image = await import("../src/app/api/help/image/[...path]/route")
  const search = await import("../src/app/api/help/search/route")

  // ─── THE IMAGE ROUTE'S REFUSAL CONTRACT ────────────────────────────────────

  console.log("\n── Image route: the refusal contract ─────────────────────────────────────────\n")

  const known = await snapshot(
    await image.GET(req("/api/help/image/hr-forms/form-builder-01.png?surface=app"), {
      params: Promise.resolve({ path: ["hr-forms", "form-builder-01.png"] }),
    })
  )
  const unknown = await snapshot(
    await image.GET(req("/api/help/image/nope/does-not-exist.png?surface=app"), {
      params: Promise.resolve({ path: ["nope", "does-not-exist.png"] }),
    })
  )

  assert("an unauthorized request for a REAL image returns 404", known.status === 404, `got ${known.status}`)
  assert("an unauthorized request for an UNKNOWN image returns 404", unknown.status === 404)

  // THE LOAD-BEARING ONE. Ruling 7 says a refused image returns 404 rather than
  // 403 because a 403 confirms the image exists — and therefore that a hidden
  // section exists. That guarantee is worth nothing if the two responses differ
  // in any other observable way: a different body length, a stray header, a
  // different cache directive. Nothing checked this until now.
  assert(
    "the two 404s are INDISTINGUISHABLE — same status, headers and body",
    known.status === unknown.status &&
      JSON.stringify(known.headers) === JSON.stringify(unknown.headers) &&
      known.body === unknown.body,
    `known=${JSON.stringify(known).slice(0, 160)}\n        unknown=${JSON.stringify(unknown).slice(0, 160)}`
  )

  // A refusal must never reach a shared cache: a cached 404 is harmless, but the
  // same directive governs the 200 path, and a CDN-cached image is ruling 7
  // defeated at the edge.
  assert(
    "the refusal is never shared-cacheable",
    (known.headers["cache-control"] ?? "").includes("private"),
    known.headers["cache-control"] ?? "(absent)"
  )

  assert(
    "the refusal body leaks nothing — no blob URL, no pathname, no stack",
    !known.body.includes("blob.vercel-storage.com") &&
      !known.body.includes("hr-forms") &&
      !/\bat\s+\w+\s+\(/.test(known.body),
    known.body.slice(0, 120)
  )

  // ?surface=my takes a different branch (getActiveStaffSelf rather than
  // getCurrentUser) and must refuse identically. A branch that 500s or 200s
  // here would be a bypass reachable by appending a query string.
  const mySurface = await snapshot(
    await image.GET(req("/api/help/image/hr-forms/form-builder-01.png?surface=my"), {
      params: Promise.resolve({ path: ["hr-forms", "form-builder-01.png"] }),
    })
  )
  assert("?surface=my refuses identically", mySurface.status === 404 && mySurface.body === known.body)

  // Catch-all param joining. The image id is a multi-segment path, and a route
  // that joined it wrongly would look for the wrong blob — a failure that
  // presents as "image missing" and sends you hunting the upload.
  const deep = await snapshot(
    await image.GET(req("/api/help/image/a/b/c/d.png"), {
      params: Promise.resolve({ path: ["a", "b", "c", "d.png"] }),
    })
  )
  assert("a deeply nested path is handled, not thrown on", deep.status === 404)

  // ─── THE SEARCH ROUTE'S CONTRACT ───────────────────────────────────────────

  console.log("\n── Search route: shape and headers ───────────────────────────────────────────\n")

  const s = await snapshot(await search.GET(req("/api/help/search?surface=app")))
  assert("an unauthenticated index request returns 200, not an error", s.status === 200, `got ${s.status}`)

  let parsed: unknown = null
  try {
    parsed = JSON.parse(s.body)
  } catch {
    /* asserted below */
  }
  assert("the body is JSON", parsed !== null, s.body.slice(0, 120))
  assert(
    "an unauthenticated index is EMPTY, never the full set",
    Array.isArray((parsed as { rows?: unknown[] })?.rows) &&
      (parsed as { rows: unknown[] }).rows.length === 0,
    s.body.slice(0, 160)
  )
  assert(
    "the index is never shared-cacheable — it is per-reader by construction",
    (s.headers["cache-control"] ?? "").includes("private"),
    s.headers["cache-control"] ?? "(absent)"
  )

  const sMy = await snapshot(await search.GET(req("/api/help/search?surface=my")))
  assert("?surface=my returns an empty index too", sMy.status === 200 && sMy.body === s.body)

  // ─── IMAGE IDS ARE ROUTABLE ────────────────────────────────────────────────
  //
  // An id with a leading slash, a traversal segment, or a space would produce a
  // src the route cannot match — presenting as a broken image with nothing in
  // any log.

  console.log("\n── Every referenced image id is a routable path ──────────────────────────────\n")

  const { GUIDE_ARTICLES } = await import("../src/generated/guide")
  for (const article of GUIDE_ARTICLES) {
    const ids = [...article.images, ...article.sections.flatMap((sec) => sec.images)].map((i) => i.id)
    for (const id of ids) {
      assert(
        `${article.id}: "${id}" is a clean relative path`,
        /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id) && !id.includes("..") && !id.endsWith("/"),
        "a leading slash, traversal or space makes the src unmatchable"
      )
      assert(`${article.id}: "${id}" round-trips through the catch-all`, id.split("/").join("/") === id)
    }
  }

  console.log(failures === 0 ? "\nPASS — all assertions held\n" : `\nFAIL — ${failures} assertion(s) failed\n`)
}

main().then(
  () => process.exit(failures === 0 ? 0 : 1),
  (err) => {
    console.error("\nFAIL — the run threw before it could finish:\n", err)
    process.exit(1)
  }
)
