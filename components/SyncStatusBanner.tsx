import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getPendingProfile, retryProfileSync } from '../lib/sync-status';

interface SyncStatusBannerProps {
  syncStatus: 'idle' | 'syncing' | 'success' | 'failed';
  onStatusChange: (status: 'idle' | 'syncing' | 'success' | 'failed') => void;
}

export const SyncStatusBanner: React.FC<SyncStatusBannerProps> = ({
  syncStatus,
  onStatusChange
}) => {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['sync']);

  // Auto-dismiss success after 2 seconds
  useEffect(() => {
    if (syncStatus === 'success') {
      const timer = setTimeout(() => {
        onStatusChange('idle');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [syncStatus, onStatusChange]);

  const handleRetry = async () => {
    const pendingProfile = await getPendingProfile();
    if (pendingProfile) {
      await retryProfileSync(pendingProfile, onStatusChange);
    }
  };

  if (syncStatus === 'idle') {
    return null;
  }

  const getBannerStyle = () => {
    switch (syncStatus) {
      case 'syncing':
        return styles.syncingBanner;
      case 'success':
        return styles.successBanner;
      case 'failed':
        return styles.failedBanner;
      default:
        return styles.syncingBanner;
    }
  };

  const getText = () => {
    switch (syncStatus) {
      case 'syncing':
        return t('sync:syncing');
      case 'success':
        return t('sync:success');
      case 'failed':
        return t('sync:failed');
      default:
        return '';
    }
  };

  return (
    <View style={[styles.banner, getBannerStyle(), { paddingTop: insets.top }]}>
      <Text style={styles.text}>{getText()}</Text>
      {syncStatus === 'failed' && (
        <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>{t('sync:retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1000,
  },
  syncingBanner: {
    backgroundColor: '#5B9BD5',
  },
  successBanner: {
    backgroundColor: '#4FAE8A',
  },
  failedBanner: {
    backgroundColor: '#C65B5B',
  },
  text: {
    color: '#0B1114',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  retryButton: {
    marginLeft: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(11, 17, 20, 0.2)',
    borderRadius: 6,
  },
  retryText: {
    color: '#0B1114',
    fontSize: 12,
    fontWeight: '600',
  },
});

