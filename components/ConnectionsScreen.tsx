/**
 * Connections screen: presents per-provider connect/disconnect controls.
 *
 * Shown as a modal pushed on top of the HamburgerMenu. Each provider row is
 * a single toggle whose action depends on the provider:
 *   - HealthKit (iOS-only): request permissions via native dialog, then
 *     kick off an initial sync. Disconnect is a no-op on the device because
 *     Apple owns the permission revocation UI (Settings > Health > Apps).
 *   - Health Connect (Android): Connect grants permissions and initial sync;
 *     when connected the row shows Manage → Re-sync or Disconnect (with
 *     explanations). Disconnect purges imported data then opens HC Settings.
 *
 * Apple HIG notes followed here:
 *   - Push (not modal sheet) for hierarchical drill-down from the menu.
 *   - System back button visible as the leading nav item.
 *   - Destructive action (Disconnect) marked red and confirmed.
 *   - 44×44pt touch targets on every toggle.
 */

import React, { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import {
  connectWhoop,
  disconnectWhoop,
  getWhoopConnection,
  type ProviderConnectionSummary,
} from '../lib/providers/whoop-client';
import {
  disconnectHealthKit,
  getHealthKitConnection,
  isHealthKitAvailable,
  requestHealthKitPermissions,
  syncHealthKit,
} from '../lib/providers/healthkit';
import { registerHealthKitObservers } from '../lib/providers/healthkit-observers';
import {
  connectHealthConnect,
  disconnectHealthConnect,
  getHealthConnectConnection,
  isHealthConnectAvailable,
  type HealthConnectConnectionSummary,
} from '../lib/providers/healthconnect-client';
import { syncHealthConnect } from '../lib/providers/healthconnect';
import { glowLogger } from '../lib/glow-logger';
import {
  conflictResolutionPriorityFallback,
  resolveMobileOsBucket,
} from '../lib/health-platform-copy';
import { BrandDialog, type BrandDialogButton } from './BrandDialog';

interface ConnectionsScreenProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  /**
   * Fired whenever the user successfully connects or disconnects a provider.
   * Parents pipe this to `setDashboardDataVersion(v => v + 1)` so the
   * dashboard / Progress screen re-fetch and pick up newly imported rows
   * (e.g. fresh Whoop workouts that just landed on Supabase) without the
   * user having to manually pull-to-refresh.
   */
  onConnectionsChanged?: () => void;
}

interface HealthKitState {
  authorized: boolean;
  busy: boolean;
  lastSyncAt?: string | null;
}

interface DialogState {
  title?: string;
  message?: string;
  buttons?: BrandDialogButton[];
}

const isMissingSupabaseSession = (e: unknown): boolean =>
  e instanceof Error && e.message.includes('No active Supabase session');

