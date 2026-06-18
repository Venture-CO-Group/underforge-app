import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily } from '../constants/Typography';
import { LANGUAGE_KEYS } from '../lib/i18n';

export type SupportedLanguage = typeof LANGUAGE_KEYS[keyof typeof LANGUAGE_KEYS];

interface LanguageSelectionScreenProps {
  onSelectLanguage: (language: SupportedLanguage) => void;
}

export const LanguageSelectionScreen: React.FC<LanguageSelectionScreenProps> = ({
  onSelectLanguage,
}) => {
  const { t } = useTranslation(['language', 'common']);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#0F1C1C', '#0B1114', '#0B1114']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Subtle orange glow at top */}
      <View style={[styles.glowOrb, { top: insets.top + 20 }]} />

      <View style={[styles.inner, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }]}>

        {/* Brand + heading */}
        <View style={styles.headerSection}>
          <Text style={styles.wordmark}>UNDERFORGE</Text>
          <Text style={styles.title}>{t('language:screenTitle')}</Text>
          <Text style={styles.description}>{t('language:description')}</Text>
        </View>

        {/* Language cards */}
        <View style={styles.cardStack}>
          <LanguageCard
            flag="🇺🇸"
            title={t('language:englishTitle')}
            subtitle={t('language:englishSubtitle')}
            onPress={() => onSelectLanguage(LANGUAGE_KEYS.ENGLISH)}
          />
          <LanguageCard
            flag="🇲🇽"
            title={t('language:spanishTitle')}
            subtitle={t('language:spanishSubtitle')}
            onPress={() => onSelectLanguage(LANGUAGE_KEYS.SPANISH)}
          />
        </View>

      </View>
    </View>
  );
};

interface LanguageCardProps {
  flag: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

const LanguageCard: React.FC<LanguageCardProps> = ({ flag, title, subtitle, onPress }) => (
  <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={onPress}>
    <LinearGradient
      colors={['#162222', '#111B1B']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={styles.cardInner}>
      <Text style={styles.flag}>{flag}</Text>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.chevronWrapper}>
        <Text style={styles.chevron}>›</Text>
      </View>
    </View>
    {/* Bottom accent line */}
    <View style={styles.cardAccent} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  glowOrb: {
    position: 'absolute',
    alignSelf: 'center',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(244, 124, 60, 0.06)',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  headerSection: {
    marginBottom: 40,
  },
  wordmark: {
    fontFamily: FontFamily.bodyBold,
    fontSize: 11,
    letterSpacing: 4,
    color: '#F47C3C',
    marginBottom: 20,
  },
  title: {
    fontFamily: FontFamily.displayBold,
    fontSize: 32,
    color: '#F2F2EE',
    lineHeight: 40,
    marginBottom: 10,
  },
  description: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 15,
    color: '#6F7A7E',
    lineHeight: 22,
  },
  cardStack: {
    gap: 14,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E2C2C',
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 22,
  },
  flag: {
    fontSize: 36,
    marginRight: 18,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 18,
    color: '#F2F2EE',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 13,
    color: '#6F7A7E',
    lineHeight: 18,
  },
  chevronWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(244,124,60,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    fontSize: 18,
    color: '#F47C3C',
    lineHeight: 20,
    marginTop: -1,
  },
  cardAccent: {
    height: 1,
    backgroundColor: 'rgba(244,124,60,0.15)',
    marginHorizontal: 20,
    marginBottom: 12,
  },
});
