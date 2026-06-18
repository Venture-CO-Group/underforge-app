/**
 * AuthScreen - Login/Signup UI Component
 * 
 * A clean, simple authentication screen for email/password auth.
 * Handles both new user signup and existing user signin.
 */

import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    Animated,
    BackHandler,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Typography } from '../constants/Typography';
import { resetPassword, signIn, signUp } from '../lib/auth';
import { glowLogger } from '../lib/glow-logger';

const VIDEO_1 = require('../assets/images/underforge_intro.mp4');
const VIDEO_2 = require('../assets/images/underforge_intro_2.mp4');
const FADE_DURATION = 1500;
const TRANSITION_THRESHOLD = 2500;

interface AuthScreenProps {
  onAuthSuccess: (authUserId: string, email: string, isNewUser: boolean, emailVerified: boolean, password?: string) => void;
  mode?: 'signin' | 'signup'; // Initial mode
  onBack?: () => void; // Optional back button handler
  isNewUserFlow?: boolean; // Show different message for new user signup
  initialError?: string | null; // Initial error message to display
  onCreateAccount?: () => void; // Override for "create account" CTA in signin mode
}

type AuthMode = 'signin' | 'signup' | 'forgot';

// Video crossfade animated values (outside component to avoid React scheduling issues)
const video1Opacity = new Animated.Value(1);
const video2Opacity = new Animated.Value(0);

