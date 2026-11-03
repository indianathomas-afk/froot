import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP } from "node:net"
import type { LookupFunction } from "node:net"
import { LABEL_MAX_BYTES, sniffLabelType, sniffMatches } from "@/lib/nutrition-files"

// ─── N-1e: fetch a label file from a pasted link ─────────────────────────────
// THE FIRST SERVER FETCH OF A USER-SUPPLIED URL IN FROOT (audit § D). Every
// other server fetch goes to a fixed host or to a URL our own Blob store
// minted. N1E-F4 (Gary, 2026-11-02, "Accept all leans"): https only; refuse
// private, loopback, link-local, metadata and other non-public addresses,
// re-checked after every redirect, max 3 redirects; 10 MB cap enforced while
// streaming; short timeout; only PDF/PNG/JPEG/WEBP by both Content-Type and
// first bytes; never send cookies or credentials; HTML refused. Audit
// additions, accepted with the leans: the address is checked AT CONNECT TIME
// (a custom `lookup` on node:https — R3, no new dependency), so a name that
// resolves public for a pre-check and private for the connect (DNS
// rebinding) still cannot reach a private address; port 443 only; no
// user:pass@ in the URL; IPv4-mapped IPv6 unwrapped before the check.
//
// The checks that need no network (checkLinkUrl, isBlockedAddress,
// guardedLookup, the redirect/size/type logic in fetchLabelFromLink via an
// injected transport) are what scripts/verify-n1e.ts pins.

export const LINK_MAX_REDIRECTS = 3
export const LINK_TIMEOUT_MS = 15_000

export const LINK_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"])

export const HTML_REFUSAL = "That link is a web page, not a label file. Open the page, save the label image, and upload it."
const HEIC_REFUSAL =
  "HEIC photos can't be read. Use a link to a JPG, PNG, WEBP or PDF instead (on iPhone: Share → Save as JPEG, or Settings → Camera → Formats → Most Compatible)."

export class LinkFetchError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Non-public ranges. IPv4 per RFC 6890 special-purpose registry (the ones a
// fetch could abuse), IPv6 likewise; ::ffff:0:0/96 is unwrapped instead.
const BLOCKED = new BlockList()
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(net, prefix, "ipv4")
for (const [net, prefix] of [
  ["::", 96] /* unspecified, loopback, IPv4-compatible */, ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(net, prefix, "ipv6")

/** True when an IP literal is not a public unicast address (or isn't an IP at all). */
export function isBlockedAddress(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").split("%")[0]
  const family = isIP(a)
  if (family === 4) return BLOCKED.check(a, "ipv4")
  if (family === 6) {
    // ::ffff:a.b.c.d / ::ffff:hhhh:hhhh (and its zero-padded long forms) —
    // judge the IPv4 address it carries.
    const mapped = a.toLowerCase().match(/^(?:::|(?:0{1,4}:){5})ffff:(.+)$/)
    if (mapped) {
      const tail = mapped[1]
      if (isIP(tail) === 4) return BLOCKED.check(tail, "ipv4")
      const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
      if (hex) {
        const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)
        return BLOCKED.check([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."), "ipv4")
      }
      return true
    }
    return BLOCKED.check(a, "ipv6")
  }
  return true
}

/** The URL is acceptable to try, or a LinkFetchError says why not. No network. */
export function checkLinkUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new LinkFetchError("That isn't a web address.", "invalid_url")
  }
  if (u.protocol !== "https:") throw new LinkFetchError("Only https:// links can be read.", "scheme")
  if (u.username || u.password) throw new LinkFetchError("Links with a user name or password can't be read.", "userinfo")
  if (u.port && u.port !== "443") throw new LinkFetchError("Only links on the standard https port can be read.", "port")
  const host = u.hostname.toLowerCase().replace(/\.$/, "")
  if (!host) throw new LinkFetchError("That isn't a web address.", "invalid_url")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new LinkFetchError("That link points at a private address.", "host_blocked")
  }
  // An IP-literal host never goes through `lookup`, so it is judged here.
  const literal = host.replace(/^\[|\]$/g, "")
  if (isIP(literal) && isBlockedAddress(literal)) throw new LinkFetchError("That link points at a private address.", "address_blocked")
  return u
}

type Resolver = (host: string) => Promise<{ address: string; family: number }[]>
const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true })

/** A net `lookup` that resolves, refuses if ANY address is non-public, and
 *  hands the socket only vetted addresses. Called on every connection,
 *  including every redirect hop. */
export function guardedLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addrs) => {
        if (addrs.length === 0) throw new LinkFetchError("That link's address couldn't be found.", "dns")
        if (addrs.some((a) => isBlockedAddress(a.address))) throw new LinkFetchError("That link points at a private address.", "address_blocked")
        const wanted = options.family === 4 || options.family === 6 ? addrs.filter((a) => a.family === options.family) : addrs
        const pick = wanted.length ? wanted : addrs
        if (options.all) callback(null, pick)
        else callback(null, pick[0].address, pick[0].family)
      })
      .catch((err: unknown) => {
        const e = err instanceof LinkFetchError ? err : new LinkFetchError("That link's address couldn't be found.", "dns")
        callback(Object.assign(e, { errno: undefined }) as NodeJS.ErrnoException, "", 0)
      })
  }
}

