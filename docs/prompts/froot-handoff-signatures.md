# UseFroot — context handoff (7/24/26) — next up: signature checkpoints

## Who I am / what we're doing

I'm building **UseFroot (Froot)**, a multi-tenant store-operations SaaS for Square
merchants — primarily multi-location franchises like Keva Juice. Reference store:
Las Brisas / Keva Juice, Carson City NV.

**Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Clerk (roles
ADMIN/MANAGER/STORE/STAFF), Prisma 7 on Neon Postgres, shadcn/ui, Vercel + Vercel Blob,
Square OAuth. Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot`), accessed via
Claude Code desktop.

**How I work with you (claude.ai):** I plan here — architecture, decision translation,
and writing self-contained session prompts that I save to `docs/prompts/` and paste
into a fresh Claude Code session (one session per phase). When Claude Code surfaces a
decision fork, I paste it here for plain-language translation and a recommendation
before I answer it. I want direct pushback when something's wrong, not agreement.

**Standing workflow rules (these are law):**
- Claude Code works on `staging` only; it never pushes and never touches `main`
  (main auto-deploys to prod instantly). I do all pushes and promotions myself.
- Audit-first: read and present a plan, stop for my explicit approval before editing.
- `next build` must pass between commits. `package-lock.json` committed with any
  dependency change.
- Additive-only Prisma migrations, no column drops, and **no schema changes without a
  presented case**.
- Before any `prisma db execute` / `migrate resolve` / `migrate deploy`, the session
  must echo the DATABASE_URL host and confirm it is NOT production (7-23 incident rule).
- Out-of-scope findings get written down as text, not fixed inline.

## Where things stand

**Shipped and promoted to production** (merge `942bc59`; main is tree-identical to
staging): HR-0→8, BUG-1, BUG-2, UM-1, HR-15/15b, STAFF-1.

**HR is dark in production** — `HR_MODULE_AVAILABLE` is unset there, so no HR nav, no
`/my` portal, and staff names aren't linked on the Staff page in prod. That is
intentional. HR's prod debut comes after HR-14 hardening, gated on the certificate
org-name check (see open findings).

**Built and live on staging:**
- **STAFF-1** — person-scoped mobile-first `/my` portal as the STAFF home; nav matrix
  (STAFF sees Home, Messages, Instagram, My Documents; + Checklists only when assigned);
  HR renamed "My Documents" for STAFF; staff can view their own signed records inline
  but **download stays ADMIN/MANAGER-only**.
- **HR-11** — four-phase DocuSign-style signing ceremony, inline pdf.js viewer,
  sequential per-page initialing, and **real per-interaction timestamps** (each
  interaction POSTs immediately; server stamps a genuine `signedAt` per row).
- **HR-11b** — field anchoring & inline stamping. Server-side text-layer anchor
  detection at upload (via `unpdf` after pdfjs failed to bundle in the Vercel serverless
  runtime), longest-match-wins vocabulary, admin-required confirm/mapping UI on the
  Document Library page, checkpoint generation from confirmed anchors, rescan action for
  already-uploaded versions, and stamping onto the PDF body at completion with the
  Certificate of Acknowledgment still appended.

**Verified working end-to-end today:** Tommy Thomas (corporate@keva.com, Las Brisas)
signed handbook v5. The output PDF shows `GLT` initials on all 28 footers, printed
name/date/store on page 1, and signature stamps on pages 11, 22, 24, 28 — with the
certificate appended showing 28 distinct per-interaction timestamps.

## Key rulings already locked (don't relitigate)

- **F2** — typed-only signatures. Drawn signatures need image storage + schema change;
  deferred.
- **F4** — active linked staff may VIEW their own signed records inline; download
  remains ADMIN/MANAGER-only (departing employees must not self-download).
- **F5** — date+time is always captured; signature stamps and certificates always render
  full date+time; inline `Date:` fills follow `Organization.hrDateStampFormat`
  (default `dateOnly`).
- **G1 (hard integrity rule)** — a checkpoint with acknowledgment rows is never deleted
  or modified by re-confirmation. Re-confirm may add/link; manual delete (ack-guarded)
  is the only deletion path.
- **Version binding (Option A)** — `DocumentAnchor` binds to `hrDocumentVersionId`;
  checkpoints stay document-level and carry forward; each new version re-detects and
  re-confirms; signed records stay bound to the version signed.
- **Anchor marks** — `Initial` and `SignatureStamp` link to checkpoints;
  `PrintedName` / `Store` / `DateStamp` are stamp-only derived values.
- **Image-only PDFs** — zero anchors → automatic certificate-only fallback. Manual
  click-to-place anchor tooling is deferred.
- **Completed-vs-Signed records** — (c) cross-link only, no merge.

## THE OPEN WORK ITEM — signature checkpoints (call it HR-11c)

**The problem.** On the v5 signed record, all 28 initials carry distinct timestamps
spread across real minutes — but all four signature stamps share a single timestamp
(13:55:29), because HR-11b linked every `SignatureStamp` anchor to the one final
Acknowledgment checkpoint. That's the same bulk-apply pattern HR-11 eliminated for
initials, still alive for signatures. And these are four *distinct* attestations, not
repeats of one: p.11 = EEO / harassment / conduct policies, p.22 = confidentiality,
p.24 = Rules & Policies, p.28 = the whole handbook.

**The change I want.** Each `SignatureStamp` anchor becomes its own checkpoint the
signer explicitly acts on during the ceremony, with its own real per-interaction
timestamp — the same treatment initials already get. `PrintedName` / `Date` / `Store`
stay stamp-only derived values with no signer interaction. Only signatures and initials
require an explicit act.

This revises the HR-11b design choice, so it needs a presented approach before build:
how signature checkpoints sequence relative to page initials, whether the typed legal
name is captured once and reused per signature or re-entered each time, and confirmation
that no schema change is needed.

## Open findings from the v5 record

1. **Placement bug, pp. 22 and 24** — where the caption sits *below* the line, the
   signature stamp's sub-lines ("Signed electronically…", "Record …") overprint the
   "Employee's Signature" caption. Pages 11 and 28 (label to the left) render cleanly.
   Fix the Above-placement offset.
2. **Stale org name** — the certificate still reads "Generated by Froot for Microsoft."
   This is the explicit gate for HR prod promotion and is still unfixed. Needs
   diagnosis: why isn't the Clerk org rename reflected?
3. **Initials validation (HR-14)** — the initials field accepts arbitrary text unrelated
   to the signer: it took "TIKTOK" once and "GLT" for signer Tommy Thomas. For a system
   built on court-defensibility this is a real gap. Logged for HR-14 hardening, not to be
   fixed inline.
4. **Shared credentials** — a second person used the TommyThomas staging login during
   testing. Harmless on a staging test account, but worth a standing rule: the
   evidentiary value of this system depends on an action being attributable to one
   person, so shared credentials are a prod integrity problem.

## Roadmap sequence from here

HR-11c (signature checkpoints, above) → HR-14 hardening → HR prod promotion session
(explicit gate: certificate renders the real org name).

## What I want from you right now

Help me think through the signature-checkpoint design, then write the session prompt I'll
save to `docs/prompts/` and paste into a fresh Claude Code session. Ask me about anything
above that's ambiguous rather than assuming.
