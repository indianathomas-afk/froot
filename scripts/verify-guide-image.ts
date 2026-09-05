// HELP-1a evidence item 4 — the BYTES half.
//
// SEPARATE FROM scripts/verify-help-access.ts ON PURPOSE. That script is pure
// policy: no I/O, no credentials, runs anywhere, and is the one a future phase
// will actually keep running. Folding a Blob round-trip into it would mean the
// policy assertions stop running on any machine without a token — which is the
// quiet way a green suite becomes a suite nobody runs.
//
// This one needs GUIDE_BLOB_READ_WRITE_TOKEN and talks to the real private
// store. It proves the half the policy assertions structurally cannot reach:
// that an authorized read actually returns the stored bytes.
//
//   npx tsx scripts/verify-guide-image.ts
//
// WHAT IT PROVES, and the pairing is the point — a route that 404s for everyone
// passes half of evidence 4 while being completely broken:
//   1. bytes go in and the same bytes come back out through presignUrl (the
//      ADMIN-side success path, end to end against the real store)
//   2. canReadImage refuses a non-ADMIN for an image inside the gated section,
//      while allowing the article that contains it (the refusal path)

import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { del, head, presignUrl, issueSignedToken, put } from "@vercel/blob"
import { guideBlobToken, guideBlobTokenSource } from "../src/lib/guide-files"
import { helpScope, type GuideArticle } from "../src/lib/help-access"
import { GUIDE_ARTICLES } from "../src/generated/guide"
import type { PermissionUser } from "../src/lib/permissions"

// LOAD .env OURSELVES rather than requiring `npx tsx --env-file=.env`.
//
// Recorded 2026-09-05 after the documented command failed as written. Neither
// plain `node` nor `npx tsx` reads .env, so this exited on "token is not set"
// while the token sat in .env the whole time — an accurate error message
// attached to a wrong instruction, which sends you to check the one thing that
// is already fine.
//
// Fixing the SCRIPT rather than the INSTRUCTIONS is deliberate: a documented
// flag is a flag someone forgets, and the failure it produces is
// indistinguishable from a genuinely missing credential. A real environment
// variable still wins over the file, so CI is unaffected.
try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"))
} catch {
  // No .env — the variable may come from the real environment instead.
}

// RESOLVED THROUGH guide-files.ts, NOT process.env. Reading the variable here
// is what let this script pass while the deployed route 404'd: it proved the
// STORE was reachable with a token this file happened to name, and never that
// the ROUTE could find one. The name the runtime reads is now the name the
// verifier reads, because it is the same function.
let token: string | null = null
try {
  token = guideBlobToken()
  console.log(`token resolved from ${guideBlobTokenSource()}`)
} catch {
  token = null
}
if (!token) {
  console.error(
    "No guide Blob token in the environment or .env.\n\n" +
      "The deployed name is GUIDE_READ_WRITE_TOKEN — Vercel creates\n" +
      "<PREFIX>_READ_WRITE_TOKEN from the prefix chosen when the store was connected,\n" +
      "and froot-guide used the prefix GUIDE. GUIDE_BLOB_READ_WRITE_TOKEN also works.\n" +
      "Read it from the Vercel dashboard: Storage -> froot-guide -> the connect snippet.\n" +
      "`vercel env pull` is banned repo-wide (CLAUDE.md)."
  )
  process.exit(1)
}

// Bound to a const after the guard above: `token` is a `let`, so TypeScript
// discards the null-narrowing inside the async closure below, where a let could
// in principle have been reassigned.
const TOKEN: string = token

const ARTICLES = GUIDE_ARTICLES as GuideArticle[]
const ORG = { activeModules: ["inventory", "hr", "labor", "nutrition"] }
const actor = (role: string): PermissionUser => ({ role })
// Every image referenced by any article, and the scope that governs it.
// A batch extends this by adding a row. `governedBy` is stated rather than
// derived so a wrong expectation fails instead of quietly agreeing with the
// code — the same reason the gated-section table in verify-help-access.ts
// spells out its denied roles.
const IMAGES = [
  {
    path: "hr-documents/document-detail-01.png",
    article: "hr-documents",
    governedBy: "section versions-and-fields (hr.documents.manage)",
    allowed: ["ADMIN"],
    refused: ["MANAGER", "STORE", "STAFF"],
  },
  {
    path: "hr-forms/form-builder-01.png",
    article: "hr-forms",
    // Article-level, in an ADMIN-only article: the ARTICLE is the narrowest
    // enclosing scope here, which is ruling 7's other half.
    governedBy: "article hr-forms (hr.forms.manage)",
    allowed: ["ADMIN"],
    refused: ["MANAGER", "STORE", "STAFF"],
  },
] as const

