import React from 'react';
import {
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { Icon } from './Icon';

export const CommunityScreen: React.FC = () => {
  const { t } = useTranslation('menu');
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('community.title')}</Text>
        <Text style={styles.subtitle}>{t('community.subtitle')}</Text>
        <View style={styles.placeholder}>
          <Icon source={appIcons.communities} width={48} height={48} fill="#F47C3C" />
          <Text style={styles.placeholderTitle}>{t('community.hubTitle')}</Text>
          <Text style={styles.placeholderDesc}>{t('community.hubDescription')}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  content: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9AA3A6',
    marginBottom: 32,
  },
  placeholder: {
    backgroundColor: '#0B1114',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#F47C3C',
  },
  placeholderText: {
    fontSize: 48,
    marginBottom: 16,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  placeholderDesc: {
    fontSize: 14,
    color: '#6F7A7E',
    textAlign: 'center',
  },
});
