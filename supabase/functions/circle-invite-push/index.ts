// circle-invite-push
//
// Sends an Expo push when a COACH invites a user into a Forging Circle from the
// coach dashboard. Peer (user -> user) invites are pushed client-side from the
// inviter's phone (lib/circle-invite-push.ts); a coach has no phone in the loop,
// so this runs server-side instead.
//
// Wiring: a Supabase Database Webhook on INSERT into public.forging_circle_invites
// calls this function. We only act on rows where inviter_coach_id IS NOT NULL, so
// peer invites flowing through the same table never double-push.
//
// Locale note: user_profile stores no language, so the push copy is English-only.
// The in-app pending-invites list (rendered client-side) is fully localized.
//
// See supabase/functions/circle-invite-push/README.md for deploy + webhook setup.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type InvitePayload = {
  type?: string
  record?: {
    id?: number
    circle_id?: number
    inviter_coach_id?: number | null
    inviter_user_id?: string | null
    invitee_user_id?: string | null
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // Optional shared-secret gate. Set CIRCLE_INVITE_PUSH_SECRET and add a matching
  // `x-webhook-secret` header to the Database Webhook to lock this endpoint down.
  const expectedSecret = Deno.env.get('CIRCLE_INVITE_PUSH_SECRET')
  if (expectedSecret && req.headers.get('x-webhook-secret') !== expectedSecret) {
    return json({ error: 'unauthorized' }, 401)
  }

  let payload: InvitePayload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const row = payload.record
  if (!row?.id) return json({ ok: true, skipped: 'no_record' })

  // Only coach-sent invites. Peer invites are pushed client-side already.
  if (row.inviter_coach_id == null) {
    return json({ ok: true, skipped: 'not_coach_invite' })
  }
  if (!row.invitee_user_id || !row.circle_id) {
    return json({ ok: true, skipped: 'incomplete_invite' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const [{ data: coach }, { data: circle }, { data: profile }] = await Promise.all([
    admin.from('coaches').select('full_name, coach_name').eq('id', row.inviter_coach_id).maybeSingle(),
    admin.from('forging_circles').select('name').eq('id', row.circle_id).maybeSingle(),
    admin.from('user_profile').select('expo_push_token, active').eq('user_id', row.invitee_user_id).maybeSingle(),
  ])

  if (!profile?.expo_push_token || profile.active === false) {
    return json({ ok: true, skipped: 'no_active_token' })
  }

  const coachName = coach?.full_name || coach?.coach_name || 'Your coach'
  const circleName = circle?.name || 'a circle'

  const message = {
    to: profile.expo_push_token,
    sound: 'default',
    title: 'Circle invitation',
    body: `Coach ${coachName} invited you to "${circleName}"`,
    data: {
      render_screen: 'forging_circle',
      sender: 'system',
      invite_id: row.id,
    },
  }

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })
    const result = await response.json()
    if (!response.ok || result?.data?.status === 'error') {
      return json({ ok: false, expo_status: response.status, result }, 502)
    }
    return json({ ok: true, invite_id: row.id })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502)
  }
})
