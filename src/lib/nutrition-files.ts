import { createHash, randomBytes } from "crypto"
import { del, head, issueSignedToken, presignUrl } from "@vercel/blob"

// N-1b — private label-document service. Mirrors src/lib/hr-files.ts (HR-3)
// and src/lib/guide-files.ts (HELP-1a) rather than inventing a mechanism:
// private store, presigned browser PUT, authoritative re-read at register,
// authorize-then-presign on read.
//
// ITS OWN STORE AND TOKEN (Gary, 2026-11-01, N-1b storage ruling): "option
// (i), a new private froot-nutrition Blob store, same pattern as froot-hr."
// The HELP-1a reasoning carries over — a nutrition credential or route bug must
// not sit one prefix away from signed employment records.
//
// NUTRITION_BLOB_READ_WRITE_TOKEN is the name Vercel created when Gary
// connected the store with prefix NUTRITION_BLOB (Production + Preview,
// 2026-11-01). Vercel also created NUTRITION_BLOB_STORE_ID and
// NUTRITION_BLOB_WEBHOOK_PUBLIC_KEY; nothing reads them. There is no Development
// connection, so local uploads fail with the message below — by design.

// Label documents are supplier spec sheets and phone photos of a panel.
// HEIC/HEIF are accepted (Gary: "HEIC accepted and offered as a download").
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WEBP",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
}
// N1B-F5 lean: 10 MB. Uploads bypass the ~4.5 MB Function body limit via the
// presigned PUT, so this cap is real, not decorative.
export const LABEL_MAX_BYTES = 10 * 1024 * 1024

const SIGNED_URL_TTL_MS = 5 * 60 * 1000
const DELEGATION_TTL_MS = 10 * 60 * 1000
const DELEGATION_REFRESH_MARGIN_MS = 60 * 1000
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000

export class NutritionFileError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function nutritionBlobToken(): string {
  const token = process.env.NUTRITION_BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new NutritionFileError(
      "Label uploads aren't set up in this environment (NUTRITION_BLOB_READ_WRITE_TOKEN is not set)",
      503
    )
  }
  return token
}

/** The folder every label of one ingredient lives in. Register pins to it. */
export function labelKeyPrefix(orgId: string, ingredientId: string): string {
  return `nutrition/${orgId}/ingredients/${ingredientId}`
}

// Blob pathnames become URL path segments; keep them URL-safe so the presign
// pathname always round-trips exactly with what was stored (hr-files.ts).
function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".")
  const rawBase = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : ""
  const base =
    rawBase.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file"
  return ext ? `${base}.${ext}` : base
}

export function validateLabelMeta(contentType: string, sizeBytes: number): void {
  if (!ALLOWED_TYPES[contentType]) {
    throw new NutritionFileError(`Only ${Object.values(ALLOWED_TYPES).join(", ")} files are allowed`, 400)
  }
  if (sizeBytes > LABEL_MAX_BYTES) {
    throw new NutritionFileError("File must be 10 MB or smaller", 413)
  }
}

/** HEIC is offered as a download, not a preview — desktop browsers can't render it. */
export function isDownloadOnly(contentType: string | null): boolean {
  return contentType === "image/heic" || contentType === "image/heif"
}

