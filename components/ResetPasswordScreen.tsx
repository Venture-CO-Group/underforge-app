/**
 * ResetPasswordScreen
 *
 * Shown after the user taps a Supabase password-recovery deep link.
 * By the time this screen mounts, `useResetPasswordDeepLink` has already
 * established a short-lived recovery session via `supabase.auth.setSession`,
 * so here we simply collect a new password and call `supabase.auth.updateUser`.
 *
 * After success the caller signs the user out and returns them to the sign-in
 * screen so the existing auth flow (profile restore, etc.) runs cleanly.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Typography } from '../constants/Typography';
import { glowLogger } from '../lib/glow-logger';
import { supabase } from '../lib/supabase_db_new';

interface ResetPasswordScreenProps {
  /** A link-level error (e.g. expired or malformed link). When set, the UI
   *  shows the error and offers to return to sign-in. */
  linkError?: string | null;
  /** Called after a successful password update. Parent must sign out and route
   *  the user back to the sign-in screen. */
  onDone: () => void | Promise<void>;
  /** Called when the user cancels. Parent must sign out of the recovery
   *  session and route back to the sign-in screen. */
  onCancel: () => void | Promise<void>;
}

export default function ResetPasswordScreen({
  linkError,
  onDone,
  onCancel,
}: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation(['auth', 'common']);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  const validatePassword = (value: string): string[] => {
    const missing: string[] = [];
    if (value.length < 6) missing.push(t('auth:passwordRequirementLength'));
    if (!/[a-z]/.test(value)) missing.push(t('auth:passwordRequirementLower'));
    if (!/[A-Z]/.test(value)) missing.push(t('auth:passwordRequirementUpper'));
    if (!/[0-9]/.test(value)) missing.push(t('auth:passwordRequirementNumber'));
    if (!/[^a-zA-Z0-9]/.test(value)) missing.push(t('auth:passwordRequirementSpecial'));
    return missing;
  };

  const handleSubmit = async () => {
    setError(null);

    const missing = validatePassword(password);
    if (missing.length > 0) {
      setError(`${t('auth:errorPasswordTooWeak')} (${missing.join(', ')})`);
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth:errorPasswordMismatch'));
      return;
    }

    if (!supabase) {
      setError(t('auth:resetPasswordGenericError'));
      return;
    }

    setIsLoading(true);
    glowLogger.info('Submitting new password from recovery flow', {});

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        glowLogger.error('Password update failed', { error: updateError.message });
        const lower = updateError.message.toLowerCase();
        if (
          lower.includes('expired') ||
          lower.includes('invalid') ||
          lower.includes('session')
        ) {
          setError(t('auth:resetPasswordLinkExpired'));
        } else {
          setError(updateError.message);
        }
        setIsLoading(false);
        return;
      }

      glowLogger.info('Password updated successfully via recovery flow', {});
      setIsLoading(false);
      Alert.alert(
        t('auth:resetPasswordSuccessTitle'),
        t('auth:resetPasswordSuccessBody'),
        [
          {
            text: t('auth:alertOk'),
            onPress: () => {
              onDone();
            },
          },
        ],
        { cancelable: false },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      glowLogger.error('Exception updating password', { error: message });
      setError(t('auth:resetPasswordGenericError'));
      setIsLoading(false);
    }
  };

  const renderLinkErrorState = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.logo}>{t('common:appName')}</Text>
        <Text style={styles.title}>{t('auth:resetPasswordLinkInvalidTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth:resetPasswordLinkInvalidBody')}</Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onCancel}
      >
        <Text style={styles.buttonText}>{t('auth:backToSignIn')}</Text>
      </Pressable>
    </View>
  );

  const renderFormState = () => (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.logo}>{t('common:appName')}</Text>
        <Text style={styles.title}>{t('auth:resetPasswordTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth:resetPasswordSubtitle')}</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>{t('auth:newPasswordLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#6F7A7E"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error) setError(null);
            }}
            secureTextEntry
            textContentType="newPassword"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>

        {password.length > 0 && (
          <View style={styles.requirementsContainer}>
            {([
              { test: password.length >= 6, label: t('auth:passwordRequirementLength') },
              { test: /[a-z]/.test(password), label: t('auth:passwordRequirementLower') },
              { test: /[A-Z]/.test(password), label: t('auth:passwordRequirementUpper') },
              { test: /[0-9]/.test(password), label: t('auth:passwordRequirementNumber') },
              { test: /[^a-zA-Z0-9]/.test(password), label: t('auth:passwordRequirementSpecial') },
            ] as const).map(({ test, label }) => (
              <Text
                key={label}
                style={[styles.requirementItem, test && styles.requirementMet]}
              >
                {test ? '✓' : '○'} {label}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>{t('auth:confirmNewPasswordLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#6F7A7E"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (error) setError(null);
            }}
            secureTextEntry
            textContentType="newPassword"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            isLoading && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#0B1114" />
          ) : (
            <Text style={styles.buttonText}>{t('auth:resetPasswordCta')}</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.linkContainer}
          onPress={onCancel}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>{t('auth:backToSignIn')}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          {linkError ? renderLinkErrorState() : renderFormState()}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  safeArea: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 36,
    ...Typography.brandText,
    color: '#F47C3C',
    marginBottom: 20,
    textShadowColor: 'rgba(244, 124, 60, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  title: {
    fontSize: 30,
    ...Typography.boldText,
    color: '#F2F2EE',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    ...Typography.defaultText,
    color: '#9AA3A6',
    textAlign: 'center',
    lineHeight: 24,
  },
  form: {
    marginBottom: 28,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    ...Typography.semiBoldText,
    color: '#F2F2EE',
    marginBottom: 10,
  },
  input: {
    backgroundColor: 'rgba(14, 26, 26, 0.85)',
    borderWidth: 1,
    borderColor: '#2A3638',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    ...Typography.defaultText,
    color: '#F2F2EE',
  },
  requirementsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -10,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  requirementItem: {
    fontSize: 13,
    ...Typography.defaultText,
    color: '#6F7A7E',
  },
  requirementMet: {
    color: '#5CB85C',
  },
  errorContainer: {
    backgroundColor: 'rgba(198, 91, 91, 0.15)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(198, 91, 91, 0.3)',
  },
  errorText: {
    color: '#C65B5B',
    fontSize: 14,
    ...Typography.defaultText,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#F47C3C',
    borderRadius: 28,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonPressed: {
    backgroundColor: '#D8662F',
  },
  buttonDisabled: {
    backgroundColor: '#F9A06A',
    opacity: 0.6,
  },
  buttonText: {
    color: '#0B1114',
    fontSize: 18,
    ...Typography.boldText,
  },
  linkContainer: {
    alignItems: 'center',
    marginTop: 20,
    padding: 10,
  },
  linkText: {
    color: '#F47C3C',
    fontSize: 15,
    ...Typography.semiBoldText,
  },
});
