/**
 * Open Source Licenses — minimal attributions (copyright + license id per package;
 * standard license text once per SPDX id). Data: assets/licenses.json.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

const { notices, packages } = require('../assets/licenses.json') as {
  notices: Record<string, string>;
  packages: { n: string; l: string; c?: string }[];
};

interface LicensesScreenProps {
  visible: boolean;
  onClose: () => void;
}

export const LicensesScreen: React.FC<LicensesScreenProps> = ({ visible, onClose }) => {
  const { t } = useTranslation(['menu', 'common']);

  if (!visible) return null;

  const noticeIds = Object.keys(notices).sort();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('common:back', { defaultValue: 'Back' })}
        >
          <Text style={styles.backButtonText}>‹ {t('common:back', { defaultValue: 'Back' })}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {t('menu:licenses.title', { defaultValue: 'Licenses' })}
        </Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        {packages.map((pkg, index) => (
          <Text key={`${pkg.n}-${index}`} style={styles.line}>
            {pkg.n} ({pkg.l}){pkg.c ? `\n${pkg.c}` : ''}
          </Text>
        ))}

        {noticeIds.length > 0 ? (
          <View style={styles.noticesBlock}>
            {noticeIds.map((id) => (
              <View key={id} style={styles.notice}>
                <Text style={styles.noticeTitle}>{id}</Text>
                <Text style={styles.noticeBody}>{notices[id]}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flex: 1,
    backgroundColor: '#0B1114',
    zIndex: 2000,
    // Above HamburgerMenu bottom sheet (elevation 12) so Android delivers scroll gestures here.
    elevation: 21,
  },
  scroll: {
    flex: 1,
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
    fontSize: 15,
    fontWeight: '600',
    color: '#C5CDD0',
  },
  headerRight: {
    minWidth: 44,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 40,
  },
  line: {
    fontSize: 12,
    lineHeight: 18,
    color: '#9AA3A6',
    marginBottom: 10,
  },
  noticesBlock: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#243035',
  },
  notice: {
    marginBottom: 20,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  noticeBody: {
    fontSize: 11,
    lineHeight: 16,
    color: '#8C979B',
  },
});
