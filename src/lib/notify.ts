// ─── Notifications (Phase F-5) ───────────────────────────────────────────────
// Thin, swappable sender so channels can be added without touching callers.
// Email is the first channel; the default implementation just logs (visible in
// Vercel function logs) until a real provider is chosen. To wire one up later:
// implement EmailSender.send() for the provider and branch on
// NOTIFY_EMAIL_PROVIDER in getEmailSender() — callers never change.

export type EmailMessage = {
  to: string[]
  subject: string
  text: string
}

export type EmailSender = {
  send(msg: EmailMessage): Promise<void>
}

// Default sender: logs the full message instead of delivering it.
export const consoleEmailSender: EmailSender = {
  async send(msg) {
    console.log(`[notify:console] to=${msg.to.join(", ")} subject="${msg.subject}"\n${msg.text}`)
  },
}

export function getEmailSender(): EmailSender {
  // NOTIFY_EMAIL_PROVIDER: "console" (default). Future: "resend" | "smtp".
  return consoleEmailSender
}
