// ─── TAB-16: help requests — client-safe constants and labels ────────────────
// No Prisma here: the tablet sheet, the Messages renderers and the server all
// import this. Rulings: docs/DECISIONS.md 2026-11-12 TAB-16.

/** The notification kind key (registry, NotificationKindSettings, picks). */
export const HELP_REQUEST_KIND = "help.request"

/** The TeamMessage.type. Deliberately NOT in MESSAGE_TYPES: the generic composer can't post one. */
export const HELP_MESSAGE_TYPE = "help_request"

/** R5: "One help request per task per store every 15 minutes." */
export const HELP_WINDOW_MS = 15 * 60 * 1000

/** R6: "an optional note up to 280 characters". */
export const HELP_NOTE_MAX = 280

/** R6: "Three fixed quick reasons … Not editable in v1." Keys are stored in TeamMessage.helpReason. */
export const HELP_REASONS = [
  { key: "still_stuck", label: "Watched it, still stuck" },
  { key: "broken", label: "Something is broken" },
  { key: "supplies", label: "Missing supplies" },
] as const
export type HelpReasonKey = (typeof HELP_REASONS)[number]["key"]
export const HELP_REASON_KEYS = HELP_REASONS.map((r) => r.key) as [HelpReasonKey, ...HelpReasonKey[]]

export function helpReasonLabel(key: string | null | undefined): string | null {
  return HELP_REASONS.find((r) => r.key === key)?.label ?? null
}

/** R4: "Not listed" saves no staff member and shows as "Team member". */
export const NOT_LISTED_NAME = "Team member"

/** R10, verbatim. */
export const NOT_EMAILED_TEXT = "Not emailed in this environment"

/**
 * TeamMessage.helpEmail. Counts and contact addresses only — never a manager
 * address (R3). `off` = the email was switched off when the request posted
 * (R1). `done` = a dispatch ran; the counts say what actually left (R10).
 */
export type HelpEmail =
  | { state: "off" }
  | {
      state: "done"
      storeName: string
      /** Managers the email really reached. */
      managersSent: number
      /** Contact addresses the email really reached. */
      contactsSent: string[]
      /** Recipients whose send failed (R9: never retried). */
      failed: number
      /** Recipients withheld by a dry run or the sandbox allowlist (R10). */
      notEmailed: number
      intentId: string | null
    }

/** Reads the Json column defensively; anything unexpected reads as "off". */
export function parseHelpEmail(raw: unknown): HelpEmail {
  if (!raw || typeof raw !== "object") return { state: "off" }
  const r = raw as Record<string, unknown>
  if (r.state !== "done") return { state: "off" }
  return {
    state: "done",
    storeName: typeof r.storeName === "string" ? r.storeName : "Store",
    managersSent: typeof r.managersSent === "number" ? r.managersSent : 0,
    contactsSent: Array.isArray(r.contactsSent) ? r.contactsSent.filter((x): x is string => typeof x === "string") : [],
    failed: typeof r.failed === "number" ? r.failed : 0,
    notEmailed: typeof r.notEmailed === "number" ? r.notEmailed : 0,
    intentId: typeof r.intentId === "string" ? r.intentId : null,
  }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

/** "Carson managers + 1 contact", "Carson managers", "2 contacts". Empty when nobody. */
export function recipientsPhrase(storeName: string, managers: boolean, contacts: number): string {
  const parts = [managers ? `${storeName} managers` : null, contacts > 0 ? plural(contacts, "contact") : null].filter(Boolean)
  return parts.join(" + ")
}

/**
 * The one line every surface shows for a help request's email (sheet, panel,
 * Messages). R10: "Never claim an email that didn't go out." Only what really
 * left is named as emailed; failures (R9) and dry runs are said plainly.
 */
export function helpEmailLabel(e: HelpEmail): string {
  if (e.state === "off") return "Posted in Messages"
  const sent = recipientsPhrase(e.storeName, e.managersSent > 0, e.contactsSent.length)
  const misses = [
    e.failed > 0 ? (sent ? `${e.failed} didn't go out` : "The email didn't go out") : null,
    e.notEmailed > 0 ? (sent ? `${e.notEmailed} not emailed in this environment` : NOT_EMAILED_TEXT) : null,
  ].filter(Boolean)
  if (!sent && misses.length === 0) return NOT_EMAILED_TEXT
  return [sent ? `Emailed to ${sent}` : null, ...misses].filter(Boolean).join(" · ")
}

/** True when everyone it was meant for really got it, or emails were off. */
export function helpEmailAllSent(e: HelpEmail): boolean {
  return e.state === "off" || (e.failed === 0 && e.notEmailed === 0)
}

/** True when nothing at all left (failed and/or not emailed): the sheet's warning state. */
export function helpEmailMissedAll(e: HelpEmail): boolean {
  return e.state === "done" && e.managersSent === 0 && e.contactsSent.length === 0
}

// ── The tablet's view (built by loadTabletHelp in ./help-requests.ts) ────────

export type TabletHelpContact = { id: string; name: string; email: string; isDefault: boolean }

/** A help request still inside R5's window, for "Help sent to …" and the duplicate state. */
export type TabletHelpRecent = {
  taskId: string
  createdAt: string
  label: string
  askerName: string
  /** R10: true when not everyone it was meant for got the email — shown as a warning, never as success. */
  warn: boolean
}

/**
 * What the Ask-a-manager sheet needs for one store. Manager ADDRESSES are never
 * here (R3): the sheet shows one "[Store] store managers" row and a count.
 */
export type TabletHelp = {
  emailsOn: boolean
  /** Managers of this store with an email address. 0 → the row says so (R3). */
  managerCount: number
  /**
   * Emails on: every active contact when "Team members can add more contacts"
   * is on, only the defaults when it is off (prompt step 4, staging test 6).
   * Emails off: empty — the sheet skips the Send to list (R1).
   */
  contacts: TabletHelpContact[]
  recent: TabletHelpRecent[]
}


/** What a serialized help request carries for the Messages cards (src/lib/messages.ts). */
export type HelpRequestInfo = { task: string; checklist: string | null; reason: string | null; emailed: string }
