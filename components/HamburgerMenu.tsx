import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Clipboard, Dimensions, Keyboard, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appIcons } from '../assets/icons';
import { APP_UPDATE, APP_VERSION } from '../constants/app';
import { resetPassword } from '../lib/auth';
import { updateUserProfile } from '../lib/supabase_db_new';
import { changeLanguage } from '../lib/i18n';
import { glowLogger } from '../lib/glow-logger';
import {
  DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE,
  isWeeklyCheckinScheduleColumnMissingError,
  setCachedWeeklyCheckinScheduleMode,
} from '../lib/weekly-checkin-schedule';
import { ensureWeeklyReportNotificationScheduled } from '../lib/weekly-report-notifications';
import { useTranslation } from 'react-i18next';
import { Onboard } from '../types/onboard';
import { UserProfile, type WeeklyCheckinScheduleMode } from '../types/user_profile';
import { AvatarPicker } from './AvatarPicker';
import { DeveloperCoachEditPlan } from './DeveloperCoachEditPlan';
import { ForgingCircleScreen } from './ForgingCircleScreen';
import { Icon } from './Icon';
import { ConnectionsScreen } from './ConnectionsScreen';
import { LicensesScreen } from './LicensesScreen';

export const TIMER_SOUND_SILENT_MODE_KEY = 'timer_sound_silent_mode';
const SUPPORT_EMAIL = 'yourcoach@underforge.io';

const SETTINGS_SWITCH_TRACK = { false: '#3A484C', true: '#F47C3C' } as const;

function SettingsGroupHeader({ title, first }: { title: string; first?: boolean }) {
  return <Text style={[settingsUi.groupHeader, first && settingsUi.groupHeaderFirst]}>{title}</Text>;
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return <View style={settingsUi.card}>{children}</View>;
}

function SettingsInsetDivider() {
  return <View style={settingsUi.insetDivider} />;
}

function SettingsSwitchRow({
  label,
  value,
  onValueChange,
  trailing,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={settingsUi.switchRow}>
      <View style={settingsUi.switchLabelRow}>
        <Text style={settingsUi.switchLabel} numberOfLines={2}>
          {label}
        </Text>
        {trailing}
      </View>
      <Switch
        trackColor={SETTINGS_SWITCH_TRACK}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#3A484C"
        onValueChange={onValueChange}
        value={value}
      />
    </View>
  );
}

function SettingsRadioRow({
  selected,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
  isLast,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
  isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[settingsUi.optionRow, selected && settingsUi.optionRowSelected, isLast && settingsUi.optionRowLast]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.7}
    >
      <View style={[settingsUi.radioRing, selected && settingsUi.radioRingSelected]}>
        {selected ? <View style={settingsUi.radioDot} /> : null}
      </View>
      <View style={settingsUi.optionCopy}>
        <Text style={[settingsUi.optionTitle, selected && settingsUi.optionTitleSelected]}>{title}</Text>
        <Text style={settingsUi.optionSubtitle}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

const settingsUi = StyleSheet.create({
  groupHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6F7A7E',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 14,
  },
  groupHeaderFirst: {
    marginTop: 0,
  },
  card: {
    borderRadius: 12,
    backgroundColor: '#141E1E',
    borderWidth: 1,
    borderColor: '#243033',
    marginBottom: 20,
    overflow: 'hidden',
  },
  insetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#243033',
    marginLeft: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 12,
  },
  switchLabelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#F2F2EE',
    lineHeight: 18,
  },
  infoButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#4A585C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIcon: {
    fontSize: 12,
    lineHeight: 14,
    color: '#9AA3A6',
    fontWeight: '700',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  optionRowSelected: {
    backgroundColor: 'rgba(244, 124, 60, 0.08)',
  },
  optionRowLast: {
    paddingBottom: 10,
  },
  radioRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4A585C',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioRingSelected: {
    borderColor: '#F47C3C',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F47C3C',
  },
  optionCopy: {
    flex: 1,
    gap: 4,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#C8CED0',
    lineHeight: 19,
  },
  optionTitleSelected: {
    color: '#F2F2EE',
  },
  optionSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6F7A7E',
    lineHeight: 16,
  },
  periodFootnoteText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#6F7A7E',
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 2,
  },
});

const PRIVACY_POLICY_URL = 'https://www.underforge.io/privacy-policy.html';
const PERSONAL_COACHING_URL = 'https://www.underforge.io';

