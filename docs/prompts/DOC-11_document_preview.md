Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-11_document_preview.md and follow it exactly.

# DOC-11 — Document Library preview

**TIER 2.** Declare the tier before writing anything. No schema, no migration, no new permission. If anything in the audit says this needs a schema change or a new capability, STOP and report. Do not build around it.

## What Gary wants

On `/hr/documents`, the only way to see what a document looks like today is to download it. Add a **Preview** button that opens the document in a dialog so the team can scroll through its pages without downloading.

## Rulings (Gary, in chat 2026-09-29 — draft these into DECISIONS.md for ratification at PRE-PUSH-CHECK)

1. Preview lives on the Document Library (`/hr/documents`) only, for whoever already sees that page. `/my/documents` is out of scope and becomes a later phase.
2. PDFs and images preview. Any other uploaded file type opens the dialog with "Preview not available for this file type" and a Download button. Link documents (`kind: "Link"`) get no Preview and keep their existing "Open".
3. PDFs render with a page-drawing library (react-pdf / pdfjs-dist), **not** the browser's built-in viewer in an iframe. iPhone Safari's built-in viewer shows only page 1, and managers use Froot on phones. Pages render lazily as they scroll into view, so a 14.6 MB handbook doesn't lock up a phone.
4. Current version only.
5. Previewing records nothing. No AuditLog row, no view tracking, no acknowledgment, no compliance effect.

## Repo gate (stop if any fail)

Run each as its own command and read the result before the next:

```
git branch --show-current
```
Must be `staging`.

```
git status --short
```
Must be empty.

```
git fetch origin
```

```
git merge-base --is-ancestor origin/main HEAD
```
Must exit 0. DOC-10's merge `7308af0` has to be on staging. If this fails, STOP. Main has not been merged back into staging yet.

Then read `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` and confirm `DOC-11` is unused. If it is taken, STOP and report the next free DOC id. Do not rename it yourself.

## Brief audit (report findings, then build; stop only on the listed conditions)

Find and name, with file paths:

- The `/hr/documents` page and the component that renders each document card's action row (Sign / Signing status / Download / icons).
- The existing **download** route for an uploaded document. Record:
  - its server-side permission check (who can call it);
  - how it serves the file: streams from Vercel Blob, or redirects to a Blob URL;
  - whether it writes anything (AuditLog, download counts). Preview must not.
- How the **current version** of a document is resolved, and where the file's MIME type or file name lives. If no MIME type is stored, infer it from the extension.
- Whether `next.config.*` or middleware sets a Content-Security-Policy that would block a pdf.js worker or `blob:` URLs.

STOP conditions:
- The download route has no server-side permission check.
- The file is served from a cross-origin URL that pdf.js cannot fetch (CORS), and there is no same-origin path without a new route that loosens access.
- Anything requires a schema change.

## Build

**1. Inline serving (reuse, don't loosen).** Add an inline mode to the existing download route (e.g. `?disposition=inline`). Keep **exactly the same permission check**, then:
- Serve `Content-Disposition: inline` with the correct `Content-Type`.
- Serve inline only for PDF and image types (png, jpg/jpeg, gif, webp). For anything else in inline mode, return 415.
- In inline mode, skip any audit or download-count write the download path makes (ruling 5).
- Leave current download behavior byte-for-byte unchanged when the param is absent.

Do not create a second file route with its own permission logic.

**2. Dependency.** Add `react-pdf` at an exact pinned version compatible with React 19 and Next 16. Serve the pdf.js worker from the same origin (the approach react-pdf documents for Next.js), never from a CDN. Load the viewer with `next/dynamic` and `ssr: false` so it stays out of the page's main bundle and never renders on the server.

**3. Preview button.**
- Add **Preview** (lucide `Eye` icon, same text-link style as Sign / Download) as the first action on every uploaded-file document card.
- Do not add it to Link documents.
- Match the existing action row's mobile behavior.

**4. Preview dialog** (shadcn Dialog, existing styling tokens):
- **Header:** document title, version label, a Download button, and close.
- **Size:** near full-screen on desktop, full-screen on mobile. The body scrolls; the header stays put.
- **PDF:** continuous vertical scroll of all pages, each fitted to the dialog width (re-measure on resize/rotate). Render a page only when it nears the viewport (IntersectionObserver), with a same-size placeholder until then so the scrollbar is honest. Show "N pages" once known. Text layer and annotation layer off; this is a look, not a reader.
- **Image:** single `<img>` from the inline URL, `object-contain`, scrollable if tall.
- **Unsupported type:** "Preview not available for this file type" plus Download.
- **States:** loading spinner, and on failure "Couldn't load the preview" plus Download. Never a blank dialog.
- **Hydration:** don't add to DEBT-113 (React #418 on this page). No server-rendered dates or locale formatting in new code.

## Out of scope

Anything on `/my/documents`, Link document previews, older versions, view tracking, and search inside PDFs.

## Checks

Run each separately:

```
npm run lint
```

```
npx tsc --noEmit
```

```
npm run build
```

`npm run build` runs `prisma generate`, which is not a migration. Note it in the report as such.

## Commits (never push)

Stage only the files this session touched. No `git add -A`.

1. **Work commit.** Route change, dependency (`package.json` + lockfile), worker setup, button, and dialog.
2. **Docs commit:**
   - Add ROADMAP row `DOC-11` in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`, status `in_progress`, with the work SHA.
   - Add a draft DECISIONS.md entry with rulings 1–5 above, marked awaiting Gary's ratification.
   - Add a planned row for "Preview on `/my/documents`".

## Report back

- Audit findings (paths, permission check, serving method, what download writes).
- Pinned react-pdf version and how the worker is served.
- Both SHAs.
- The three check results.
- Any out-of-scope findings, classified FIX NOW / RULING NOW / COMMENT / ROW.

## Staging test plan (Gary, after PRE-PUSH-CHECK and push)

1. As `indianathomas` on `/hr/documents`, preview the Employee Handbook. All pages scroll, it stays smooth, and the page count shows.
2. Preview the Key Agreement.
3. Upload a test image and preview it.
4. Upload a non-PDF (e.g. .docx) and confirm the "not available" message with a working Download.
5. The I-9 Link card shows no Preview; Open still works.
6. On iPhone Safari, preview the handbook. Pages past page 1 must render.
7. Download on each card still downloads, same as before.
8. As Tommy, call the inline URL of a document he can't download. Expect the same refusal the download route gives him.
