# Wearables integration - Edge Functions runbook

Functions shipped under this directory:

| Function | Purpose |
| --- | --- |
| `providers-oauth-start` | Issues a PKCE-secured Whoop authorize URL + state/verifier pair. |
| `providers-oauth-callback` | Exchanges the OAuth code, encrypts tokens, upserts `user_provider_connections`. |
| `providers-disconnect` | Revokes a provider connection through service-role access without exposing token rows. |
| `providers-webhook-whoop` | HMAC-verified receiver for Whoop workout / sleep / recovery push events. |
| `providers-sync` | Hourly `pg_cron` poller that backfills workouts + daily energy + sleep + recovery per active Whoop connection. |

Shared helpers live under `_shared/`:

- `cors.ts`, `encrypt.ts`, `canonical.ts`, `normalize.ts`, `ingest.ts`, `whoop.ts`.

What lands where:

| Whoop event / endpoint | Server table written |
| --- | --- |
| `/v2/activity/workout` (poll) + `workout.updated` (webhook) | `activity_logs` (source = `whoop`) + `provider_raw_payloads` |
| `/v2/cycle` (poll) | `daily_metrics(metric='active_energy_kcal')` + `provider_raw_payloads` |
| `/v2/activity/sleep` (poll) + `sleep.updated` (webhook) | `daily_metrics('sleep_total_min','sleep_efficiency_pct')` + `provider_raw_payloads` |
| `/v2/recovery` (poll) + `recovery.updated` (webhook) | `daily_metrics('recovery_score','hrv_rmssd_ms','resting_hr_bpm')` + `provider_raw_payloads` |

## Environment variables

