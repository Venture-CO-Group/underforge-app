import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { getChatMessages } from '../lib/supabase_db_new';
import { ChatMessage } from '../types/chat';
import { UserProfile } from '../types/user_profile';
import { Icon } from './Icon';

interface ChatMessagesScreenProps {
  userProfile: UserProfile;
  onBack: () => void;
}

export const ChatMessagesScreen: React.FC<ChatMessagesScreenProps> = ({
  userProfile,
  onBack
}) => {
  const { t } = useTranslation(['chat', 'common']);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalMessageCount, setTotalMessageCount] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadChatMessages();
  }, [userProfile.user_id]);

  // Auto-scroll to bottom after messages are loaded
  useEffect(() => {
    if (!loading && chatMessages.length > 0 && scrollViewRef.current) {
      // Use a small delay to ensure the content has rendered
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [loading, chatMessages.length]);

  const loadChatMessages = async () => {
    try {
      setLoading(true);
      setError(null);
      const messages = await getChatMessages(userProfile.user_id);
      const totalCount = messages.length;
      // Show only the most recent 500 messages
      const recentMessages = messages.slice(-500);
      setChatMessages(recentMessages);
      setTotalMessageCount(totalCount);
    } catch (err) {
      console.error('Error loading chat messages:', err);
      setError(t('chat:chatMessagesLoadError'));
    } finally {
      setLoading(false);
    }
  };

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

  const copyAllMessages = async () => {
    try {
      const allMessagesText = chatMessages
        .map(message => `${getSenderDisplayName(message.sender)} (${formatTimestamp(message.timestamp)}): ${message.text}`)
        .join('\n\n');
      await Clipboard.setString(allMessagesText);
      Alert.alert(t('chat:messageCopiedTitle'), t('chat:messagesCopiedBody'));
    } catch (error) {
      console.error('Error copying all messages:', error);
      Alert.alert(t('common:error'), t('chat:messagesCopyFailed'));
    }
  };

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ {t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <TouchableOpacity onLongPress={copyAllMessages}>
            <Text style={styles.headerTitle}>{t('chat:chatMessagesTitle')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerSubtitle}>{userProfile.display_name}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F47C3C" />
          <Text style={styles.loadingText}>{t('chat:chatMessagesLoading')}</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadChatMessages}>
            <Text style={styles.retryButtonText}>{t('chat:chatMessagesRetry')}</Text>
          </TouchableOpacity>
        </View>
      ) : chatMessages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('chat:chatMessagesEmpty')}</Text>
        </View>
      ) : (
        <ScrollView 
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 10,
          }}
        >
          {/* Warning when more than 500 messages exist */}
          {totalMessageCount > 500 && (
            <View style={styles.messageWarningContainer}>
              <Text style={styles.messageWarningText}>
                {t('chat:chatMessagesWarningTruncated', { total: totalMessageCount })}
              </Text>
            </View>
          )}
          
          {chatMessages.map((message) => (
            <View key={message.id} style={styles.messageGroup}>
              <TouchableOpacity
                onLongPress={() => copyMessage(message)}
                style={[
                  styles.messageBubble,
                  isUserMessage(message.sender) ? styles.userMessage : styles.coachMessage
                ]}
              >
                <Text style={[
                  styles.messageText,
                  isUserMessage(message.sender) ? styles.userMessageText : styles.coachMessageText
                ]}>
                  {message.text}
                </Text>
              </TouchableOpacity>
              <View style={[
                styles.messageInfo,
                isUserMessage(message.sender) ? styles.userMessageInfo : styles.coachMessageInfo
              ]}>
                <Text style={styles.messageTime}>
                  {formatTimestamp(message.timestamp)}
                </Text>
                {!isUserMessage(message.sender) && (
                  <View style={styles.senderInfo}>
                    {getSenderIcon(message.sender)}
                    <Text style={styles.messageSender}>
                      {getSenderDisplayName(message.sender)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </>
  );
};

const styles = StyleSheet.create({
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
    marginTop: 2,
  },
  headerRight: {
    width: 60,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9AA3A6',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#C65B5B',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#F47C3C',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  emptyText: {
    fontSize: 16,
    color: '#9AA3A6',
    textAlign: 'center',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  messageGroup: {
    marginBottom: 16,
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    marginBottom: 4,
  },
  userMessage: {
    backgroundColor: '#F47C3C',
    alignSelf: 'flex-end',
  },
  coachMessage: {
    backgroundColor: '#0E1A1A',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#fff',
  },
  coachMessageText: {
    color: '#F2F2EE',
  },
  messageInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userMessageInfo: {
    justifyContent: 'flex-end',
  },
  coachMessageInfo: {
    justifyContent: 'flex-start',
  },
  messageTime: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  senderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  senderIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  messageSender: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  messageWarningContainer: {
    backgroundColor: '#FFF3CD',
    borderColor: '#FFEAA7',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    marginHorizontal: 4,
  },
  messageWarningText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
    lineHeight: 18,
  },
});
