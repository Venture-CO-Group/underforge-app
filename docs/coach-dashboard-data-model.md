# Coach Dashboard — Supabase Data Model Contract

**Audience:** the external coach-dashboard repo (and anyone editing user data directly in Supabase Studio).

**Why this file exists:** `schema.sql` is the canonical DDL, but raw DDL doesn't tell you *which columns a coach may edit*, *what shape the JSON columns are*, or *how the storage buckets work*. This document is that contract.

**This doc is the DB contract, not the whole app.** When building or changing the coach dashboard (especially with AI), start here, then pull additional files from the **underforge_app** repo only when the task needs them. Paths below are relative to that repo root.

---

## Related files in the app repo (read on demand)

Use this as a lookup: if you're working on X in the dashboard, ask for / open these files in underforge_app.

| If you need to understand… | Read in underforge_app |
| --- | --- |
| **Full DB DDL** (tables, columns, constraints, bootstrap) | `schema.sql` |
| **Column ownership & coach-facing classification** (what the dashboard may edit) | `docs/coach-dashboard-data-model.config.json` |
| **How this doc stays in sync with schema** | `scripts/generate-data-model.js`, `package.json` (`data-model` scripts) |
| **Plan / onboarding JSON shape** (`onboarding_profile_json`, action steps, hypothesis) | `types/onboard.ts`, `types/onboarding_config.ts` |
| **User profile fields** (TypeScript mirror of `user_profile`) | `types/user_profile.ts` |
| **Workout plan inside a step** (`step_details` as `WorkoutPlan`) | `types/workout.ts` |
| **Exercise catalog the plans draw from** (all exercises, classification, muscles worked, muscle maps) | `docs/exercise-catalog-contract.md` |
| **Human coach per-step notes** (parse/write `human_coach_step_notes_json`) | `lib/human-coach-step-notes.ts` |
| **Reading/writing profiles & plans in Supabase** | `lib/supabase_db_new.ts` (`updateUserProfile`, `updateUserOnboardingProfileJson`, `coach_user` helpers) |
| **Plan regeneration** (what overwrites the plan blob) | `lib/regeneration-utils.ts`, `lib/llm-service.ts` |
| **Nutrition targets side effects** (editing step 2 → `user_nutrition_targets`) | `lib/nutrition-storage.ts` (`persistPlanNutritionTargets`), `lib/baseline-movement.ts` |
| **Coach roster / coach type / DB coach ids** | `lib/coach-config.ts`, `assets/onboarding_config/onboarding_coaches.json` |
| **Matching coach display name to onboarding** (`full_name` first token ↔ config key) | `components/ChooseCoach.tsx`, `assets/onboarding_config/onboarding_coaches.json` |
| **Hybrid vs AI-only coaching in chat** (`human_coach` vs `ai_coach` messages) | `components/ChatScreen.tsx`, `lib/supabase_db_new.ts` (coach email lookup via `coach_user`) |
| **In-app plan editing UI** (reference for what fields exist on steps) | `components/DeveloperCoachEditPlan.tsx`, `components/EditPlanModal.tsx`, `components/StepDetailContent.tsx` |
| **Weekly check-in report JSON** (`weekly_checkin_reports.narrative_json`) | `lib/weekly-report-narrative.ts`, `lib/weekly-report-metrics.ts`, `lib/weekly-report-supabase.ts` |
| **Social post snapshots** (`metrics_snapshot`, `share_options`) | `lib/social-posts.ts`, `components/ShareWorkoutModal.tsx` |
| **Wearables / provider connections** (mostly read-only for coaches; service-role tables) | `supabase/functions/README_WEARABLES.md`, `lib/activity-storage.ts`, migrations under `supabase/migrations/20260423_wearables.sql` and `20260429_wearables_sleep_recovery.sql` |
| **Storage bucket policies** (not in `schema.sql`; `storage.objects` RLS) | `supabase/migrations/20260526_social_share_and_forging_circle.sql`, `supabase/migrations/20260528143000_forging_circle_images.sql`, `supabase/migrations/20260604120000_body_progress_photos.sql` |
| **Body progress photos** (capture UI, upload, chart thumbnails) | `components/BodyPhotoCapture.tsx`, `components/WeeklyLogModal.tsx`, `components/WeightBarChart.tsx`, `lib/storage-upload.ts` (`uploadBodyPhoto`), `lib/body-composition-storage.ts` |
| **Special onboarding codes** (`special_codes` table + seeds) | `supabase/migrations/20260601120000_special_codes.sql`, `components/SpecialCodeEntryModal.tsx` |
| **Realtime on circle invites** (`REPLICA IDENTITY FULL`) | `supabase/migrations/20260528120000_forging_circle_invites_realtime.sql` |
| **Coach-sent circle invites** (`inviter_coach_id`, push, dashboard insert shape) | `supabase/functions/circle-invite-push/README.md` + `index.ts`, `supabase/migrations/20260607130000_coach_circle_invites.sql`, `lib/forging-circle.ts` |
| **Local SQLite parity** (what the phone stores offline vs Supabase) | `lib/db.ts` |
| **Account deletion cascades** (what rows disappear with a user) | `supabase/functions/delete-account/index.ts` |

