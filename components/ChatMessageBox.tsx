import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Path } from 'react-native-svg';
import { appIcons } from '../assets/icons';
import { Icon } from './Icon';

interface ChatMessageBoxProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  coachTyping?: boolean;
  placeholder?: string;
  maxLength?: number;
  initialText?: string;
  onOpenMealLogModal?: () => void;
}

export default function ChatMessageBox({
  onSend,
  disabled = false,
  coachTyping = false,
  placeholder = 'Type your message...',
  maxLength = 2000,
  initialText = '',
  onOpenMealLogModal,
}: ChatMessageBoxProps) {
  const { t } = useTranslation(['chat']);
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (initialText) {
      setText(initialText);
    }
  }, [initialText]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || coachTyping) return;
    onSend(trimmed);
    setText('');
    Keyboard.dismiss();
  }, [text, disabled, coachTyping, onSend]);

  return (
    <View style={styles.inputContainer}>
      <TextInput
        style={styles.textInput}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor="#6F7A7E"
        multiline={true}
        maxLength={maxLength}
        onSubmitEditing={handleSend}
        returnKeyType="send"
        blurOnSubmit={false}
        enablesReturnKeyAutomatically={true}
        editable={!disabled && !coachTyping}
        autoFocus={true}
        textAlignVertical="center"
      />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Log meal"
        style={styles.cameraButton}
        onPress={() => {
          if (onOpenMealLogModal) {
            onOpenMealLogModal();
          }
        }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Icon source={appIcons.camera} width={20} height={20} fill="#F47C3C" />
        <Text style={styles.cameraText}>{t('chat:logMealButton')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Send message"
        style={[
          styles.sendButton,
          ((!text.trim()) || disabled || coachTyping) && styles.sendButtonDisabled
        ]}
        onPress={handleSend}
        disabled={!text.trim() || disabled || coachTyping}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Svg width={44} height={44} viewBox="0 0 64 64">
          <Circle cx="32" cy="32" r="30" fill="#F47C3C" />
          <Path fill="#0B1114" d="M20 18 L50 32 L20 46 L24 36 L36 32 L24 28 Z" />
        </Svg>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1A2426',
    zIndex: 1000,
    elevation: 8,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A3638',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#141E1E',
    marginRight: 10,
    color: '#F2F2EE',
  },
  cameraButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  cameraEmoji: {
    fontSize: 18,
  },
  cameraText: {
    fontSize: 10,
    color: '#F47C3C',
    fontWeight: '500',
    marginTop: 3,
  },
  sendButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.3,
  },
});
