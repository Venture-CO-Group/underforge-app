/**
 * Email notification helper using Modal backend + Resend
 * 
 * Used to notify coaches when users send them messages
 * Sends emails via Modal.com backend endpoint which uses Resend API
 * (No domain verification needed, perfect for mobile apps)
 */

import { glowLogger } from './glow-logger';

// Modal endpoint URL - defaults to the deployed endpoint
// Can be overridden with EXPO_PUBLIC_MODAL_EMAIL_ENDPOINT environment variable
const MODAL_EMAIL_ENDPOINT = process.env.EXPO_PUBLIC_MODAL_EMAIL_ENDPOINT || 
  'https://glow360--glow360-backend-send-coach-email-endpoint.modal.run';

/**
 * Notify coach that a user has sent them a message
 * 
 * @param coachEmail - Coach's email address
 * @param userName - User's display name
 * @returns true if successful, false otherwise
 */
export async function notifyCoachOfUserMessage(
  coachEmail: string,
  userName: string
): Promise<boolean> {
  try {
    if (!MODAL_EMAIL_ENDPOINT) {
      glowLogger.warn('Modal email endpoint not configured, skipping email notification', {});
      return false;
    }

    glowLogger.info('Sending email notification to coach via Modal', {
      endpoint: MODAL_EMAIL_ENDPOINT,
      coach_email_preview: coachEmail.substring(0, 3) + '***',
      user_name: userName
    });

    const requestBody = {
      coach_email: coachEmail,
      user_name: userName
    };

    glowLogger.info('Email notification request payload', {
      payload: requestBody,
      endpoint: MODAL_EMAIL_ENDPOINT
    });

    const response = await fetch(MODAL_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    glowLogger.info('Email notification API response received', {
      status: response.status,
      status_text: response.statusText,
      ok: response.ok
    });

    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      if (result.success) {
        glowLogger.info('Email notification sent successfully', {
          user_name: userName
        });
        return true;
      } else {
        glowLogger.error('Email notification failed', {
          message: result.message || 'Unknown error'
        });
        return false;
      }
    }

    const errorResult = await response.json().catch(() => ({}));
    glowLogger.error('Email notification failed', {
      status: response.status,
      error: JSON.stringify(errorResult)
    });
    return false;

  } catch (error) {
    glowLogger.error('Failed to send email notification', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