When in doubt: **schema + this doc first**, then the row that matches your feature. Do not copy TypeScript types into the dashboard repo unless you adopt a shared package — import or read from underforge_app so shapes stay single-sourced.

---

## How this file stays correct (read before editing)

The table/column inventory at the bottom is **generated from `schema.sql`** by `scripts/generate-data-model.js`. You do not edit it by hand.

- It regenerates automatically on `npm start` / `npm run ios|android|web` and during EAS builds (wired through `package.json`). So it tracks `schema.sql` without anyone remembering to do anything.
- CI / pre-commit can run `npm run data-model:check`, which **fails** if the doc is stale *or* if a coach-facing table gained a column that nobody classified.
- When you add/change a column on a coach-facing table, classify it in `docs/coach-dashboard-data-model.config.json` (access = `coach-edit` | `app` | `system` | `read`). Until you do, it shows up as `⚠️ UNCLASSIFIED` here and the check fails. That is the forcing function — there is no way to quietly change the schema and leave the dashboard guessing.

The prose sections **above** the generated block (workflows, JSON shapes, etc.) are hand-written; keep them current when behavior changes.

---

## Connecting

- Same Supabase project as the app (`supabase/.temp/linked-project.json` → project ref). Use the project URL + anon key, or a service-role key for privileged dashboard operations.
- RLS across most `public.*` tables is **permissive** (anon may read/write). Treat the dashboard as trusted; the database is not the access-control boundary. Do not widen this assumption without revisiting RLS.
- Two tables are locked down: `provider_raw_payloads` and `user_provider_connections` are service-role only (the latter exposes a safe `user_provider_connections_public` view).

---

## JSON column shapes (source of truth = TypeScript types)

Do **not** duplicate these shapes elsewhere — read them from the app repo so they can't drift:

| Column | Shape | Source of truth |
| --- | --- | --- |
| `user_profile.onboarding_profile_json` | `Onboard` (includes `actionPlan.steps[]`, `hypothesis`, goals, nutrition targets) | `types/onboard.ts` |
| `user_profile.onboarding_profile_ai_gen_json` | same `Onboard` shape, frozen AI snapshot | `types/onboard.ts` |
| `user_profile.human_coach_step_notes_json` | `{ "step_1": string, "step_2": string, "step_3": string }` | `lib/human-coach-step-notes.ts` |
| `*.step_details` inside the action plan | `string \| {text}[] \| {text} \| WorkoutPlan` | `types/workout.ts` |
| `weekly_checkin_reports.narrative_json` | LLM narrative blob | `components/WeeklyProgressReportModal.tsx` / report writer |
| `social_posts.metrics_snapshot` / `share_options` | denormalized post metrics | social post writer |

### Editing the plan (`onboarding_profile_json`) safely

- The plan is one JSON blob. The app writes it whole on plan create/regenerate/edit (`updateUserOnboardingProfileJson` / `updateUserProfile` in `lib/supabase_db_new.ts`).
- **Regeneration overwrites the entire blob.** Anything a coach hand-edits inside it can be lost on the next AI regeneration. This is exactly why coach notes live in the separate `human_coach_step_notes_json` column instead of inside the plan.
- Editing plan **step 2** (nutrition) has a side effect: the app re-derives `user_nutrition_targets` via `persistPlanNutritionTargets`. If the dashboard edits nutrition in the plan, expect targets to be recomputed by the app; don't fight it by writing `user_nutrition_targets` directly.

---

## Workflows the dashboard must respect

**Plan review status** — `user_profile.plan_status`:
`AI drafted` → `Coach reviewed` → `Coach and client reviewed`. Move it forward as the coach works; the app surfaces this state.

**Assigning a coach / changing a plan tier** — `coach_user` is an **append-only log**, not a one-row-per-pair table. The live assignment is the row `WHERE is_current = true` (exactly one per user, enforced by a partial unique index). To assign a coach or change a user's `plan_tier_id`, set the current row `is_current = false`, then **insert a new row** with the new `coach_id`/`plan_tier_id` and `is_current = true`. The history of ai↔human moves is every row for that user ordered by `assigned_at`. The app reads only the current row (`is_current = true`) for coach lookups (`lib/supabase_db_new.ts`).

**Plan tiers** — `coach_user.plan_tier_id` → `plan_tiers`. `NULL` means `ai_only`. Add a future tier by inserting a `plan_tiers` row (no schema change). The app shows the current tier's name on the Account screen (read-only for the user); everything else about tiers is dashboard/Studio-managed.

**Pending check-ins this week** — not stored; compute it: `max(0, plan_tiers.checkins_per_week − count(checkin_coach_with_user rows for the user since Monday))`. Pair it with the latest `checkin_date` so the coach can time the next one. `ai_only` (`checkins_per_week = 0`) is always 0 pending.