// ─── File-type check by first bytes (Gary, N-1b) ─────────────────────────────
// The declared type is baked into the PUT signature, but a renamed file can
// still claim to be what it is not. Register reads the stored bytes anyway (to
// hash them), so the signature check costs nothing. Returns the detected type,
// or null when the bytes match none of the allowed formats.
export function sniffLabelType(bytes: Uint8Array): string | null {
  const at = (i: number, s: string) => [...s].every((c, j) => bytes[i + j] === c.charCodeAt(0))
  if (at(0, "%PDF-")) return "application/pdf"
  if (bytes[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp"
  if (at(4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (["heic", "heix", "heim", "heis", "hevc", "hevx"].includes(brand)) return "image/heic"
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif"
  }
  return null
}

/** Declared and sniffed agree. HEIC and HEIF are one family (the brand box varies by device). */
export function sniffMatches(declared: string, sniffed: string | null): boolean {
  if (sniffed === null) return false
  const family = (t: string) => (t === "image/heif" ? "image/heic" : t)
  return family(declared) === family(sniffed)
}

// Browser-upload leg: a short-lived presigned PUT straight to the store, with
// the declared type and the cap baked into the signature (hr-files.ts
// getHrFileUploadUrl). Only call this AFTER the request passed nutrition.manage.
export async function getLabelUploadUrl({
  keyPrefix,
  fileName,
  contentType,
  sizeBytes,
}: {
  keyPrefix: string
  fileName: string
  contentType: string
  sizeBytes: number
}): Promise<{ pathname: string; uploadUrl: string }> {
  validateLabelMeta(contentType, sizeBytes)
  const token = nutritionBlobToken()

  const safe = safeFileName(fileName)
  const suffix = randomBytes(12).toString("base64url")
  const dot = safe.lastIndexOf(".")
  const unique = dot > 0 ? `${safe.slice(0, dot)}-${suffix}${safe.slice(dot)}` : `${safe}-${suffix}`
  const pathname = `${keyPrefix}/${unique}`
  const validUntil = Date.now() + UPLOAD_URL_TTL_MS

  const delegation = await issueSignedToken({
    pathname,
    operations: ["put"],
    validUntil,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: LABEL_MAX_BYTES,
    token,
  })
  const { presignedUrl } = await presignUrl(delegation, {
    operation: "put",
    pathname,
    access: "private",
    validUntil,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: LABEL_MAX_BYTES,
  })
  return { pathname, uploadUrl: presignedUrl }
}

// Authoritative metadata for a blob the client PUT: size and type from the
// store, sha256 and the first-bytes type from the stored bytes. head() with our
// token only resolves blobs in OUR store, so a URL anywhere else fails here.
export async function readLabelMeta(fileUrl: string): Promise<{
  url: string
  pathname: string
  contentType: string
  sizeBytes: number
  fileHash: string
  sniffedType: string | null
}> {
  const token = nutritionBlobToken()
  const info = await head(fileUrl, { token })
  const res = await fetch(info.url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Failed to read label blob (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return {
    url: info.url,
    pathname: info.pathname,
    contentType: info.contentType,
    sizeBytes: info.size,
    fileHash: createHash("sha256").update(bytes).digest("hex"),
    sniffedType: sniffLabelType(bytes),
  }
}

/** Store-relative pathname out of a full private blob URL. */
export function labelPathnameFromUrl(fileUrl: string): string {
  return new URL(fileUrl).pathname.replace(/^\//, "")
}

/** Best effort: a failed delete leaves an orphan blob, never a failed request. */
export async function deleteLabelBlob(fileUrl: string | null): Promise<void> {
  if (!fileUrl) return
  try {
    await del(fileUrl, { token: nutritionBlobToken() })
  } catch (err) {
    console.error("[nutrition-files] label blob delete failed:", err)
  }
}

let cachedDelegation: { clientSigningToken: string; delegationToken: string; validUntil: number } | null = null

async function getReadDelegation() {
  if (cachedDelegation && cachedDelegation.validUntil - Date.now() > DELEGATION_REFRESH_MARGIN_MS) {
    return cachedDelegation
  }
  cachedDelegation = await issueSignedToken({
    operations: ["get"],
    validUntil: Date.now() + DELEGATION_TTL_MS,
    token: nutritionBlobToken(),
  })
  return cachedDelegation
}

// A short-lived signed GET URL. Only call this AFTER the request passed
// nutrition.view and the record resolved inside the caller's org — the URL
// works for anyone holding it until it expires. Redirect, not stream: a
// Function response is capped near 4.5 MB and labels go to 10 MB.
export async function getLabelDownloadUrl(pathname: string): Promise<string> {
  const delegation = await getReadDelegation()
  const { presignedUrl } = await presignUrl(delegation, {
    operation: "get",
    pathname,
    access: "private",
    validUntil: Date.now() + SIGNED_URL_TTL_MS,
  })
  return presignedUrl
}
