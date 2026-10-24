import Link from "next/link"
import { getKind } from "@/lib/notifications/registry"
import type { ContactView } from "@/lib/notifications/contacts"
import { AlsoSendTo } from "./also-send-to"

// ─── NOTIFY-12: the Recipients block on each email card ─────────────────────
// Replaces each card's hard-coded "Recipients:" paragraph. The first line is
// the kind's ROLE DEFAULT, read from the registry (roleDefault), so the copy
// cannot drift from the resolver it describes. Then, for a kind with
// `extras: true`, the "Also send to" picker; for one without (milestone, F11),
// a line saying so.

export function RecipientsSection({
  kind,
  contacts,
  pickedIds,
  pickerHelp,
}: {
  kind: string
  /** Every contact, archived included; the picker shows the active ones. */
  contacts: ContactView[]
  /** Contact ids currently picked for this kind, archived included. */
  pickedIds: string[]
  pickerHelp?: string
}) {
  const def = getKind(kind)
  if (!def) return null
  const active = contacts.filter((c) => !c.archived)
  const activeIds = new Set(active.map((c) => c.id))
  const archivedPicked = pickedIds.filter((id) => !activeIds.has(id)).length

  return (
    <div className="mt-4">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        <span className="font-medium text-[var(--color-foreground)]">Recipients:</span> {def.roleDefault.summary}
        {def.roleDefault.usersLink && (
          <>
            {" "}
            Turn this off for an individual user from their row on the{" "}
            <Link href="/users" className="underline hover:text-[var(--color-foreground)]">
              Users page
            </Link>
            .
          </>
        )}
      </p>
      {def.extras ? (
        <AlsoSendTo
          kind={kind}
          contacts={active}
          pickedIds={pickedIds.filter((id) => activeIds.has(id))}
          archivedPicked={archivedPicked}
          // Pace is the one kind with extras AND a capability: a contact that
          // is a store login resolves as that login and is refused (F9 + F8,
          // Gary 2026-10-23). hr.ack has no capability, so it still sends.
          warnStoreLogin={Boolean(def.capability)}
          help={pickerHelp}
        />
      ) : (
        <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
          Extra recipients can&apos;t be added to this email.
        </p>
      )}
    </div>
  )
}
