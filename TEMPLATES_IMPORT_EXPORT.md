# USE Froot — Template Export / Import

Adds a portable **Export** and **Import** for Checklist Templates so you can pull
templates out of production and load them into staging (or any environment), and
so you have a permanent export/import feature going forward.

## What's in this folder

```
src/app/api/templates/export/route.ts        # GET  → CSV (or ?format=json) download
src/app/api/templates/import/route.ts        # POST → create templates+tasks from rows
src/app/(app)/templates/template-export-button.tsx
src/app/(app)/templates/template-import-button.tsx
src/app/(app)/templates/templates-client.tsx # already-patched copy (buttons wired in)
templates-client.patch                       # same change as a git-applyable diff
froot-templates-sample.csv                   # sample showing the exact format
PROMPT.md                                     # reusable prompt for your coding agent
```

## Install

Copy the four new files into the matching paths in your `froot` repo. Then either
drop in the patched `templates-client.tsx`, or apply the diff from the repo root:

```bash
git apply templates-client.patch
```

No new dependencies — `papaparse` and `zod` are already in the project. Nothing to
migrate; this uses your existing `Template`/`Task` tables. Commit, push, and Vercel
deploys it to whichever branch you push to (`main` = production, `staging` = staging).

## Extracting production data right now

1. Sign into **https://www.usefroot.com** as an admin.
2. Go to the **Templates** page and click **Export** (downloads
   `froot-templates-YYYY-MM-DD.csv`). If the feature isn't deployed to production
   yet, you can instead open **https://www.usefroot.com/api/templates** while
   logged in and save the JSON — but the Export button is the clean path.
3. Switch to staging
   (`https://froot-git-staging-indianathomas-2483s-projects.vercel.app`), open
   **Templates → Import**, choose the CSV, review the preview, and click **Import**.

## CSV format

One row per task. Rows sharing a `template_name` are grouped into a single
template; template-level columns are taken from that template's first row (repeat
them on every row — the sample does this).

| Column | Required | Notes |
|---|---|---|
| `template_name` | yes | Grouping key. |
| `template_description` | no | |
| `template_type` | no | Opener, Closer, Mid-Shift, Cleaning, Audit, Management… Defaults to `Mid-Shift`. |
| `template_frequency` | no | Defaults to `Daily`. |
| `template_availability_type` | no | e.g. `StoreHours`, `AllDay`. Defaults to `StoreHours`. |
| `template_operational_phase` | no | e.g. `Before Opening`, `After Closing`. |
| `template_start_offset_hours` | no | Integer. |
| `template_end_offset_hours` | no | Integer. |
| `template_applies_to` | no | Always imported as `all` (see below). |
| `task_section` | no | Section header; defaults to `General`. |
| `task_description` | yes* | *A row with no `task_description` is treated as a template-only row (no task created). |
| `task_estimated_minutes` | no | Number. |
| `task_requires_photo` | no | `true`/`false` (also accepts `1`/`0`, `yes`/`no`). |
| `task_requires_temp` | no | `true`/`false`. |
| `task_is_critical` | no | `true`/`false`. |
| `task_order_index` | no | Number; defaults to row order within the template. |
| `task_video_url` | no | Optional URL. |

Any cell containing a comma, quote, or newline must be wrapped in double quotes
(embedded quotes doubled) — standard CSV. The sample file demonstrates this.

## Important behavior

- **Store assignments are not carried across environments.** Store IDs are unique
  per environment, so a production store row doesn't exist in staging. Imported
  templates are created org-wide (`appliesTo = all`) with no per-task store
  exclusions. Re-assign stores in the target environment after import. (Use
  `?format=json` on export if you want the raw assignment data for reference.)
- **Imported templates arrive inactive** (`isActive = false`) so nothing goes live
  until you review it on the Templates page.
- **Re-importing appends by default.** Tick **Replace mode** in the import dialog
  (or send `{ mode: "replace" }`) to archive existing same-named templates first,
  avoiding duplicates.
- **Admin only.** Both routes require an admin, matching the rest of `/templates`.
