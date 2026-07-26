# Roadmap

Phase status now lives in **`docs/ROADMAP.yaml`** — the single source of truth.
This file is retired. Do not add status here.

Narrative history for shipped phases (verification fixtures, migration names,
decision cross-references) is preserved verbatim in `docs/ROADMAP_ARCHIVE.md`
(frozen 2026-07-24 — no longer updated).

`/internal/roadmap` (ADMIN-only) is the live dashboard, rendered from
`docs/ROADMAP.yaml` at build with its timestamp taken from that file's git
commit date; the downloaded `froot-roadmap-dashboard.html` snapshot is
deprecated — it dated itself by hand and went stale on the first edit.
