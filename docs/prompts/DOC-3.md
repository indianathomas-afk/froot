# DOC-3 — Linked documents + per-document instructions. TIER 3: audit → plan → STOP.

You are executing a planning-approved session on Froot. Planning chat 2026-08-24
scoped this row and Gary ratified four rulings (§2). Nothing below is a build
instruction until Gary approves your Phase 0 plan. Do NOT push. Pushes are Gary's.

## 0 · Where you are

- Repo root is `~/Claude_Projects/Froot/froot` (lowercase). Use the `froot` alias.
  The capital-F parent is not the git root.
- Work on `staging`. Planning audited `main @ 25ba98f`; Gary states staging
  `648e6da` is level. Your first command proves that — every file:line in §3 is
  orientation, and you re-measure on the branch you're actually on.
- House rules: `CLAUDE.md`, `docs/WORKFLOW.md`. Evidence absolute. No `&&` chains.
  Parenthesised subshells, `|| echo "*** NO MATCH ***"` on searches,
  `|| { echo "*** CD FAILED ***"; exit 1; }` on the opening cd. Additive-only
  schema. Preserve-and-mark on the roadmap. Two-commit pattern.

Opening command:

```
(cd ~/Claude_Projects/Froot/froot || { echo "*** CD FAILED ***"; exit 1; }
 echo "=== branch/head ==="; git branch --show-current; git log --oneline -1
 echo "=== level with main? ==="; git rev-list --left-right --count main...staging
 echo "=== DOC-3 / DOC-4 already on board? ==="; grep -c "id: DOC-3\|id: DOC-4" docs/ROADMAP.yaml)
```

Expected: `staging`, `648e6da`, `0	0` (or explain the delta before continuing),
and `0` for the grep. If the grep is non-zero, STOP — someone filed these rows
already and the numbering in §6 is wrong.

## 1 · What this row builds (after approval)

Two capabilities on the HR document library, one row, link-first then
instructions so a stop after the schema phase leaves something coherent.

1. **A document can be a link instead of a file.** `kind: "Link"`, a nullable
   `externalUrl` on `HrDocument`, zero version rows. The driving case is the
   I-9: `https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf`.
   Audience by store/person exactly as today, so a Colorado store gets the
   Colorado link and a Nevada roster never sees it.
