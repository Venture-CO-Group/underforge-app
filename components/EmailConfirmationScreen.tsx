/**
 * EmailConfirmationScreen - Waits for user to confirm email
 * 
 * Shows after signup, checks if email is verified in Supabase Auth
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Typography } from '../constants/Typography';
import { resendSignupConfirmation } from '../lib/auth';
import { glowLogger } from '../lib/glow-logger';
import { supabase } from '../lib/supabase_db_new';
import { useTranslation } from 'react-i18next';

interface EmailConfirmationScreenProps {
  email: string;
  password: string; // Need password to verify by attempting sign-in
  onEmailConfirmed: () => void;
  onBack: () => void;
}

const RESEND_COOLDOWN_SECONDS = 120;

export default function EmailConfirmationScreen({
  email,
  password,
  onEmailConfirmed,
  onBack,
}: EmailConfirmationScreenProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(RESEND_COOLDOWN_SECONDS);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation(['email', 'common']);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;

    const interval = setInterval(() => {
      setResendCooldownSeconds((current) => {
        if (current <= 1) {
          clearInterval(interval);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [resendCooldownSeconds]);

  const resendCountdown = useMemo(() => {
    const minutes = Math.floor(resendCooldownSeconds / 60);
    const seconds = resendCooldownSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [resendCooldownSeconds]);

  const checkEmailVerification = async () => {
    setIsChecking(true);
    setError(null);

    try {
      glowLogger.info('Checking email verification by attempting sign-in', { email });

      // Try to sign in - if email is confirmed, this will work
      // If not confirmed, Supabase returns "Email not confirmed" error
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        if (signInError.message.toLowerCase().includes('email not confirmed')) {
          glowLogger.info('Email not yet confirmed', { email });
          setError(t('email:errorGeneric'));
        } else {
          glowLogger.error('Sign-in error during verification check', { error: signInError.message });
          setError(signInError.message);
        }
        setIsChecking(false);
        return;
      }

      // Sign-in succeeded - email is confirmed!
      if (data?.user?.email_confirmed_at) {
        glowLogger.info('Email verified! Sign-in successful', { email, confirmed_at: data.user.email_confirmed_at });
        onEmailConfirmed();
        return;
      }

      // Shouldn't reach here, but handle it
      setError(t('email:errorGeneric'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      glowLogger.error('Exception checking email verification', { error: errorMessage });
      setError(t('email:errorGeneric'));
    }

    setIsChecking(false);
  };

  const handleResendConfirmation = async () => {
    if (isResending || resendCooldownSeconds > 0) return;

    setIsResending(true);
    setError(null);
    setInfoMessage(null);

    const result = await resendSignupConfirmation(email);

    setIsResending(false);

    if (!result.success) {
      setError(result.error || t('email:resendError'));
      return;
    }

    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    setInfoMessage(t('email:resendSuccess'));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>📧</Text>
        </View>

        <Text style={styles.title}>{t('email:confirmationTitle')}</Text>
        <Text style={styles.subtitle}>
          {t('email:confirmationSubtitle')}{'\n'}
          <Text style={styles.email}>{email}</Text>
        </Text>

        <Text style={styles.instructions}>
          {t('email:confirmationInstructions')}
        </Text>

        <View style={styles.spamHighlight} accessibilityRole="text">
          <Text style={styles.spamHighlightText}>{t('email:checkSpamHighlight')}</Text>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {infoMessage && (
          <View style={styles.infoContainer}>
            <Text style={styles.infoText}>{infoMessage}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, isChecking && styles.buttonDisabled]}
          onPress={checkEmailVerification}
          disabled={isChecking}
        >
          {isChecking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('email:ctaIConfirmed')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resendTouchable}
          onPress={handleResendConfirmation}
          disabled={isResending || resendCooldownSeconds > 0}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
        >
          {isResending ? (
            <ActivityIndicator color="#9AA3A6" />
          ) : resendCooldownSeconds > 0 ? (
            <Text style={styles.resendWaitingText}>
              {t('email:ctaResendWaiting', { time: resendCountdown })}
            </Text>
          ) : (
            <Text style={styles.resendCombinedText}>
              <Text style={styles.resendHint}>{t('email:ctaResendHint')} </Text>
              <Text style={styles.resendAction}>{t('email:ctaResendAction')}</Text>
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>{t('email:ctaGoBack')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    fontSize: 28,
    ...Typography.boldText,
    color: '#F2F2EE',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    ...Typography.defaultText,
    color: '#9AA3A6',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  email: {
    ...Typography.semiBoldText,
    color: '#F47C3C',
  },
  instructions: {
    fontSize: 14,
    ...Typography.defaultText,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
  },
  spamHighlight: {
    width: '100%',
    backgroundColor: 'rgba(244, 124, 60, 0.18)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#F47C3C',
  },
  spamHighlightText: {
    fontSize: 17,
    ...Typography.boldText,
    color: '#F47C3C',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
    width: '100%',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    ...Typography.defaultText,
    textAlign: 'center',
  },
  infoContainer: {
    backgroundColor: 'rgba(92, 184, 92, 0.15)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 92, 0.3)',
    width: '100%',
  },
  infoText: {
    color: '#8FD18F',
    fontSize: 14,
    ...Typography.defaultText,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#F47C3C',
    borderRadius: 25,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  buttonDisabled: {
    backgroundColor: '#f7c5a5',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    ...Typography.boldText,
  },
  resendTouchable: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 4,
    minHeight: 44,
  },
  resendCombinedText: {
    fontSize: 14,
    ...Typography.defaultText,
    textAlign: 'center',
    lineHeight: 20,
  },
  resendHint: {
    color: '#6F7A7E',
    ...Typography.defaultText,
  },
  resendAction: {
    color: '#9AA3A6',
    ...Typography.semiBoldText,
  },
  resendWaitingText: {
    fontSize: 13,
    ...Typography.defaultText,
    color: '#6F7A7E',
    textAlign: 'center',
  },
  backButton: {
    padding: 12,
  },
  backButtonText: {
    color: '#F47C3C',
    fontSize: 16,
    ...Typography.semiBoldText,
  },
});