/** One HTTP exchange, no redirect following. Injectable so the fixture can
 *  drive redirects, sizes and types without the network. */
export type LinkResponse = {
  status: number
  headers: Record<string, string | undefined>
  body: AsyncIterable<Uint8Array>
  abort: () => void
}
export type LinkTransport = (url: URL, signal: AbortSignal) => Promise<LinkResponse>

export const httpsTransport: LinkTransport = (url, signal) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        lookup: guardedLookup(),
        agent: false, // no pooled sockets shared with any other request
        signal,
        // No Cookie, no Authorization, nothing forwarded from the caller.
        headers: { "user-agent": "Froot-label-fetch/1.0", accept: "application/pdf,image/png,image/jpeg,image/webp" },
      },
      (res) => {
        const headers: Record<string, string | undefined> = {}
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
        resolve({ status: res.statusCode ?? 0, headers, body: res, abort: () => res.destroy() })
      }
    )
    req.on("error", reject)
    req.end()
  })

/** For audit rows: the host only, never the path or query (they can carry tokens). */
export function linkHost(raw: string): string | null {
  try {
    return new URL(raw).hostname
  } catch {
    return null
  }
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

/** A file name for a fetched label: the link's last path segment, with the extension its type implies. */
export function linkFileName(finalUrl: string, contentType: string): string {
  let last = ""
  try {
    last = decodeURIComponent(new URL(finalUrl).pathname.split("/").filter(Boolean).pop() ?? "")
  } catch {
    last = ""
  }
  const base = last.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 120) || "label-from-link"
  return `${base}.${EXT[contentType] ?? "bin"}`
}

export type FetchedLabel ={ bytes: Uint8Array; contentType: string; finalUrl: string; redirects: number }

const baseType = (h: string | undefined) => (h ?? "").split(";")[0].trim().toLowerCase()

/** Fetch a label file from a link, or throw a LinkFetchError with a plain-language reason. */
export async function fetchLabelFromLink(
  raw: string,
  { transport = httpsTransport, timeoutMs = LINK_TIMEOUT_MS }: { transport?: LinkTransport; timeoutMs?: number } = {}
): Promise<FetchedLabel> {
  const signal = AbortSignal.timeout(timeoutMs)
  let url = checkLinkUrl(raw)
  let redirects = 0
  try {
    for (;;) {
      const res = await transport(url, signal)
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        res.abort()
        if (redirects >= LINK_MAX_REDIRECTS) throw new LinkFetchError("That link redirects too many times.", "too_many_redirects")
        redirects++
        let next: URL
        try {
          next = new URL(res.headers.location, url)
        } catch {
          throw new LinkFetchError("That link redirects somewhere invalid.", "invalid_redirect")
        }
        url = checkLinkUrl(next.toString()) // every hop re-checked; the lookup re-checks its address
        continue
      }
      if (res.status !== 200) {
        res.abort()
        throw new LinkFetchError(`That link didn't return a file (the site answered ${res.status}).`, "http_status")
      }

      const declared = baseType(res.headers["content-type"])
      if (declared === "text/html" || declared === "application/xhtml+xml") {
        res.abort()
        throw new LinkFetchError(HTML_REFUSAL, "html")
      }
      if (declared === "image/heic" || declared === "image/heif") {
        res.abort()
        throw new LinkFetchError(HEIC_REFUSAL, "heic", 415)
      }
      if (!LINK_TYPES.has(declared)) {
        res.abort()
        throw new LinkFetchError("That link isn't a PDF, PNG, JPG or WEBP file.", "type", 415)
      }
      const length = Number(res.headers["content-length"])
      if (Number.isFinite(length) && length > LABEL_MAX_BYTES) {
        res.abort()
        throw new LinkFetchError("That file is larger than 10 MB.", "too_large", 413)
      }

      // The cap holds even when Content-Length is missing or lies.
      const chunks: Uint8Array[] = []
      let total = 0
      for await (const chunk of res.body) {
        total += chunk.byteLength
        if (total > LABEL_MAX_BYTES) {
          res.abort()
          throw new LinkFetchError("That file is larger than 10 MB.", "too_large", 413)
        }
        chunks.push(chunk)
      }
      const bytes = new Uint8Array(total)
      let at = 0
      for (const c of chunks) {
        bytes.set(c, at)
        at += c.byteLength
      }

      const sniffed = sniffLabelType(bytes)
      if (sniffed === null && /^\s*</.test(new TextDecoder().decode(bytes.slice(0, 64)))) throw new LinkFetchError(HTML_REFUSAL, "html")
      if (!sniffMatches(declared, sniffed)) {
        throw new LinkFetchError("That file's contents don't match its type. Link to a PDF, PNG, JPG or WEBP file.", "mismatch")
      }
      return { bytes, contentType: declared, finalUrl: url.toString(), redirects }
    }
  } catch (err) {
    if (err instanceof LinkFetchError) throw err
    const cause = err as { code?: string; name?: string; cause?: unknown }
    if (cause?.cause instanceof LinkFetchError) throw cause.cause
    if (signal.aborted || cause?.name === "TimeoutError" || cause?.name === "AbortError") {
      throw new LinkFetchError("That link took too long to answer.", "timeout", 504)
    }
    throw new LinkFetchError("Couldn't fetch that link.", "network", 502)
  }
}
