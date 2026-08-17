# HR-11d — Phase 1 build, addendum: §2f

**R3(ii) was ruled, and then omitted from `HR-11d-phase1-build.md` in error.**
This addendum carries the missing subsection. The original prompt is **not
edited** — a saved prompt is a claim wholesale (CLAUDE.md, § Where documents
live) — so the omission stays visible where it happened and is corrected here
rather than tidied away.

**Read this file alongside `docs/prompts/HR-11d-phase1-build.md`.** Two lines in
that file are wrong once this addendum is in force, and both are wrong in the
direction that would cause a Phase 1 session to skip §2f:

- §2 is headed **"Scope — five items, no more"**. With this addendum it is six.
- §3 lists **"the certificate writer"** among the things not to disturb. §2f
  deliberately changes it. Everything else on that do-not-disturb line stands.

Neither line is amended in the original. This one is the correction of record.

---

### 2f. R3(ii) — the certificate states which mode produced it

A certificate-only record currently reads identically to a stamped one. The
Certificate of Acknowledgment carries no trace of whether inline field stamping
ran, so the artifact that is the whole point of the ceremony cannot be told
apart from the artifact that silently skipped it. That is the §1 defect
surviving into the executed document itself: the guard in §2b stops a hollow
record being minted from here on, but it says nothing about what the certificate
claims.

The Certificate of Acknowledgment must state which mode produced it — **stamped**
or **certificate-only**. Both modes are legitimate once §2b ships: a version
reporting `matched == 0` (image-only, or pre-HR-11b and never scanned) is
certificate-only by design and remains signable. The line therefore describes a
legitimate state of the document and must not read as an error, a warning, or a
defect notice.

**This changes an executed legal artifact.** The audit (§11, R3(ii)) declines to
recommend it for exactly that reason and records it as Gary's call alone. The
ruling to build it is his; the wording is a separate decision and has not been
made.

**One stop-and-ask item. Do not guess it.**

1. **The exact certificate copy for both modes.** Present the proposed wording
   for the stamped case and the certificate-only case and let Gary rule before
   writing either into the certificate writer. Same handling as §2d's two items:
   surface and stop, do not resolve by picking the reasonable-looking phrasing.

Out of scope here, as everywhere else in this build: re-issuing or amending any
certificate already generated. R1 is moot — no production signed records exist —
so this applies forward only.

**Tests.** A certificate generated for a version with confirmed anchors states
the stamped mode; one generated for a `matched == 0` version states the
certificate-only mode. Both assertions belong with the §5 fixtures, not in a
second harness.
