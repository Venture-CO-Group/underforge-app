/**
 * Provider connection success / error screen.
 *
 * Doubles as:
 *   1. Deep-link landing for OAuth flows that return to
 *      `longeviq://providers-oauth-return?...` (Whoop today; future Garmin /
 *      HealthConnect can reuse the same route by setting `?provider=...`).
 *   2. Programmatic confirmation pushed by client code after non-OAuth
 *      connections (HealthKit) so every "data source connected" outcome
 *      lands on the same screen for a consistent UX.
 *
 * Query params:
 *   - provider: 'whoop' | 'healthkit' | 'garmin' | 'healthconnect'
 *               (defaults to 'whoop' since that is the only deep-link source today)
 *   - error / error_description: when present, render the error variant.
 *
 * Apple HIG considerations:
 *   - Push (slide) into the navigation stack; system back chevron preserved.
 *   - Single primary action ("Continue") sized at 44pt minimum.
 *   - Destructive copy avoided; failure state offers a non-destructive retry
 *     by going back to Connections.
 *   - Image renders inside SafeAreaView so it never collides with notches.
 */

import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontFamily } from '../constants/Typography';
import { providerSourceUserFacingLabel } from '../lib/health-platform-copy';

const CONFIRMATION_IMAGE = require('../assets/images/utils/confirmation-hammering.png');

type ProviderKey = 'whoop' | 'healthkit' | 'garmin' | 'healthconnect';

function normaliseProvider(raw: unknown): ProviderKey {
  if (typeof raw !== 'string') return 'whoop';
  const v = raw.toLowerCase();
  if (v === 'whoop' || v === 'healthkit' || v === 'garmin' || v === 'healthconnect') {
    return v;
  }
  return 'whoop';
}

export default function ProvidersOAuthReturnScreen() {
  const router = useRouter();
  const { t } = useTranslation(['menu', 'common']);
  const params = useLocalSearchParams<{
    provider?: string;
    error?: string;
    error_description?: string;
  }>();

  const provider = normaliseProvider(params.provider);
  const providerName = providerSourceUserFacingLabel(provider);
  const hasError = Boolean(params.error);

  const handleContinue = () => {
    // Always land back at the app root; this clears the OAuth deep-link
    // history regardless of whether we got here via deep link (Android) or
    // programmatic push (iOS).
    router.replace('/');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {!hasError ? (
            <>
              <Image
                source={CONFIRMATION_IMAGE}
                style={styles.image}
                contentFit="contain"
                accessibilityIgnoresInvertColors
                accessibilityLabel={
                  t('menu:connections.success.imageAlt') ??
                  'Hammer striking an anvil'
                }
              />
              <Text style={styles.title}>
                {t('menu:connections.success.title') ??
                  'Your data is connected with UnderForge now!'}
              </Text>
              <Text style={styles.subtitle}>
                {t('menu:connections.success.subtitle', {
                  provider: providerName,
                  defaultValue:
                    '{{provider}} is syncing in the background. Workouts and daily totals will appear in your dashboard automatically.',
                })}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.errorTitle}>
                {t('menu:connections.failure.title') ?? 'Connection failed'}
              </Text>
              <Text style={styles.subtitle}>
                {t('menu:connections.failure.subtitle', {
                  provider: providerName,
                  defaultValue:
                    'We could not finish connecting {{provider}}. You can close this and try again from Connections.',
                })}
              </Text>
              {params.error_description ? (
                <Text style={styles.errorDetail}>
                  {String(params.error_description)}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={handleContinue}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('common:continue') ?? 'Continue'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.primaryButtonText}>
              {t('common:continue') ?? 'Continue'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    gap: 20,
  },
  image: {
    width: '88%',
    aspectRatio: 1,
    maxWidth: 360,
    maxHeight: 360,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    color: '#F2F2EE',
    textAlign: 'center',
    fontFamily: FontFamily.displayBold,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#9AA3A6',
    textAlign: 'center',
    fontFamily: FontFamily.bodyRegular,
    paddingHorizontal: 8,
  },
  errorTitle: {
    fontSize: 24,
    lineHeight: 30,
    color: '#E8947A',
    textAlign: 'center',
    fontFamily: FontFamily.displayBold,
  },
  errorDetail: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: '#6F7A7E',
    textAlign: 'center',
    fontFamily: FontFamily.bodyRegular,
  },
  actions: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 26,
    backgroundColor: '#F47C3C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.bodySemiBold,
    color: '#0B1114',
    letterSpacing: 0.2,
  },
});