2. **Instructions on any document.** Two nullable columns on `HrDocument`:
   `instructionsHtml` (sanitized rich text, HR-28's `sanitizeRichText`) and
   `instructionsVideoUrl` (raw URL, rendered through `canonicalYouTubeUrl` as an
   embed, else a plain link). Applies to Reference, Acknowledgment, and Link.

Explicitly NOT this row:
- No link between a library entry and a returned `StaffDocument`. DOC-2 owns that.
- No role-level visibility floor ("managers only"). That is DOC-4, which you FILE
  in §6 and do not build.
- No link checking on read, no nightly sweep.

## 2 · Rulings — ratified 2026-08-24, write into docs/DECISIONS.md verbatim

Heading: `## 2026-08-24 — DOC-3: linked documents and instructions`

> 1. A linked document is `kind: "Link"` with a nullable `externalUrl` on
>    `HrDocument`, zero version rows. Additive only.
> 2. The library link and the staff-record upload stay independent; DOC-2
>    connects them. Audience for a Link uses the existing store/person grants
>    unchanged. Role-level visibility is a separate row (DOC-4), not built here.
> 3. Instructions reuse HR-28: sanitized rich text via `sanitizeRichText`, plus a
>    separate video URL rendered through `canonicalYouTubeUrl`. Applies to every
>    kind.
> 4. Links are validated for shape at save (https, parses, not our blob host),
>    never checked on read; the host is displayed under the title. A nightly link
>    check, if ever, is a debt row.
>
> Split ruling (Gary, same date): "DOC-3 (this row): link kind + instructions,
> audience by store/person exactly as today. The I-9 case is fully served —
> Colorado stores get the Colorado link. No role floor. File DOC-4 as its own
> row: visibility floor — managers-only documents. Scope it with the four places
> it has to be honored, and say it inherits DOC-1's denominator rules. Rule on it
> separately, because 'which staff owe a document' and 'which logins can see it'
> are about to be two different answers and I want that written in DECISIONS.md
> before code reads it."

## 3 · Planning-chat audit (main @ 25ba98f) — re-verify every line

| What | Where | Finding |
|---|---|---|
| kind is a free string, no enum | `prisma/schema.prisma:1637-1640` | fourth kind costs no column migration |
| version requires file fields | `schema.prisma:1735-1745` | fileUrl/fileName/contentType/sizeBytes/fileHash non-null → a Link must have ZERO versions |
| create route is blob-only | `api/hr/documents/route.ts:21, :49, :56` | `isOrgHrBlobUrl` (`access.ts:42-52`) rejects any external URL; Link needs its own body branch, not a relaxed one |
| signing gate is a real type check | `(app)/hr/acknowledge/[documentId]/page.tsx:38`, `acknowledgments/route.ts:72`, `signed-record/route.ts:46`, `(my)/my/documents/[documentId]/page.tsx:27`, client `documents-client.tsx:260` | all `kind: "Acknowledgment"` in the where → Link cannot reach the ceremony. No change needed |
| requiresAcknowledgment derives from kind | `route.ts:98` | a Link can never be flagged for signing |
| download 404s on no version | `download/route.ts:31, :47` | route is safe; the BUTTONS are not — `documents-client.tsx:269-278` and `(my)/my/documents/page.tsx:254-257` render Download on every active row |
| row metadata assumes a file | `page.tsx:62-64`, `documents-client.tsx:252` | a Link would render "· 0 B · Uploaded" — two surfaces disagreeing |
| kind allow-lists | `lib/hr-documents.ts:33 HR_DOCUMENT_KINDS`, `page.tsx:39`, `(my)/my/documents/page.tsx:68`, `[id]/route.ts:30` | a new kind is INVISIBLE until these are widened |
| versions UI already kind-gated | `documents-client.tsx:289` | Link never gets a versions surface. Fine |
| archive is kind-agnostic | `[id]/route.ts:11, :34` | works unchanged |
| PATCH edits title/category only | `[id]/route.ts:9-11` | editing externalUrl / instructions is new surface either way |
| return path exists, unlinked | `api/staff/[id]/documents/route.ts:7-14, :33, :48`; `schema.prisma:1996` | `StaffDocument` has no FK to `HrDocument`. Leave it that way (ruling 2) |
| HR-28 precedent | `components/hr/training-module-view.tsx:6, :108, :129, :172-208`; `lib/sanitize-html.ts:63`; `lib/messages.ts:113` | reuse verbatim |
| stale next-free note | `docs/ROADMAP.yaml:5017` says HR-28 is next free; HR-28 exists at `:4984` | not this row's job; mention in the DOC-4 filing's neighbourhood only if you touch that region, otherwise leave for DEBT-84 |

## 4 · Phase 0 — audit and plan, then STOP

Re-verify §3 on staging with file:line in your output. Then produce a plan with
these sections and hand it back to planning chat. Do not create or edit any
source file in Phase 0.

**4a · Schema.** Three nullable columns on `HrDocument`: `externalUrl String?`,
`instructionsHtml String?`, `instructionsVideoUrl String?`. Hand-authored
migration per `docs/MIGRATIONS.md` (`prisma migrate dev` is broken, P3018).
Propose whether the invariant `kind = 'Link' ⇔ externalUrl IS NOT NULL ⇔ no
version rows` is enforced in the route only, or also as a CHECK appended to
MIGRATIONS.md § Protected indexes (same hazard class as `hrdoc_grant_shape` —
the baseline squash silently drops it). Give a lean.

**4b · Create route.** `bodySchema` becomes a discriminated union on `kind`.
Link branch: `title`, `category`, `externalUrl` (https only, parses, hostname
NOT ending `.private.blob.vercel-storage.com`), no `url`, no `fileName`. File
branches unchanged. Link creates the `HrDocument` with no `versions.create`. Both
branches accept the two instructions fields; `instructionsHtml` passes through
`sanitizeRichText` server-side before write — the client is never trusted.

**4c · PATCH route.** Add `externalUrl` (Link only, same validation),
`instructionsHtml` (sanitized), `instructionsVideoUrl`. Reject `externalUrl` on a
non-Link with 400.

**4d · Kind allow-lists.** `HR_DOCUMENT_KINDS` gains `"Link"` with label
"Link — points to a document hosted elsewhere". Then every consumer in §3's
allow-list row is re-audited: list which widen automatically because they import
the constant and which have a literal `in: [...]` that must be edited by hand.
Name each.

**4e · Readers.** For each surface, say what a Link renders:
- Library row (`documents-client.tsx`): icon (`ExternalLink` not `FileText`),
  metadata line = hostname · "Added <date>" (NOT size, NOT "Uploaded"), action =
  "Open" (`target=_blank rel=noopener noreferrer`, href = externalUrl) instead of
  Download. Sign never appears. Manage-versions never appears.
- Staff portal Library (`(my)/my/documents/page.tsx`): same — card links to
  externalUrl, not to `/api/hr/documents/[id]/download`.
- Download route: leave as is; confirm a Link id returns 404 at `:31` and say why
  that is acceptable (nothing links to it).
- Instructions: where they render on each surface. Lean: an expandable
  "Instructions" block under the row in the library and above the Open/Download
  action in the staff portal; video via the HR-28 iframe pattern.

**4f · Dialog.** Type select gains Link. Choosing it hides the File input and
shows a URL input (`type="url"`, required). Instructions fields (rich text via
the HR-28 editor component, video URL input) appear for every kind. Client-side
required-ness must match the server's — write down the check that proves the two
surfaces agree (submit a Link with no URL, expect a 400 and a visible error, not
"saved").

**4g · Edit dialog.** `EditDocumentButton` gains externalUrl (Link only) and the
two instructions fields.

**4h · Gates.** `npm run build` before every commit. A grep proving no reader
still renders Download/size/Uploaded on a Link path. A staging browser check on
`froot-git-staging-…vercel.app/hr/documents` (badge `~staging`) as `karson@keva.com`
(ADMIN) and `tommy@keva.com` (STORE/MANAGER): create the I-9 as a Link granted to
one store, confirm the other store's login does not see it, confirm Open goes to
uscis.gov, confirm no Sign/Download/versions affordance. SQL for the Neon console
(staging `ep-odd-rain`, `br-square-feather`) proving the Link row has zero
`HrDocumentVersion` rows, with the branch in the same output.

**4i · Triage.** Anything out of scope you find: FIX NOW / RULING NOW / COMMENT /
ROW, row last. RULING NOW stops the session.

STOP HERE. Return the plan. Do not proceed to §5 without Gary's approval.

## 5 · Build phases (only after approval)

One phase per commit-pair; each phase ends on a green `npm run build`.

- Phase 1 — schema + migration + DECISIONS.md entry (§2).
- Phase 2 — create/PATCH routes + `HR_DOCUMENT_KINDS` + allow-list widening.
- Phase 3 — readers (library row, staff portal, dialog, edit dialog, instructions).
- Phase 4 — roadmap (§6) + DEPLOY_LOG heredoc handed to Gary for the push.

## 6 · Roadmap edits (Phase 4)

`cp docs/ROADMAP.yaml docs/ROADMAP.yaml.bak` first. Edit by line number, higher
line first. Prove with `diff docs/ROADMAP.yaml.bak docs/ROADMAP.yaml | grep -c "^<"`
returning 0, AND confirm no error line printed above it.

**DOC-3** — track `hr`, size M, status per phase. Notes carry: the four rulings
by reference to DECISIONS.md, the zero-versions invariant, the list of literal
`in: [...]` allow-lists that had to be hand-widened, and "DOC-2 attaches a
returned StaffDocument to a Link via a nullable FK; nothing in DOC-3 forecloses
that."

**DOC-4** — track `hr`, size M, status planned. Title: "Visibility floor —
managers-only documents". Notes, in Gary's words from §2's split ruling, then:
"THE FOUR PLACES IT MUST BE HONORED: `canReadHrDocument` and both
`*AudienceWhere` fragments (lib/hr-documents-access.ts), the staff-portal list
((my)/my/documents), the library list ((app)/hr/documents/page.tsx), and the
compliance denominator (lib/hr-compliance.ts) — a managers-only document granted
to a store must NOT count against crew who cannot see it. INHERITS DOC-1's
denominator rules (current audience, ACTIVE staff at the counting layer, R3
corporate exclusion). Today STORE and MANAGER logins deliberately share one read
branch (hr-documents-access.ts:167-178) — a floor separates them and that is a
ruling, not a refactor. AWAITING RULING before any code reads it."

## 7 · Standing reminders

- Never write a push instruction anywhere. DEPLOY_LOG entry is a heredoc Gary runs.
- Name the branch on every DB figure; `current_database()` proves nothing, the
  `ep-` host does.
- A green gate from an instrument that cannot fail is not evidence — show the
  Link-with-no-URL 400 actually firing before trusting the dialog's agreement.
- `--no-ff` only. `--ff-only` is banned.
