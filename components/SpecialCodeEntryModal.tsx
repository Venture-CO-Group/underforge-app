import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily } from '../constants/Typography';
import { validateSpecialCode, ValidatedSpecialCode } from '../lib/supabase_db_new';

interface SpecialCodeEntryModalProps {
  visible: boolean;
  onClose: () => void;
  onValidated: (result: ValidatedSpecialCode) => void;
}

export default function SpecialCodeEntryModal({
  visible,
  onClose,
  onValidated,
}: SpecialCodeEntryModalProps) {
  const { t } = useTranslation(['specialCode', 'common']);
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [visible]);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const result = await validateSpecialCode(trimmed);
      if (!result) {
        setError(t('specialCode:invalid'));
        return;
      }
      onValidated(result);
    } catch {
      setError(t('specialCode:networkError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.content, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 24) }]}>
          <Text style={styles.title}>{t('specialCode:modalTitle')}</Text>

          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(text) => {
              setCode(text);
              if (error) setError(null);
            }}
            placeholder={t('specialCode:placeholder')}
            placeholderTextColor="#6B7280"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            editable={!isSubmitting}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.primaryButton, (!code.trim() || isSubmitting) && styles.primaryButtonDisabled]}
            onPress={handleSubmit}
            disabled={!code.trim() || isSubmitting}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{t('specialCode:submit')}</Text>
            )}
          </TouchableOpacity>

          <Pressable
            style={styles.cancelButton}
            onPress={onClose}
            disabled={isSubmitting}
            accessibilityRole="button"
          >
            <Text style={styles.cancelButtonText}>{t('specialCode:cancel')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    fontFamily: FontFamily.displayBold,
    fontSize: 28,
    color: '#F2F2EE',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#151D22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: '#F2F2EE',
    minHeight: 48,
    marginBottom: 12,
  },
  errorText: {
    color: '#F87171',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#F47C3C',
    borderRadius: 24,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  cancelButtonText: {
    color: '#9AA3A6',
    fontSize: 15,
    fontWeight: '500',
  },
});