export const ConnectionsScreen: React.FC<ConnectionsScreenProps> = ({
  visible,
  onClose,
  userId,
  onConnectionsChanged,
}) => {
  const { t } = useTranslation(['menu', 'common']);
  const router = useRouter();

  const formatLastSync = useCallback((iso?: string | null): string => {
    const never = t('menu:connections.relativeTime.never');
    if (!iso) return never;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return never;
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t('menu:connections.relativeTime.justNow');
    if (mins < 60) return t('menu:connections.relativeTime.minAgo', { count: mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t('menu:connections.relativeTime.hoursAgo', { count: hours });
    return d.toLocaleDateString();
  }, [t]);
  const [whoop, setWhoop] = useState<ProviderConnectionSummary>({ provider: 'whoop', connected: false });
  const [whoopBusy, setWhoopBusy] = useState(false);
  const [hk, setHk] = useState<HealthKitState>({ authorized: false, busy: false });
  const [hc, setHc] = useState<HealthConnectConnectionSummary>({
    provider: 'healthconnect',
    connected: false,
  });
  const [hcBusy, setHcBusy] = useState(false);
  const [hcAvailable, setHcAvailable] = useState(false);
  const [hcManageModalVisible, setHcManageModalVisible] = useState(false);
  // Single brand-styled dialog for every popup on this screen (info, errors,
  // and destructive confirms) — replaces the OS `Alert.alert` so the look
  // matches the rest of the app. `showDialog` mimics Alert's call shape.
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const showDialog = useCallback(
    (title?: string, message?: string, buttons?: BrandDialogButton[]) => {
      setDialog({ title, message, buttons });
    },
    [],
  );
  const showHealthKit = Platform.OS === 'ios';
  const showHealthConnect = Platform.OS === 'android';
  // Whoop's direct OAuth integration is disabled for now: users connect their
  // wearable through the OS health store instead (Apple Health on iOS, Health
  // Connect on Android), where Whoop already writes its workouts/metrics. Flip
  // back to `true` to re-expose the dedicated Whoop card. All Whoop code below
  // is left intact so re-enabling is a one-line change.
  const showWhoop = false;

  /**
   * Hand the user off to the shared confirmation screen
   * (`/providers-oauth-return`).
   *
   * Whoop on Android: the system fires the
   * `longeviq://providers-oauth-return` intent the moment Whoop's redirect
   * lands in the in-app browser, so the deep-link route has already pushed
   * the success screen by the time we get here. Pushing again would render
   * a duplicate, so we just close the sheet on Android.
   *
   * Whoop on iOS: ASWebAuthenticationSession captures the redirect inside
   * the in-app browser before the OS dispatches the deep link, so the
   * programmatic push is the only path that reaches the success screen.
   *
   * HealthKit / Health Connect: no OAuth deep link involved, so we always
   * push.
   */
  const goToConnectionSuccess = useCallback(
    (provider: 'whoop' | 'healthkit' | 'healthconnect') => {
      onClose();
      if (provider === 'whoop' && Platform.OS === 'android') {
        return;
      }
      router.replace({
        pathname: '/providers-oauth-return',
        params: { provider },
      });
    },
    [onClose, router],
  );

  const refresh = useCallback(async () => {
    try {
      const c = await getHealthConnectConnection(userId);
      setHc(c);
      if (showWhoop) {
        setWhoop(await getWhoopConnection(userId));
      }
      if (showHealthKit) {
        // Reflect prior authorization: the toggle defaulted to off on every
        // open because nothing read the persisted HealthKit connection row.
        const hkConn = await getHealthKitConnection(userId);
        setHk((s) => ({ ...s, authorized: hkConn.connected, lastSyncAt: hkConn.lastSyncAt }));
      }
      if (showHealthConnect) {
        setHcAvailable(await isHealthConnectAvailable());
      }
    } catch (e) {
      glowLogger.warn('Connections refresh failed', { err: e instanceof Error ? e.message : String(e) });
    }
  }, [userId, showHealthConnect, showHealthKit, showWhoop]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  useEffect(() => {
    if (!visible) setHcManageModalVisible(false);
  }, [visible]);

  const handleWhoopToggle = async (next: boolean) => {
    if (whoopBusy) return;
    setWhoopBusy(true);
    try {
      if (next) {
        const { connected } = await connectWhoop(userId);
        if (connected) {
          // Inline backfill ran inside `providers-oauth-callback`, so by
          // the time we get here the Whoop activities + daily metrics are
          // already on Supabase. Bump the dashboard data version so the
          // Progress / dashboard screens re-pull instead of waiting until
          // the next manual refresh.
          onConnectionsChanged?.();
          goToConnectionSuccess('whoop');
          return;
        }
      } else {
        showDialog(
          t('menu:connections.disconnectTitle') ?? 'Disconnect Whoop?',
          t('menu:connections.disconnectBody') ?? 'Your historical data stays in Underforge. New workouts will no longer import until you reconnect.',
          [
            { text: t('common:cancel') ?? 'Cancel', variant: 'default' },
            {
              text: t('common:disconnect') ?? 'Disconnect',
              variant: 'destructive',
              onPress: async () => {
                try {
                  await disconnectWhoop(userId);
                  // The disconnect Edge Function hard-deletes Whoop rows
                  // on Supabase and the client mirrors that locally, so
                  // re-render the dashboard against the now-emptier data.
                  onConnectionsChanged?.();
                } catch (e) {
                  showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
                } finally {
                  await refresh();
                }
              },
            },
          ],
        );
      }
    } catch (e) {
      if (isMissingSupabaseSession(e)) {
        showDialog(
          t('menu:connections.signInRequiredTitle'),
          t('menu:connections.signInRequiredWhoopBody'),
        );
      } else {
        showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
      }
    } finally {
      setWhoopBusy(false);
      await refresh();
    }
  };

  // iOS exposes no public deep link to Health › Profile › Privacy › Apps, and
  // `Linking.openSettings()` only opens Underforge's *own* app settings page
  // (which has no Health toggles). Opening the Health app to its home is the
  // closest correct destination; the alert copy spells out the rest of the
  // path. Fall back to the app settings page only if the scheme won't open.
  const openAppleHealthApp = () => {
    Linking.openURL('x-apple-health://').catch(() => Linking.openSettings());
  };

  // Step 2 of the connect flow: actually request access and run the initial
  // import. Triggered by the "Continue" button on the priming dialog.
  const runHealthKitConnect = async () => {
    setHk((s) => ({ ...s, busy: true }));
    try {
      // Triggers iOS's native HealthKit permission sheet (in-app) when the
      // scopes are still undecided. A `true` result only means the request did
      // not error — Apple deliberately hides whether READ access was actually
      // granted — so we cannot treat it as proof of consent.
      const authorized = await requestHealthKitPermissions();
      if (!authorized) {
        // The request errored, which typically means the user previously
        // denied and iOS won't re-show the sheet. Point them to the manual
        // Health path — that's the only way back once denied.
        setHk((s) => ({ ...s, busy: false }));
        showDialog(
          t('menu:connections.appleHealthPermissionTitle'),
          t('menu:connections.appleHealthPermissionBody'),
          [
            { text: t('common:cancel'), variant: 'default' },
            { text: t('menu:connections.appleHealthOpenHealthApp'), variant: 'primary', onPress: openAppleHealthApp },
          ],
        );
        return;
      }
      const result = await syncHealthKit(userId, { daysBack: 30, force: true });
      setHk({ authorized: true, busy: false, lastSyncAt: new Date().toISOString() });
      // Safe to register background observers only after authorization.
      try {
        registerHealthKitObservers(userId);
      } catch (e) {
        glowLogger.warn('Failed to register HealthKit observers after connect', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      glowLogger.info('Apple Health initial sync done', {
        workouts: result.workouts,
        stepsDays: result.stepsDays,
      });
      onConnectionsChanged?.();
      // No "Connected!" screen: Apple hides whether the grant succeeded, so we
      // state plainly what's true and what to do if data doesn't appear.
      showDialog(
        t('menu:connections.appleHealthImportingTitle'),
        t('menu:connections.appleHealthImportingBody'),
        [{ text: t('common:ok'), variant: 'primary' }],
      );
    } catch (e) {
      setHk((s) => ({ ...s, busy: false }));
      showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
    }
  };

  const handleHealthKitToggle = (next: boolean) => {
    if (hk.busy) return;
    if (!isHealthKitAvailable()) {
      showDialog(
        t('menu:connections.appleHealthUnavailableTitle'),
        Platform.OS === 'ios'
          ? t('menu:connections.appleHealthUnavailableBodyIos')
          : t('menu:connections.appleHealthUnavailableBodyNonIos'),
      );
      return;
    }
    if (next) {
      // Step 1: priming popup that sets expectations. "Continue" triggers the
      // iOS permission sheet + import inside `runHealthKitConnect`.
      showDialog(
        t('menu:connections.appleHealthConnectTitle'),
        t('menu:connections.appleHealthConnectBody'),
        [
          { text: t('common:cancel'), variant: 'default' },
          { text: t('menu:connections.appleHealthConnectContinue'), variant: 'primary', onPress: runHealthKitConnect },
        ],
      );
      return;
    }
    // Toggle OFF → disconnect confirmation. We can't revoke Apple's read grant
    // (Apple owns it), but we CAN stop importing — see `confirmHealthKitDisconnect`.
    showDialog(
      t('menu:connections.appleHealthRevokeTitle'),
      t('menu:connections.appleHealthRevokeBody'),
      [
        { text: t('common:cancel'), variant: 'default' },
        {
          text: t('menu:connections.appleHealthDisconnectConfirm'),
          variant: 'destructive',
          onPress: confirmHealthKitDisconnect,
        },
      ],
    );
  };

  const confirmHealthKitDisconnect = async () => {
    setHk((s) => ({ ...s, busy: true }));
    try {
      await disconnectHealthKit(userId);
      setHk({ authorized: false, busy: false, lastSyncAt: null });
      onConnectionsChanged?.();
    } catch (e) {
      setHk((s) => ({ ...s, busy: false }));
      showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
    }
  };

  const handleHealthConnectResync = async () => {
    setHcBusy(true);
    try {
      const r = await syncHealthConnect(userId, { daysBack: 30, force: true });
      onConnectionsChanged?.();
      const total =
        r.workouts +
        r.stepsDays +
        r.activeEnergyDays +
        r.restingEnergyDays +
        r.sleepDays +
        r.hrvDays +
        r.rhrDays;
      if (total === 0) {
        showDialog(t('menu:connections.healthConnectNoDataTitle'), t('menu:connections.healthConnectNoDataBody'));
      }
    } catch (e) {
      showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
    } finally {
      setHcBusy(false);
      await refresh();
    }
  };

  const handleHealthConnectDisconnectFromManage = async () => {
    try {
      await disconnectHealthConnect(userId);
      onConnectionsChanged?.();
    } catch (e) {
      showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
    } finally {
      await refresh();
    }
  };

  const handleHealthConnectRowPress = async () => {
    if (hcBusy) return;
    if (!hcAvailable) {
      showDialog(
        t('menu:connections.healthConnect.unavailableTitle') ?? 'Health Connect unavailable',
        t('menu:connections.healthConnect.unavailableBody') ??
          'Install or update Health Connect from the Play Store, then try again.',
      );
      return;
    }

    if (!hc.connected) {
      setHcBusy(true);
      try {
        const { connected } = await connectHealthConnect(userId);
        if (!connected) {
          showDialog(
            t('menu:connections.healthConnect.permissionTitle') ?? 'Permission needed',
            t('menu:connections.healthConnect.permissionBody') ??
              'Open Health Connect and grant Underforge read access for steps, exercise sessions, sleep, and heart-rate metrics.',
          );
          return;
        }
        onConnectionsChanged?.();
        goToConnectionSuccess('healthconnect');
      } catch (e) {
        showDialog(t('common:error'), e instanceof Error ? e.message : String(e));
      } finally {
        setHcBusy(false);
        await refresh();
      }
      return;
    }

    setHcManageModalVisible(true);
  };

  if (!visible) return null;

  return (
    <Fragment>
      <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backButtonText}>‹ {t('common:back') ?? 'Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('menu:connections.title') ?? 'Connections'}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHint}>
          {t('menu:connections.description') ?? 'Connect wearables and apps to auto-import workouts and daily totals. We never sum across sources — we pick one canonical value per day.'}
        </Text>

        {showHealthKit ? (
          <View style={styles.providerCard}>
            <View style={styles.providerRow}>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>
                  {t('menu:connections.appleHealth.title') ?? 'Apple Health'}
                </Text>
                <Text style={styles.providerSub}>
                  {hk.authorized
                    ? t('menu:connections.lastSync', { value: formatLastSync(hk.lastSyncAt) })
                    : (t('menu:connections.appleHealth.subtitle') ??
                        'Workouts, steps, energy, sleep, HRV, and resting heart rate')}
                </Text>
              </View>
              {hk.busy ? (
                <ActivityIndicator color="#F47C3C" />
              ) : (
                <Switch
                  value={hk.authorized}
                  onValueChange={handleHealthKitToggle}
                  trackColor={{ false: '#2A3638', true: '#F47C3C' }}
                  thumbColor="#F2F2EE"
                  ios_backgroundColor="#2A3638"
                />
              )}
            </View>
          </View>
        ) : null}

        {showHealthConnect ? (
          <TouchableOpacity
            style={[styles.providerCard, styles.pressableProviderCard, hcBusy && styles.disabledProviderCard]}
            onPress={() => void handleHealthConnectRowPress()}
            activeOpacity={0.82}
            disabled={hcBusy}
            accessibilityRole="button"
            accessibilityLabel={
              hc.connected
                ? (t('menu:connections.healthConnect.manageA11y') ?? 'Manage Health Connect')
                : (t('menu:connections.healthConnect.connectA11y') ?? 'Connect Health Connect')
            }
            accessibilityState={{ disabled: hcBusy, selected: hc.connected }}
          >
            <View style={styles.providerRow}>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>
                  {t('menu:connections.healthConnect.title') ?? 'Health Connect'}
                </Text>
                <Text style={styles.providerSub}>
                  {!hcAvailable
                    ? (t('menu:connections.healthConnect.unavailableSubtitle') ??
                        'Install Health Connect from the Play Store')
                    : hc.connected
                    ? t('menu:connections.lastSync', { value: formatLastSync(hc.lastSyncAt) })
                    : (t('menu:connections.healthConnect.subtitle') ??
                        'Workouts, steps, energy, sleep, HRV, and resting heart rate')}
                </Text>
                {hc.lastError ? (
                  <Text style={styles.providerError}>{hc.lastError}</Text>
                ) : null}
              </View>
              {hcBusy ? (
                <ActivityIndicator color="#F47C3C" />
              ) : (
                <View
                  style={[
                    styles.actionButton,
                    hc.connected ? styles.manageButton : styles.connectButton,
                  ]}
                >
                  <Text
                    style={[
                      styles.actionButtonText,
                      hc.connected ? styles.manageButtonText : styles.connectButtonText,
                    ]}
                  >
                    {hc.connected
                      ? (t('menu:connections.healthConnect.manage') ?? 'Manage')
                      : (t('menu:connections.connectAction') ?? 'Connect')}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ) : null}

        {showWhoop ? (
          <TouchableOpacity
            style={[styles.providerCard, styles.pressableProviderCard, whoopBusy && styles.disabledProviderCard]}
            onPress={() => handleWhoopToggle(!whoop.connected)}
            activeOpacity={0.82}
            disabled={whoopBusy}
            accessibilityRole="button"
            accessibilityLabel={
              whoop.connected
                ? (t('menu:connections.whoopDisconnectA11y') ?? 'Disconnect Whoop')
                : (t('menu:connections.whoopConnectA11y') ?? 'Connect Whoop')
            }
            accessibilityState={{ disabled: whoopBusy, selected: whoop.connected }}
          >
            <View style={styles.providerRow}>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>Whoop</Text>
                <Text style={styles.providerSub}>
                  {whoop.connected
                    ? t('menu:connections.lastSync', { value: formatLastSync(whoop.lastSyncAt) })
                    : (t('menu:connections.whoopSubtitle') ?? 'Workouts and daily active energy')}
                </Text>
                {whoop.lastError ? <Text style={styles.providerError}>{whoop.lastError}</Text> : null}
              </View>
              {whoopBusy ? (
                <ActivityIndicator color="#F47C3C" />
              ) : (
                <View style={[styles.actionButton, whoop.connected ? styles.disconnectButton : styles.connectButton]}>
                  <Text style={[styles.actionButtonText, whoop.connected ? styles.disconnectButtonText : styles.connectButtonText]}>
                    {whoop.connected ? (t('common:disconnect') ?? 'Disconnect') : (t('menu:connections.connectAction') ?? 'Connect')}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footerHint}>
          {(() => {
            const bucket = resolveMobileOsBucket();
            const priorityKey =
              bucket === 'ios'
                ? 'menu:connections.priorityIos'
                : bucket === 'android'
                  ? 'menu:connections.priorityAndroid'
                  : 'menu:connections.priorityWeb';
            const fallback = conflictResolutionPriorityFallback();
            let text = t(priorityKey, { defaultValue: fallback });
            if (bucket === 'android' && /apple health/i.test(text)) {
              text = fallback;
            }
            return text;
          })()}
        </Text>
      </ScrollView>
      </SafeAreaView>

      <Modal
        visible={hcManageModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        accessibilityViewIsModal
        onRequestClose={() => setHcManageModalVisible(false)}
      >
      <View style={styles.hcManageBackdrop}>
        <TouchableOpacity
          style={styles.hcManageBackdropDismiss}
          activeOpacity={1}
          onPress={() => setHcManageModalVisible(false)}
          accessibilityLabel={t('common:cancel') ?? 'Dismiss'}
          accessibilityRole="button"
        />
        <View style={styles.hcManageCard}>
          <Text style={styles.hcManageCardTitle}>
            {t('menu:connections.healthConnect.manageTitle') ?? 'Manage Health Connect'}
          </Text>

          <View style={styles.hcManageSection}>
            <Text style={styles.hcManageSectionLabel}>
              {t('menu:connections.healthConnect.resync') ?? 'Re-sync'}
            </Text>
            <Text style={styles.hcManageSectionBody}>
              {t('menu:connections.healthConnect.manageResyncDescription') ??
                'Imports the last 30 days from Health Connect again. Use this if you linked another app to Health Connect (for example Samsung Health, Google Fit, or Fitbit) or new data has not appeared yet.'}
            </Text>
          </View>

          <View style={styles.hcManageDivider} />

          <View style={styles.hcManageSection}>
            <Text style={styles.hcManageSectionLabel}>
              {t('menu:connections.healthConnect.disconnectAction') ?? 'Disconnect'}
            </Text>
            <Text style={styles.hcManageSectionBody}>
              {t('menu:connections.healthConnect.manageDisconnectDescription') ??
                'Deletes all Health Connect–imported data from Underforge on your devices and account, then opens Health Connect settings so you can revoke Underforge’s access.'}
            </Text>
          </View>

          <View style={styles.hcManageActions}>
            <TouchableOpacity
              style={styles.hcManagePrimaryBtn}
              activeOpacity={0.85}
              onPress={() => {
                setHcManageModalVisible(false);
                void handleHealthConnectResync();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('menu:connections.healthConnect.resync') ?? 'Re-sync'}
            >
              <Text style={styles.hcManagePrimaryBtnText}>
                {t('menu:connections.healthConnect.resync') ?? 'Re-sync'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hcManageDestructiveBtn}
              activeOpacity={0.85}
              onPress={() => {
                setHcManageModalVisible(false);
                void handleHealthConnectDisconnectFromManage();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('menu:connections.healthConnect.disconnectAction') ?? 'Disconnect'}
            >
              <Text style={styles.hcManageDestructiveBtnText}>
                {t('menu:connections.healthConnect.disconnectAction') ?? 'Disconnect'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hcManageCancelBtn}
              activeOpacity={0.75}
              onPress={() => setHcManageModalVisible(false)}
              accessibilityRole="button"
            >
              <Text style={styles.hcManageCancelBtnText}>{t('common:cancel') ?? 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </Modal>

      <BrandDialog
        visible={dialog !== null}
        title={dialog?.title}
        message={dialog?.message}
        buttons={(dialog?.buttons && dialog.buttons.length > 0
          ? dialog.buttons
          : [{ text: t('common:ok') ?? 'OK', variant: 'primary' as const }]
        ).map((btn) => ({
          ...btn,
          // Every tap dismisses the dialog first, then runs the button's
          // action (async actions keep running after the close).
          onPress: () => {
            closeDialog();
            void btn.onPress?.();
          },
        }))}
        onRequestClose={closeDialog}
      />
    </Fragment>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0B1114',
    zIndex: 2000,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: '600',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#F2F2EE',
  },
  headerRight: {
    minWidth: 44,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  sectionHint: {
    fontSize: 14,
    lineHeight: 20,
    color: '#9AA3A6',
  },
  providerCard: {
    backgroundColor: '#141E1E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pressableProviderCard: {
    minHeight: 72,
  },
  disabledProviderCard: {
    opacity: 0.7,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  providerInfo: {
    flex: 1,
    paddingRight: 12,
  },
  providerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  providerSub: {
    marginTop: 4,
    fontSize: 13,
    color: '#8C979B',
  },
  providerError: {
    marginTop: 6,
    fontSize: 13,
    color: '#E8947A',
  },
  actionButton: {
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectButton: {
    backgroundColor: '#F47C3C',
  },
  disconnectButton: {
    borderWidth: 1,
    borderColor: '#E8947A',
    backgroundColor: 'transparent',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  connectButtonText: {
    color: '#0B1114',
  },
  disconnectButtonText: {
    color: '#E8947A',
  },
  manageButton: {
    borderWidth: 1,
    borderColor: '#5A6568',
    backgroundColor: 'transparent',
  },
  manageButtonText: {
    color: '#F2F2EE',
  },
  footerHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#6F7A7E',
  },
  hcManageBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 12, 14, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  hcManageBackdropDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  hcManageCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#141E1E',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#243035',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 14,
  },
  hcManageCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 18,
    letterSpacing: -0.2,
  },
  hcManageSection: {
    marginBottom: 2,
  },
  hcManageSectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  hcManageSectionBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#9AA3A6',
  },
  hcManageDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A3638',
    marginVertical: 16,
  },
  hcManageActions: {
    marginTop: 22,
    gap: 10,
  },
  hcManagePrimaryBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#F47C3C',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  hcManagePrimaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1114',
  },
  hcManageDestructiveBtn: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#C75C4A',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  hcManageDestructiveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E8947A',
  },
  hcManageCancelBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  hcManageCancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8C979B',
  },
});
