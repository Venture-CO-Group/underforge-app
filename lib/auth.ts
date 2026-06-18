/**
 * Supabase Authentication Helper
 * 
 * Handles user authentication using Supabase Auth.
 * Session tokens are automatically persisted in secure storage
 * (iOS Keychain / Android Keystore) and survive app updates/reinstalls.
 */

import { Session, User } from '@supabase/supabase-js';
import { clearAllLocalUserData } from './db';
import { glowLogger } from './glow-logger';
import { supabase } from './supabase_db_new';

export interface AuthResult {
  success: boolean;
  user?: User;
  session?: Session;
  error?: string;
}

export interface AuthActionResult {
  success: boolean;
  error?: string;
}

/**
 * Sign up a new user with email and password
 */
export const signUp = async (email: string, password: string): Promise<AuthResult> => {
  try {
    if (!supabase) {
      glowLogger.error('Supabase not initialized for auth signup', {});
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Attempting user signup', { email });

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      glowLogger.error('Signup failed', { error: error.message, email });
      return { success: false, error: error.message };
    }

    if (!data.user) {
      glowLogger.error('Signup succeeded but no user returned', { email });
      return { success: false, error: 'No user returned from signup' };
    }

    glowLogger.info('Signup successful', { 
      user_id: data.user.id,
      email: data.user.email,
      email_confirmed: !!data.user.email_confirmed_at
    });

    return {
      success: true,
      user: data.user,
      session: data.session || undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Signup exception', { error: errorMessage, email });
    return { success: false, error: errorMessage };
  }
};

/**
 * Sign in an existing user with email and password
 */
export const signIn = async (email: string, password: string): Promise<AuthResult> => {
  try {
    if (!supabase) {
      glowLogger.error('Supabase not initialized for auth signin', {});
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Attempting user signin', { email });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      glowLogger.error('Signin failed', { error: error.message, email });
      return { success: false, error: error.message };
    }

    if (!data.user || !data.session) {
      glowLogger.error('Signin succeeded but no user/session returned', { email });
      return { success: false, error: 'No user or session returned from signin' };
    }

    glowLogger.info('Signin successful', { 
      user_id: data.user.id,
      email: data.user.email
    });

    return {
      success: true,
      user: data.user,
      session: data.session,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Signin exception', { error: errorMessage, email });
    return { success: false, error: errorMessage };
  }
};

/**
 * Sign out the current user
 */
export const signOut = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!supabase) {
      glowLogger.error('Supabase not initialized for auth signout', {});
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Attempting user signout', {});

    const { error } = await supabase.auth.signOut();

    if (error) {
      glowLogger.error('Signout failed', { error: error.message });
      return { success: false, error: error.message };
    }

    glowLogger.info('Signout successful', {});
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Signout exception', { error: errorMessage });
    return { success: false, error: errorMessage };
  }
};

/**
 * Get the current auth session (if user is logged in)
 * Sessions are persisted in secure storage and survive app updates
 */
export const getSession = async (): Promise<Session | null> => {
  try {
    if (!supabase) {
      glowLogger.info('Supabase not initialized, no session available', {});
      return null;
    }

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      glowLogger.error('Error getting session', { error: error.message });
      return null;
    }

    if (session) {
      glowLogger.info('Found existing auth session', { 
        user_id: session.user.id,
        email: session.user.email,
        expires_at: session.expires_at
      });
    } else {
      glowLogger.info('No existing auth session found', {});
    }

    return session;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Exception getting session', { error: errorMessage });
    return null;
  }
};

/**
 * Get the current authenticated user (if any)
 */
export const getCurrentAuthUser = async (): Promise<User | null> => {
  try {
    if (!supabase) {
      return null;
    }

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      glowLogger.error('Error getting current user', { error: error.message });
      return null;
    }

    return user;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Exception getting current user', { error: errorMessage });
    return null;
  }
};

/**
 * Web page the password reset email redirects to. The user sets their new
 * password directly on this page (Supabase implicit recovery flow), then
 * returns to the app to log in.
 *
 * Doing the reset on the web — instead of deep-linking the recovery token back
 * into the app — avoids the token (which Supabase returns in the URL fragment)
 * being dropped when the browser hands a custom-scheme URL off to the app, which
 * was causing the "Enlace no válido" error.
 *
 * This value must be allow-listed in Supabase Dashboard under
 * Authentication > URL Configuration > Redirect URLs.
 */
export const PASSWORD_RESET_REDIRECT_URL = 'https://www.underforge.io/reset.html';

/**
 * Send password reset email
 */
export const resetPassword = async (email: string): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!supabase) {
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Sending password reset email', { email, redirectTo: PASSWORD_RESET_REDIRECT_URL });

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: PASSWORD_RESET_REDIRECT_URL,
    });

    if (error) {
      glowLogger.error('Password reset failed', { error: error.message, email });
      return { success: false, error: error.message };
    }

    glowLogger.info('Password reset email sent', { email });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Password reset exception', { error: errorMessage, email });
    return { success: false, error: errorMessage };
  }
};

/**
 * Resend signup confirmation email for an existing unconfirmed user.
 */
export const resendSignupConfirmation = async (email: string): Promise<AuthActionResult> => {
  try {
    if (!supabase) {
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Resending signup confirmation email', { email });

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      glowLogger.error('Resend signup confirmation failed', { error: error.message, email });
      return { success: false, error: error.message };
    }

    glowLogger.info('Signup confirmation email resent', { email });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Resend signup confirmation exception', { error: errorMessage, email });
    return { success: false, error: errorMessage };
  }
};

/**
 * Permanently delete the user's account.
 * 1. Calls the delete-account Edge Function (deletes all Supabase data + auth user)
 * 2. Clears all local SQLite + AsyncStorage data
 * 3. Signs out locally
 *
 * @param userId - The app-level user_id (UUID stored in logged_in_user / user_profile)
 */
export const deleteAccount = async (userId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!supabase) {
      return { success: false, error: 'Supabase not initialized' };
    }

    glowLogger.info('Starting account deletion', { user_id: userId });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: 'No active session. Please sign in and try again.' };
    }

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return { success: false, error: 'Supabase URL not configured' };
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    const body = await response.json();

    if (!response.ok) {
      glowLogger.error('Edge Function delete-account failed', {
        status: response.status,
        error: body.error,
        detail: body.detail,
        code: body.code,
        hint: body.hint,
      });
      return { success: false, error: body.detail || body.error || 'Server error during account deletion' };
    }

    glowLogger.info('Server-side account deletion succeeded, clearing local data', { user_id: userId });

    await clearAllLocalUserData(userId);

    await supabase.auth.signOut();

    glowLogger.info('Account deletion completed', { user_id: userId });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    glowLogger.error('Account deletion exception', { error: errorMessage, user_id: userId });
    return { success: false, error: errorMessage };
  }
};