Supabase automatically injects reserved `SUPABASE_*` values into Edge
Functions (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
Do not set those manually with `supabase secrets set`.

Set only the integration-specific values on the Supabase project:

```
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
WHOOP_REDIRECT_URI=https://<project-ref>.functions.supabase.co/providers-oauth-callback
# Optional override. If unset, webhook signature validation uses WHOOP_CLIENT_SECRET,
# which is what Whoop's docs call "the secret key for your app".
WHOOP_WEBHOOK_SECRET=<same as WHOOP_CLIENT_SECRET unless Whoop gives a separate webhook secret>
WHOOP_INITIAL_BACKFILL_DAYS=90    # optional; default 90, capped at 365
WEARABLES_TOKEN_KEY=<32 raw bytes as 64 hex chars OR base64> # symmetric key for token encryption (see _shared/encrypt.ts)
# Generate one with either:
#   openssl rand -hex 32        # → 64 hex chars
#   openssl rand -base64 32     # → 44 chars ending in '='
```

Whoop developer app scopes requested by `providers-oauth-start`:

```
read:recovery
read:workout
read:sleep
read:profile
read:cycles
read:body_measurement
offline
```

## Deploy

```
supabase functions deploy providers-oauth-start
supabase functions deploy providers-oauth-callback --no-verify-jwt
supabase functions deploy providers-disconnect
supabase functions deploy providers-webhook-whoop --no-verify-jwt
supabase functions deploy providers-sync
```

`providers-oauth-callback` and `providers-webhook-whoop` must be deployed
without Supabase's gateway JWT check because Whoop calls them directly without
an app session. The callback still validates the app user's JWT on the POST
that exchanges the OAuth code.

## Configure Whoop webhooks (step by step)

This is what makes new sleep / recovery / workout events flow into
`provider_raw_payloads` and `daily_metrics` in real time. Without this the
poller is the only ingestion path and it runs at most hourly.

1. **Apply the Postgres migrations.** Make sure both
   `supabase/migrations/20260423_wearables.sql` and
   `supabase/migrations/20260429_wearables_sleep_recovery.sql` have been
   applied (Studio → Database → Migrations, or `supabase db push`). Without
   the second one the new metric / kind values fail the CHECK constraint
   and inserts will reject.

2. **Pick the webhook signing secret.** Whoop's docs say webhook HMAC
   validation uses the app's **client secret** ("the secret key for your app").
   If your dashboard only shows one secret below the client ID, use that
   value. You do **not** need to generate a random webhook secret unless
   Whoop's dashboard explicitly gives you a separate webhook secret field.

   ```sh
   # Usually this should be the same value as WHOOP_CLIENT_SECRET.
   WHOOP_WEBHOOK_SECRET=<your-whoop-client-secret>
   ```

3. **Set the secret on Supabase** so the receiver can verify HMAC
   signatures:

   ```sh
   supabase secrets set --project-ref <project-ref> \
     WHOOP_WEBHOOK_SECRET=<your-whoop-client-secret>
   ```

   While you're here, double-check the other secrets exist:

   ```sh
   supabase secrets list --project-ref <project-ref>
   ```

   You should see `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`,
   `WHOOP_REDIRECT_URI`, `WEARABLES_TOKEN_KEY`, `WHOOP_WEBHOOK_SECRET`.

4. **Deploy the receiver with `--no-verify-jwt`** (Whoop calls it without
   a Supabase session):

   ```sh
   supabase functions deploy providers-webhook-whoop --no-verify-jwt \
     --project-ref <project-ref>
   ```

5. **Register the URL in the Whoop developer console.** Go to
   <https://developer-dashboard.whoop.com/> → your app → **Webhooks**
   (sometimes labelled "Webhook URL"):

   - **Webhook URL:**
     `https://<project-ref>.functions.supabase.co/providers-webhook-whoop`
   - **Model Version:** choose **v2**. Whoop may only offer v2 for new apps.
     The receiver fetches detail records through v2 endpoints. For
     `recovery.updated`, Whoop sends the associated sleep UUID; the receiver
     fetches that sleep first to find `cycle_id`, then fetches recovery.
   - **Subscribed events:** enable at minimum:
     - `workout.updated`, `workout.deleted`
     - `sleep.updated`, `sleep.deleted`
     - `recovery.updated`, `recovery.deleted`

   Save. Whoop will fire a verification ping immediately. Open the
   **Logs** tab of `providers-webhook-whoop` in Supabase Studio — you
   should see one log line with `outcome` of `ignored` or
   `no_connection` and HTTP 200. A 401 means the secret used by Supabase
   doesn't match Whoop's client secret, or the function was not deployed with
   `--no-verify-jwt`.

6. **Configure the hourly poller.** In Supabase Studio → SQL editor, run
   once (replace placeholders):

   ```sql
   select cron.schedule(
     'providers-sync-hourly',
     '5 * * * *',
     $$ select net.http_post(
          url := 'https://<project-ref>.functions.supabase.co/providers-sync',
          headers := '{"Authorization":"Bearer <service-role-jwt>"}'::jsonb
        ) $$
   );
   ```

   Verify it landed:

   ```sql
   select jobname, schedule, active from cron.job
    where jobname = 'providers-sync-hourly';
   ```

7. **Trigger one immediate poll** so historical data starts streaming
   without waiting for the next cron tick:

   ```sh
   curl -i -X POST \
     -H "Authorization: Bearer <service-role-jwt>" \
     "https://<project-ref>.functions.supabase.co/providers-sync"
   ```

   Expected response:

   ```json
   {"users":[{"user_id":"...","workouts":N,"cycles":N,"sleep":N,"recovery":N,"outcome":"ok"}]}
   ```

8. **Confirm rows are landing** (replace `<your_user_id>`):

   ```sql
   -- connection should be active with a recent last_sync_at
   select last_sync_at, last_error, status
     from public.user_provider_connections
    where user_id = '<your_user_id>' and provider = 'whoop';

   -- raw payloads (will populate from poller AND webhooks)
   select kind, count(*), max(received_at)
     from public.provider_raw_payloads
    where user_id = '<your_user_id>' and provider = 'whoop'
    group by kind order by kind;

   -- per-day sleep + recovery metrics
   select metric_date, metric, value, source, is_canonical
     from public.daily_metrics
    where user_id = '<your_user_id>' and source = 'whoop'
      and metric_date >= current_date - 14
    order by metric_date desc, metric;
   ```

9. **Test the live webhook path.** Open the Whoop app, edit any workout
   note (or log a 1-min activity) so Whoop fires `workout.updated`. Within
   a few seconds you should see a fresh row in `provider_raw_payloads`
   (`kind='workout'`) and an `outcome=workout_upserted` line in
   `providers-webhook-whoop` logs.

If step 5 returns 401 in the function logs:
- The secret on Supabase doesn't match Whoop, **or**
- the function was deployed without `--no-verify-jwt` (Supabase's gateway
  is rejecting the call before your code runs).

If step 8's `provider_raw_payloads` is empty even after step 7 returned
`ok`, you almost certainly have a stale function build that predates the
sleep/recovery work — redeploy `providers-sync` and re-run.

## E2E verification checklist

Before flipping `EXPO_PUBLIC_WEARABLES_V1` on in production, run through:

- [ ] iOS device with a Whoop account can complete the OAuth flow via the
      Connections screen (token row appears in `user_provider_connections`).
- [ ] `provider_raw_payloads` shows rows of `kind` in
      `('workout','active_energy','sleep','recovery')` after first poll.
- [ ] Logging a Whoop workout triggers a `workout.updated` webhook; the
      corresponding row appears in `activity_logs` with `source = 'whoop'`
      and a non-zero `calories_burned`.
- [ ] Hourly `providers-sync` ingests `active_energy_kcal` + sleep +
      recovery into `daily_metrics` and the dashboard surfaces the
      canonical values.
- [ ] Apple Health permissions prompt shows the right usage strings; first
      sync imports last 30 days of workouts + steps.
- [ ] Manual entry + Apple Health import of the same workout collapse to
      one canonical row via `dedupe_fingerprint`.
- [ ] `nutrition_daily_adjustments` row exists for today with realistic
      `adjusted_calories_target` (no more than ±40% of baseline).
- [ ] CoachDashboard pill shows the adjusted target + canonical steps, and
      disappears cleanly when the user disconnects all providers.

Once all checks are green, set `EXPO_PUBLIC_WEARABLES_V1=true` in the
`prod_self_contained` build profile (`eas.json`) and ship a production OTA
update.