let failures = 0
function assert(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n        ${detail}` : ""}`)
  if (!ok) failures++
}

// tsx compiles this to CJS, where top-level await is unavailable — hence main().
async function main(): Promise<void> {
  // ─── 1. THE BYTES HALF — a real round-trip through the private store ───────

  console.log("\n── Evidence 4 (bytes half): round-trip through the private froot-guide store ─\n")

  // A 1x1 PNG. The content is irrelevant — this asserts that what was stored is
  // what comes back, not what it looks like. Written under a _verify/ prefix and
  // deleted at the end so it can never collide with a real guide image.
  const fixture = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
  const fixturePath = `_verify/roundtrip-${Date.now()}.png`
  const sentHash = createHash("sha256").update(fixture).digest("hex")

  let uploaded = false
  try {
    const blob = await put(fixturePath, fixture, {
      access: "private",
      addRandomSuffix: false,
      contentType: "image/png",
      token: TOKEN,
    })
    uploaded = true
    assert("a private blob can be written to froot-guide", blob.pathname === fixturePath, blob.pathname)

    // THE STORED BLOB URL IS NOT FETCHABLE ON ITS OWN. This is the invariant the
    // whole arrangement rests on — if this ever starts returning 200, the
    // authenticated route has become decorative and ruling 7 is undone beneath it.
    const naked = await fetch(blob.url)
    assert(
      "the stored blob URL is NOT fetchable without authorization",
      !naked.ok,
      `bare GET returned ${naked.status} — the private store is not private`
    )

    const delegation = await issueSignedToken({
      operations: ["get"],
      validUntil: Date.now() + 5 * 60 * 1000,
      token: TOKEN,
    })
    const { presignedUrl } = await presignUrl(delegation, {
      operation: "get",
      pathname: fixturePath,
      access: "private",
      validUntil: Date.now() + 5 * 60 * 1000,
    })

    const res = await fetch(presignedUrl)
    assert("an authorized read returns 200", res.ok, `status ${res.status}`)
    const backHash = createHash("sha256")
      .update(Buffer.from(await res.arrayBuffer()))
      .digest("hex")
    assert("the bytes returned are byte-identical to the bytes stored", backHash === sentHash)
  } finally {
    if (uploaded) {
      await del(fixturePath, { token: TOKEN })
      console.log(`  (cleaned up ${fixturePath})`)
    }
  }

  // ─── 2. IS EVERY REFERENCED SCREENSHOT THERE? ─────────────────────────────

  console.log("\n── Referenced screenshots ────────────────────────────────────────────────────\n")

  for (const img of IMAGES) {
    let present = false
    try {
      const meta = await head(img.path, { token: TOKEN })
      present = true
      console.log(`  present — ${img.path} (${(meta.size / 1024).toFixed(0)} KB, ${meta.contentType})`)
    } catch {
      console.log(`  NOT UPLOADED — ${img.path}`)
      console.log(`    referenced by ${img.article}, governed by ${img.governedBy}`)
      console.log("    Capture from PRODUCTION and redact by hand into docs/guide/_review/ (ruling 1),")
      console.log(`    then: node scripts/upload-guide-image.mjs docs/guide/_review/<file> ${img.path}`)
    }
    assert(`${img.path} exists in the store`, present)
  }

  // ─── 3. THE REFUSAL HALF ──────────────────────────────────────────────────
  //
  // Restated here so one run covers both directions. A route that 404s for
  // everyone passes the refusal half while being entirely broken, which is why
  // section 1 above has to be in the same script rather than assumed.

  console.log("\n── Evidence 4 (refusal half): the gate is the narrowest enclosing scope ──────\n")

  for (const img of IMAGES) {
    for (const role of img.allowed) {
      assert(
        `${role} may read ${img.path} (${img.governedBy})`,
        helpScope(actor(role), ORG, ARTICLES, { surface: "app" }).canReadImage(img.path)
      )
    }
    for (const role of img.refused) {
      assert(
        `${role} may NOT read ${img.path}`,
        !helpScope(actor(role), ORG, ARTICLES, { surface: "app" }).canReadImage(img.path)
      )
    }
  }
  assert(
    "an unknown image id is refused for everyone",
    !helpScope(actor("ADMIN"), ORG, ARTICLES, { surface: "app" }).canReadImage("nope/none.png")
  )

  console.log(failures === 0 ? "\nPASS — all assertions held\n" : `\nFAIL — ${failures} assertion(s) failed\n`)
}

main().then(
  () => process.exit(failures === 0 ? 0 : 1),
  (err) => {
    console.error("\nFAIL — the run threw before it could finish:\n", err)
    process.exit(1)
  }
)