**Coach check-in notes** — write `checkin_coach_with_user` rows (set `checkin_type` = `message`/`call`/`video`/`in_person`); these are manual human-coach check-ins, distinct from the app's automatic weekly AI check-in (`weekly_checkin_reports`) and from `human_coach_step_notes_json` (per-plan-step guidance shown inside the user's plan).

**Hybrid vs AI-only** — `coaches.coach_type = 'ai_human_hybrid'` unlocks human-coach features for that coach's users. `full_name`'s first token must match the onboarding config key (see `ChooseCoach` / `onboarding_coaches.json`).

---

## Storage (files, not rows)

Buckets are public-read; the row stores the public URL.

- `avatars` → `user_profile.avatar_url`
- `social-posts` → `social_posts.photo_url`
- `circle-images` → `forging_circles.image_url`
- `body-photos` → `body_composition_log.photo_front_url` / `photo_side_url` / `photo_back_url`

Public URL pattern: `\<SUPABASE_URL>/storage/v1/object/public/\<bucket>/\<path>`. The `storage.objects` write policies that back these buckets live in `supabase/migrations/` (not in `schema.sql`, because they target `storage.objects`, not a `public.*` table).

**Body progress photos — privacy note (deliberate tradeoff).** `body-photos` is **public-read**, like the other buckets. This is intentional, not an oversight: the dashboard reads these directly by URL with no signed-URL plumbing, and it matches the app's trusted-client RLS posture (the `body_composition_log` rows holding the URLs are already anon-readable). Privacy therefore rests on **hard-to-enumerate paths** — `{userId}/{year}_W{week}_{angle}.jpg`, where `userId` is a Clerk-style sub — not on the bucket ACL. One photo set per ISO week (front/side/back); re-uploading a week overwrites in place. If body-photo confidentiality ever needs to be a hard guarantee, switch this bucket to private and generate signed URLs in both the app (`lib/storage-upload.ts`) and the dashboard.

---

## Coach-owned Forging Circles (dashboard-introduced)

The coach dashboard lets a coach create and own a Forging Circle directly, without proxying through one of their coachees. End-user-owned circles continue to work exactly as before; coach-owned circles are an additive concept on the same `forging_circles` row.

**Schema additions to `public.forging_circles`** — now mirrored into the app repo's canonical `schema.sql` and shipped as a hosted migration (`supabase/migrations/20260607120000_coach_owned_forging_circles.sql`). The originating dashboard script is `web_dashboard/coach_owned_circles.sql`.

- `owner_coach_id integer NULL REFERENCES public.coaches(id) ON DELETE SET NULL` — new column.
- `owner_user_id text` is now **NULL-able** (was previously NOT NULL; the migration drops it).
- `CREATE INDEX idx_forging_circles_owner_coach_id ON public.forging_circles(owner_coach_id)`.

**Invariant (enforced in app + dashboard code, not yet via DB CHECK):** exactly one of `owner_user_id` / `owner_coach_id` is non-null per row.

| `owner_user_id` | `owner_coach_id` | meaning |
| --- | --- | --- |
| set | NULL | user-owned circle (legacy; created by an end user in the app) |
| NULL | set | coach-owned circle (created by a coach in the dashboard) |
| both set or both NULL | — | invalid — do not write |

**App-side changes required to consume coach-owned circles**

When `owner_coach_id` is non-null, treat the circle as owned by a coach instead of a user:

- **Owner display.** Don't look up `user_profile(owner_user_id)`. Join to `coaches(owner_coach_id)` and use `full_name` (fallback `coach_name`). The app may want a small "Coach" badge to distinguish from peer-owned circles.
- **`CommunityScreen` / `ShareWorkoutModal` audience picker.** A coach-owned circle still appears in the user's list of circles (because the user is a `forging_circle_members` row). The existing visibility filter (`circle_id IS NULL` broadcast vs `circle_id === audience.circleId`) is unchanged; the only thing that differs is the owner label.
- **`listCircleParticipantIds` / `listAllOwnedCircleParticipantIds`.** Participants are still just the owner plus members. For coach-owned circles, the "owner" contributes no `user_id` to the participant set — only the members do. So `participants = forging_circle_members.member_user_id for that circle` (no owner row to add).
- **Edit / delete UX.** End users do not own these circles and should not be allowed to rename, re-image, or delete them from the app. Gate the existing owner-only controls on `owner_user_id === currentUserId` (already correct if you compare to `owner_user_id`, since coach-owned circles have it `NULL`).
- **Invites (`forging_circle_invites`).** A coach can now invite a user instead of (or as well as) adding them silently. `forging_circle_invites.inviter_coach_id` records the coach inviter; `inviter_user_id` is left NULL (the `forging_circle_invites_one_inviter` CHECK enforces exactly one of the two). The invitee then gets the same flow as a peer invite — pending-invites list + realtime banner + push — rendered as "Coach X invited you" with a Coach badge (`lib/forging-circle.ts` resolves the coach name; `components/ForgingCircleScreen.tsx` renders the badge). To add a member silently without an invite, the dashboard can still insert a `forging_circle_members` row directly. **Dashboard insert shape + push wiring:** see `supabase/functions/circle-invite-push/README.md`. The background push for coach invites is sent by the `circle-invite-push` Edge Function (triggered by a Database Webhook on `forging_circle_invites` INSERT); it only fires for `inviter_coach_id IS NOT NULL` rows, so peer invites (pushed client-side) never double-fire. Note: `accept_circle_invite` no longer keys off `inviter_user_id` for existence, so coach-sent invites accept correctly.
- **Realtime / RLS.** `forging_circles` and `forging_circle_members` keep their existing permissive RLS. No new policies required for the dashboard write path.

