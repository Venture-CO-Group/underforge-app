import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { glowLogger } from '../lib/glow-logger';
import { getChatMessages } from '../lib/supabase_db_new';
import { ChatMessage } from '../types/chat';
import { UserProfile } from '../types/user_profile';
import { Icon } from './Icon';

interface SendMessageScreenProps {
  userProfile: UserProfile;
  onBack: () => void;
}

export const SendMessageScreen: React.FC<SendMessageScreenProps> = ({
  userProfile,
  onBack
}) => {
  const { t } = useTranslation(['chat', 'common']);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [totalMessageCount, setTotalMessageCount] = useState<number>(0);

  useEffect(() => {
    loadChatMessages();
  }, [userProfile.user_id]);

  const loadChatMessages = async () => {
    try {
      setLoadingMessages(true);
      setMessagesError(null);
      const messages = await getChatMessages(userProfile.user_id);
      const totalCount = messages.length;
      // Reverse to show most recent messages first, then take only the most recent 100
      const recentMessages = messages.reverse().slice(0, 100);
      setChatMessages(recentMessages);
      setTotalMessageCount(totalCount);
    } catch (err) {
      console.error('Error loading chat messages:', err);
      setMessagesError(t('chat:chatMessagesLoadError'));
    } finally {
      setLoadingMessages(false);
    }
  };

  // Calculate current payload size
  const getCurrentPayloadSize = () => {
    const message = {
      to: userProfile.expoPushToken || 'ExponentPushToken[placeholder]',
      sound: 'default',
      title: subject.trim(),
      body: body.trim(),
      data: { 
        sender: 'human_coach',
        recipient_user_id: userProfile.user_id,
        sent_at: new Date().toISOString()
      },
    };
    return new Blob([JSON.stringify(message)]).size;
  };

  const currentPayloadSize = getCurrentPayloadSize();
  const isPayloadTooLarge = currentPayloadSize > 4096;

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      });
    }
  };

  const getSenderDisplayName = (sender: string) => {
    switch (sender) {
      case 'user':
        return userProfile.display_name || t('chat:senderUserFallback');
      case 'coach':
      case 'ai_coach':
        return t('chat:senderAiCoach');
      case 'human_coach':
        return t('chat:senderHumanCoach');
      default:
        return sender;
    }
  };

  const getSenderIcon = (sender: string) => {
    switch (sender) {
      case 'coach':
      case 'ai_coach':
        return <Icon source={appIcons.robot} width={14} height={14} fill="#F47C3C" />;
      case 'human_coach':
        return <Icon source={appIcons.person} width={14} height={14} fill="#F47C3C" />;
      default:
        return null;
    }
  };

  const isUserMessage = (sender: string) => sender === 'user';

  const copyMessage = async (message: ChatMessage) => {
    try {
      const messageText = `${getSenderDisplayName(message.sender)}: ${message.text}`;
      await Clipboard.setString(messageText);
      Alert.alert(t('chat:messageCopiedTitle'), t('chat:messageCopiedBody'));
    } catch (error) {
      console.error('Error copying message:', error);
      Alert.alert(t('common:error'), t('chat:messageCopyFailed'));
    }
  };

  const handleSendMessage = async () => {
    if (!subject.trim() || !body.trim()) {
      Alert.alert(t('common:error'), t('chat:sendMessageFillSubjectBody'));
      return;
    }

    if (!userProfile.expoPushToken) {
      Alert.alert(t('common:error'), t('chat:sendMessageNoPushTokenError'));
      return;
    }

    const message = {
      to: userProfile.expoPushToken,
      sound: 'default',
      title: subject.trim(),
      body: body.trim(),
      data: { 
        sender: 'human_coach',
        recipient_user_id: userProfile.user_id,
        sent_at: new Date().toISOString()
      },
    };

    // Check payload size (4KB limit for Expo push notifications)
    const payloadSize = new Blob([JSON.stringify(message)]).size;
    if (payloadSize > 4096) {
      Alert.alert(
        t('chat:sendMessageTooLargeTitle'),
        t('chat:sendMessageTooLargeBody', { bytes: payloadSize }),
      );
      return;
    }

    setIsSending(true);

    try {

      glowLogger.info('Sending push notification', {
        recipient: userProfile.display_name || 'unknown',
        recipient_user_id: userProfile.user_id,
        recipient_device_type: userProfile.device_type,
        recipient_active: userProfile.active,
        subject: subject.trim(),
        body_length: body.trim().length,
        push_token_full: userProfile.expoPushToken,
        push_token_preview: userProfile.expoPushToken.substring(0, 20) + '...',
        data: { sender: 'human_coach' } // log sender in data dictionary
      });

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const result = await response.json();

      glowLogger.info('Push notification API response', {
        status: response.status,
        ok: response.ok,
        result: JSON.stringify(result)
      });

      if (response.ok && result.data && result.data.status === 'ok') {
        const ticketId = result.data.id;
        
        glowLogger.info('Push notification sent successfully', {
          recipient: userProfile.display_name || 'unknown',
          ticket_id: ticketId
        });

        // Check receipt after 5 seconds to verify Apple delivery status
        setTimeout(async () => {
          try {
            const receiptResponse = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ids: [ticketId] })
            });
            
            const receiptResult = await receiptResponse.json();
            
            glowLogger.info('Push notification receipt from Apple', {
              recipient: userProfile.display_name || 'unknown',
              recipient_user_id: userProfile.user_id,
              ticket_id: ticketId,
              receipt_status: receiptResult.data?.[ticketId]?.status || 'unknown',
              receipt_message: receiptResult.data?.[ticketId]?.message || 'none',
              receipt_details: JSON.stringify(receiptResult.data?.[ticketId]?.details || {}),
              full_receipt: JSON.stringify(receiptResult)
            });
          } catch (receiptError) {
            glowLogger.error('Failed to get push receipt', {
              error: receiptError instanceof Error ? receiptError.message : String(receiptError),
              ticket_id: ticketId,
              recipient: userProfile.display_name || 'unknown'
            });
          }
        }, 5000);

        Alert.alert(
          t('chat:sendMessageSentTitle'),
          t('chat:sendMessageSentBody', { name: userProfile.display_name || t('chat:sendMessageRecipientFallback') }),
          [
            {
              text: t('common:ok'),
              onPress: () => {
                // Clear form and go back
                setSubject('');
                setBody('');
                onBack();
              }
            }
          ]
        );
      } else {
        const errorMessage = result.data?.message || 
                            result.data?.details?.error || 
                            result.message || 
                            result.error || 
                            `HTTP ${response.status}: ${response.statusText}` ||
                            'Unknown error';
        throw new Error(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      glowLogger.error('Failed to send push notification', {
        error: errorMessage,
        recipient: userProfile.display_name || 'unknown',
        push_token: userProfile.expoPushToken ? userProfile.expoPushToken.substring(0, 20) + '...' : 'missing'
      });

      Alert.alert(
        t('chat:sendMessageFailedTitle'),
        t('chat:sendMessageFailedBody', { error: errorMessage }),
        [{ text: t('common:ok') }]
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>‹ {t('chat:sendMessageCancel')}</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{t('chat:sendMessageTitle')}</Text>
            <Text style={styles.headerSubtitle}>
              {t('chat:sendMessageToUser', { name: userProfile.display_name || t('chat:sendMessageRecipientFallback') })}
            </Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        <ScrollView 
          style={styles.content} 
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Recipient Info */}
          <View style={styles.recipientCard}>
            <View style={styles.recipientInfo}>
              <Text style={styles.recipientName}>{userProfile.display_name || t('chat:sendMessageRecipientNoName')}</Text>
              <Text style={styles.recipientDetails}>
                {userProfile.device_type} • {userProfile.active ? t('chat:sendMessageDeviceActive') : t('chat:sendMessageDeviceInactive')}
              </Text>
              {userProfile.expoPushToken ? (
                <Text style={styles.tokenStatus}>✓ {t('chat:sendMessagePushEnabled')}</Text>
              ) : (
                <Text style={styles.tokenStatusError}>⚠ {t('chat:sendMessageNoPushToken')}</Text>
              )}
            </View>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('chat:sendMessageSubjectLabel')}</Text>
              <TextInput
                style={styles.textInput}
                value={subject}
                onChangeText={setSubject}
                placeholder={t('chat:sendMessageSubjectPlaceholder')}
                placeholderTextColor="#6F7A7E"
                maxLength={100}
                editable={!isSending}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('chat:sendMessageBodyLabel')}</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={body}
                onChangeText={setBody}
                placeholder={t('chat:sendMessageBodyPlaceholder')}
                placeholderTextColor="#6F7A7E"
                multiline
                numberOfLines={6}
                maxLength={3600}
                textAlignVertical="top"
                editable={!isSending}
              />
              <View style={styles.counters}>
                <Text style={styles.characterCount}>
                  {t('chat:sendMessageCharCount', { current: body.length })}
                </Text>
                <Text style={[
                  styles.payloadSize, 
                  isPayloadTooLarge && styles.payloadSizeError
                ]}>
                  {t('chat:sendMessagePayloadSize', {
                    current: currentPayloadSize,
                    tooLarge: isPayloadTooLarge ? t('chat:sendMessagePayloadTooLarge') : '',
                  })}
                </Text>
              </View>
            </View>

            {/* Send Button */}
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!subject.trim() || !body.trim() || !userProfile.expoPushToken || isSending || isPayloadTooLarge) && styles.sendButtonDisabled
              ]}
              onPress={handleSendMessage}
              disabled={!subject.trim() || !body.trim() || !userProfile.expoPushToken || isSending || isPayloadTooLarge}
            >
              {isSending ? (
                <View style={styles.sendingContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.sendButtonText}>{t('chat:sendMessageSending')}</Text>
                </View>
              ) : (
                <Text style={styles.sendButtonText}>{t('chat:sendMessageCta')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Recent Messages Section */}
          <View style={styles.recentMessagesSection}>
            <Text style={styles.recentMessagesTitle}>{t('chat:sendMessageRecentTitle')}</Text>
            {loadingMessages ? (
              <View style={styles.recentMessagesLoading}>
                <ActivityIndicator size="small" color="#F47C3C" />
                <Text style={styles.recentMessagesLoadingText}>{t('chat:sendMessageLoadingRecent')}</Text>
              </View>
            ) : messagesError ? (
              <View style={styles.recentMessagesError}>
                <Text style={styles.recentMessagesErrorText}>{messagesError}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={loadChatMessages}>
                  <Text style={styles.retryButtonText}>{t('chat:chatMessagesRetry')}</Text>
                </TouchableOpacity>
              </View>
            ) : chatMessages.length === 0 ? (
              <View style={styles.recentMessagesEmpty}>
                <Text style={styles.recentMessagesEmptyText}>{t('chat:sendMessageNoRecent')}</Text>
              </View>
            ) : (
              <View style={styles.recentMessagesContainer}>
                {chatMessages.map((message) => (
                  <View key={message.id} style={styles.recentMessageGroup}>
                    <TouchableOpacity
                      onLongPress={() => copyMessage(message)}
                      style={[
                        styles.recentMessageBubble,
                        isUserMessage(message.sender) ? styles.recentUserMessage : styles.recentCoachMessage
                      ]}
                    >
                      <Text style={[
                        styles.recentMessageText,
                        isUserMessage(message.sender) ? styles.recentUserMessageText : styles.recentCoachMessageText
                      ]} numberOfLines={3}>
                        {message.text}
                      </Text>
                    </TouchableOpacity>
                    <View style={[
                      styles.recentMessageInfo,
                      isUserMessage(message.sender) ? styles.recentUserMessageInfo : styles.recentCoachMessageInfo
                    ]}>
                      <Text style={styles.recentMessageTime}>
                        {formatTimestamp(message.timestamp)}
                      </Text>
                      {!isUserMessage(message.sender) && (
                        <View style={styles.recentSenderInfo}>
                          {getSenderIcon(message.sender)}
                          <Text style={styles.recentMessageSender}>
                            {getSenderDisplayName(message.sender)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
                
                {/* Message Count Indicator */}
                {totalMessageCount > 100 && (
                  <View style={styles.messageCountIndicator}>
                    <Text style={styles.messageCountText}>
                      Only showing 100 of {totalMessageCount} messages
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '400',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9AA3A6',
  },
  headerRight: {
    width: 60,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  recipientCard: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  recipientInfo: {
    alignItems: 'center',
  },
  recipientName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  recipientDetails: {
    fontSize: 14,
    color: '#9AA3A6',
    marginBottom: 8,
  },
  tokenStatus: {
    fontSize: 13,
    color: '#4FAE8A',
    fontWeight: '500',
  },
  tokenStatusError: {
    fontSize: 13,
    color: '#C65B5B',
    fontWeight: '500',
  },
  formSection: {
    flex: 1,
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#F2F2EE',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  textArea: {
    height: 120,
    paddingTop: 16,
  },
  counters: {
    flexDirection: 'column',
    marginTop: 4,
  },
  characterCount: {
    fontSize: 12,
    color: '#9AA3A6',
    textAlign: 'right',
  },
  payloadSize: {
    fontSize: 12,
    color: '#9AA3A6',
    textAlign: 'right',
    marginTop: 2,
  },
  payloadSizeError: {
    color: '#C65B5B',
    fontWeight: '600',
  },
  sendButton: {
    backgroundColor: '#F47C3C',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  sendButtonDisabled: {
    backgroundColor: '#C6C6C8',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  sendingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Recent Messages Styles
  recentMessagesSection: {
    marginTop: 24,
    marginBottom: 16,
  },
  recentMessagesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 16,
  },
  recentMessagesLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  recentMessagesLoadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#9AA3A6',
  },
  recentMessagesError: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  recentMessagesErrorText: {
    fontSize: 14,
    color: '#C65B5B',
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#F47C3C',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  recentMessagesEmpty: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  recentMessagesEmptyText: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
  },
  recentMessagesContainer: {
    // Remove maxHeight to allow full scrolling
  },
  recentMessageGroup: {
    marginBottom: 12,
  },
  recentMessageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    marginBottom: 2,
  },
  recentUserMessage: {
    backgroundColor: '#F47C3C',
    alignSelf: 'flex-end',
  },
  recentCoachMessage: {
    backgroundColor: '#0E1A1A',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  recentMessageText: {
    fontSize: 14,
    lineHeight: 18,
  },
  recentUserMessageText: {
    color: '#fff',
  },
  recentCoachMessageText: {
    color: '#F2F2EE',
  },
  recentMessageInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recentUserMessageInfo: {
    justifyContent: 'flex-end',
  },
  recentCoachMessageInfo: {
    justifyContent: 'flex-start',
  },
  recentMessageTime: {
    fontSize: 11,
    color: '#9AA3A6',
  },
  recentSenderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
  },
  recentSenderIcon: {
    fontSize: 10,
    marginRight: 3,
  },
  recentMessageSender: {
    fontSize: 11,
    color: '#9AA3A6',
  },
  messageCountIndicator: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  messageCountText: {
    fontSize: 13,
    color: '#9AA3A6',
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
