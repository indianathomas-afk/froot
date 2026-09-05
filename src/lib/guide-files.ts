import { issueSignedToken, presignUrl } from "@vercel/blob"

// HELP-1a — private guide-image service. Mirrors src/lib/hr-files.ts (HR-3)
// rather than inventing a mechanism: private store, authorize-then-presign, a
// short signed-URL TTL, a cached delegation token, and a same-origin streaming
// path with IDENTICAL authorization on both routes.
//
// WHY IMAGES ARE NOT IN public/. Verified against production on 2026-09-04: a
// file at public/guide/x.png returns 200 to anyone who guesses the URL, with no
// session. The proxy matcher's negative lookahead lists `png`, so the request
// never reaches auth.protect() at all. That is not a risk, it is a measured
// fact, and it disqualifies public/ for every guide image — not merely the
// sensitive ones (ruling 7).
//
// AND WHY THERE IS NO SPLIT BY RISK BUCKET. A storage architecture that files
// images by whether their page shows PII inherits every future misclassification
// silently — and the audit's own risk sweep was wrong twice before it settled
// (it mis-scored /store-view/checklist/[id] and /hr/signed-records as clean
// because the pattern omitted displayName/fullName). A single authenticated
// route has no classification step, so it cannot be classified wrongly.
//
// ITS OWN STORE AND TOKEN (Gary's ruling, 2026-09-04, fork 9): "separate
// froot-guide store and token. Pattern shared, blast radius not." A leaked
// guide credential must not reach signed employment records.

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WEBP",
}

// Screenshots, not handbooks. HR's ceiling is 25 MB because Keva's handbook is
// 15.3 MB; a redacted PNG of one screen has no business approaching that.
const MAX_BYTES = 5 * 1024 * 1024

const SIGNED_URL_TTL_MS = 5 * 60 * 1000
const DELEGATION_TTL_MS = 10 * 60 * 1000
const DELEGATION_REFRESH_MARGIN_MS = 60 * 1000

// THE ONE PLACE the guide token is resolved. Exported so the verification
// scripts resolve it the same way the route does — reading process.env
// themselves is how a script proves the STORE works while the ROUTE cannot
// reach it, which is exactly what happened on 2026-09-05.
//
// GUIDE_READ_WRITE_TOKEN IS THE PLATFORM'S NAME AND IS LISTED FIRST. Connecting
// a Blob store on Vercel auto-creates `<PREFIX>_READ_WRITE_TOKEN` from the
// prefix chosen at connect time; froot-guide was connected with prefix GUIDE,
// so the deployed variable is GUIDE_READ_WRITE_TOKEN. HR's store was connected
// with prefix HR_BLOB, which is the only reason HR_BLOB_READ_WRITE_TOKEN looks
// like it follows a convention — it does not, it is a coincidence of prefix.
//
// GUIDE_BLOB_READ_WRITE_TOKEN is accepted as a fallback because that is the
// name a local .env was set up with by hand before the mismatch was found. Both
// resolve; neither is required to be the one present.
export function guideBlobToken(): string {
  const token = process.env.GUIDE_READ_WRITE_TOKEN ?? process.env.GUIDE_BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new Error(
      "No guide Blob token — set GUIDE_READ_WRITE_TOKEN (the name Vercel creates for the " +
        "froot-guide store) or GUIDE_BLOB_READ_WRITE_TOKEN. See CLAUDE.md § Environment Variables."
    )
  }
  return token
}

/** Which variable supplied the token, for diagnostics. Never the value. */
export function guideBlobTokenSource(): string | null {
  if (process.env.GUIDE_READ_WRITE_TOKEN) return "GUIDE_READ_WRITE_TOKEN"
  if (process.env.GUIDE_BLOB_READ_WRITE_TOKEN) return "GUIDE_BLOB_READ_WRITE_TOKEN"
  return null
}

export function validateGuideImageMeta(contentType: string, sizeBytes: number): void {
  if (!ALLOWED_TYPES[contentType]) {
    throw new Error(`Only ${Object.values(ALLOWED_TYPES).join(", ")} images are allowed`)
  }
  if (sizeBytes > MAX_BYTES) {
    throw new Error(`Image exceeds ${MAX_BYTES / (1024 * 1024)} MB`)
  }
}

// Guide images are immutable once uploaded and shared by every reader who may
// see them, so one delegation serves all of them — exactly HR-3's arrangement,
// and the reason per-image authorization is affordable at all. One control-plane
// call per ~9 minutes rather than one per image.
let cachedDelegation: { clientSigningToken: string; delegationToken: string; validUntil: number } | null =
  null

async function getReadDelegation() {
  if (cachedDelegation && cachedDelegation.validUntil - Date.now() > DELEGATION_REFRESH_MARGIN_MS) {
    return cachedDelegation
  }
  cachedDelegation = await issueSignedToken({
    operations: ["get"],
    validUntil: Date.now() + DELEGATION_TTL_MS,
    token: guideBlobToken(),
  })
  return cachedDelegation
}

/**
 * A short-lived signed GET URL for a private guide image.
 *
 * ONLY call this after the request has passed helpScope().canReadImage — the
 * URL works for anyone holding it until it expires.
 */
export async function getGuideImageUrl(pathname: string): Promise<string> {
  const delegation = await getReadDelegation()
  const { presignedUrl } = await presignUrl(delegation, {
    operation: "get",
    pathname,
    access: "private",
    validUntil: Date.now() + SIGNED_URL_TTL_MS,
  })
  return presignedUrl
}

/**
 * Same-origin delivery: proxy the bytes through the Function.
 *
 * THIS IS THE PATH <img> USES. A redirect to a signed URL works, but a signed
 * URL in the DOM is a capability-gated image reachable by anyone the reader
 * pastes it to for the next five minutes. Streaming keeps the bytes same-origin
 * and keeps the only durable reference to the image an authorized route.
 *
 * The authorization contract is identical on both paths, which is what stops
 * this becoming an accidental bypass of the redirect path.
 */
export async function streamGuideImage(pathname: string): Promise<Response> {
  const url = await getGuideImageUrl(pathname)
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch guide blob (${res.status})`)
  }
  return res
}
