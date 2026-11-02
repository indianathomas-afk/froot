import { LABEL_OUTPUT_JSON_SCHEMA, LABEL_READ_INSTRUCTIONS, parseLabelOutput, type LabelOutput } from "@/lib/label-review"

// ─── N-1c: the one call to the Anthropic API ─────────────────────────────────
// fetch, no SDK (Gary, 2026-11-02: "Use fetch, no SDK.") — the same shape as
// notify.ts's Resend call. The document goes as base64, never as a URL: a
// presigned URL handed to a third-party fetcher is the public URL N-1b exists
// to avoid. API facts: platform.claude.com docs (vision, pdf-support,
// structured-outputs), read 2026-11-02 — docs/prompts/N-1c_AUDIT.md § B.

// N1C-F4 (Gary, 2026-11-02): "claude-sonnet-5-5 in one constant." THE place to change it.
export const LABEL_READ_MODEL = "claude-sonnet-5-5"

const ENDPOINT = "https://api.anthropic.com/v1/messages"
const CALL_TIMEOUT_MS = 45_000 // under the route's maxDuration of 60 (Gary, 2026-11-02)
// "10 MB (base64-encoded)" per image on the Claude API.
const IMAGE_BASE64_MAX = 10 * 1024 * 1024

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

export class LabelReadError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function labelReadConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Why this stored file can't be sent, or null. Checked before any call. */
export function unreadableTypeReason(contentType: string | null): string | null {
  // N1C-F5 (Gary): "HEIC stays attached as proof; Read label is disabled on it with a 'share as JPEG' instruction."
  if (contentType === "image/heic" || contentType === "image/heif") {
    return "HEIC photos can't be read. Upload a JPG or PNG of the label (on iPhone: Share → Save as JPEG, or Settings → Camera → Formats → Most Compatible)."
  }
  if (contentType !== "application/pdf" && !IMAGE_TYPES.has(contentType ?? "")) return "This file type can't be read."
  return null
}

export async function readLabelWithModel(bytes: Uint8Array, contentType: string): Promise<LabelOutput> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new LabelReadError("Label reading isn't set up in this environment (ANTHROPIC_API_KEY is not set)", 503, "not_configured")
  const typeReason = unreadableTypeReason(contentType)
  if (typeReason) throw new LabelReadError(typeReason, 415, "unsupported_type")

  const data = Buffer.from(bytes).toString("base64")
  if (contentType !== "application/pdf" && data.length > IMAGE_BASE64_MAX) {
    throw new LabelReadError("This photo is too large to read. Retake it or export a smaller JPG (under about 7 MB).", 413, "image_too_large")
  }
  const source = { type: "base64", media_type: contentType, data }
  const block = contentType === "application/pdf" ? { type: "document", source } : { type: "image", source }

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: LABEL_READ_MODEL,
        max_tokens: 4000,
        // Document first, then the instructions (vision docs: images before text).
        messages: [{ role: "user", content: [block, { type: "text", text: LABEL_READ_INSTRUCTIONS }] }],
        output_config: { format: { type: "json_schema", schema: LABEL_OUTPUT_JSON_SCHEMA } },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
    throw new LabelReadError(timedOut ? "Reading the label took too long. Try again." : "Couldn't reach the label reader. Try again.", 504, timedOut ? "timeout" : "network")
  }

  // Never surface the raw API error; log it server-side only.
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    console.error(`[label-read] Anthropic ${res.status}: ${detail.slice(0, 500)}`)
    if (res.status === 429 || res.status === 529) throw new LabelReadError("The label reader is busy. Try again in a minute.", 503, `api_${res.status}`)
    if (res.status === 400 || res.status === 413) throw new LabelReadError("This file couldn't be read. Try a clearer PDF, JPG or PNG.", 422, `api_${res.status}`)
    throw new LabelReadError("The label reader failed. Try again.", 502, `api_${res.status}`)
  }

  const body = (await res.json().catch(() => null)) as { stop_reason?: string; content?: { type: string; text?: string }[] } | null
  if (body?.stop_reason === "refusal") throw new LabelReadError("The label reader declined this file.", 422, "refusal")
  if (body?.stop_reason === "max_tokens") throw new LabelReadError("The label reader's answer was cut off. Try again.", 502, "max_tokens")
  const text = body?.content?.find((c) => c.type === "text")?.text
  const parsed = parseLabelOutput(text ?? "")
  if (!parsed.ok) throw new LabelReadError(parsed.error, 422, "malformed_output")
  return parsed.output
}
