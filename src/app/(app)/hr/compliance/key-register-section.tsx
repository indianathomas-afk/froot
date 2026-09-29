import Link from "next/link"
import { KeyRound } from "lucide-react"
import { ReturnEventButton } from "@/components/hr/return-event-button"
import type { ReturnItem, ReturnRegisterDocument } from "@/lib/hr-returns"

// DOC-6 (F6): the Key Register — who holds an item issued by a tracks-return
// document right now. Computed by lib/hr-returns.ts (one holding rule); this
// only renders. Below By Document and deliberately OUTSIDE the compliance
// numbers: a held key is not a gap (out of scope: "any change to compliance
// math"). TERMINATED holders stay listed and flagged (F7); an archived
// document keeps its holders, marked "(archived)" (R2).
//
// Renders nothing when the org has no tracks-return document, so orgs that
// never tick the box see no new section.
export function KeyRegisterSection({
  register,
  scopeLabel,
}: {
  register: ReturnRegisterDocument[]
  scopeLabel: string
}) {
  if (register.length === 0) return null

  return (
    <div
      id="key-register"
      className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden mb-8 scroll-mt-4"
    >
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)]">Key Register</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            Who currently holds something issued by a signed document {scopeLabel}, until it&apos;s marked
            returned. Not part of the compliance numbers.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {register.map((doc) => (
          <RegisterDocument key={doc.documentId} doc={doc} />
        ))}
      </ul>
    </div>
  )
}

function RegisterDocument({ doc }: { doc: ReturnRegisterDocument }) {
  // Grouped by store, name-sorted groups; the loader already sorted people.
  const groups = new Map<string, ReturnItem[]>()
  for (const h of doc.holders) groups.set(h.groupName, [...(groups.get(h.groupName) ?? []), h])
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))

  return (
    <li className="px-6 py-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-medium text-[var(--color-foreground)]">{doc.title}</span>
        {!doc.active && <span className="text-xs text-[var(--color-muted-foreground)]">(archived)</span>}
        <span className="ml-auto text-sm text-[var(--color-foreground)]">
          <span className="font-semibold">{doc.holders.length}</span> holding
        </span>
      </div>
      {doc.holders.length === 0 ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Nobody holds a {doc.itemLabel.toLowerCase()} from this document.
        </p>
      ) : (
        <div className="space-y-3">
          {ordered.map(([groupName, people]) => (
            <div key={groupName}>
              <p className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide mb-1">
                {groupName}
              </p>
              <ul className="space-y-1.5">
                {people.map((h) => (
                  <li key={h.staffId} className="flex items-center gap-3 text-sm flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/staff/${h.staffId}`}
                          className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                        >
                          {h.staffName}
                        </Link>
                        {h.terminated && (
                          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-[var(--color-destructive)] border border-red-200">
                            Terminated — not returned
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        Signed {h.latestSignedAtLabel} (v{h.latestVersionNumber})
                        {h.fields.map((f) => ` · ${f.label}: ${f.value}`).join("")}
                      </p>
                    </div>
                    <ReturnEventButton
                      type="Returned"
                      documentId={doc.documentId}
                      staffId={h.staffId}
                      staffName={h.staffName}
                      itemLabel={doc.itemLabel}
                      documentTitle={doc.title}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}