export type MenuMode =
  | 'main'
  | 'account'
  | 'manage_account'
  | 'settings'
  | 'language'
  | 'feature_request'
  | 'support'
  | 'developer'
  | 'forging_circle';

interface HamburgerMenuProps {
  visible: boolean;
  onClose: () => void;
  onboardingData: Onboard;
  currentUserProfile?: UserProfile | null;
  /** Current coaching plan tier ({ key, displayName }); null = ai_only / not loaded. */
  planTier?: { key: string; displayName: string } | null;
  onLogout?: () => void;
  onResetAndLogout: () => void;
  onDeleteAccount?: () => void;
  onShowPlan: () => void;
  onShowDeveloper: () => void;
  onProfileUpdate?: () => void;
  /**
   * Bumped by the Connections screen when the user (dis)connects a
   * provider. The parent uses it to invalidate dashboard caches so a
   * brand-new Whoop / Health Connect import shows up immediately.
   */
  onConnectionsChanged?: () => void;
  /**
   * Initial sub-screen to open the menu on. When set, the menu skips the
   * "main" landing and goes straight to the requested mode (e.g. used by
   * the Community screen's "Decide ... here" link to jump into the
   * Forging Circle settings).
   */
  initialMode?: MenuMode;
  /** Called once the parent's requested initialMode has been consumed. */
  onInitialModeConsumed?: () => void;
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  visible,
  onClose,
  onboardingData,
  currentUserProfile,
  planTier,
  onLogout,
  onResetAndLogout,
  onDeleteAccount,
  onShowPlan,
  onShowDeveloper,
  onProfileUpdate,
  onConnectionsChanged,
  initialMode,
  onInitialModeConsumed,
}) => {
  const [menuMode, setMenuMode] = useState<MenuMode>('main');
  const bottomSheetAnim = useRef(new Animated.Value(0)).current;
  const menuWasVisibleRef = useRef(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const screenHeight = Dimensions.get('window').height;
  const insets = useSafeAreaInsets();
  const [showOnboardDataModal, setShowOnboardDataModal] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [timerSoundSilentMode, setTimerSoundSilentMode] = useState(true);
  const [weeklyScheduleModeOverride, setWeeklyScheduleModeOverride] = useState<WeeklyCheckinScheduleMode | null>(null);
  const { t, i18n } = useTranslation(['menu', 'settings', 'common', 'main', 'social']);

  const profileWeeklyScheduleMode: WeeklyCheckinScheduleMode =
    currentUserProfile?.weekly_checkin_schedule_mode ?? DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE;
  const effectiveWeeklyScheduleMode = weeklyScheduleModeOverride ?? profileWeeklyScheduleMode;

  useEffect(() => {
    setWeeklyScheduleModeOverride(null);
  }, [profileWeeklyScheduleMode]);

  // Keyboard event listeners
  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardDidShow.remove();
      keyboardDidHide.remove();
    };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(TIMER_SOUND_SILENT_MODE_KEY).then(val => {
      setTimerSoundSilentMode(val === null ? true : val === 'true');
    });
  }, [visible]);

  const handleTimerSoundSilentModeToggle = async (newValue: boolean) => {
    setTimerSoundSilentMode(newValue);
    await AsyncStorage.setItem(TIMER_SOUND_SILENT_MODE_KEY, newValue.toString());
  };

  // Bottom sheet animation — only set menuMode when the sheet opens (or when a
  // new deep-link initialMode arrives), not on every parent re-render while open.
  useEffect(() => {
    const justOpened = visible && !menuWasVisibleRef.current;
    menuWasVisibleRef.current = visible;

    if (visible) {
      if (justOpened || initialMode) {
        setMenuMode(initialMode ?? 'main');
        if (initialMode) onInitialModeConsumed?.();
      }
      Animated.spring(bottomSheetAnim, {
        toValue: 1,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(bottomSheetAnim, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, bottomSheetAnim, initialMode, onInitialModeConsumed]);

  const handleClose = () => {
    setMenuMode('main'); // Reset menu mode when closing
    onClose();
  };

  const handleShowAccountInfo = () => {
    setMenuMode('account');
  };

  const handleShowManageAccount = () => {
    setMenuMode('manage_account');
  };

  const handleShowSettings = () => {
    setMenuMode('settings');
  };

  const handleShowLanguage = () => {
    setMenuMode('language');
  };

  const handleShowFeatureRequest = () => {
    setMenuMode('feature_request');
  };

  const handleShowSupport = () => {
    setMenuMode('support');
  };

  const handleBackToMainMenu = () => {
    setMenuMode('main');
  };

  const handleShowPlan = () => {
    if (onboardingData.actionPlan) {
      handleClose();
      onShowPlan?.(); // Call parent callback if provided
    } else {
      Alert.alert(t('menu:alertNoActionPlanTitle'), t('menu:alertNoActionPlanBody'));
    }
  };

  const handleShowDeveloper = () => {
    handleClose();
    onShowDeveloper?.(); // Call parent callback if provided
  };

  const openUrl = async (url: string, fallbackMessage: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.error('Failed to open URL:', error);
      Alert.alert(t('common:error'), fallbackMessage);
    }
  };

  const handleOpenPrivacyPolicy = () => {
    openUrl(PRIVACY_POLICY_URL, t('menu:privacyPolicyFallback'));
  };

  const handleOpenPersonalCoaching = () => {
    openUrl(PERSONAL_COACHING_URL, t('menu:personalCoachingFallback'));
  };

  const handleOpenEmailDraft = (type: 'feature_request' | 'support') => {
    const subject =
      type === 'feature_request'
        ? t('menu:featureRequestEmailSubject')
        : t('menu:supportEmailSubject');
    const body =
      type === 'feature_request'
        ? t('menu:featureRequestEmailBody')
        : t('menu:supportEmailBody');

    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    openUrl(mailtoUrl, t('menu:emailFallback', { email: SUPPORT_EMAIL }));
  };

  const handleChangePassword = async () => {
    const email = currentUserProfile?.email;

    if (!email) {
      Alert.alert(t('common:error'), t('menu:changePasswordMissingEmail'));
      return;
    }

    const result = await resetPassword(email);
    if (!result.success) {
      Alert.alert(t('common:error'), result.error || t('menu:changePasswordError'));
      return;
    }

    Alert.alert(
      t('menu:changePasswordSuccessTitle'),
      t('menu:changePasswordSuccessBody', { email })
    );
  };

  const getUserFocus = () => {
    return onboardingData.selectedModules?.[0] || 'general wellness';
  };

  const ellideUserId = (userId?: string) => {
    if (!userId || userId.length <= 20) return userId || t('menu:accountValueNotAvailable');
    return `${userId.slice(0, 8)}...${userId.slice(-8)}`;
  };

  const handleVersionCopy = () => {
    const versionInfo = `Version: ${APP_VERSION}\nUpdate: ${APP_UPDATE}`;
    Clipboard.setString(versionInfo);
    Alert.alert(t('common:copied'), t('menu:versionCopiedBody'));
  };

  const handleWeeklyCheckinScheduleModeChange = async (newMode: WeeklyCheckinScheduleMode) => {
    if (!currentUserProfile) {
      Alert.alert(t('common:error'), t('menu:profileNotAvailable'));
      return;
    }

    const currentMode =
      currentUserProfile.weekly_checkin_schedule_mode ?? DEFAULT_WEEKLY_CHECKIN_SCHEDULE_MODE;
    if (currentMode === newMode) return;

    setWeeklyScheduleModeOverride(newMode);
    await setCachedWeeklyCheckinScheduleMode(newMode);
    await ensureWeeklyReportNotificationScheduled(newMode);

    try {
      await updateUserProfile({
        user_id: currentUserProfile.user_id,
        weekly_checkin_schedule_mode: newMode,
      });
      if (onProfileUpdate) {
        onProfileUpdate();
      }
    } catch (error) {
      if (isWeeklyCheckinScheduleColumnMissingError(error)) {
        glowLogger.warn('weekly_checkin_schedule_mode column missing on Supabase; using local preference only', {
          user_id: currentUserProfile.user_id,
          mode: newMode,
        });
        return;
      }
      setWeeklyScheduleModeOverride(null);
      await setCachedWeeklyCheckinScheduleMode(profileWeeklyScheduleMode);
      await ensureWeeklyReportNotificationScheduled(profileWeeklyScheduleMode);
      console.error('Failed to update weekly check-in schedule mode:', error);
      Alert.alert(t('common:error'), t('settings:weeklyCheckinScheduleUpdateFailed'));
    }
  };

  const handleAwayModeToggle = async (newValue: boolean) => {
    if (!currentUserProfile) {
      Alert.alert(t('common:error'), t('menu:profileNotAvailable'));
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      await updateUserProfile({
        user_id: currentUserProfile.user_id,
        away_mode: newValue,
        away_mode_start_date: newValue ? today : null
      });

      // Call parent callback to refresh profile
      if (onProfileUpdate) {
        onProfileUpdate();
      }
    } catch (error) {
      console.error('Failed to update away mode:', error);
      Alert.alert(t('common:error'), t('menu:awayModeUpdateFailed'));
    }
  };

  const showAwayModeInfo = () => {
    Alert.alert(
      t('settings:awayModeInfoTitle'),
      t('settings:awayModeInfoBody'),
      [{ text: t('settings:awayModeInfoGotIt') }]
    );
  };

  const showTimerSoundSilentModeInfo = () => {
    Alert.alert(
      t('settings:timerSoundSilentModeInfoTitle'),
      t('settings:timerSoundSilentModeInfoBody'),
      [{ text: t('settings:timerSoundSilentModeInfoGotIt') }]
    );
  };

  const handleShowOnboardData = () => {
    if (currentUserProfile && currentUserProfile.onboardingProfile) {
      setShowOnboardDataModal(true);
    } else {
      Alert.alert(
        t('menu:noOnboardingDataTitle'),
        t('menu:noOnboardingDataBody'),
        [{ text: t('common:ok') }]
      );
    }
  };

  if (!visible) return null;

  const isSpanish = i18n.language.startsWith('es');

  const renderMainMenuItem = (
    label: string,
    onPress: () => void,
    trailing?: React.ReactNode
  ) => (
    <TouchableOpacity style={styles.simpleMenuItem} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.simpleMenuItemText}>{label}</Text>
      <View style={styles.simpleMenuItemTrailing}>
        {trailing}
        <Text style={styles.menuItemArrow}>›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <>
      {/* Bottom Sheet Overlay */}
      {visible && (
        <TouchableOpacity
          style={styles.bottomSheetOverlay}
          onPress={handleClose}
          activeOpacity={1}
        />
      )}

      {/* Bottom Sheet */}
      {visible && (() => {
        // Modes with their own long scrollable content need a bounded,
        // full-height sheet (top anchored) so the inner ScrollView can
        // actually scroll instead of overflowing past the sheet's max
        // height and getting clipped behind the Android nav bar.
        const isTallScrollMode = menuMode === 'account' || menuMode === 'forging_circle';
        return (
        <Animated.View
          style={[
            styles.bottomSheet,
            isTallScrollMode ? { top: '10%', bottom: 0 } : {},
            {
              bottom: keyboardHeight,
              transform: [
                {
                  translateY: bottomSheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [screenHeight, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.bottomSheetHeader}>
            <View style={styles.bottomSheetHandle} />
          </View>

          <View style={[
            styles.bottomSheetContent,
            isTallScrollMode && { flex: 1 },
            !isTallScrollMode && { paddingBottom: Math.max(insets.bottom + 16, 24) },
          ]}>
            {menuMode === 'main' ? (
              <>
                <Text style={styles.menuTitle}>{t('menu:title')}</Text>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.mainMenuScrollContent}
                >
                  <View style={styles.mainMenuSection}>
                    {renderMainMenuItem(
                      t('menu:languageSelectionTitle'),
                      handleShowLanguage,
                      <Text style={styles.inlineFlag}>{isSpanish ? '🇲🇽' : '🇺🇸'}</Text>
                    )}
                    {renderMainMenuItem(t('menu:accountTitle'), handleShowAccountInfo)}
                    {renderMainMenuItem(t('social:circleMenuTitle'), () => setMenuMode('forging_circle'))}
                    {renderMainMenuItem(t('menu:settingsTitle'), handleShowSettings)}
                    {renderMainMenuItem(
                      t('menu:connectionsTitle') || 'Connections',
                      () => setShowConnections(true),
                    )}
                    {renderMainMenuItem(t('menu:personalCoachingTitle'), handleOpenPersonalCoaching)}
                    {renderMainMenuItem(t('menu:requestFeatureTitle'), handleShowFeatureRequest)}
                    {renderMainMenuItem(t('menu:contactSupportTitle'), handleShowSupport)}
                  </View>

                  <View style={styles.mainMenuFooter}>
                    <TouchableOpacity
                      style={styles.secondaryTextButton}
                      onPress={handleOpenPrivacyPolicy}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.secondaryTextButtonText}>{t('menu:privacyPolicyTitle')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.developerButton}
                      onPress={handleShowDeveloper}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.developerButtonText}>{t('menu:developerTitle')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.tertiaryTextButton}
                      onPress={() => setShowLicenses(true)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={t('menu:licenses.title')}
                    >
                      <Text style={styles.tertiaryTextButtonText}>{t('menu:licenses.menuLabel')}</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </>
            ) : menuMode === 'account' ? (
              // Account Information — scrollable info + pinned View Onboard Data button
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.backButtonText}>‹ {t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.submenuTitle}>{t('menu:accountTitle')}</Text>
                </View>

                <ScrollView
                  style={styles.accountScrollView}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.accountScrollContent}
                >
                  {onboardingData.localUserId ? (
                    <AvatarPicker
                      uri={currentUserProfile?.avatar_url ?? null}
                      userId={onboardingData.localUserId}
                      displayName={onboardingData.name || currentUserProfile?.display_name}
                      onChange={async (newUrl) => {
                        try {
                          await updateUserProfile({
                            user_id: onboardingData.localUserId!,
                            avatar_url: newUrl,
                          });
                          onProfileUpdate?.();
                        } catch (e) {
                          glowLogger.error('Failed to persist avatar_url', {
                            error: e instanceof Error ? e.message : String(e),
                          });
                        }
                      }}
                    />
                  ) : null}

                  <Text style={styles.sectionHeader}>{t('menu:accountSectionGeneral')}</Text>

                  <View style={styles.userInfoRow}>
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelName')}</Text>
                    <Text style={styles.userInfoValue}>{onboardingData.name}</Text>
                  </View>

                  <View style={styles.userInfoRow}>
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelEmail')}</Text>
                    <Text style={styles.userInfoValue}>{currentUserProfile?.email || t('menu:accountValueNotSet')}</Text>
                  </View>

                  <View style={styles.userInfoRow}>
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelCoach')}</Text>
                    <Text style={styles.userInfoValue}>{onboardingData.selectedCoach || t('menu:accountValueNotAssigned')}</Text>
                  </View>

                  <View style={styles.userInfoRow}>
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelPlanTier')}</Text>
                    <Text style={styles.userInfoValue}>
                      {planTier
                        ? t(`menu:planTier_${planTier.key}`, { defaultValue: planTier.displayName })
                        : t('menu:planTier_ai_only')}
                    </Text>
                  </View>

                  <Text style={styles.sectionHeader}>{t('menu:accountSectionTechnical')}</Text>

                  <View style={styles.userInfoRow}>
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelUserId')}</Text>
                    <TouchableOpacity
                      style={styles.userIdCopyContainer}
                      onPress={() => {
                        if (onboardingData.localUserId) {
                          Clipboard.setString(onboardingData.localUserId);
                          Alert.alert(t('common:copied'), t('menu:userIdCopiedBody'));
                        }
                      }}
                    >
                      <Text
                        style={[styles.userInfoValue, { maxWidth: 140 }]}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {ellideUserId(onboardingData.localUserId)}
                      </Text>
                      <Icon source={appIcons.clipboard} width={16} height={16} fill="#F47C3C" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.userInfoRow}>
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelTimezone')}</Text>
                    <Text style={styles.userInfoValue}>
                      {currentUserProfile?.timezone || t('menu:accountValueNotSet')}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.userInfoRow}
                    onLongPress={handleVersionCopy}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelVersion')}</Text>
                    <Text style={styles.userInfoValue}>{APP_VERSION}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.userInfoRow}
                    onLongPress={handleVersionCopy}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.userInfoLabel}>{t('menu:accountLabelUpdate')}</Text>
                    <Text style={styles.userInfoValue}>{APP_UPDATE}</Text>
                  </TouchableOpacity>
                </ScrollView>

                {/* Pinned buttons — always visible at the bottom */}
                <View style={[styles.accountPinnedActions, Platform.OS === 'android' && { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
                  <TouchableOpacity
                    style={styles.viewDataButton}
                    onPress={handleShowOnboardData}
                  >
                    <Text style={styles.viewDataButtonText}>{t('menu:viewOnboardData')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.manageAccountButton}
                    onPress={handleShowManageAccount}
                  >
                    <Text style={styles.manageAccountButtonText}>{t('menu:manageAccountTitle')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : menuMode === 'manage_account' ? (
              // Manage Account — logout + delete
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.backButtonText}>‹ {t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.submenuTitle}>{t('menu:manageAccountTitle')}</Text>
                </View>

                <View style={styles.bottomSheetActions}>
                  <TouchableOpacity
                    style={styles.secondaryActionButton}
                    onPress={handleChangePassword}
                  >
                    <Text style={styles.secondaryActionButtonText}>{t('menu:changePasswordTitle')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.resetButton}
                    onPress={onResetAndLogout}
                  >
                    <Text style={styles.resetButtonText}>{t('main:logoutConfirm')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.deleteAccountButton}
                    onPress={() => {
                      Alert.alert(
                        t('menu:deleteAccountTitle'),
                        t('menu:deleteAccountBody'),
                        [
                          { text: t('common:cancel'), style: 'cancel' },
                          {
                            text: t('common:delete'),
                            style: 'destructive',
                            onPress: () => {
                              Alert.alert(
                                t('menu:deleteAccountConfirmTitle'),
                                t('menu:deleteAccountConfirmBody'),
                                [
                                  { text: t('common:cancel'), style: 'cancel' },
                                  {
                                    text: t('menu:deleteEverything'),
                                    style: 'destructive',
                                    onPress: () => {
                                      onClose();
                                      onDeleteAccount?.();
                                    },
                                  },
                                ]
                              );
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Text style={styles.deleteAccountButtonText}>{t('menu:deleteAccountButton')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : menuMode === 'settings' ? (
              // Settings Menu
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.settingsScreenBack}>{t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.settingsScreenTitle}>{t('settings:title')}</Text>
                </View>

                <ScrollView
                  style={styles.settingsScroll}
                  contentContainerStyle={styles.settingsScrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <SettingsGroupHeader title={t('settings:groupReminders')} first />
                  <SettingsCard>
                    <SettingsSwitchRow
                      label={t('settings:timerSoundSilentModeShort')}
                      value={timerSoundSilentMode}
                      onValueChange={handleTimerSoundSilentModeToggle}
                      trailing={(
                        <TouchableOpacity
                          onPress={showTimerSoundSilentModeInfo}
                          style={settingsUi.infoButton}
                          accessibilityRole="button"
                          accessibilityLabel={t('settings:timerSoundSilentModeInfoTitle')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={settingsUi.infoIcon}>i</Text>
                        </TouchableOpacity>
                      )}
                    />
                  </SettingsCard>

                  <SettingsGroupHeader title={t('settings:groupWeeklyCheckin')} />
                  <SettingsCard>
                    <SettingsRadioRow
                      selected={effectiveWeeklyScheduleMode === 'sun_sat_sun1800'}
                      title={t('settings:weeklyCheckinScheduleSunSat')}
                      subtitle={t('settings:weeklyCheckinScheduleSunSatDelivered')}
                      onPress={() => handleWeeklyCheckinScheduleModeChange('sun_sat_sun1800')}
                      accessibilityLabel={`${t('settings:weeklyCheckinScheduleSunSat')}. ${t('settings:weeklyCheckinScheduleSunSatDelivered')}`}
                    />
                    <SettingsInsetDivider />
                    <SettingsRadioRow
                      selected={effectiveWeeklyScheduleMode === 'mon_sun_mon1800'}
                      title={t('settings:weeklyCheckinScheduleMonSun')}
                      subtitle={t('settings:weeklyCheckinScheduleMonSunDelivered')}
                      onPress={() => handleWeeklyCheckinScheduleModeChange('mon_sun_mon1800')}
                      accessibilityLabel={`${t('settings:weeklyCheckinScheduleMonSun')}. ${t('settings:weeklyCheckinScheduleMonSunDelivered')}`}
                      isLast
                    />
                    <Text style={settingsUi.periodFootnoteText}>
                      {effectiveWeeklyScheduleMode === 'mon_sun_mon1800'
                        ? t('settings:weeklyCheckinScheduleMonSunHelp')
                        : t('settings:weeklyCheckinScheduleSunSatHelp')}
                    </Text>
                  </SettingsCard>

                  <SettingsGroupHeader title={t('settings:groupAwayMode')} />
                  <SettingsCard>
                    <SettingsSwitchRow
                      label={t('settings:awayMode')}
                      value={currentUserProfile?.away_mode || false}
                      onValueChange={handleAwayModeToggle}
                      trailing={(
                        <TouchableOpacity
                          onPress={showAwayModeInfo}
                          style={settingsUi.infoButton}
                          accessibilityRole="button"
                          accessibilityLabel={t('settings:awayModeInfoTitle')}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={settingsUi.infoIcon}>i</Text>
                        </TouchableOpacity>
                      )}
                    />
                  </SettingsCard>
                </ScrollView>
              </>
            ) : menuMode === 'language' ? (
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.backButtonText}>{t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.submenuTitle}>{t('menu:languageSelectionTitle')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <Text style={styles.infoCardText}>{t('menu:languageSelectionDescription')}</Text>
                </View>

                <View style={styles.languageOptionsColumn}>
                  <TouchableOpacity
                    style={[
                      styles.languageOption,
                      !isSpanish && styles.languageOptionActive,
                    ]}
                    activeOpacity={0.9}
                    onPress={() => changeLanguage('en')}
                  >
                    <View style={styles.languageOptionInner}>
                      <Text style={styles.languageFlag}>🇺🇸</Text>
                      <Text
                        style={[
                          styles.languageOptionText,
                          !isSpanish && styles.languageOptionTextActive,
                        ]}
                      >
                        {t('settings:languageEnglish')}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.languageOption,
                      isSpanish && styles.languageOptionActive,
                    ]}
                    activeOpacity={0.9}
                    onPress={() => changeLanguage('es')}
                  >
                    <View style={styles.languageOptionInner}>
                      <Text style={styles.languageFlag}>🇲🇽</Text>
                      <Text
                        style={[
                          styles.languageOptionText,
                          isSpanish && styles.languageOptionTextActive,
                        ]}
                      >
                        {t('settings:languageSpanish')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </>
            ) : menuMode === 'feature_request' ? (
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.backButtonText}>{t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.submenuTitle}>{t('menu:requestFeatureTitle')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <Text style={styles.infoCardText}>{t('menu:featureRequestDescription')}</Text>
                </View>

                <TouchableOpacity
                  style={styles.primaryActionButton}
                  onPress={() => handleOpenEmailDraft('feature_request')}
                >
                  <Text style={styles.primaryActionButtonText}>{t('menu:featureRequestButton')}</Text>
                </TouchableOpacity>

                <Text style={styles.helperText}>
                  {t('menu:emailFallback', { email: SUPPORT_EMAIL })}
                </Text>
              </>
            ) : menuMode === 'support' ? (
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.backButtonText}>{t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.submenuTitle}>{t('menu:contactSupportTitle')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <Text style={styles.infoCardText}>{t('menu:contactSupportDescription')}</Text>
                </View>

                <TouchableOpacity
                  style={styles.primaryActionButton}
                  onPress={() => handleOpenEmailDraft('support')}
                >
                  <Text style={styles.primaryActionButtonText}>{t('menu:contactSupportButton')}</Text>
                </TouchableOpacity>

                <Text style={styles.helperText}>
                  {t('menu:emailFallback', { email: SUPPORT_EMAIL })}
                </Text>

                <TouchableOpacity
                  style={styles.secondaryTextButton}
                  onPress={handleOpenPrivacyPolicy}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryTextButtonText}>{t('menu:privacyPolicyTitle')}</Text>
                </TouchableOpacity>
              </>
            ) : menuMode === 'forging_circle' ? (
              <>
                <View style={styles.submenuHeader}>
                  <TouchableOpacity onPress={handleBackToMainMenu} style={styles.backButton}>
                    <Text style={styles.backButtonText}>{t('common:back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.submenuTitle}>{t('social:circleMenuTitle')}</Text>
                </View>
                {onboardingData.localUserId ? (
                  <ForgingCircleScreen
                    userId={onboardingData.localUserId}
                    currentUserEmail={currentUserProfile?.email ?? null}
                    currentUserDisplayName={currentUserProfile?.display_name ?? onboardingData.name ?? null}
                    currentUserAvatarUrl={currentUserProfile?.avatar_url ?? null}
                  />
                ) : null}
              </>
            ) : null}
          </View>
        </Animated.View>
        );
      })()}

      {/* Onboard Data Modal */}
      {currentUserProfile && (
        <DeveloperCoachEditPlan
          visible={showOnboardDataModal}
          onClose={() => setShowOnboardDataModal(false)}
          userProfile={currentUserProfile}
          readOnly={true}
        />
      )}

      {/* Connections (wearables + apps) */}
      {onboardingData.localUserId ? (
        <ConnectionsScreen
          visible={showConnections}
          onClose={() => setShowConnections(false)}
          userId={onboardingData.localUserId}
          onConnectionsChanged={onConnectionsChanged}
        />
      ) : null}

      {/* Open Source Licenses (acknowledgements) */}
      <LicensesScreen visible={showLicenses} onClose={() => setShowLicenses(false)} />
    </>
  );
};

const styles = StyleSheet.create({
  // Bottom Sheet Styles
  bottomSheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 17, 20, 0.9)',
    zIndex: 999,
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 1000,
    maxHeight: '90%',
    borderTopWidth: 1,
    borderTopColor: '#1E2A2C',
  },
  bottomSheetHeader: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  bottomSheetHandle: {
    width: 44,
    height: 4,
    backgroundColor: '#2A3638',
    borderRadius: 2,
  },
  bottomSheetContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    // flex: 1 is applied conditionally via inline style when in account mode
  },
  accountScrollView: {
    flex: 1,
  },
  accountScrollContent: {
    paddingBottom: 8,
  },
  accountPinnedActions: {
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  // Menu Styles
  menuTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 24,
    textAlign: 'center',
    flexShrink: 1,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  submenuHeader: {
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 14,
    marginBottom: 10,
  },
  backButtonText: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: '600',
  },
  submenuTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'left',
  },
  mainMenuScrollContent: {
    paddingBottom: 8,
  },
  mainMenuSection: {
    borderTopWidth: 1,
    borderTopColor: '#1A2426',
  },
  simpleMenuItem: {
    minHeight: 56,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  simpleMenuItemText: {
    fontSize: 17,
    color: '#F2F2EE',
    fontWeight: '500',
    flex: 1,
    paddingRight: 16,
  },
  simpleMenuItemTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inlineFlag: {
    fontSize: 20,
  },
  mainMenuFooter: {
    paddingTop: 20,
    alignItems: 'center',
    gap: 10,
  },
  secondaryTextButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  secondaryTextButtonText: {
    fontSize: 14,
    color: '#8C979B',
    textDecorationLine: 'underline',
  },
  developerButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  developerButtonText: {
    fontSize: 13,
    color: '#6F7A7E',
    fontWeight: '500',
  },
  tertiaryTextButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  tertiaryTextButtonText: {
    fontSize: 12,
    color: '#556065',
    fontWeight: '400',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 22,
    backgroundColor: '#141E1E',
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  menuItemIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0E1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 18,
  },
  menuItemIconText: {
    fontSize: 22,
  },
  menuItemIconImage: {
    width: 22,
    height: 22,
  },
  menuItemContent: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  menuItemSubtitle: {
    fontSize: 14,
    color: '#9AA3A6',
  },
  menuItemArrow: {
    fontSize: 20,
    color: '#6F7A7E',
    fontWeight: '300',
  },
  // Account Info Styles
  userInfoSection: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6F7A7E',
    letterSpacing: 1.1,
    marginTop: 18,
    marginBottom: 6,
  },
  userInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A2426',
  },
  userInfoLabel: {
    fontSize: 14,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  userInfoValue: {
    fontSize: 14,
    color: '#F2F2EE',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  userIdCopyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copyIcon: {
    fontSize: 18,
    color: '#F47C3C',
    marginLeft: 10,
  },
  settingsScreenBack: {
    fontSize: 15,
    color: '#F47C3C',
    fontWeight: '600',
  },
  settingsScreenTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F2F2EE',
    textAlign: 'left',
  },
  settingsScroll: {
    flexGrow: 0,
  },
  settingsScrollContent: {
    paddingBottom: 24,
  },
  infoCard: {
    backgroundColor: '#141E1E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  infoCardText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#C7D0D4',
  },
  languageOptionsColumn: {
    gap: 12,
  },
  languageOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  languageOption: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2A2C',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#0B1114',
  },
  languageOptionActive: {
    borderColor: '#F47C3C',
    backgroundColor: '#1A2529',
  },
  languageOptionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  languageOptionText: {
    fontSize: 14,
    color: '#E5EEF2',
    fontWeight: '500',
  },
  languageOptionTextActive: {
    color: '#FFFFFF',
  },
  languageFlag: {
    fontSize: 22,
  },
  primaryActionButton: {
    backgroundColor: '#F47C3C',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  primaryActionButtonText: {
    color: '#0B1114',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryActionButton: {
    backgroundColor: '#141E1E',
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  secondaryActionButtonText: {
    color: '#F2F2EE',
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: '#8C979B',
    textAlign: 'center',
  },
  bottomSheetActions: {
    gap: 14,
  },
  viewDataButton: {
    backgroundColor: '#141E1E',
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E2A2C',
  },
  viewDataButtonText: {
    color: '#F47C3C',
    fontSize: 16,
    fontWeight: '600',
  },
  manageAccountButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
  },
  manageAccountButtonText: {
    color: '#0B1114',
    fontSize: 16,
    fontWeight: '700',
  },
  resetButton: {
    backgroundColor: '#C65B5B',
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#0B1114',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteAccountButton: {
    backgroundColor: 'transparent',
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteAccountButtonText: {
    color: '#C65B5B',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0B1114',
    zIndex: 2000,
  },
});