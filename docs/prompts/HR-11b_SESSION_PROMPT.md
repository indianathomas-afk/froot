# HR-11b — Field Anchoring & Inline Stamping — Session Prompt (audit-first)

Fresh Claude Code session on **UseFroot (Froot)**, store-operations SaaS for Square
merchants (reference store = Las Brisas / Keva Juice). Stack: Next.js 16 App Router,
React 19, TS, Prisma 7 on Neon, Clerk (roles ADMIN/MANAGER/STORE/STAFF), shadcn/ui,
Vercel. App root: `~/Claude_Projects/Froot/froot` (LOWERCASE `froot`).

Read first: `CLAUDE.md`, `AGENTS.md` (incl. the Next.js 16 docs requirement),
`docs/ROADMAP.md` (the **HR-11b row contains the full spec** — it is the source of
truth for this phase), `docs/DECISIONS.md`, `docs/WORKFLOW.md`. Prompts live in
`docs/prompts/`. Numbering: phase HR-11b. Do not use bare "Phase N" numbers.

Branch rules: all work on `staging`; you NEVER push and NEVER touch `main` (main
auto-deploys to production instantly). Commit staging-only when told; the human pushes.
`next build` must pass after each step. package-lock.json committed with any dependency
change. Two-gate module pattern stays intact (HR_MODULE_AVAILABLE + activeModules) —
no new gates.

**Migration safety rule (per the 7-23 incident recorded in DECISIONS.md):** before
running ANY `prisma db execute`, `prisma migrate resolve`, or `prisma migrate deploy`,
echo the host portion of the `DATABASE_URL` you are targeting and confirm out loud that
it is NOT the production database. Preview/production env scoping was remediated on
7-23; this guard is belt-and-suspenders. Additive-only migrations, no column drops ever.

## State entering this phase

- STAFF-1 shipped, staging-verified, and **promoted to prod** (merge `942bc59`); main is
  tree-identical to staging. Prod is healthy.
- **HR remains dark in prod** (`HR_MODULE_AVAILABLE` unset). Nothing in HR-11b changes
  that. HR's prod debut comes after HR-14, gated on the certificate org-name check.
- **HR-11 is built and live on staging:** four-phase signing ceremony, inline pdf.js
  viewer, sequential per-page initialing, and **real per-interaction timestamps** on
  every checkpoint (each interaction POSTs immediately; the server stamps a genuine
  `signedAt` per row). The Certificate of Acknowledgment renders each row's own time.
  Do not regress any of this.
- **What HR-11 deliberately did NOT do — this phase's entire job:** the signed PDF's
  pages are still blank. `Initial:_________` on every footer, empty `Employee Name
  (Print):` / `Date:` / `Employee Signature:` lines. All execution evidence lives only
  in the appended certificate. A lawyer holding page 11 sees an unsigned-looking page.
- **The Employee Handbook document now has two versions with different source files:**
  v1 `2026 Employee Handbook.pdf` (uploaded 7/13, sha256 `d0860ff703be…`) and v2
  `V3-2026-Employee-Handbook.pdf` (uploaded 7/23, sha256 `7d60912ccf4b…`, Current).
  Its 29 checkpoints were hand-added via "Add Checkpoint" and render at the DOCUMENT
  level. This is the concrete test case for the version-binding question below.
