# Decision Log

Plain record of who decided what, so "yours vs mine" is never fuzzy. **Gary** =
operator decision; **Claude** = implementation choice made without an explicit
instruction. Newest scoping at top. (Started as the Labor log; now records HR
decisions too.)

## HR-11b field anchoring & inline stamping — 2026-07-23 (Gary approved plan + rulings 1–7)

a. **Version-binding — Option A.** `DocumentAnchor` binds to
   `hrDocumentVersionId` (coordinates are per-file). Checkpoints stay
   document-level and keep carrying forward across versions. Each new version
   upload re-detects and re-confirms; an in-flight signer finishes against the
   version's own anchors; signed records stay bound to the version signed
   (existing rule, reaffirmed).

b. **Schema — additive.** `DocumentAnchor` (page, x, y, width, pageRotation,
   anchorText, markType, placement, confirmed, generatedCheckpointId
   soft-pointer) with `@@index([hrDocumentVersionId])` and **no float
   `@@unique`** (ruling 2 — float equality is unreliable); re-detection
   idempotency is application-level (replace the version's **unconfirmed** set,
   never confirmed). `onDelete: Cascade` on the version relation (anchors are
   metadata, not records). `Organization.hrDateStampFormat` (**B1**, default
   `"dateOnly"`) governs inline `Date:` fills only; validation stamps and the
   Certificate of Acknowledgment always render full date+time (reaffirms F5b,
   court-defensibility).

c. **Anchor vocabulary + longest-match-wins.** 8 tokens (`Initial:`, `Name:`,
   `Date:`, `Store:`, `Employee Name (Print):`, `Employee Name`,
   `Employee Signature:`, `Employee's Signature`), matched case-insensitively,
   longest first with a claimed-span mask so `Employee Name (Print):` never
   also registers as `Name:` / `Employee Name`.

d. **Detection server-side at upload.** pdfjs legacy build, headless in the
   Next 16 Node runtime (D1 spike = GO; no drop-in substitute exists, so a
   no-go would have been a re-plan, not a workaround). **D2 (ruling 7): page
   `/Rotate` and non-zero MediaBox origin handled explicitly** in both detection
   and stamping — pdf-lib and pdfjs share absolute content space (shifted-
   MediaBox spike confirmed no offset needed); placement offsets rotate out of
   the reader frame and glyphs counter-rotate. Unit-tested for all four
   rotations.

e. **Admin confirmation REQUIRED.** Detected anchors are proposals; the upload
   flow is scan → grouped-by-page review → confirm/adjust → generate. **U1:**
   confirm may change mark type, coarse placement side (Right/Above/Below), and
   keep/discard — **no free-drag repositioning** (that is manual placement,
   deferred).

f. **What anchoring adds, and link-first generation.** Document creation
   ALREADY auto-generates the checkpoint backbone — one `Initial` checkpoint per
   page plus a final `Acknowledgment` (the handbook's 29 were hand-refinements
   on top of that, not built from zero). Anchoring does NOT replace that
   backbone; it adds two things the checkpoints never had: (1) the page
   COORDINATES to stamp at (`pageRef` was page-number only), and (2) coverage of
   the printed-name / date / signature-line fields the per-page Initial defaults
   never captured. Generation is **link-first**: a confirmed `Initial` anchor
   links to the page's existing Initial checkpoint (creating one only if a
   page's default was deleted); `SignatureStamp` links to the final
   Acknowledgment checkpoint (where the typed legal name is already captured, so
   no new ceremony step is added); `PrintedName` / `Store` / `DateStamp` are
   stamp-only (derived values, no checkpoint). Existing manual checkpoints and
   documents keep working untouched (additive, not a migration).

g. **G1 — hard integrity rule (ruling 5).** A checkpoint that has
   acknowledgment rows is **never deleted or modified by re-confirmation**, full
   stop. Re-confirmation may add/link checkpoints. **Chosen posture (Gary):**
   re-confirm does **not** auto-delete even zero-ack generated checkpoints —
   manual delete (already ack-count-guarded in the UI) stays the only deletion
   path. This is a system integrity rule, not a session preference.