**Storage path the dashboard writes.** Coach-uploaded circle images land in the existing `circle-images` bucket (public-read) at:

```
coach/{coaches.id}/{epoch_ms}_{rand8}.{ext}
```

`forging_circles.image_url` stores the resulting public URL, same as for user-uploaded circle images. The migration file also `INSERT … ON CONFLICT DO NOTHING` into `storage.buckets` for `circle-images` so the bucket exists on deployments that didn't already create it.

**Dashboard Public/Global feed.** The dashboard's "Public" pseudo-circle reads `social_posts WHERE visibility = 'public'` globally (no participant filter) and its leaderboard pulls `user_profile WHERE default_share_audience = 'public'` (capped at 200). This is dashboard-only behavior; the app's `listFeedPosts` `'public'` audience is unchanged.

---

## When you change the schema (checklist)

1. Update `schema.sql` (canonical) and add a migration in `supabase/migrations/` if a hosted DB needs the change.
2. If the change touches a coach-facing table, classify the new/changed column in `docs/coach-dashboard-data-model.config.json`.
3. Run `npm run data-model` (or just `npm start`) to refresh the generated block below.
4. If JSON shapes or workflows changed, update the prose sections above.
5. `npm run data-model:check` should pass before you commit.
6. If a change originated in the **coach dashboard repo** (e.g. `web_dashboard/coach_owned_circles.sql`), copy it into the app repo's `schema.sql` + `supabase/migrations/` and re-run step 3 so the generated inventory below picks up the new columns/buckets.

---

## Generated schema inventory

<!-- BEGIN GENERATED: schema-inventory (managed by scripts/generate-data-model.js — do not edit by hand) -->

<!-- schema fingerprint: 34793bc38abe -->

> This section is generated from `schema.sql`. Do not edit it by hand.
> Run `npm run data-model` (auto-runs on `npm start`) to refresh it.
> Tables: **31** · buckets: **3** · functions: **1** · views: **1**.

### Coach-facing tables (classified)

Access legend — **coach-edit**: dashboard may write · **app**: app owns it, dashboard reads only · **system**: DB/Edge managed, never write · **read**: reference/lookup.

#### `user_profile`

The user's identity, preferences, and the AI/coach plan. The dashboard's main edit surface. `onboarding_profile_json` holds the whole plan (see JSON shapes below).

RLS — public: insert, select, update, delete

| column | type | access | notes |
| --- | --- | --- | --- |
| `user_id` | `text` | **system** — primary key (Clerk-style sub); never change | emulate Clerk `sub` identifier |
| `display_name` | `text` | **coach-edit** — safe to edit |  |
| `onboarding_profile_json` | `text` | **coach-edit** — the full Onboard/action plan blob; edit via structured tooling, not raw — regeneration overwrites it |  |
| `onboarding_profile_ai_gen_json` | `text` | **system** — historical AI snapshot; read-only baseline | snapshot copy of onboarding_profile_json for historical comparison |
| `timezone` | `text` | **app** — set by the app from the device | user's timezone (e.g. "Europe/Berlin") |
| `expo_push_token` | `text` | **system** — push token; app-managed | optional Expo push notification token |
| `device_type` | `text` | **app** — app-managed | device type enum |
| `active` | `boolean` | **app** — active-profile flag; app-managed | indicates if this profile is currently active |
| `is_coach` | `boolean` | **read** — marks coach accounts; set deliberately in Studio | indicates if this user is a coach |
| `share_stats` | `boolean` | **app** — leaderboard opt-in; user-controlled | indicates if user wants to share their consistency stats on the leaderboard |
| `human_coach_step_notes_json` | `text` | **coach-edit** — coach free-text per step; keys step_1/step_2/step_3 (see lib/human-coach-step-notes.ts). Kept separate so plan regen never clobbers it | per-step notes written manually by the human coach in Supabase Studio; JSON keyed by action-step id ("step_1"/"step_2"/"step_3") |
| `created_at` | `timestamptz` | **system** |  |
| `reminder_frequency` | `text` | **app** — user preference | Add reminder_frequency column to user_profile table |
| `away_mode` | `boolean` | **app** — user-controlled streak pause | Add away_mode columns to user_profile table |
| `away_mode_start_date` | `timestamptz` | **app** | Add away_mode columns to user_profile table |
| `account_status` | `text` | **coach-edit** — active\|deactivated; admin/coach gate on app access | Add account_status column for admin-controlled user access |
| `preferred_weight_unit` | `text` | **app** — user preference | Add preferred_weight_unit column to user_profile table |
| `plan_status` | `text` | **coach-edit** — workflow enum: 'AI drafted' → 'Coach reviewed' → 'Coach and client reviewed' | Coach dashboard plan workflow (setup_coaches.sql) |
| `auth_user_id` | `text` | **system** — Supabase auth linkage; never edit | Supabase Auth linkage (app + Edge Functions) |
| `weekly_checkin_schedule_mode` | `text` | **app** — user preference | Weekly check-in schedule mode (2026-05-25). Lets users pick between the default Sun→Sat window (prompted Sunday 18:00 local) and the alternate Mon→Sun window (prompted Monday 18:00 local). NULL/legacy rows default to the Sun→Sat behavior in the client. |
| `avatar_url` | `text` | **app** — set by app upload to the avatars bucket | Profile photo URL (Supabase Storage 'avatars' bucket) |
| `default_share_audience` | `text` | **app** — user preference: public\|circles | Default audience used for new social posts AND for leaderboard visibility (2026-05-27). 'circles' (default) keeps the user mostly private to their Forging Circles; 'public' opens them to anyone. Renamed from singular 'circle' to plural 'circles' in 20260527160000_multi_forging_circles.sql. |
| `signup_code` | `text` | **read** — acquisition attribution: the special_codes.code the user joined with (e.g. coach code), or NULL. Set once by the app at signup; stored as the literal code, not an FK | Acquisition attribution (2026-06-09): the normalized special_codes.code the user entered at the pre-auth onboarding entry screen (e.g. 'jesus2026'), or NULL when they joined without a code. Stored as the literal code (not an FK) so it survives even if the special_codes row is later edited or removed. |