- Landing points identified during the STAFF-1 audit (verify, don't assume):
  - `HrDocumentCheckpoint.pageRef` already exists — the page-anchor seed.
  - `CertificateWriter` in `hr-signed-pdf.ts` appends certificate pages to the source
    PDF — the natural composition layer for stamping.
  - The pdf.js viewer built in HR-11 is where page coordinates can be captured.

## The central design question — resolve in Phase 1, before the schema case

**Anchors are inherently per-VERSION. Checkpoints today are per-DOCUMENT.** A
coordinate detected on v1 is meaningless on v2 — different file, different layout,
possibly different page count. The handbook's v1/v2 pair makes this concrete and
unavoidable.

Audit how checkpoints currently relate to document versions, then present options and a
recommendation covering:

- What `DocumentAnchor` binds to (version, presumably) and how generated checkpoints
  relate to it — whether checkpoints become per-version too, or stay document-level
  and reference version-scoped anchors.
- What happens on **new version upload**: are anchors re-detected fresh, carried
  forward where text matches, or does the admin re-confirm? What happens to the
  document's existing hand-made checkpoints?
- What happens to an **in-flight signer** — someone partway through signing v1 when v2
  is uploaded. (Note the existing product rule: signed records stay bound to the
  version they were signed against, per the Versions panel copy.)
- Whether existing documents with hand-made checkpoints keep working untouched
  (they must) and how they coexist with anchor-generated ones.

**Do not resolve this unilaterally.** The schema case cannot be presented coherently
until the human rules on it, so surface it early in the Phase 1 plan.

## What this phase is

Four parts. Anchors are detected at upload, confirmed by an admin, generate the
checkpoints, and are stamped at completion.

### 1. Anchor detection (at version upload)

Scan the uploaded PDF's text layer for anchor tokens, recording each hit with its page
and coordinates. Default anchor vocabulary:

`Initial:` · `Name:` · `Date:` · `Store:` · `Employee Name (Print):` ·
`Employee Name` · `Employee Signature:` · `Employee's Signature`

**Longest-match-wins** — `Employee Name (Print):` must not also register as `Name:`.

**Image-only PDFs (no text layer):** zero anchors detected → **automatic fallback to
certificate-only mode**, exactly today's behavior, with a clear admin-facing
explanation of why no anchors were found. Manual click-to-place anchor tooling is
explicitly deferred to a future phase — do not build it here.

### 2. Anchor → mark mapping (admin-configurable, on the Document Library page)

Each detected anchor maps to a mark type:

| Anchor | Mark |
|---|---|
| `Initial:` | Signer initials — e.g. [TPT] |
| `Name:` / `Employee Name` / `Employee Name (Print):` | Printed full name — placed beside, above, or below the line per detected layout |
| `Date:` | Date stamp (see timestamp policy below) |
| `Store:` | Signer's store assignment — e.g. [Las Brisas] |
| `Employee Signature:` / `Employee's Signature` | Signature validation stamp: stylized name + electronic-signature notation + timestamp + record reference |

**Admin confirmation is REQUIRED, not optional.** Detected anchors are proposals. The
upload flow becomes: scan → present detected anchors grouped by page → admin confirms
or adjusts mappings → generate. This review step is the safety valve against false
positives (e.g. an "Effective Date:" appearing inside policy body text).

### 3. Checkpoint generation from confirmed anchors

Confirmed anchors **create** the checkpoints, replacing manual "Add Checkpoint" entry.
(The handbook required 29 hand-added checkpoints — that is the pain being removed.)
Existing documents with manually-created checkpoints must continue to work unchanged;
this is additive capability, not a migration of existing data.

### 4. Stamping at completion

When a signing completes, overlay the captured values at each anchor's coordinates so
the document body reads as executed — footers show `Initial: TPT`, acknowledgment
blocks show the printed name, date, and signature stamp on their lines — **and the
Certificate of Acknowledgment is still appended, unchanged.** Human-readable execution
on every page, cryptographic binding (SHA-256, append-only) at the back.

**Timestamp policy (locked):** date+time is ALWAYS captured and stored. Signature
validation stamps ALWAYS render full date+time. Inline `Date:` fills may render
date-prominent with time subordinate. Court-defensibility wins all ties. Stamps draw
from HR-11's real per-interaction capture times, never from a single submit-time value.

## Schema case — present before ANY Prisma edit

This phase is expected to need one **additive** migration covering two things:

1. **`DocumentAnchor`** — persistence for detected/confirmed anchors: anchor text, mark
   type, page, coordinates, placement, confirmation state, and the version binding
   settled by the central design question above. Shape is yours to propose.
2. **Org-level timestamp display setting** — the toggle deferred in STAFF-1 fork F5
   (`Date:` rendering as date vs. date+time). There is no settings field on
   `Organization` today. Fold it into this same migration.

Present the case — models, fields, types, indexes, and the migration plan — and
**STOP for approval before touching `schema.prisma`.** Additive only; no drops.

## Phase 1 — Audit and plan (then STOP)

1. Read the HR-11b roadmap row (the spec) and the relevant DECISIONS entries.
2. Audit the document upload path, version storage, the document↔version↔checkpoint
   relationships, and how checkpoints are created today (including "Add Checkpoint").
3. Audit the signed-PDF generation pipeline end to end — `hr-signed-pdf.ts`,
   `CertificateWriter`, how the source PDF is composed with certificate pages, and
   where an overlay layer would insert.
4. Audit the HR-11 pdf.js viewer for text-layer access and coordinate extraction —
   determine whether detection should run server-side at upload, client-side, or both,
   and recommend which, with reasoning.
5. Verify (don't assume) the landing points listed above: `pageRef`'s current shape and
   whether it can seed anchors; what PDF library is available for text extraction and
   for drawing overlays; whether it is already a dependency or a new one.
6. Present a plain-language plan covering: **the version-binding resolution options
   (lead with this)**; detection approach and where it runs; the anchor vocabulary
   implementation incl. longest-match-wins; the Document Library review/mapping UI
   (wireframe-level walkthrough); checkpoint generation and coexistence with existing
   manual checkpoints; the stamping/composition approach; the image-only fallback; the
   schema case; and a build order in small verifiable steps. Surface every decision
   fork rather than assuming.
7. **STOP and wait for explicit approval before editing anything**, including schema.

### Other known fork to surface (do not silently resolve)

The **"Completed vs. Signed records" section redundancy** flagged during STAFF-1 — the
two surfaces overlap and merging them was noted as a possible design change. Present
the options and a recommendation; the human rules on it. Do not merge them unilaterally.

## Phase 2 — Build (only after approval)

Small steps, `next build` green after each. Do not regress HR-11's ceremony, per-
interaction timestamps, certificate contents, or the STAFF-1 `/my` surface.

End with a staging verification checklist covering, at minimum:
- Upload a fresh version of a multi-page document with text-layer anchors → detection
  finds them, grouped by page, presented for confirmation; admin adjusts and confirms;
  checkpoints are generated from the confirmed set.
- Upload an image-only PDF → zero anchors, clean fallback to certificate-only mode with
  an explanatory message; signing still works end to end.
- Sign as **Tommy Thomas (corporate@keva.com, Las Brisas)** → resulting PDF shows
  `Initial: TPT` on page footers, printed name / date / signature stamp on their lines,
  **and** the Certificate of Acknowledgment still appended with distinct per-interaction
  timestamps.
- Version behavior per the approved ruling: exercise the handbook's v1/v2 case
  explicitly — anchors resolve against the correct version, and signed records stay
  bound to the version they were signed against.
- Prior signed records (Tommy's existing coexisting records) untouched and still
  readable; nothing collapsed, overwritten, or merged.
- Signed-PDF download remains ADMIN/MANAGER-only; staff inline view of own records
  still works per the STAFF-1 F4 ruling.
- Existing documents with manually-created checkpoints still sign correctly.
- Admin/manager surfaces otherwise unchanged.

Stop before commit; commit staging-only when told; the human pushes.

## Scope containment

- Webhook email-resolution logic: read-only.
- Do not modify HR-8 rollup logic, labor/forecast code, or the STAFF-1 `/my` surface
  beyond what stamping requires.
- Manual click-to-place anchor tooling: deferred, not built.
- Hardening-flavored findings → text notes tagged for **HR-14**.
- All other unrelated findings → written down as text, not fixed.
- Docs at the end (when told): `ROADMAP.md` (HR-11b row → complete; confirm HR-14 and
  the HR prod-promotion rows are next), `DECISIONS.md` (version-binding ruling, anchor
  vocabulary and longest-match rule, mapping-confirmation requirement, image-only
  fallback ruling, timestamp display setting, the Completed-vs-Signed fork ruling, and
  the `DocumentAnchor` schema decision).

## Reminder for the phase after this one

HR-14 hardening comes next, then the HR prod promotion session — whose explicit gate is
verifying the certificate renders the **correct organization name** (staging previously
showed a stale "Microsoft" org name). Do not attempt either here.
