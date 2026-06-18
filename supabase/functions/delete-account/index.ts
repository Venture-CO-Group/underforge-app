import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client scoped to the calling user (to verify their identity)
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const authUserId = user.id

    // Admin client with service_role for deletions
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Look up the app-level user_id from user_profile
    const { data: profile, error: profileError } = await adminClient
      .from('user_profile')
      .select('user_id')
      .eq('auth_user_id', authUserId)
      .single()

    if (profileError || !profile) {
      // No profile found -- still delete the auth user to allow clean re-signup
      console.warn(`No user_profile found for auth_user_id=${authUserId}, deleting auth user only`)
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(authUserId)
      if (authDeleteError) {
        console.error('Failed to delete auth user:', authDeleteError.message)
      }
      return new Response(
        JSON.stringify({ success: true, message: 'Auth user deleted (no profile found)' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = profile.user_id
    console.log(`Deleting account for user_id=${userId}, auth_user_id=${authUserId}`)

    // Explicitly delete from ALL child tables before deleting user_profile.
    // Don't rely on CASCADE -- some FKs are RESTRICT in production.
    // Order: workout_exercise_logs first (depends on workout_logs), then the rest.
    const tablesToClean = [
      { table: 'workout_exercise_logs', fk: 'workout_log_id', subquery: true },
      { table: 'workout_logs', fk: 'user_id' },
      { table: 'weekly_consistency_scores', fk: 'user_id' },
      { table: 'checkin_coach_with_user', fk: 'user_id' },
      { table: 'conversations', fk: 'user_id' },
      { table: 'chat_messages', fk: 'user_id' },
      { table: 'body_composition_log', fk: 'user_id' },
      { table: 'coach_user', fk: 'user_id' },
      { table: 'daily_nutrition_totals', fk: 'user_id' },
      { table: 'meal_logs', fk: 'user_id' },
      { table: 'task_completions', fk: 'user_id' },
      { table: 'user_nutrition_targets', fk: 'user_id' },
      // Social Share + Forging Circle
      // Per-circle invites/members cascade off either `forging_circles` (owner
      // side, dropped below) or `user_profile.user_id` (member side). We still
      // explicitly clean the invitee side because the FK is ON DELETE SET NULL.
      { table: 'social_post_likes', fk: 'user_id' },
      { table: 'social_post_comments', fk: 'user_id' },
      { table: 'social_posts', fk: 'user_id' },
      { table: 'forging_circle_invites_inviter', fk: 'inviter_user_id', actualTable: 'forging_circle_invites' },
      { table: 'forging_circle_invites_invitee', fk: 'invitee_user_id', actualTable: 'forging_circle_invites' },
      { table: 'forging_circle_members', fk: 'member_user_id' },
      { table: 'forging_circles', fk: 'owner_user_id' },
    ]

    for (const entry of tablesToClean) {
      const { table, fk } = entry as { table: string; fk?: string }
      const subquery = (entry as { subquery?: boolean }).subquery
      const actualTable = (entry as { actualTable?: string }).actualTable ?? table
      try {
        if (subquery) {
          // workout_exercise_logs doesn't have user_id; delete via workout_logs join
          const { data: workoutIds } = await adminClient
            .from('workout_logs')
            .select('id')
            .eq('user_id', userId)
          if (workoutIds && workoutIds.length > 0) {
            const ids = workoutIds.map((w: { id: number }) => w.id)
            const { error: delErr } = await adminClient
              .from(actualTable)
              .delete()
              .in('workout_log_id', ids)
            if (delErr) console.warn(`Failed to delete from ${table}: ${delErr.message}`)
            else console.log(`Cleaned ${table}`)
          }
        } else {
          const { error: delErr } = await adminClient.from(actualTable).delete().eq(fk!, userId)
          if (delErr) console.warn(`Failed to delete from ${table}: ${delErr.message}`)
          else console.log(`Cleaned ${table}`)
        }
      } catch (e) {
        console.warn(`Exception cleaning ${table}:`, e)
      }
    }

    // Best-effort clean-up of the user's avatar object in Supabase Storage.
    // The bucket is public so leaving it is harmless, but tidying it up keeps
    // storage costs honest. Same for any photos attached to their posts.
    try {
      await adminClient.storage.from('avatars').remove([`${userId}/avatar.jpg`])
    } catch (e) {
      console.warn(`Failed to delete avatar in storage:`, e)
    }
    try {
      const { data: postPhotos } = await adminClient.storage.from('social-posts').list(userId, {
        limit: 1000,
      })
      if (postPhotos && postPhotos.length > 0) {
        const paths = postPhotos.map((o: { name: string }) => `${userId}/${o.name}`)
        await adminClient.storage.from('social-posts').remove(paths)
      }
    } catch (e) {
      console.warn(`Failed to delete social-posts photos in storage:`, e)
    }

    // Delete user_profile (child rows already removed above)
    const { error: profileDeleteError } = await adminClient
      .from('user_profile')
      .delete()
      .eq('user_id', userId)

    if (profileDeleteError) {
      console.error(`Failed to delete user_profile: ${profileDeleteError.message} (code: ${profileDeleteError.code}, details: ${profileDeleteError.details}, hint: ${profileDeleteError.hint})`)
      return new Response(
        JSON.stringify({
          error: 'Failed to delete user data',
          detail: profileDeleteError.message,
          code: profileDeleteError.code,
          hint: profileDeleteError.hint,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete the auth user last (data is already gone, so partial failure here is low-risk)
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(authUserId)
    if (authDeleteError) {
      console.error('Failed to delete auth user (profile already deleted):', authDeleteError.message)
      // Still return success -- user data is deleted, orphaned auth record is harmless
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unexpected error in delete-account:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
