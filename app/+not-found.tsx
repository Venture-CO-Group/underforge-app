import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { i18n } from '../lib/i18n';

function NotFoundContent() {
  const { t } = useTranslation(['root']);

  return (
    <>
      <Stack.Screen options={{ title: t('root:notFoundTitle') }} />
      <ThemedView style={styles.container}>
        <ThemedText type="title">{t('root:notFoundBody')}</ThemedText>
        <Link href="/" style={styles.link}>
          <ThemedText type="link">{t('root:notFoundLink')}</ThemedText>
        </Link>
      </ThemedView>
    </>
  );
}

export default function NotFoundScreen() {
  return (
    <I18nextProvider i18n={i18n}>
      <NotFoundContent />
    </I18nextProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
