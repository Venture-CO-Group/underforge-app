import i18n from 'i18next';
import { glowLogger } from './glow-logger';
import { supabase } from './supabase_db_new';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Notify the invitee immediately via Expo push so they do not have to wait for
 * a foreground poll to see the invitation.
 */
export async function sendCircleInvitePushNotification(params: {
  inviteeUserId: string;
  inviterDisplayName: string;
  circleName: string;
  inviteId: number;
}): Promise<void> {
  if (!supabase) return;

  try {
    const { data: profile, error } = await supabase
      .from('user_profile')
      .select('expo_push_token, active')
      .eq('user_id', params.inviteeUserId)
      .maybeSingle();

    if (error || !profile?.expo_push_token || profile.active === false) {
      glowLogger.info('Skipping circle invite push — no active token', {
        invitee_user_id: params.inviteeUserId,
        has_token: !!profile?.expo_push_token,
      });
      return;
    }

    const title = i18n.t('social:circleInvitePushTitle');
    const body = i18n.t('social:circleInvitePushBody', {
      name: params.inviterDisplayName,
      circle: params.circleName,
    });

    const message = {
      to: profile.expo_push_token,
      sound: 'default',
      title,
      body,
      data: {
        render_screen: 'forging_circle',
        sender: 'system',
        invite_id: params.inviteId,
      },
    };

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    if (!response.ok || result?.data?.status === 'error') {
      glowLogger.warn('Circle invite push failed', {
        invitee_user_id: params.inviteeUserId,
        status: response.status,
        result: JSON.stringify(result),
      });
      return;
    }

    glowLogger.info('Circle invite push sent', {
      invitee_user_id: params.inviteeUserId,
      invite_id: params.inviteId,
    });
  } catch (error) {
    glowLogger.warn('Circle invite push threw', {
      invitee_user_id: params.inviteeUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
