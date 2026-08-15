import Link from "next/link"
import { Download, FileClock } from "lucide-react"

// HR-11d 2b layer (b) + 2c — the refusal screen, shown INSTEAD of the signing
// ceremony when the current version has detected fields and none are confirmed.
//
// REFUSING BEFORE THE CEREMONY RATHER THAN AT MINT-TIME IS THE WHOLE POINT
// (R3(i), Gary 2026-08-14): "I am not failing a signer after they have typed 27
// sets of initials." Layer (c) in ensureSignedRecord still exists underneath
// this, as the backstop for anything that gets past the door.
export function SigningUnavailable({
  documentId,
  documentTitle,
  audience,
  confirmHref,
  matched,
}: {
  documentId: string
  documentTitle: string
  // "signer" — the person who came to sign. "manager" — an admin/manager on the
  // attested-capture path, who can act on this themselves.
  audience: "signer" | "manager"
  confirmHref?: string
  matched?: number
}) {
  return (
    <div className="max-w-xl mx-auto">
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
          <FileClock className="h-6 w-6 text-[var(--color-muted-foreground)]" />
        </div>

        {audience === "signer" ? (
          <>
            {/* Gary's copy, verbatim and exact. No raw error, no error code, and
                nothing implying the employee did something wrong — because they
                did not. This is an admin's outstanding task. */}
            <h1 className="text-lg font-bold text-[var(--color-foreground)] mb-2">
              This document isn&apos;t available yet — ask your manager.
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
              You can still read {documentTitle} now. Nothing you have already completed on it has
              been lost.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-[var(--color-foreground)] mb-2">
              Fields need confirming before anyone signs
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
              {matched
                ? `Field detection found ${matched} field${matched === 1 ? "" : "s"} on the current version of ${documentTitle}, and none are active yet.`
                : `The current version of ${documentTitle} has detected fields that are not active yet.`}{" "}
              Signing is blocked until they are confirmed — otherwise the signed record would claim
              completion and stamp nothing onto the page body.
            </p>
          </>
        )}

        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          {/* 2c: a new hire on a shared iPad is not stuck mid-shift. Download
              ONLY — accepting a scanned wet-signed copy back in is HR-11g. */}
          <a
            href={`/api/hr/documents/${documentId}/download`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
          >
            <Download className="h-4 w-4" />
            Download / print
          </a>
          {audience === "manager" && confirmHref && (
            <Link
              href={confirmHref}
              className="inline-flex items-center rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Confirm fields
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