#### `coaches`

Coach accounts that can log into the dashboard.

RLS — public: select, update

| column | type | access | notes |
| --- | --- | --- | --- |
| `id` | `SERIAL` | **system** — referenced by coach_user, special_codes, checkin_coach_with_user |  |
| `coach_name` | `text` | **read** — slug used to match onboarding config |  |
| `email` | `text` | **coach-edit** — login email |  |
| `password_hash` | `text` | **system** — bcrypt; set/rotate via secure tooling only |  |
| `full_name` | `text` | **coach-edit** — display name (first token must match onboarding config key) |  |
| `coach_type` | `text` | **coach-edit** — ai_only \| ai_human_hybrid; controls human-coach features |  |
| `created_at` | `timestamptz` | **system** |  |
| `last_login_at` | `timestamptz` | **system** — stamped by the dashboard on login |  |

#### `coach_user`

Append-only log of coach + plan-tier assignments. The current row per user is WHERE is_current = true (the dashboard roster); older rows are the ai↔human history ordered by assigned_at. To change a user's tier/coach: set the live row is_current=false, then insert a new is_current=true row.

RLS — public: insert, select, delete

| column | type | access | notes |
| --- | --- | --- | --- |
| `id` | `SERIAL` | **system** |  |
| `coach_id` | `integer` | **coach-edit** — FK → coaches.id |  |
| `user_id` | `text` | **coach-edit** — FK → user_profile.user_id |  |
| `plan_tier_id` | `integer` | **coach-edit** — FK → plan_tiers.id; NULL = ai_only. The user's coaching plan tier (unrelated to training/nutrition/recovery plans) | NULL = ai_only; the user's coaching plan tier |
| `is_current` | `boolean` | **coach-edit** — marks the live assignment; exactly one true per user (partial unique index). Set false on the old row when changing tier/coach | the live assignment; superseded rows are kept with false |
| `assigned_at` | `timestamptz` | **system** — when this assignment row was written; doubles as the tier-change timestamp for history | when this assignment row was written (the change timestamp) |

#### `checkin_coach_with_user`

Human coach check-in notes per user, written from the dashboard.

RLS — public: insert, select, update, delete

| column | type | access | notes |
| --- | --- | --- | --- |
| `id` | `uuid` | **system** — uuid |  |
| `user_id` | `text` | **coach-edit** — FK → user_profile.user_id |  |
| `coach_id` | `integer` | **coach-edit** — FK → coaches.id |  |
| `checkin_date` | `timestamptz` | **coach-edit** |  |
| `notes` | `text` | **coach-edit** — the check-in note body |  |
| `checkin_type` | `text` | **coach-edit** — how the coach checked in: message \| call \| video \| in_person (NULL = unspecified) | how the coach checked in (NULL = unspecified) |
| `created_at` | `timestamptz` | **system** |  |
| `updated_at` | `timestamptz` | **coach-edit** — bump on edit |  |

### All other tables (reference inventory)

Read-context for the dashboard. Coaches generally do not write these directly.

#### `activity_logs`

