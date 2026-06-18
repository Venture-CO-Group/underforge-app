import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { Icon } from './Icon';
import { Typography } from '../constants/Typography';

export type PlanRemoteSyncStatus = 'idle' | 'checking' | 'success' | 'failed';

interface PlanRemoteSyncBannerProps {
  status: Exclude<PlanRemoteSyncStatus, 'idle'>;
  onRetry: () => void;
  onDismiss: () => void;
}

// Matches ChatScreen message-sync ribbons (syncMessagesButton / syncingRibbon /
// syncFailedRibbon) so plan coach-check feels consistent with chat.
export const PlanRemoteSyncBanner: React.FC<PlanRemoteSyncBannerProps> = ({
  status,
  onRetry,
  onDismiss,
}) => {
  const { t } = useTranslation(['plan']);

  const message =
    status === 'checking'
      ? t('plan:coachCheckChecking')
      : status === 'success'
      ? t('plan:coachCheckUpToDate')
      : t('plan:coachCheckFailed');

  const containerStyle =
    status === 'checking'
      ? styles.syncingRibbon
      : status === 'success'
      ? styles.successRibbon
      : styles.syncFailedRibbon;

  const textStyle =
    status === 'checking'
      ? styles.syncingRibbonText
      : status === 'success'
      ? styles.successRibbonText
      : styles.failedRibbonText;

  return (
    <View style={[styles.baseRibbon, containerStyle]}>
      {status === 'checking' ? (
        <ActivityIndicator
          size="small"
          color="rgba(91, 155, 213, 0.55)"
          style={styles.leadingIcon}
        />
      ) : (
        <View style={styles.leadingIcon}>
          <Icon
            source={appIcons.refresh}
            width={11}
            height={11}
            fill={
              status === 'success'
                ? 'rgba(79, 174, 138, 0.55)'
                : 'rgba(224, 164, 88, 0.55)'
            }
          />
        </View>
      )}

      <Text style={[styles.syncRibbonText, textStyle]} numberOfLines={1}>
        {message}
      </Text>

      <View style={styles.trailingActions}>
        {status === 'failed' && (
          <TouchableOpacity
            onPress={onRetry}
            style={styles.syncRetryButton}
            accessibilityRole="button"
            accessibilityLabel={t('plan:coachCheckRetry')}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.syncRetryButtonText}>{t('plan:coachCheckRetry')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={onDismiss}
          style={styles.dismissButton}
          accessibilityRole="button"
          accessibilityLabel={t('plan:coachCheckDismiss')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon
            source={appIcons.close}
            width={11}
            height={11}
            fill="rgba(255, 255, 255, 0.38)"
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  baseRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 24,
  },
  syncingRibbon: {
    backgroundColor: 'rgba(91, 155, 213, 0.07)',
    borderBottomColor: 'rgba(91, 155, 213, 0.14)',
  },
  successRibbon: {
    backgroundColor: 'rgba(79, 174, 138, 0.07)',
    borderBottomColor: 'rgba(79, 174, 138, 0.14)',
  },
  syncFailedRibbon: {
    backgroundColor: 'rgba(224, 164, 88, 0.07)',
    borderBottomColor: 'rgba(224, 164, 88, 0.14)',
  },
  leadingIcon: {
    width: 11,
    height: 11,
    marginRight: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncRibbonText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: Typography.fontFamily.regular,
    marginRight: 6,
  },
  syncingRibbonText: {
    color: 'rgba(154, 163, 166, 0.95)',
  },
  successRibbonText: {
    color: 'rgba(154, 163, 166, 0.95)',
  },
  failedRibbonText: {
    color: 'rgba(154, 163, 166, 0.95)',
  },
  trailingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  syncRetryButton: {
    backgroundColor: 'rgba(224, 164, 88, 0.22)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(224, 164, 88, 0.28)',
    justifyContent: 'center',
  },
  syncRetryButtonText: {
    color: 'rgba(224, 164, 88, 0.85)',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Typography.fontFamily.semiBold,
  },
  dismissButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