export default function AuthScreen({ onAuthSuccess, mode: initialMode = 'signin', onBack, isNewUserFlow = false, initialError, onCreateAccount }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);
  const { t } = useTranslation(['auth', 'common']);

  useEffect(() => {
    if (Platform.OS !== 'android' || !onBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // Video crossfade state
  const activeVideoRef = useRef<1 | 2>(1);
  const isTransitioning = useRef(false);

  const player1 = useVideoPlayer(VIDEO_1, (p) => {
    p.loop = false;
    p.muted = true;
    p.playbackRate = 0.75;
    p.play();
  });

  const player2 = useVideoPlayer(VIDEO_2, (p) => {
    p.loop = false;
    p.muted = true;
    p.playbackRate = 0.75;
  });

  const crossfade = useCallback((toVideo: 1 | 2) => {
    if (isTransitioning.current || activeVideoRef.current === toVideo) return;
    isTransitioning.current = true;

    const incoming = toVideo === 2 ? player2 : player1;
    const outgoing = toVideo === 2 ? player1 : player2;

    try { incoming.currentTime = 0; incoming.play(); } catch {}

    Animated.parallel([
      Animated.timing(toVideo === 2 ? video1Opacity : video2Opacity, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(toVideo === 2 ? video2Opacity : video1Opacity, {
        toValue: 1,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      try { outgoing.pause(); } catch {}
      activeVideoRef.current = toVideo;
      isTransitioning.current = false;
    });
  }, [player1, player2]);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (isTransitioning.current) return;
        const active = activeVideoRef.current;
        const player = active === 1 ? player1 : player2;
        if (player.duration > 0 && player.currentTime >= player.duration - TRANSITION_THRESHOLD / 1000) {
          crossfade(active === 1 ? 2 : 1);
        }
      } catch {}
    }, 100);
    return () => clearInterval(interval);
  }, [player1, player2, crossfade]);

  // Update error when initialError prop changes
  useEffect(() => {
    if (initialError) {
      setError(initialError);
    }
  }, [initialError]);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): boolean => {
    if (password.length < 6) return false;
    if (mode === 'signup') {
      return /[a-z]/.test(password) &&
             /[A-Z]/.test(password) &&
             /[0-9]/.test(password) &&
             /[^a-zA-Z0-9]/.test(password);
    }
    return true;
  };

  const getPasswordErrorKeys = (password: string): string[] => {
    const missing: string[] = [];
    if (password.length < 6) missing.push('passwordRequirementLength');
    if (!/[a-z]/.test(password)) missing.push('passwordRequirementLower');
    if (!/[A-Z]/.test(password)) missing.push('passwordRequirementUpper');
    if (!/[0-9]/.test(password)) missing.push('passwordRequirementNumber');
    if (!/[^a-zA-Z0-9]/.test(password)) missing.push('passwordRequirementSpecial');
    return missing;
  };

  const handleSignIn = async () => {
    setError(null);

    if (!validateEmail(email)) {
      setError(t('auth:errorInvalidEmail'));
      return;
    }

    if (!validatePassword(password)) {
      setError(t('auth:errorPasswordTooWeak'));
      return;
    }

    setIsLoading(true);
    glowLogger.info('User attempting signin', { email });

    const result = await signIn(email, password);

    setIsLoading(false);

    if (result.success && result.user) {
      const isEmailVerified = !!result.user.email_confirmed_at;
      
      glowLogger.info('Signin successful, calling onAuthSuccess', { 
        auth_user_id: result.user.id,
        email: result.user.email || email,
        email_verified: isEmailVerified
      });
      onAuthSuccess(result.user.id, result.user.email || email, false, isEmailVerified);
    } else {
      setError(result.error || t('auth:errorSignInFailed'));
    }
  };

  const handleSignUp = async () => {
    setError(null);

    if (!validateEmail(email)) {
      setError(t('auth:errorInvalidEmail'));
      return;
    }

    if (!validatePassword(password)) {
      const missingKeys = getPasswordErrorKeys(password);
      setError(`${t('auth:errorPasswordTooWeak')} (${missingKeys.map((k) => t(`auth:${k}` as const)).join(', ')})`);
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth:errorPasswordMismatch'));
      return;
    }

    setIsLoading(true);
    glowLogger.info('User attempting signup', { email });

    try {
      // Let Supabase Auth check if user already exists in the auth.users table
      const result = await signUp(email, password);

      // Always clear loading state
      setIsLoading(false);

      if (result.success && result.user) {
        // Check if this is a fake success (user already exists but Supabase returns success to prevent email enumeration)
        // When this happens, the identities array will be empty or null
        const identities = result.user.identities;
        const isExistingUser = !identities || identities.length === 0;
        
        if (isExistingUser) {
          // User already exists in auth.users table
          glowLogger.info('Signup detected existing user (empty identities)', { email });
          Alert.alert(
            t('auth:alertAccountExistsTitle'),
            t('auth:alertAccountExistsBody'),
            [
              { text: t('auth:signInCta'), onPress: () => setMode('signin') },
              { text: t('common:cancel'), style: 'cancel' as const }
            ]
          );
          return;
        }
        
        const isEmailVerified = !!result.user.email_confirmed_at;
        
        glowLogger.info('Signup successful, calling onAuthSuccess', { 
          auth_user_id: result.user.id,
          email: result.user.email || email,
          email_verified: isEmailVerified,
          identities_count: identities?.length || 0
        });
        
        // Check if email confirmation is required
        if (!result.session) {
          Alert.alert(
            'Check Your Email',
            'We sent you a confirmation email. Please verify your email address to continue.',
            [{ text: 'OK' }]
          );
        }
        
        onAuthSuccess(result.user.id, result.user.email || email, true, isEmailVerified, password);
      } else {
        // Check for various "already exists" error patterns
        const errorLower = (result.error || '').toLowerCase();
        const isAlreadyRegistered = 
          errorLower.includes('already registered') ||
          errorLower.includes('already been registered') ||
          errorLower.includes('user already registered') ||
          errorLower.includes('email already registered') ||
          errorLower.includes('already exists') ||
          errorLower.includes('user with this email');
        
        if (isAlreadyRegistered) {
          // User already exists - show friendly message
          Alert.alert(
            t('auth:alertAccountExistsTitle'),
            t('auth:alertAccountExistsBody'),
            [
              { text: t('auth:signInCta'), onPress: () => setMode('signin') },
              { text: t('common:cancel'), style: 'cancel' as const }
            ]
          );
          glowLogger.info('Signup failed - user already exists', { email });
        } else {
          setError(result.error || t('auth:errorSignUpFailed'));
        }
      }
    } catch (error) {
      // Ensure loading state is cleared even on exception
      setIsLoading(false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage || t('auth:errorSignUpFailed'));
      glowLogger.error('Signup exception in handleSignUp', { error: errorMessage, email });
    }
  };

  const handleForgotPassword = async () => {
    setError(null);

    if (!validateEmail(email)) {
      setError(t('auth:errorEmailRequired'));
      return;
    }

    setIsLoading(true);
    glowLogger.info('User requesting password reset', { email });

    const result = await resetPassword(email);

    setIsLoading(false);

    if (result.success) {
      Alert.alert(
        t('auth:alertEmailSentTitle'),
        t('auth:alertEmailSentBody'),
        [{ text: t('auth:alertOk'), onPress: () => setMode('signin') }]
      );
    } else {
      setError(result.error || t('auth:errorResetFailed'));
    }
  };

  const handleSubmit = () => {
    switch (mode) {
      case 'signin':
        handleSignIn();
        break;
      case 'signup':
        handleSignUp();
        break;
      case 'forgot':
        handleForgotPassword();
        break;
    }
  };

  const getTitle = () => {
    switch (mode) {
      case 'signin':
        return t('auth:titleSignIn');
      case 'signup':
        return t('auth:titleSignUp');
      case 'forgot':
        return t('auth:titleForgot');
    }
  };

  const getSubtitle = () => {
    switch (mode) {
      case 'signin':
        return t('auth:subtitleSignIn');
      case 'signup':
        return isNewUserFlow
          ? t('auth:subtitleSignUp')
          : t('auth:subtitleSignUp');
      case 'forgot':
        return t('auth:subtitleForgot');
    }
  };

  const getButtonText = () => {
    switch (mode) {
      case 'signin':
        return t('auth:signInCta');
      case 'signup':
        return t('auth:signUpCta');
      case 'forgot':
        return t('auth:forgotCta');
    }
  };

  return (
    <View style={styles.container}>
      {/* Crossfading video background */}
      <View style={styles.videoContainer} pointerEvents="none">
        <Animated.View style={[styles.videoWrapper, { opacity: video1Opacity }]}>
          <VideoView
            player={player1}
            style={styles.videoPlayer}
            contentFit="cover"
            nativeControls={false}
            {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
          />
        </Animated.View>

        <Animated.View style={[styles.videoWrapper, { opacity: video2Opacity }]}>
          <VideoView
            player={player2}
            style={styles.videoPlayer}
            contentFit="cover"
            nativeControls={false}
            {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
          />
        </Animated.View>
      </View>

      {/* Content layer above native video views */}
      <View style={styles.contentLayer} pointerEvents="box-none">
      {/* Dark overlay for form readability */}
      <View style={styles.videoOverlay} pointerEvents="none" />

      <SafeAreaView style={styles.safeArea}>
      {/* Back button */}
      {onBack && (
        <TouchableOpacity style={styles.backButtonTop} onPress={onBack}>
          <Text style={styles.backButtonTopText}>← {t('common:back')}</Text>
        </TouchableOpacity>
      )}
      
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
            <Text style={styles.logo}>{t('common:appName')}</Text>
          <Text style={styles.title}>{getTitle()}</Text>
          <Text style={styles.subtitle}>{getSubtitle()}</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Email Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>{t('auth:emailLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth:emailPlaceholder')}
              placeholderTextColor="#6F7A7E"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError(null); // Clear error when user starts typing
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!isLoading}
            />
          </View>

          {/* Password Input (not shown for forgot mode) */}
          {mode !== 'forgot' && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>{t('auth:passwordLabel')}</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#6F7A7E"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                editable={!isLoading}
              />
            </View>
          )}

          {/* Password requirements (signup only) */}
          {mode === 'signup' && password.length > 0 && (
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

          {/* Confirm Password (signup only) */}
          {mode === 'signup' && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>{t('auth:confirmPasswordLabel')}</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#6F7A7E"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                textContentType="newPassword"
                editable={!isLoading}
              />
            </View>
          )}

          {/* Error Message */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Submit Button */}
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
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{getButtonText()}</Text>
            )}
          </Pressable>

          {/* Forgot Password Link (signin mode only) */}
          {mode === 'signin' && (
            <Pressable 
              style={styles.linkContainer}
              onPress={() => setMode('forgot')}
            >
              <Text style={styles.linkText}>{t('auth:forgotPassword')}</Text>
            </Pressable>
          )}
        </View>

        {/* Mode Toggle */}
        <View style={styles.toggleContainer}>
          {mode === 'signin' && (
            <>
              <Text style={styles.toggleText}>{t('auth:dontHaveAccount')} </Text>
              <Pressable onPress={() => {
                if (onCreateAccount) {
                  onCreateAccount();
                } else {
                  setMode('signup');
                  setError(null);
                }
              }}>
                <Text style={styles.toggleLink}>{t('auth:signUpCta')}</Text>
              </Pressable>
            </>
          )}
          {mode === 'signup' && (
            <>
              <Text style={styles.toggleText}>{t('auth:haveAccount')} </Text>
              <Pressable onPress={() => {
                setMode('signin');
                setError(null); // Clear error when switching modes
              }}>
                <Text style={styles.toggleLink}>{t('auth:signInCta')}</Text>
              </Pressable>
            </>
          )}
          {mode === 'forgot' && (
            <Pressable onPress={() => setMode('signin')}>
              <Text style={styles.toggleLink}>{t('auth:backToSignIn')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  videoContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  videoWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 17, 20, 0.6)',
  },
  safeArea: {
    flex: 1,
  },
  backButtonTop: {
    position: 'absolute',
    top: 60,
    left: 24,
    zIndex: 10,
    padding: 10,
  },
  backButtonTopText: {
    color: '#F47C3C',
    fontSize: 16,
    ...Typography.semiBoldText,
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
    marginBottom: 48,
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
    alignSelf: 'stretch',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
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
  },
  linkText: {
    color: '#F47C3C',
    fontSize: 14,
    ...Typography.semiBoldText,
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleText: {
    color: '#9AA3A6',
    fontSize: 15,
    ...Typography.defaultText,
  },
  toggleLink: {
    color: '#F47C3C',
    fontSize: 15,
    ...Typography.boldText,
  },
});