_Cardio/sport sessions (manual + wearable). App/Edge-written._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `activity_date` | `date` |  |
| `activity_type` | `text` |  |
| `activity_name` | `text` |  |
| `duration_minutes` | `integer` |  |
| `intensity` | `text` |  |
| `distance_value` | `decimal(8,2)` |  |
| `distance_unit` | `text` |  |
| `elevation_gain` | `decimal(8,2)` |  |
| `calories_burned` | `integer` |  |
| `source` | `text` |  |
| `external_id` | `text` |  |
| `payload_id` | `bigint` |  |
| `calories_source` | `text` |  |
| `calories_confidence` | `text` |  |
| `dedupe_fingerprint` | `text` |  |
| `started_at` | `timestamptz` |  |
| `ended_at` | `timestamptz` |  |
| `avg_heart_rate` | `integer` |  |
| `notes` | `text` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

#### `activity_workout_links`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `user_id` | `text` |  |
| `activity_log_id` | `integer` |  |
| `workout_log_id` | `integer` |  |
| `link_state` | `text` |  |
| `review_acknowledged` | `boolean` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

#### `body_composition_log`

_Weekly body-composition scans (weight, muscle %, fat %). App-written. photo_front_url/photo_side_url/photo_back_url are optional progress-photo public URLs in the 'body-photos' bucket; front is the angle the app renders above each weight-chart bar._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `log_date` | `date` |  |
| `week_number` | `integer` |  |
| `year` | `integer` |  |
| `weight_value` | `decimal(5,2)` |  |
| `weight_unit` | `text` |  |
| `muscle_percent` | `decimal(4,1)` |  |
| `fat_percent` | `decimal(4,1)` |  |
| `created_at` | `timestamptz` |  |
| `photo_front_url` | `text` | Optional progress photos attached to a weekly body-composition entry. Public URLs in the 'body-photos' bucket (one set per ISO week, overwritten on re-upload). Front is the angle shown on the weight chart; side/back are extra. |
| `photo_side_url` | `text` |  |
| `photo_back_url` | `text` |  |

#### `chat_messages`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `TEXT` |  |
| `user_id` | `text` |  |
| `text` | `TEXT` |  |
| `sender` | `TEXT` |  |
| `timestamp` | `TEXT` |  |
| `user_display_name` | `TEXT` |  |
| `is_from_notification` | `BOOLEAN` |  |
| `created_at` | `timestamptz` |  |

#### `conversations`

RLS — public: insert, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `sqlite_id` | `INTEGER` |  |
| `user_message` | `TEXT` |  |
| `coach_response` | `TEXT` |  |
| `timestamp` | `TEXT` |  |
| `user_display_name` | `TEXT` |  |
| `created_at` | `timestamptz` |  |

#### `daily_metrics`

_Canonical wearable metrics per day/source. Edge-written._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `user_id` | `text` |  |
| `metric_date` | `date` |  |
| `metric` | `text` |  |
| `source` | `text` |  |
| `value` | `numeric` |  |
| `is_canonical` | `boolean` |  |
| `winner_reason` | `text` |  |
| `confidence` | `text` |  |
| `payload_id` | `bigint` |  |
| `synced_at` | `timestamptz` |  |

#### `daily_nutrition_totals`

_Daily cumulative nutrition totals. App-written._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `log_date` | `date` |  |
| `total_carbs_grams` | `decimal(7,1)` |  |
| `total_protein_grams` | `decimal(7,1)` |  |
| `total_fat_grams` | `decimal(7,1)` |  |
| `total_fiber_grams` | `decimal(7,1)` |  |
| `total_calories` | `integer` |  |
| `carbs_target_grams` | `decimal(6,1)` |  |
| `protein_target_grams` | `decimal(6,1)` |  |
| `fat_target_grams` | `decimal(6,1)` |  |
| `fiber_target_grams` | `decimal(6,1)` |  |
| `calories_target` | `integer` |  |
| `carbs_percent_of_target` | `decimal(5,1)` |  |
| `protein_percent_of_target` | `decimal(5,1)` |  |
| `fat_percent_of_target` | `decimal(5,1)` |  |
| `fiber_percent_of_target` | `decimal(5,1)` |  |
| `calories_percent_of_target` | `decimal(5,1)` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

#### `forging_circle_invites`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `circle_id` | `bigint` |  |
| `inviter_user_id` | `text` |  |
| `inviter_coach_id` | `integer` |  |
| `invitee_email` | `text` |  |
| `invitee_user_id` | `text` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `responded_at` | `timestamptz` |  |

#### `forging_circle_members`

RLS — public: insert, select, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `circle_id` | `bigint` |  |
| `member_user_id` | `text` |  |
| `created_at` | `timestamptz` |  |

#### `forging_circles`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `owner_user_id` | `text` |  |
| `name` | `text` |  |
| `image_url` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `owner_coach_id` | `integer` | Coach-owned circles (dashboard-introduced): owner_coach_id set, owner_user_id NULL. |

#### `glow360_survey`

RLS — public: insert — restrictive: select "No read access"

| column | type | notes |
| --- | --- | --- |
| `id` | `bigint` |  |
| `health_areas` | `text[]` |  |
| `name` | `text` |  |
| `age_group` | `text` |  |
| `health_description` | `text` |  |
| `motivation` | `text` |  |
| `email` | `text` |  |
| `consent` | `text` |  |
| `submitted_at` | `timestamp without time zone` |  |
| `created_at` | `timestamp without time zone` |  |

