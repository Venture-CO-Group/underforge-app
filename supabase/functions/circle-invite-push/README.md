# circle-invite-push

Sends an Expo push when a **coach** invites a user into a Forging Circle from the
coach dashboard (`forging_circle_invites.inviter_coach_id` set). Peer (user → user)
invites are still pushed client-side from the inviter's phone
(`lib/circle-invite-push.ts`); this function only fires for coach-sent rows, so
there is no double-push.

The in-app pending-invites list and the realtime banner update on their own from
the row insert (realtime is enabled on `forging_circle_invites`). This function
only covers the **background push** when the app is closed.

## Deploy

```bash
supabase functions deploy circle-invite-push --no-verify-jwt
```

`--no-verify-jwt` is required because a Database Webhook calls this without a user
JWT. Lock it down with the shared secret below instead.

## Configure the shared secret (recommended)

```bash
supabase secrets set CIRCLE_INVITE_PUSH_SECRET=<random-string>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the
Edge runtime.

## Wire the Database Webhook

In Supabase Studio → Database → Webhooks → **Create**:

- **Table:** `public.forging_circle_invites`
- **Events:** `INSERT`
- **Type:** HTTP Request (the "Supabase Edge Function" shortcut isn't in every Studio version; HTTP Request builds the same call)
  - **Method:** `POST`
  - **URL:** `https://meefxdpgrshyfqhyynzu.supabase.co/functions/v1/circle-invite-push`
- **HTTP Headers:** `Content-Type: application/json` + `x-webhook-secret: <the value you set above>`

The webhook fires on every invite insert; the function ignores peer invites
(`inviter_coach_id IS NULL`) and only pushes for coach-sent ones.

> The webhook is configured in Studio rather than a migration so the shared secret
> never lands in git.

## Dashboard contract

To trigger a coach invite, the dashboard inserts one row:

```sql
INSERT INTO public.forging_circle_invites
  (circle_id, inviter_coach_id, invitee_email, invitee_user_id, status)
VALUES ($circle, $coachId, $inviteeEmail, $inviteeUserId, 'pending');
```

`inviter_user_id` stays NULL (the `forging_circle_invites_one_inviter` CHECK
enforces exactly one of `inviter_user_id` / `inviter_coach_id`). The circle must
be coach-owned (`forging_circles.owner_coach_id = $coachId`).
