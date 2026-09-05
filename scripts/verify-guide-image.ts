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

const token = process.env.GUIDE_BLOB_READ_WRITE_TOKEN
if (!token) {
  console.error(
    "GUIDE_BLOB_READ_WRITE_TOKEN is not set, and .env does not supply it either.\n\n" +
      "It must be in your local .env, the same way HR_BLOB_READ_WRITE_TOKEN and\n" +
      "BLOB_READ_WRITE_TOKEN already are. Connecting a Blob store to a Vercel project\n" +
      "creates the variable in the DEPLOYED environments only — nothing injects it locally,\n" +
      "and there is no password-manager copy to find unless you made one. Read it from the\n" +
      "Vercel dashboard: Storage -> froot-guide -> the connect / .env.local snippet.\n" +
      "`vercel env pull` is banned repo-wide (CLAUDE.md)."
  )
  process.exit(1)
}

const ARTICLES = GUIDE_ARTICLES as GuideArticle[]
const ORG = { activeModules: ["inventory", "hr", "labor", "nutrition"] }
const actor = (role: string): PermissionUser => ({ role })
const GATED_IMAGE = "hr-documents/document-detail-01.png"

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
      token,
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
      token,
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
      await del(fixturePath, { token })
      console.log(`  (cleaned up ${fixturePath})`)
    }
  }

  // ─── 2. IS THE REAL SCREENSHOT THERE? ─────────────────────────────────────

  console.log("\n── The document-library gated-section screenshot ─────────────────────────────\n")

  let realImagePresent = false
  try {
    const meta = await head(GATED_IMAGE, { token })
    realImagePresent = true
    console.log(`  present — ${GATED_IMAGE} (${(meta.size / 1024).toFixed(0)} KB, ${meta.contentType})`)
  } catch {
    console.log(`  NOT UPLOADED — ${GATED_IMAGE} is referenced by the document library's`)
    console.log("  gated section but does not exist in the store.")
    console.log("  Capture and redact per ruling 1 (from production, by hand, into docs/guide/_review/),")
    console.log(`  then: node scripts/upload-guide-image.mjs docs/guide/_review/<file> ${GATED_IMAGE}`)
  }
  assert("the referenced guide image exists in the store", realImagePresent)

  // ─── 3. THE REFUSAL HALF ──────────────────────────────────────────────────
  //
  // Restated here so one run covers both directions. A route that 404s for
  // everyone passes the refusal half while being entirely broken, which is why
  // section 1 above has to be in the same script rather than assumed.

  console.log("\n── Evidence 4 (refusal half): the gate is the narrowest enclosing scope ──────\n")

  const adminScope = helpScope(actor("ADMIN"), ORG, ARTICLES, { surface: "app" })
  const storeScope = helpScope(actor("STORE"), ORG, ARTICLES, { surface: "app" })

  assert("ADMIN may read the image inside the gated section", adminScope.canReadImage(GATED_IMAGE))
  assert(
    "STORE may NOT — although STORE may read the article that contains it",
    !storeScope.canReadImage(GATED_IMAGE) && storeScope.canReadArticle("hr-documents")
  )
  assert("an unknown image id is refused for everyone", !adminScope.canReadImage("nope/none.png"))

  console.log(failures === 0 ? "\nPASS — all assertions held\n" : `\nFAIL — ${failures} assertion(s) failed\n`)
}

main().then(
  () => process.exit(failures === 0 ? 0 : 1),
  (err) => {
    console.error("\nFAIL — the run threw before it could finish:\n", err)
    process.exit(1)
  }
)