#### `meal_logs`

_Individual meal entries. App-written._

RLS — public: insert, select, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `log_date` | `date` |  |
| `meal_description` | `text` |  |
| `carbs_grams` | `decimal(6,1)` |  |
| `protein_grams` | `decimal(6,1)` |  |
| `fat_grams` | `decimal(6,1)` |  |
| `fiber_grams` | `decimal(6,1)` |  |
| `calories` | `integer` |  |
| `food_quantities` | `text` |  |
| `food_item_macros` | `jsonb` |  |
| `logged_at` | `timestamptz` |  |

#### `nutrition_daily_adjustments`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `adjustment_date` | `date` |  |
| `base_calories_target` | `integer` |  |
| `base_carbs_target_grams` | `decimal(6,1)` |  |
| `base_protein_target_grams` | `decimal(6,1)` |  |
| `base_fat_target_grams` | `decimal(6,1)` |  |
| `base_fiber_target_grams` | `decimal(6,1)` |  |
| `activity_calories_burned` | `integer` |  |
| `steps_neat_calories` | `integer` |  |
| `adjusted_calories_target` | `integer` |  |
| `adjusted_carbs_target_grams` | `decimal(6,1)` |  |
| `adjusted_protein_target_grams` | `decimal(6,1)` |  |
| `adjusted_fat_target_grams` | `decimal(6,1)` |  |
| `adjusted_fiber_target_grams` | `decimal(6,1)` |  |
| `strategy` | `text` |  |
| `inputs_digest` | `text` |  |
| `computed_at` | `timestamptz` |  |

#### `nutrition_log`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `log_date` | `date` |  |
| `carbs_grams` | `decimal(6,1)` |  |
| `protein_grams` | `decimal(6,1)` |  |
| `fat_grams` | `decimal(6,1)` |  |
| `fiber_grams` | `decimal(6,1)` |  |
| `total_calories` | `integer` |  |
| `carbs_target_grams` | `decimal(6,1)` |  |
| `protein_target_grams` | `decimal(6,1)` |  |
| `fat_target_grams` | `decimal(6,1)` |  |
| `fiber_target_grams` | `decimal(6,1)` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

#### `plan_tiers`

_Catalog of coaching plan tiers (key, display_name, checkins_per_week). Referenced by coach_user.plan_tier_id. Add a future tier by inserting a row — no schema change. checkins_per_week is the expected human check-ins/week the dashboard uses to compute 'pending check-ins this week' = max(0, checkins_per_week − count(checkin_coach_with_user rows since Monday)); ai_only = 0. The app maps `key` to a localized name; `display_name` is the English label._

RLS — public: insert, select, update

| column | type | notes |
| --- | --- | --- |
| `id` | `serial` |  |
| `key` | `text` | stable slug; the app maps it to a localized name |
| `display_name` | `text` | English label shown in the dashboard |
| `checkins_per_week` | `numeric` | expected human check-ins per week (ai_only = 0) |
| `active` | `boolean` | soft-retire a tier without deleting history |
| `created_at` | `timestamptz` |  |

#### `provider_raw_payloads`

_Raw wearable payloads. Service-role only._

RLS — RLS on, no public policies (service-role only)

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `user_id` | `text` |  |
| `provider` | `text` |  |
| `kind` | `text` |  |
| `external_id` | `text` |  |
| `payload` | `jsonb` |  |
| `received_at` | `timestamptz` |  |

#### `social_post_comments`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `post_id` | `bigint` |  |
| `user_id` | `text` |  |
| `body` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `deleted_at` | `timestamptz` |  |

#### `social_post_likes`

RLS — public: insert, select, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `post_id` | `bigint` |  |
| `user_id` | `text` |  |
| `created_at` | `timestamptz` |  |

#### `social_posts`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `user_id` | `text` |  |
| `workout_log_id` | `integer` |  |
| `activity_log_id` | `integer` |  |
| `title` | `text` |  |
| `photo_url` | `text` |  |
| `location` | `text` | Optional free-text location (gym/place/city) added 2026-05-27 — also runs standalone via migration for existing deployments. |
| `visibility` | `text` |  |
| `circle_id` | `bigint` | Optional per-circle target. NULL = "all my circles" (broadcast); a value is reserved for future per-circle targeted posts. |
| `share_options` | `jsonb` |  |
| `metrics_snapshot` | `jsonb` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `deleted_at` | `timestamptz` |  |

#### `special_codes`

_Pre-auth onboarding entry codes (coach/event/promo). Managed in Studio._

RLS — public: select

