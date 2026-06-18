import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LineHeight, LetterSpacing } from '../constants/Typography';
import { appIcons } from '../assets/icons';
import { useTranslation } from 'react-i18next';

const SUPPORT_EMAIL = 'support@underforge.app';

const WarningIcon = appIcons.warning;

export default function AccountDeactivatedScreen() {
  const { t } = useTranslation(['account']);
  const handleContactSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Account%20Deactivated%20-%20Help%20Request`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <WarningIcon width={48} height={48} fill={BrandColors.warning} />
        </View>

        {/* Title */}
        <Text style={styles.title}>{t('account:deactivatedTitle')}</Text>

        {/* Message */}
        <Text style={styles.message}>
          {t('account:deactivatedBody')}
        </Text>

        {/* Support Button */}
        <TouchableOpacity style={styles.supportButton} onPress={handleContactSupport}>
          <Text style={styles.supportButtonText}>{t('account:contactSupport')}</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{SUPPORT_EMAIL}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BrandColors.backgroundPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 340,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: BrandColors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: FontFamily.displayBold,
    fontSize: FontSize.sectionHeadline,
    lineHeight: LineHeight.sectionHeadline,
    letterSpacing: LetterSpacing.tight,
    color: BrandColors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    color: BrandColors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  supportButton: {
    backgroundColor: BrandColors.accent,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    minWidth: 200,
  },
  supportButtonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.button,
    letterSpacing: LetterSpacing.wide,
    color: BrandColors.textPrimary,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
  },
  footerText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    color: BrandColors.textTertiary,
  },
});
