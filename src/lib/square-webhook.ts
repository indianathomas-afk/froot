import crypto from "crypto"

// ─── Square webhook signature (Phase F-4) ────────────────────────────────────
// Square signs every webhook delivery with HMAC-SHA256 over
// (notification URL + raw request body), base64-encoded, sent in the
// x-square-hmacsha256-signature header. The key is per-subscription, shown in
// the Square Developer Dashboard (env: SQUARE_WEBHOOK_SIGNATURE_KEY). The URL
// must match the subscription's notification URL byte-for-byte — we derive it
// from NEXT_PUBLIC_APP_URL rather than the request (proxies rewrite hosts).

export const SQUARE_SIGNATURE_HEADER = "x-square-hmacsha256-signature"

export function squareWebhookSignature(notificationUrl: string, rawBody: string, signatureKey: string): string {
  return crypto.createHmac("sha256", signatureKey).update(notificationUrl + rawBody).digest("base64")
}

export function verifySquareWebhookSignature(
  notificationUrl: string,
  rawBody: string,
  signatureKey: string,
  signatureHeader: string | null
): boolean {
  if (!signatureHeader) return false
  const expected = Buffer.from(squareWebhookSignature(notificationUrl, rawBody, signatureKey), "utf8")
  const given = Buffer.from(signatureHeader, "utf8")
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}
