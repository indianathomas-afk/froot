import { KeyRound } from "lucide-react"
import { ReturnEventButton } from "@/components/hr/return-event-button"
import type { ReturnItem } from "@/lib/hr-returns"

// DOC-6 (F6): what this person was issued by a tracks-return document, whether
// they still hold it, and the append-only return history. Holding is decided
// by lib/hr-returns.ts; this only renders. Mark returned while holding;
// Reissue while not holding and the document is active (R2).
export function StaffReturnItems({ items }: { items: ReturnItem[] }) {
  if (items.length === 0) return null

  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide mb-3">
        Issued Items
      </h2>
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <div key={item.documentId} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <KeyRound className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    {item.itemLabel} · {item.documentTitle}
                  </p>
                  {!item.documentActive && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">(archived)</span>
                  )}
                  {item.holding ? (
                    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-[#efa201]/10 text-[var(--color-warning-text,#a36a00)]">
                      {item.terminated ? "Terminated — not returned" : "Holding"}
                    </span>
                  ) : (
                    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-[#25ba3b]/10 text-[var(--color-success-text,#1d7c2e)]">
                      Returned
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                  Signed {item.latestSignedAtLabel} (v{item.latestVersionNumber})
                  {item.fields.map((f) => ` · ${f.label}: ${f.value}`).join("")}
                </p>
              </div>
              {(item.holding || item.documentActive) && (
                <ReturnEventButton
                  type={item.holding ? "Returned" : "Reissued"}
                  documentId={item.documentId}
                  staffId={item.staffId}
                  staffName={item.staffName}
                  itemLabel={item.itemLabel}
                  documentTitle={item.documentTitle}
                />
              )}
            </div>
            {item.events.length > 0 && (
              <ul className="mt-3 pl-7 space-y-1">
                {item.events.map((e) => (
                  <li key={e.id} className="text-xs text-[var(--color-muted-foreground)]">
                    <span className="font-medium text-[var(--color-foreground)]">{e.type}</span>{" "}
                    {e.occurredOnLabel} · recorded by {e.recordedByName}
                    {e.note ? ` · ${e.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
