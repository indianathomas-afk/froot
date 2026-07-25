# HR-11c — ceremony fixes: pre-populate fields, signature-line placement, dedup

**Append to the running HR-11c session.** Three defects observed while testing the
mobile `/my` signing ceremony (Gary Thomas, staging) and reviewing the Tommy Thomas
v5 output. All three are in the **ceremony UI / affordance layer**, not the final PDF
stamping — the completed output already stamps name, date, and signature at the correct
anchor positions (verified on Tommy v5 page 11). These fixes bring the ceremony into line
with what the output already does.

---

## Standing rules (unchanged, they bind this work)

- `staging` only. Never push. Never touch `main`.
- **Audit first.** Read the relevant files, present findings and a plan, and STOP for
  explicit approval before editing. This matters most for Item 3 — do not fix it until
  you have found and reported the root cause.
- `next build` must pass between commits. `package-lock.json` committed with any dependency change.
- Additive-only Prisma migrations. No column drops. No schema change without a presented case.
  (These three fixes should need no schema change — confirm that during the audit.)
- Before any `prisma db execute` / `migrate resolve` / `migrate deploy`: echo the
  DATABASE_URL host and confirm it is NOT production (7-23 incident rule).
- Out-of-scope findings get written down as text, not fixed inline.
- **G1 + forward-only:** a checkpoint with acknowledgment rows is never deleted or modified.
  Nothing here touches the completed Tommy v5 record. All fixes apply to new ceremonies /
  new document versions. Test with a fresh signer on staging.

---

## Item 1 — Pre-populate and DISPLAY identity fields during the ceremony

**Observed:** During signing (screenshot, page 11 mobile), the in-document
`Employee Name (Print):` and `Date:` lines render blank. The values only appear in the
final output PDF, so the signer never sees them before signing. If the name is wrong, no
one can catch it before the document is executed.

**Change:** Render the derived field values inline, at their anchor positions, *during*
the ceremony — before the signer acts — so they are visible on the page being signed.

| Field | Source | Ceremony behavior |
|---|---|---|
| Printed name | `StaffMember.fullName ?? displayName` | Pre-populated and shown at the `PrintedName` anchor. Display only this pass — see note. |
| Date | Server-derived | Pre-populated and shown at the `DateStamp` anchor. **Read-only** — never an input. |
| Store | Signer's assignment | Pre-populated and shown where a `Store` anchor exists. |

These are the same `PrintedName` / `DateStamp` / `Store` derived values the output already
resolves; this surfaces them earlier in the same positions. This should be a rendering
change in the ceremony viewer, not new data.

**Resolve at completion from a single source.** The printed name that appears at the
identity fields and the name inside each of the four signature stamps must all resolve
from one value at completion — not be captured independently per interaction. Otherwise a
document could show two spellings. Confirm during the audit which path currently produces
the stamp names and that they share one source.

**Not in this pass — do NOT build:** editing/correcting the name, write-back to
`StaffMember`, or a signer "this isn't my name" flow. That is the next session. This pass
only makes the values *visible* pre-signing. If the display work tempts an inline "make it
editable" shortcut, stop and leave it for the correction session.

---

## Item 2 — Signature affordance at the signature line

**Observed:** The "Sign here" affordance is corner-docked at the bottom-right of the page
(screenshots, pages 11 and 22 mobile), away from the signature line it corresponds to.
It is not transparent which line the signer is signing.

**Change:** Render the signature affordance at its anchor — immediately above, or directly
beside, the `Employee Signature` / `Employee's Signature` caption — using the **same
anchor → viewport transform the completed stamp already uses.** The completed stamp lands
correctly in the output (Tommy v5 p.11), so the transform exists; the pending affordance
just isn't using it. Do not introduce a second coordinate path.

- Must not cover the caption text or the signature rule.
- Must render correctly at the mobile `/my` viewport (this is the STAFF home).
- **Collision handling:** where a signature affordance and the page-initials affordance
  would overlap, offset — never stack. (Currently everything piles into the bottom-right.)

---

## Item 3 — Duplicate signature affordance (RESEARCH first, then fix)

**Observed:** Every signature line renders **two** identical affordances instead of one.
Page 22 shows two pending "Sign here" buttons; page 11 (Gary Thomas) shows two completed
"Gary Thomas" stamps. One signature line should produce exactly one affordance and, on
completion, one stamp and one checkpoint.

**Do not guess or patch the symptom.** Find the root cause and present it before fixing.
Candidate causes to investigate (not a conclusion):

1. Two `SignatureStamp` anchors are being detected for one visual signature line — e.g. the
   vocabulary matches both the caption and the rule, or "Employee Signature" matches in more
   than one place near the line.
2. The pre-HR-11c bulk-apply signature path and the new HR-11c per-checkpoint path are
   *both* rendering an affordance for the same line (old path was never removed/replaced).
3. HR-11c checkpoint generation is emitting two checkpoints per `SignatureStamp` anchor.
4. A double render in the ceremony component.

**Fix at the source, not the surface.** If the duplicate is two anchors or two checkpoints,
hiding the second button leaves the certificate recording two signature checkpoints per
line — still wrong. The fix must result in one anchor → one checkpoint → one affordance →
one stamp → one certificate row per signature line.

**G1 / forward-only.** Do not delete or modify checkpoints on the completed Tommy v5 record.
Deduplication applies to new detection / new versions. If existing staging test records
carry duplicates, they are throwaway; verify the fix on a fresh signer, not by mutating old
rows.

**Verify:** for a fresh signer on a document with signature lines (handbook pp. 11, 22, 24,
28), the ceremony shows one affordance per line, the output shows one stamp per line, and
the certificate lists one signature checkpoint per line with its own real timestamp.

---

## Audit deliverable before any edit

1. Root cause of Item 3, named with the file/function responsible.
2. Confirmation that Items 1 and 2 need no schema change.
3. Confirmation of the single-source resolution for printed name across identity field and
   the four signature stamps.
4. The plan for all three, for approval.

---

## Explicitly OUT OF SCOPE — note as text, do not touch

- Name correction, write-back to `StaffMember`, Square-sync override, and the signer
  "this isn't my name" path — the next session.
- Initials validation (accepts arbitrary text) — HR-14.
- Certificate stale org name ("Generated by Froot for Microsoft") — separate diagnosis; it
  is the HR prod-promotion gate.
- The p.22 / p.24 caption-overprint offset (Above-placement) — log it; fix only if it turns
  out to be the same coordinate code touched by Item 2, and even then present it first.

---

## Done criteria

- Item 1: name/date/store visible pre-signing at their anchor positions; date read-only;
  names single-sourced. No correction UI built.
- Item 2: signature affordance at the line via the existing transform; correct on mobile;
  no stacking.
- Item 3: root cause found and reported; fixed at source; one affordance / one stamp / one
  checkpoint per signature line, verified on a fresh signer and its certificate.
- `next build` passes. `staging` only, no push. New findings written down as text.