h. **Image-only fallback.** No text layer → zero anchors → automatic
   certificate-only mode (today's behavior) with a clear admin explanation.
   Manual click-to-place tooling explicitly deferred.

i. **Rescan.** `POST /api/hr/documents/[id]/anchors/rescan` re-detects the
   current version's already-uploaded file (no re-upload) — for documents that
   predate anchoring and for re-running when detection improves. Replaces the
   unconfirmed set, preserves confirmed. ADMIN-only, like every other document-
   configuration route (the confirm route and the `/hr/documents/[id]` manager
   surface are ADMIN-only too; MANAGER-in-scope is for signing/attesting, not
   document config).

j. **Completed-vs-Signed fork (STAFF-1) — (c) cross-link only, no merge.** The
   flagged overlap lives inside `staff-documents.tsx`: a document row shows both
   a completion-state badge and a "Signed record" link, already referencing the
   same record — no structural change needed. No second overlap found
   (`/hr/signed-records` vs `/hr/compliance` were confirmed to have distinct
   jobs — executed-artifact list vs who-hasn't-signed rollup).

k. **Staging fix pass (7-23, Gary): silent-collapse was the real defect.** The
   first staging scan of the handbook returned zero fields with no error.
   Root-cause discipline (Gary): scan/rescan must **report distinctly** — (a)
   error with the real message surfaced in the UI + logged server-side, (b) no
   text layer found (image-only), (c) text layer found, N pages scanned, M
   labels matched — never one bare "0 fields" standing in for all three.
   `detectAndStoreVersionAnchors` now returns a discriminated result and logs a
   summary; rescan surfaces errors (500) and outcomes. **Ruled out explicitly:**
   routes run on the Node runtime (never Edge; Prisma/crypto would fail on Edge
   anyway — now pinned with `export const runtime = "nodejs"`); no `maxDuration`
   was set (a timeout would 504, not return 0) — set to 60s on the scan/upload
   routes; the blob fetch succeeds (byte length logged before pdfjs). **The
   actual fix (found via the new diagnostics):** the first staging scan then
   reported `ReferenceError: DOMMatrix is not defined` — the direct
   `pdfjs-dist` legacy build references browser-DOM globals (DOMMatrix, Path2D,
   ImageData, …) that Vercel's Node runtime lacks (it worked locally only
   because the tiny test PDFs never hit those paths; the real handbook does).
   Server detection switched from `pdfjs-dist` to **`unpdf`** — a serverless
   build of pdf.js with no DOM dependencies — via `getDocumentProxy` (same
   `getTextContent`/transform API, so no detection-logic change). `unpdf` is in
   `serverExternalPackages`; `pdfjs-dist` stays a dependency for the browser-side
   HR-11 viewer (untouched). Proof: the fixture runs in plain Node where
   `DOMMatrix` is undefined and passes 28/28 — a real DOM-free reproduction.

l. **Vocabulary refinements (7-23, from the real handbook).** (1) Text is
   punctuation-normalized before matching, so `Employee's Signature` with a
   typographic apostrophe (U+2019) on pages 22/24 matches. (2) Bare `Date` (no
   colon) joins the vocabulary but is **fill-gated** — accepted only when an
   underscore run sits to its right or on the line just above it — so prose
   "Date" is ignored. (3) **Placement is auto-derived**: a trailing underscore
   run ⇒ Right (fill line to the right); an underscore run on the line just
   above, roughly over the label ⇒ Above (under-line caption block); default
   Right. Admin can still override the coarse side (U1). Limitation: fill
   detection keys on underscore runs, so signature lines drawn as graphics
   (not underscores) won't gate a bare field — logged for a future pass.

m. **(Claude) Delivery.** New dep `unpdf` (serverless pdf.js for detection;
   package-lock committed); `pdf-lib` and `pdfjs-dist` already present.
   Migration `20260723220118_hr11b_document_anchors` additive-only
   (applied to dev; Vercel `migrate deploy` applies to staging/prod). Fixture
   `scripts/verify-hr-anchors.ts` → 28/28 (detection, longest-match, split-label
   reassembly, D2 geometry across four rotations, diagnostics, curly-apostrophe /
   bare-Date / under-line placement, image-only). `next build` green each step.
   HR remains dark in production (`HR_MODULE_AVAILABLE` unset) — unchanged.

n. **End-to-end stamping verified (7-23).** A throwaway run of the real
   `ensureSignedRecord` path (dev DB + dev blob store, a 28-page handbook-shaped
   PDF with signature blocks on pages 11/22/24/28) confirmed 14/14: SignatureStamp
   anchors detected on those pages, confirmed, and linked to the final
   Acknowledgment checkpoint; the output PDF carries the signature stamp (name +
   "Signed electronically" + timestamp) on 11/22/24/28, the printed name on 11,
   the store on page 1, `TPT` initials on footers, and the certificate still
   appended. **No separate signature UI is by design (F2 typed-only + the
   link-to-Acknowledgment choice): one typed signature at the formal block,
   stamped at every SignatureStamp anchor — not a per-field prompt.**

o. **HR-11b test-data purge (staging, 7-23, Gary-approved).** Deliberate, scoped
   deletion of Tommy Thomas's (`corporate@keva.com`) `HrDocumentAcknowledgment` +
   `HrSignedRecord` rows on **staging only** — his records were polluted by a
   second tester entering `TIKTOK` as initials across pre-HR-11/HR-11/HR-11b runs.
   Scope: those two tables, that one staff member, all versions/cycles; his
   `StaffMember` row, checkpoints, documents, versions, and every other staff
   member untouched. Signed-PDF blobs are left orphaned in the private store
   (harmless on staging). An explicit, one-time exception to the append-only /
   G1 "never touch acked records" posture, for unreliable staging test data —
   **not precedent** for deleting real or production records.

## STAFF-1 staff experience + HR-11 inline signing — 2026-07-23 (Gary approved plan + forks F1–F8)

a. **Timestamp audit finding (Defect 1 root cause).** Per-interaction times
   never existed: the HR-5-era client batched every checkpoint into ONE POST
   and the server stamped a single `new Date()` across all rows. The fix is
   new capture, not preservation — **progressive save**: each interaction
   (page initialed, acknowledgment ticked, signature) POSTs immediately
   through the EXISTING acknowledgments API, so each append-only row carries
   its own server-clock `signedAt` + IP/UA. No schema change; the certificate
   generator was already per-row and is untouched.
b. **Timestamp policy (F5, amends the earlier org-setting ruling: deferred,
   not dropped).** Date+time is always captured and stored (server clock,
   UTC). Fixed rendering policy for now: validation stamps and certificates
   always show full date+time; inline date fills may render date-prominent.
   The org-level display toggle is a FUTURE ADDITIVE schema item (no settings
   storage exists on Organization today). Court-defensibility wins ties.
c. **Consent language (F1): `esign-2026-07` kept verbatim** — one consent
   version across all records. HR-11 changes its presentation only: shown
   ceremonially at the consent gate and restated at the signature block.
d. **Signature capture (F2): typed-only.** Drawn signatures deferred — if
   ever wanted they ride with HR-11b's schema case (image storage).
e. **Signing ceremony (approved design).** Four phases: consent gate (name +
   initials up front) → inline pdf.js review, pages lazy-rendered, sequential
   per-page initialing ("Initial All" removed from self-serve; a page's
   control arms only when viewed and prior pages are initialed) → fields +
   per-tick acknowledgments → formal execution block (doc/version/hash,
   signer, consent restated, signature-rendered typed name). Manager-attested
   capture deliberately keeps the quick form — it records, it doesn't sign.
   Non-renderable files fall back to open-externally + sequential initial
   list. Resume is the existing per-cycle state. Prior records untouchable by
   construction (append-only + skipDuplicates unchanged).
f. **Rule-5 amendment (F4, Gary).** Active linked staff may VIEW their own
   signed records inline: `/my/documents/records/[id]` canvas render fed by
   `/api/my/signed-records/[id]` (own-records-only, same-origin byte proxy,
   signed blob URL never reaches the client, no download affordance).
   Download remains ADMIN/MANAGER-only; access ends at termination via the
   ACTIVE gate + Clerk revocation. **Honest caveat, recorded:** viewing
   requires serving bytes — a determined user can capture them via devtools;
   the guarantee is "no download affordance", not "bytes can't be saved".
g. **Nav visibility matrix (STAFF only changes; ADMIN/MANAGER/STORE
   byte-identical).** App-shell STAFF keeps Dashboard, Messages, Instagram
   (F6); loses Store View + every Inventory item; Checklists only when the F3
   store-proxy fires (an open checklist exists at an assigned store — there
   is NO per-person checklist assignment in the schema; the staff-facing
   execution surface inside /my is deferred until an org actually has
   staff-visible checklists); HR entry renamed "My Documents" → /my/documents
   (unlinked staff land on the existing no-profile explainer). Linked STAFF
   stay redirected to /my; its tab bar is Home · Messages · Instagram ·
   Documents — Training folded into the Home compliance card (F7, routes
   live); /my/messages is the full MessagesClient, compose included (F8).
h. **BUG-1 completed (step 4).** Stale request-path Square sync now runs
   AFTER the response (`next/server after()`): cached numbers serve
   immediately, refresh lands post-response; a store-day with no cache at all
   still syncs inline; webhooks + reconcile cron remain primary freshness.
   Staging duration logs could not be pulled retroactively (`vercel logs` is
   live-tail only, no log drain configured) — noted; the change is safe
   regardless of what they would have shown.
i. **Mandatory pre-prod-promotion verification (Defect 3):** the Certificate
   of Acknowledgment must render the REAL org name (staging once produced
   "Generated by Froot for Microsoft" from the stale Clerk org name; believed
   fixed by the Clerk rename — verify on a fresh certificate before HR goes
   live in production).
j. (Claude) Delivery details: new dep `pdfjs-dist` (lazy-loaded on document
   routes only; package-lock committed); `?stream=1` inline byte delivery
   added to the documents download route so the viewer never depends on
   cross-origin blob fetch behavior; /my home data is server-fetched
   (messages/compliance) with the Instagram strip client-fetched under the
   BUG-1 timeout/hide discipline. Tagged for HR-14: the /my home surfaces
   nothing for a staff login whose store assignments were dropped by
   termination-then-manual-relink edge paths (existing hardening territory).

## HR-15b re-sign on rehire (Fork 2 REVERSED: Policy A → Policy B) — 2026-07-23 (Gary)

a. **Gary reversed Fork 2 during the staging pass:** rehired employees MUST
   re-sign required acknowledgment documents ("in case things have changed"),
   and the re-read-and-sign flow doubles as the get-back-up-to-speed
   acknowledgment he asked for. Old signed PDFs stay manager/admin-side
   (HR-7 rule 5 unchanged — staff still don't download records).
b. **Mechanism: signing cycles.** The HR-4 engine's uniqueness (one ack per
   checkpoint/version/person, one record per version/person) made same-version
   re-signing impossible, so each tenure is now a cycle: migration
   `20260723180000_hr15b_signing_cycles` adds `StaffMember.signingCycle`
   (default 1) + `rehiredAt`, and `signingCycle` (default 1) on
   HrDocumentAcknowledgment + HrSignedRecord with both unique keys widened to
   include it. Additive columns + index swaps only; no rows touched — all
   existing signatures are cycle 1.
c. **Semantics.** Reactivation increments the member's cycle and stamps
   `rehiredAt`. Signatures count only under the member's current cycle; a
   prior-cycle signature on the current version reads **needs re-sign** (same
   loudness as a version bump, distinct from not-started). Capture stamps the
   current cycle; completion and `ensureSignedRecord` are judged per cycle
   (the cycle is derived server-side from the staff row — a prior cycle can
   never be retro-completed); the signing screens' resume state is per cycle,
   so rehires start the document fresh. A rehire's completed re-sign mints a
   SECOND HrSignedRecord for the same version under the new cycle — the
   cycle-1 record is untouched, hash-intact, still downloadable.
d. **Training deliberately NOT reset** — Gary's decision covered documents;
   a training reset on rehire would be its own decision.
e. (Claude) Reactivate dialog copy now discloses the re-sign requirement;
   `/staff/[id]` header shows "Rehired {date} — required documents need
   re-signing" while `rehiredAt` is set. Verified via fixture script vs dev
   DB + live private store: 11/11 (cycle-1 sign → complete; bump →
   needs-resign pinned to current version; no retro-completion; same-cycle
   dupes still skip; cycle-2 re-sign → new record, old record byte-intact).
f. **Timing note:** Tommy was reactivated BEFORE this shipped, so he remains
   cycle 1 (his old signatures count). Terminate + reactivate him once more
   on staging to exercise the rehire re-sign end-to-end.

## HR-15 rehire / reactivate terminated staff — 2026-07-22 (Gary approved plan + both forks)

a. **Reactivate action.** `POST /api/staff/[id]/reactivate` + Reactivate button
   on `/staff/[id]` for terminated members. Same tier as terminate (ADMIN
   org-wide, MANAGER in-scope). Flips status → ACTIVE, clears `terminatedAt`.
   Never creates a duplicate row, never touches HrSignedRecord /
   FormSubmission / training rows — terminated-not-deleted stays inviolate in
   both directions. The dialog offers "send a login invite" in the same motion
   (chains the existing staff-directory invite flow, so PendingInvite carries
   role STAFF + store assignments and the webhook links on acceptance);
   rehire and invite stay separable — after a plain reactivation the normal
   Invite to self-service button reappears.
b. **Stale-userId hygiene at the source (audit finding → fix).**
   `terminateStaffMember` relied on the `organizationMembership.deleted`
   webhook alone to unlink `StaffMember.userId` — and staging proof showed
   that path is not reliable: Tommy Thomas sat TERMINATED with a live stale
   link (and his User row's store assignments intact), which dead-ends rehire
   (invite 409s "already has a login"). Fix: terminate now unlinks inline
   (userId → null + StoreUserAssignment cleanup) right after Clerk
   revocation; the webhook handler stays as backup for dashboard-initiated
   removals. Reactivate ALSO clears any stale userId defensively, for rows
   terminated before this fix. Old logins stay dead; rehire always re-links
   fresh via the invite flow.
c. **Fork 1 — Square re-termination race (Gary): dialog warning, option (c).**
   The sync reconcile stays absolute-state (Square INACTIVE → terminated);
   the reactivate dialog preflights Square live (`GET .../reactivate` →
   `fetchSquareTeamMember`) and warns "inactive in Square — mark them active
   there too or the next sync will terminate them again." Rationale: sync is
   a deliberate admin click, real rehires must be rehired in Square anyway
   (timeclock/payroll), and both timestamp options (`squareStatus` baseline
   for transition-only, or `manuallyReactivatedAt`) need schema additions.
   Transition-based reconcile is the documented follow-up if Square/Froot
   divergence ever becomes a real operational problem. Note: Square rehire
   (INACTIVE→ACTIVE) does NOT flow into Froot — the sync ACTIVE branch never
   touches status; reactivation is always a Froot-side action.
d. **Fork 2 — compliance on rehire (Gary): Policy A, old signatures stand.**
   Deliberate choice, not an oversight: a rehired member re-enters the
   rollup denominators with prior records counting (signed record on the
   CURRENT doc version = compliant, per HR-8). The document-version bump
   stays the compliance-refresh lever — re-upload flips everyone, rehires
   included, to needs-re-sign. **Documented upgrade path if customer
   compliance policy ever demands rehire-forces-re-sign: Policy B — additive
   `rehiredAt DateTime?` on StaffMember + compliance derivation treating doc
   records completed before it as needs-re-sign** (training reset would need
   its own call). Not implemented.
e. (Claude) Directory findability: "Terminated" badge on `/staff` rows (the
   directory previously showed terminated members indistinguishable from
   active). This ships the badge half of HR-14(b) early; the hide-by-default
   "Show terminated" toggle remains HR-14.
f. **Noted, no action (Gary):** the stray Clerk test account
   (corporate@keva.com / tommythomas) holds an org:admin membership in
   unrelated org "Keva Smoothie Company" — Gary cleans up in the dashboard.
   *(Done during the staging pass — org deleted; its webhook-created fossil
   Organization row joins the HR-14 cleanup list.)*
g. **Invite links route by account status (staging-pass finding, Gary).**
   Both invite routes pointed `redirectUrl` at `/sign-up`, dead-ending any
   invitee whose email already has a Clerk account — exactly the rehire case
   ("email already exists" / "sign up forbidden"; employees have ONE email).
   Fix: new public `/accept-invite` route-handler; Clerk appends
   `__clerk_ticket` + `__clerk_status` to the redirect, and it forwards —
   `sign_in` → `/sign-in` (ticket sign-in accepts the invitation), `sign_up`
   → `/sign-up`, `complete` → `/dashboard`, no ticket → `/sign-in`. Prebuilt
   SignIn/SignUp consume the forwarded ticket automatically. Remaining
   polish is Gary's, in the Clerk dashboard: the invitation email template
   wording ("if you already have a Froot login, you'll just sign in").
   Bulk-sync wart: a TERMINATED member who is Square-ACTIVE still gets store
   assignments rewritten by the bulk sync (the "profile freezes" comment only
   holds for Square-INACTIVE members) — text-only finding, HR-14 territory.

## UM-1 user-management fixes (/users) — 2026-07-22 (Gary approved plan)

a. **Role-mapping truth table.** Clerk memberships only distinguish
   `org:admin` / `org:member`; the finer Froot roles live in the Froot DB
   only. No custom `org:manager` role exists in the Clerk instance (Gary
   confirmed) — the webhook's `org:manager` map entry is dead code, left
   untouched.

   | Froot role | Clerk membership role | Distinction lives |
   |---|---|---|
   | ADMIN | `org:admin` | both |
   | MANAGER | `org:member` | Froot DB only |
   | STORE | `org:member` | Froot DB only |
   | STAFF | `org:member` | Froot DB only |

b. **What the webhook actually overwrites (audit finding).** Narrower than
   assumed going in: `organizationMembership.created` sets `User.role` only
   when CREATING a row (PendingInvite role → role map → STAFF); the upsert's
   update branch self-heals email only. There is no
   `organizationMembership.updated` handler, so no webhook event rewrites an
   existing row's role. Divergence bites on row re-creation (member removed
   and re-added, or a deleted row as in the BUG-2 repair), where the role is
   re-derived from the Clerk membership — plus the Clerk dashboard lies in
   the meantime. Clerk sync on role edits is therefore still mandatory.
c. **Role edits sync Clerk first.** PATCH `/api/users/[id]` updates the Clerk
   org membership role before the Froot row; Clerk failure = no DB write. The
   call is skipped when the mapped role is unchanged (all transitions within
   MANAGER/STORE/STAFF are `org:member` → `org:member`) — Gary approved.
d. **Guards, all server-side:** self-role-change blocked; last-admin blocked
   for both demotion and removal; self-removal blocked; store IDs validated
   as org-owned; demotion to STAFF requires a linked (or
   linkable-by-normalized-email, then auto-linked with the HR-7 `userId:
   null` guard) ACTIVE StaffMember, else 409 pointing at the Staff directory
   invite flow.
e. **Names on /users:** staff-profile name (userId link, else normalized-email
   match not owned by another login) → Clerk first/last from data already
   fetched → email only. One org-scoped StaffMember query; no per-member
   Clerk API calls. Display email prefers self-healed `User.email` over
   `identifier` (BUG-2 rule); identifier is last-resort display fallback.
f. **STAFF appears in the Edit dialog only** — the generic Invite dialog
   deliberately omits it (an invite-created STAFF user would be unlinked, a
   broken state; the Staff directory invite flow is the STAFF entry point).
   Auto-sync + display role defaults aligned to the webhook's STAFF.
g. **Noted, not fixed (follow-up, HR-14 territory):** DELETE `/api/users/[id]`
   still calls `clerk.users.deleteUser`, deleting the Clerk account GLOBALLY
   rather than just the org membership; guards were added around it this
   session but the membership-only removal fix is deferred.

## BUG-2 staff-profile linking — 2026-07-22 (Gary approved fix + repair)

Caught by the HR-8 staging pass: an invited staff member's `/hr/acknowledge`
page showed "no staff profile matching your email (tommythomas)".

a. **Root cause.** The Clerk webhook persisted
   `public_user_data.identifier` as `User.email` and keyed the
   `PendingInvite` lookup on it — but on username-enabled accounts the
   identifier is the USERNAME, not an email. Both linking mechanisms
   (`StaffMember.userId` via PendingInvite, and the email fallback) failed
   for the same reason. Blast radius was wider than HR: role + store
   assignments from PendingInvite were dropped for any affected invitee.
b. **Fix.** Shared helper `src/lib/clerk.ts`
   (`getClerkPrimaryEmail` — Backend API resolution; `normalizeEmail` —
   trim + lowercase). Webhook resolves the real primary email on
   `organizationMembership.created` (500 on API failure so Svix retries),
   PendingInvite lookup is case-insensitive, User upserts self-heal the
   email, new `user.updated` handler tracks primary-email changes (endpoint
   subscription verified by Gary). Users-page auto-sync uses the helper;
   invite routes normalize at write time; signed-record route unified onto
   `findStaffMemberForUser`; staff email writes trimmed.
c. **Data repair (staging).** Deleted the single orphaned
   `email = 'tommythomas'` User row (the Clerk account behind it had been
   deleted during dashboard investigation; the ADMIN role on it was a
   manual test edit — both Gary). PendingInvite kept for re-invite
   verification; StaffMember untouched.
d. **Noted, not fixed:** no `organization.deleted` / `user.deleted`
   handlers (5 fossil Organization rows on staging; future
   webhook-hardening session). Clerk org display name "Microsoft" drives
   invite-email branding — rename is backlog. Display-only `identifier`
   reads on the users surfaces left as-is (cosmetic).

## HR-8 compliance rollup — 2026-07-22 (Gary)

a. **Acknowledgment docs: current version only.** Compliant = every required
   checkpoint acknowledged on the CURRENT document version. A completed set of
   acknowledgments whose signed PDF hasn't been generated yet ("pending-record")
   still counts as compliant — generation is mechanical and idempotent. A
   record signed against an older version is its own **"needs re-sign"**
   status: non-compliant, but distinct from "not started".
b. **Agreement forms stay OUT of the compliance % (v1).** Nothing in the data
   says who is *supposed* to hold a given form (no assignment mechanism, no
   signing-cycle definition), so forms can't be a denominator. They surface in
   a separate Agreements panel on `/hr/compliance`, with submissions stuck in
   `PendingSupervisor` surfaced prominently as the actionable gap. The
   follow-up ("required forms" flag + defined signing cycle, additive schema)
   is logged in `ROADMAP.md` as HR-10.
c. **Training: Completed = compliant.** Certification is a separate, stricter
   badge — never required for the %. An assignment past its `dueDate` and not
   Completed is **"Overdue"**, the loudest gap state on every surface.
   **Amended 7-22 (Gary, HR-8 staging pass):** not-yet-due assignments are
   EXCLUDED from the % denominator — an assignment only counts against
   compliance once its dueDate passes (completing early counts immediately).
   The % means "is anyone behind", not "is everything assigned done".
   Implementation lands with HR-13 (as-built code still counts from
   assignment until then).
d. **Only ACTIVE staff count in rollups.** Terminated staff are excluded from
   every percentage and every rollup denominator; their records remain fully
   auditable (the profile Compliance tab renders them behind an exclusion
   banner, signed PDFs stay downloadable).
e. (Claude) Rollup is computed live from existing records — no stored
   snapshots, no new schema, no migration; per-store grouping uses the
   member's primary store (the `/staff` directory convention) so nobody is
   double-counted. Flagged: if reminders or trend history land later, those
   become stored per-environment data (regenerate per Neon branch).

## L-3 promotion to production — 2026-07-21 (Gary)

a. **Coverage stays sales-inferred for v1.** Populating `StoreHours` (real
   open/close hours) is deferred as a future *additive* upgrade — Square always
   provides selling hours, so there is no empty-data failure mode. Not a blocker
   for promotion.
b. **L-3 promoted to production** on 2026-07-21 (merge commit `9743899`). First
   `staging → main` promotion in a while.
c. **Prod forecast plan was STALE — and it was NOT caused by the promotion.**
   dev / staging / production are separate Neon branches, and forecast goals are
   *stored* data (`GoalPlan` / `dailyGoals`), not recomputed from code. A plan
   regenerated on staging (Jul 20, +3%) was **never** regenerated on prod, so
   prod carried the old ~$802k plan (spiky per-day goals) while staging showed
   the smoothed ~$753k plan. Fixed by running **Refresh from Square + regenerate
   +3%** on prod. **LESSON:** forecast/plan data is per-environment stored data —
   promoting *code* never migrates it; each Neon branch must be regenerated
   independently. (Code was confirmed identical: `goal-engine.ts` unchanged since
   F-1; the only forecasting file in the promoted diff was a new labor helper.)
d. **STRUCTURAL — keep `main` close to staging.** `main` had drifted **53
   commits behind** staging, so "promote L-3" became "promote the whole backlog"
   (L-3 + all of HR-0…HR-7.6 + the Labor foundation, 11 migrations). Going
   forward, promote more often so each `staging → main` diff stays small and
   readable.

## Phase 3 — BUILT 7-20 (Gary decisions)

1. **Budget is the hard cap.** Conservative budget caps total scheduled hours;
   coverage never exceeds it. The floor-to-tier rounding ($15k→$14k, $14.5k→$14k)
   is the buffer. Small stores have physical limits — never schedule blindly to %.
2. **Demand-shaped headcount; drop fixed daypart minimums.** ✅ CONFIRMED. Heads
   follow the sales shape (1 at 2p, 3 at 3p), capped by budget, floored at **1
   opener + 1 closer**. Daypart headcount minimums are removed.
3. **Only the GM is salaried; GM counts on the floor.** ✅ Re-seed positions to
   **one salaried General Manager + everyone else hourly** (ASM/Lead/Supervisor/
   Team). The GM is a body on the floor and the supervisor. **On-floor rule =
   option (b): GM covers open→mid by default** (GMs typically work days/mids;
   Square integration will refine this automatically later).
4. **Future / 4-week forward scheduling.** ✅ Coverage must render future days and
   next weeks (4-week horizon) for writing schedules. Future-day demand shape =
   **average of the same weekday over the last 4 weeks** (fall back to last-year
   same-weekday, à la Forecasting, when recent data is thin).
5. **Per-store settings, rolling to the org.** ✅ Each store's budget maps to its
   own performance/budget; per-store `LaborSettings` override the org default;
   locations roll up to the org total.

## Locked decisions (already built)

- Money = dollars, `Decimal(10,2)`, integer-cents internally. (Gary/Claude)
- Rounding: sales floor-to-tier (no full-step-down); hours floor to 0.5. (Gary)
- Total sales only — delivery split removed; `denominator` /
  `projectedDelivery` deprecated. (**Gary** — 7-20 answer to the 3 questions.)
- Auto-forecast from Forecasting `DailyGoal` (TREND default, MANUAL override). (Gary)
- Adjustment scales hourly hours only; salaried fixed. (Gary)
- Salaried hours are a weekly constant, never split per day (option B). (Gary)
- Two-gate feature flag; RBAC read=any / write=ADMIN+MANAGER. (Claude, unchallenged)

## Claude implementation choices (autonomous — for the record)

- Daypart defaults 2/3/2, all requiring a supervisor. (superseded by open #2)
- Weather-adjustment control on the Coverage card; weekly hero shows adjusted
  total by splitting → adjusting → re-summing (the "adjusted from N" label also
  fires on pure rounding drift — **known wart to fix**).
- Day-split weights auto-derived from trailing 8 weeks of sales.
- Coverage today/past only. (superseded by open #4)
- Day-split editor on `/settings/labor` with a per-store dropdown.
- StoreHours window mapping (0=Sun, floor/ceil times, demand-inference fallback).
- "Revert to auto" delete for the manual override; cross-card refresh event.

## Process

- **Verify-gate:** no new phase starts until the prior one passes a staging pass.
- Heads-up on non-trivial autonomous calls before building; veto window.
- Smaller commits per sub-feature.
