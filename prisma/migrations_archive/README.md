# prisma/migrations_archive — history only

Archived by **DEBT-125** (baseline squash, closes **BUG-25**), 2026-11-05.

These 86 folders are the migration history from `20260627002005_init`
through `20261104020000_tpl3_task_retired_at`. They were replaced by the single
generated baseline `prisma/migrations/0_init`, because 20 tables never had a
`CREATE TABLE` in any of them and a fresh `migrate deploy` could not run them.

- **History only. Never applied again.** Prisma reads only `prisma/migrations/`
  (`prisma.config.ts`) and never reads this folder. The `scripts/verify-*.ts`
  fixtures read files here as plain text only.
- **Never deleted** (DEBT-125 ruling R1). Existing databases keep their 86
  `_prisma_migrations` rows with these names. `migrate deploy` ignores rows
  whose folders are gone.
- Do not move a folder back into `prisma/migrations/`. Its SQL would run again
  on top of `0_init`.

See `docs/MIGRATIONS.md` § "After the squash".
