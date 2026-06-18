# Supabase migrations

Historical, ordered DDL applied to hosted databases. `../../schema.sql` is the
canonical bootstrap schema — reflect every structural change there too.

## ⚠️ Coach dashboard contract

An external repo (the coach dashboard) reads/writes this same database. After any
migration that changes a **coach-facing** table (`user_profile`, `coaches`,
`coach_user`, `checkin_coach_with_user`):

1. Mirror the change in `../../schema.sql`.
2. Classify new/changed columns in `../../docs/coach-dashboard-data-model.config.json`
   (`access`: `coach-edit` | `app` | `system` | `read`).
3. Run `npm run data-model` to regenerate `../../docs/coach-dashboard-data-model.md`
   (also runs automatically on `npm start`).
4. `npm run data-model:check` must pass before committing.

This keeps the dashboard's data-model docs from silently drifting from the schema.

## Naming

Files must match `<timestamp>_name.sql` (e.g. `20260601120000_special_codes.sql`)
or the Supabase CLI will skip them. `add_delete_cascade_and_policies.sql` predates
this convention and is intentionally applied out of band.
