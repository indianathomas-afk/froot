// ─── NOTIFY-6: the notification registry ─────────────────────────────────────
// ONE ENTRY PER KIND OF EMAIL. Adding a kind is one defineNotification() call
// in src/lib/notifications/kinds/ plus one line in KINDS below — no table, no
// guard, no test route, no log code of its own (NOTIFY-3 audit § 4.7). The
// dispatcher (./dispatch.ts) is the only code that reads these definitions.
//
// A definition says WHAT the kind is. It never says HOW mail leaves: mode,
// sandbox filtering, one-message-per-recipient, the sent-once lock, retries and
// the log are the dispatcher's, identical for every kind.
//
// MS-4b added both things NOTIFY-6 left out (audit C7): `batch:
// "per-recipient-daily"` (the grouped mode, dispatch.ts) and `sample()`, which
// the test kind renders for "Send a sample to me" (kinds/test.ts).

import type { NotificationKindDef } from "./define"
import { paceAlertKind } from "./kinds/pace-alert"
import { hrAckKind } from "./kinds/hr-ack"
import { testKind } from "./kinds/test"
import { milestoneKind } from "./kinds/milestone"
import { docDigestKind } from "./kinds/doc-digest"

export * from "./define"

const KINDS: NotificationKindDef<unknown>[] = [paceAlertKind, hrAckKind, testKind, milestoneKind, docDigestKind]

const BY_KIND = new Map(KINDS.map((k) => [k.kind, k]))

export function getKind(kind: string): NotificationKindDef<unknown> | undefined {
  return BY_KIND.get(kind)
}

export function kindLabel(kind: string): string {
  return BY_KIND.get(kind)?.label ?? kind
}
