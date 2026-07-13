import { createHash, randomBytes } from "crypto"
import { head, put, issueSignedToken, presignUrl } from "@vercel/blob"

// Private HR file service (HR-3). All HR document files live in the dedicated
// PRIVATE Blob store (froot-hr) — never the public store that serves checklist
// task attachments. A stored blob URL is not fetchable on its own: every read
// goes through an app route that authorizes the viewer and then mints a
// short-lived signed URL. Server-side only — the RW token must never reach the
// client.

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
}
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — matches the task-attachment limit

// Signed GET URLs live 5 minutes; the underlying delegation token is issued
// for 10 and cached until it is within a minute of expiry, so steady traffic
// costs one control-plane call per ~9 minutes rather than one per download.
const SIGNED_URL_TTL_MS = 5 * 60 * 1000
const DELEGATION_TTL_MS = 10 * 60 * 1000
const DELEGATION_REFRESH_MARGIN_MS = 60 * 1000
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000

export class HrFileValidationError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function hrBlobToken(): string {
  const token = process.env.HR_BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new Error(
      "HR_BLOB_READ_WRITE_TOKEN is not set — connect the private froot-hr Blob store (see CLAUDE.md)"
    )
  }
  return token
}

// Blob pathnames become URL path segments; keep them URL-safe so the presign
// pathname always round-trips exactly with what put() stored.
function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".")
  const rawBase = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : ""
  const base =
    rawBase.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file"
  return ext ? `${base}.${ext}` : base
}

export interface HrFileUploadResult {
  url: string
  pathname: string
  fileName: string
  contentType: string
  sizeBytes: number
  fileHash: string
}

export function validateHrFileMeta(contentType: string, sizeBytes: number): void {
  if (!ALLOWED_TYPES[contentType]) {
    throw new HrFileValidationError(
      `Only ${Object.values(ALLOWED_TYPES).join(", ")} files are allowed`,
      400
    )
  }
  if (sizeBytes > MAX_BYTES) {
    throw new HrFileValidationError("File must be 10 MB or smaller", 413)
  }
}

// Server-side upload (used by scripts and future server-generated files, e.g.
// HR-4 signed PDFs). Browser uploads must NOT come through here — a Vercel
// Function rejects request bodies over ~4.5 MB with a 413 before our code
// runs. The UI uses getHrFileUploadUrl + a direct PUT to the store instead.
export async function uploadHrFile(
  file: File,
  { keyPrefix }: { keyPrefix: string }
): Promise<HrFileUploadResult> {
  validateHrFileMeta(file.type, file.size)

  const bytes = Buffer.from(await file.arrayBuffer())
  // sha256 of the exact stored bytes — HR-4 acknowledgments pin to this hash.
  const fileHash = createHash("sha256").update(bytes).digest("hex")

  const blob = await put(`${keyPrefix}/${safeFileName(file.name)}`, bytes, {
    access: "private",
    addRandomSuffix: true,
    contentType: file.type,
    token: hrBlobToken(),
  })

  return {
    url: blob.url,
    pathname: blob.pathname,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: bytes.length,
    fileHash,
  }
}

// Browser-upload path: mint a short-lived presigned PUT URL so the client
// sends the file directly to the Blob store, bypassing the ~4.5 MB Vercel
// Function body limit. The declared content type and the 10 MB cap are baked
// into the signature (allowedContentTypes / maximumSizeInBytes), so the CDN
// enforces them even against a dishonest client; readHrFileMeta re-reads the
// stored blob afterwards for the authoritative metadata. Only call this AFTER
// the request has passed the ADMIN gate.
export async function getHrFileUploadUrl({
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
  validateHrFileMeta(contentType, sizeBytes)

  // The control plane appends its own random suffix on top of this pathname
  // and returns the final URL in the PUT response (a PutBlobResult JSON) —
  // the client must register THAT url, not this pathname. Our suffix keeps
  // names unique either way.
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
    maximumSizeInBytes: MAX_BYTES,
    token: hrBlobToken(),
  })
  const { presignedUrl } = await presignUrl(delegation, {
    operation: "put",
    pathname,
    access: "private",
    validUntil,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_BYTES,
  })
  return { pathname, uploadUrl: presignedUrl }
}

// Authoritative metadata for a blob the client uploaded via presigned PUT:
// size and content type from the store, sha256 computed server-side from the
// stored bytes (never trusted from the client — HR-4 acknowledgments pin to
// this hash). head() with our token only resolves blobs in OUR store, so a
// URL pointing anywhere else fails here.
export async function readHrFileMeta(urlOrPathname: string): Promise<{
  url: string
  contentType: string
  sizeBytes: number
  fileHash: string
}> {
  const info = await head(urlOrPathname, { token: hrBlobToken() })
  const res = await fetch(info.url, {
    headers: { authorization: `Bearer ${hrBlobToken()}` },
  })
  if (!res.ok) throw new Error(`Failed to read HR blob for hashing (${res.status})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  return {
    url: info.url,
    contentType: info.contentType,
    sizeBytes: info.size,
    fileHash: createHash("sha256").update(bytes).digest("hex"),
  }
}

// HrDocumentVersion stores the full private blob URL; presigning needs the
// store-relative pathname back out of it.
export function hrPathnameFromUrl(fileUrl: string): string {
  return new URL(fileUrl).pathname.replace(/^\//, "")
}

let cachedDelegation: { clientSigningToken: string; delegationToken: string; validUntil: number } | null = null

async function getReadDelegation() {
  if (cachedDelegation && cachedDelegation.validUntil - Date.now() > DELEGATION_REFRESH_MARGIN_MS) {
    return cachedDelegation
  }
  cachedDelegation = await issueSignedToken({
    operations: ["get"],
    validUntil: Date.now() + DELEGATION_TTL_MS,
    token: hrBlobToken(),
  })
  return cachedDelegation
}

// Mint a short-lived signed GET URL for a private HR blob. Only call this
// AFTER the request has passed canReadHrDocument — the URL works for anyone
// who holds it until it expires.
export async function getHrFileDownloadUrl(pathname: string): Promise<string> {
  const delegation = await getReadDelegation()
  const { presignedUrl } = await presignUrl(delegation, {
    operation: "get",
    pathname,
    access: "private",
    validUntil: Date.now() + SIGNED_URL_TTL_MS,
  })
  return presignedUrl
}

// Fallback delivery: proxy the bytes through the Function with the RW token
// instead of redirecting to a signed URL. Same authorization contract applies.
export async function streamHrFile(fileUrl: string): Promise<Response> {
  const res = await fetch(fileUrl, {
    headers: { authorization: `Bearer ${hrBlobToken()}` },
  })
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch HR blob (${res.status})`)
  }
  return res
}

// Document access policy, keyed on HrDocument.kind. The download route (and
// every future HR read path) must resolve version → document and ask this
// function — authorization is per document policy, never "any HR file".
export function canReadHrDocument(
  doc: { kind: string; organizationId: string },
  viewer: { orgDbId: string; role: string | null }
): boolean {
  if (doc.organizationId !== viewer.orgDbId) return false
  switch (doc.kind) {
    case "Reference":
      // General HR library: readable by every authenticated member of the org.
      return true
    // HR-4: case "Acknowledgment":
    // HR-4: case "FillableForm":
    //   ADMIN/MANAGER, or the staff member the document is assigned to.
    default:
      return false
  }
}
