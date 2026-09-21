// ─── Notifications (Phase F-5; Resend provider NOTIFY-1) ─────────────────────
// Thin, swappable sender so channels can be added without touching callers.
// Email is the first channel. Two implementations live here:
//
//   NOTIFY_EMAIL_PROVIDER unset | "console"  → consoleEmailSender (logs only)
//   NOTIFY_EMAIL_PROVIDER = "resend"         → Resend over plain fetch
//
// Callers never change: they take an EmailSender from getEmailSender() and
// call send(). Adding a third provider means adding a branch here and nothing
// else.

export type EmailMessage = {
  // NOTIFY-1 widened this from `string[]`. A bare string is accepted so a
  // one-recipient caller (the admin test route) needn't wrap it; every
  // existing array caller is unaffected.
  to: string | string[]
  subject: string
  text: string
  // NOTIFY-1, additive and unused today. HR-16 needs it so a manager who hits
  // Reply on an acknowledgment confirmation reaches their own office rather
  // than the no-reply sending address.
  replyTo?: string
  // NOTIFY-2b. The alternative body, rendered by src/lib/email-template.ts.
  // OPTIONAL AND IT STAYS OPTIONAL: `text` is the part that must always exist,
  // because it is what a plain-text client and every spam filter read. A
  // message with html and no text is the one shape this type must not permit,
  // which is why html is the field that was made nullable and not the reverse.
  html?: string
}

// `id` is the provider's message id where the provider returns one. The
// console sender returns {}. Widening the old `Promise<void>` is safe for
// every caller — pace-alerts.ts awaits send() and discards the result.
export type EmailSendResult = { id?: string }

export type EmailSender = {
  send(msg: EmailMessage): Promise<EmailSendResult>
}

const CONSOLE_PROVIDER = "console"
const RESEND_PROVIDER = "resend"

function recipients(to: EmailMessage["to"]): string[] {
  return Array.isArray(to) ? to : [to]
}

// The resolved provider string, WITHOUT validating it. The admin test route
// reports this alongside a failure, so it must answer even when the value is
// the thing that is wrong.
export function emailProviderName(): string {
  return (process.env.NOTIFY_EMAIL_PROVIDER ?? CONSOLE_PROVIDER).trim().toLowerCase() || CONSOLE_PROVIDER
}

// Default sender: logs the full message instead of delivering it.
export const consoleEmailSender: EmailSender = {
  async send(msg) {
    // THE HTML IS NOT PRINTED, only its length. A branded body is ~4KB of
    // table markup that would bury the message it wraps in every local run and
    // every Vercel function log — and the text part directly below is the same
    // content in the form a human can actually read. The note exists so that a
    // console-mode run still says whether the HTML was built at all, which is
    // the one thing the text alone cannot tell you (NOTIFY-2b).
    const html = msg.html ? ` html=${msg.html.length}b` : " html=(none)"
    console.log(
      `[notify:console] to=${recipients(msg.to).join(", ")} subject="${msg.subject}"${html}\n${msg.text}`
    )
    return {}
  },
}

const RESEND_ENDPOINT = "https://api.resend.com/emails"
// A hung provider must not hold a cron open. maxDuration on the pace-alerts
// route is 300s and it loops every store; ten seconds each is the ceiling.
const RESEND_TIMEOUT_MS = 10_000

export function createResendEmailSender(config: { apiKey: string; from: string }): EmailSender {
  return {
    async send(msg) {
      const to = recipients(msg.to)
      const body: Record<string, unknown> = {
        from: config.from,
        to,
        subject: msg.subject,
        text: msg.text,
      }
      // Sending both makes it multipart/alternative; the client picks. `text`
      // is never dropped when html is present (NOTIFY-2b).
      if (msg.html) body.html = msg.html
      if (msg.replyTo) body.reply_to = msg.replyTo

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (e) {
        // A DOMException named AbortError is what an aborted fetch throws; it
        // is not an Error subclass on every runtime, so duck-type the name.
        const name = (e as { name?: string } | null)?.name
        if (name === "AbortError" || name === "TimeoutError") {
          throw new Error(`[notify:resend] request timed out after ${RESEND_TIMEOUT_MS}ms`)
        }
        throw e
      } finally {
        clearTimeout(timer)
      }

      // Read the body ONCE, as text, before branching — a non-2xx response
      // from Resend carries the reason in it and res.json() on an empty or
      // non-JSON error body throws over the top of the real failure.
      const raw = (await res.text().catch(() => "")).slice(0, 1000)

      if (!res.ok) {
        console.error(`[notify:resend] send failed ${res.status} ${res.statusText}: ${raw}`)
        // THROW, never swallow. The caller decides — the pace-alert cron
        // already catches per store, and the test route turns this into a 502.
        throw new Error(`[notify:resend] ${res.status} ${res.statusText} — ${raw.slice(0, 300)}`)
      }

      let id: string | undefined
      try {
        id = (JSON.parse(raw) as { id?: string }).id
      } catch {
        // 2xx with an unparseable body: the send succeeded, the id is lost.
      }
      console.log(
        `[notify:resend] sent id=${id ?? "(none)"} to=${to.length} recipient(s) subject="${msg.subject}"`
      )
      return { id }
    },
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `[notify] ${name} is not set, and NOTIFY_EMAIL_PROVIDER="${RESEND_PROVIDER}" requires it. ` +
        `There is NO fallback to the console sender: a deployment that believes it is ` +
        `emailing and is not is the exact failure this provider exists to end.`
    )
  }
  return value
}

export function getEmailSender(): EmailSender {
  const provider = emailProviderName()

  if (provider === CONSOLE_PROVIDER) return consoleEmailSender

  if (provider === RESEND_PROVIDER) {
    // CONFIG IS VALIDATED HERE, NOT INSIDE send(), AND THAT IS DELIBERATE.
    // pace-alerts.ts writes the PaceAlertLog idempotency row BEFORE it sends,
    // so a throw at send() time would burn a store's one-alert-per-month lock
    // with no email delivered — unrecoverable until the month rolls. The cron
    // calls getEmailSender() once, before the store loop, so a missing key
    // fails the run with zero rows written instead of poisoning every store.
    return createResendEmailSender({
      apiKey: requiredEnv("RESEND_API_KEY"),
      from: requiredEnv("NOTIFY_FROM_EMAIL"),
    })
  }

  throw new Error(
    `[notify] NOTIFY_EMAIL_PROVIDER="${provider}" is not a provider. ` +
      `Accepted values: "${CONSOLE_PROVIDER}" (the default when unset) or "${RESEND_PROVIDER}".`
  )
}