| column | type | notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` |  |
| `code` | `text` |  |
| `code_type` | `text` |  |
| `coach_id` | `bigint` |  |
| `metadata` | `jsonb` |  |
| `is_active` | `boolean` |  |
| `expires_at` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |

#### `task_completions`

_Daily action-step completions. App-written._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `step_id` | `text` |  |
| `completed` | `boolean` |  |
| `completion_date` | `date` |  |
| `created_at` | `timestamptz` |  |

#### `user_nutrition_targets`

_Persisted macro/calorie targets the app derives from the plan. Coaches change these indirectly by editing the plan (step 2), not by writing this table._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `calories_target` | `INTEGER` |  |
| `carbs_target_grams` | `DECIMAL(6,1)` |  |
| `protein_target_grams` | `DECIMAL(6,1)` |  |
| `fat_target_grams` | `DECIMAL(6,1)` |  |
| `fiber_target_grams` | `DECIMAL(6,1)` |  |
| `baseline_movement_kcal` | `INTEGER` | kcal/day NEAT target; feeds burn card + TDEE context |
| `baseline_movement_minutes` | `INTEGER` | user-facing brisk-walk minutes/day (training plan UI) |
| `baseline_movement_steps` | `INTEGER` | ~steps/day equivalent for wearable cross-check |
| `effective_from` | `DATE` |  |
| `created_at` | `TIMESTAMPTZ` |  |

#### `user_provider_connections`

_Wearable OAuth state with encrypted tokens. Service-role only — anon reads the *_public view._

RLS — RLS on, no public policies (service-role only)

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `provider` | `text` |  |
| `external_user_id` | `text` |  |
| `access_token_encrypted` | `text` |  |
| `refresh_token_encrypted` | `text` |  |
| `token_expires_at` | `timestamptz` |  |
| `scopes` | `text[]` |  |
| `connected_at` | `timestamptz` |  |
| `last_sync_at` | `timestamptz` |  |
| `last_sync_cursor` | `text` |  |
| `status` | `text` |  |
| `last_error` | `text` |  |

#### `weekly_checkin_reports`

_Weekly metrics snapshot + LLM narrative. App-written; useful read context for coaches._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `week_start` | `date` |  |
| `week_end` | `date` |  |
| `consistency_score` | `integer` | Training & nutrition metrics |
| `workout_sessions` | `integer` |  |
| `activity_sessions` | `integer` |  |
| `total_training_sessions` | `integer` |  |
| `meals_logged` | `integer` |  |
| `volume_lifted_kg` | `decimal(10,1)` |  |
| `protein_grams` | `decimal(8,1)` |  |
| `total_estimated_calories` | `integer` |  |
| `weight_kg` | `decimal(5,1)` | Body composition (nullable — only present when user has logged scans) |
| `muscle_percent` | `decimal(4,1)` |  |
| `fat_percent` | `decimal(4,1)` |  |
| `lean_mass_kg` | `decimal(5,1)` |  |
| `weight_kg_prior` | `decimal(5,1)` |  |
| `muscle_percent_delta` | `decimal(4,1)` |  |
| `fat_percent_delta` | `decimal(4,1)` |  |
| `lean_mass_kg_delta` | `decimal(5,1)` |  |
| `narrative_json` | `jsonb` | LLM-generated narrative (structured + plain-text) |
| `summary_text` | `text` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

#### `weekly_consistency_scores`

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `week_start` | `date` |  |
| `score` | `integer` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

#### `workout_exercise_logs`

_Per-set exercise rows under a workout_log. App-written._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `workout_log_id` | `integer` |  |
| `exercise_id` | `text` | Reference to exercise database ID |
| `exercise_name` | `text` | Exercise name for display |
| `set_number` | `integer` | Which set (1, 2, 3...) |
| `weight_value` | `decimal(6,2)` | Weight used (null for bodyweight exercises) |
| `weight_unit` | `text` |  |
| `reps` | `integer` | Actual reps performed |
| `rest_time_seconds` | `integer` | Actual rest time taken |
| `rir` | `integer` | Reps in Reserve (0-5) |
| `difficulty_perception` | `integer` |  |
| `comments` | `text` | User notes for this set |
| `calories_burned` | `integer` | MET-based per-set estimate (device-written) |
| `created_at` | `timestamptz` |  |

#### `workout_logs`

_User workout sessions. App-written._

RLS — public: insert, select, update, delete

| column | type | notes |
| --- | --- | --- |
| `id` | `SERIAL` |  |
| `user_id` | `text` |  |
| `workout_date` | `date` |  |
| `workout_day_name` | `text` | e.g., "Leg Day", "Full Body", "Upper Body Day" |
| `step_id` | `text` | Link to action plan step (optional for legacy plans) |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

### Storage buckets

| bucket id | public | written by |
| --- | --- | --- |
| `avatars` | yes | user profile photos; avatar_url on user_profile points here |
| `social-posts` | yes | social post photos; photo_url on social_posts points here |
| `body-photos` | yes | weekly body progress photos; photo_front_url/photo_side_url/photo_back_url on body_composition_log point here. Public-read by design (see Storage section) — paths are {userId}/{year}_W{week}_{angle}.jpg |

### RPC functions

- `accept_circle_invite(p_invite_id bigint)`

### Views

- `user_provider_connections_public`

<!-- END GENERATED: schema-inventory -->
