import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { getUsersWithRecentChatMessages, getUsersWithRecentCheckins, getUsersWithRecentOnboardings, UserRecentChatMessages, UserRecentCheckins } from '../lib/supabase_db_new';
import { UserProfile } from '../types/user_profile';
import { UserDetailScreen } from './UserDetailScreen';

interface Props {
  onBack: () => void;
}

export const CoachDashboardRecentActivity: React.FC<Props> = ({ onBack }) => {
  const [hours, setHours] = useState('24');
  const [chatUsers, setChatUsers] = useState<UserRecentChatMessages[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [checkinUsers, setCheckinUsers] = useState<UserRecentCheckins[]>([]);
  const [loadingCheckins, setLoadingCheckins] = useState(false);
  const [checkinsError, setCheckinsError] = useState<string | null>(null);
  const [onboardingUsers, setOnboardingUsers] = useState<UserProfile[]>([]);
  const [loadingOnboardings, setLoadingOnboardings] = useState(false);
  const [onboardingsError, setOnboardingsError] = useState<string | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchChatUsers = async (hrs: number) => {
    try {
      setLoadingChat(true);
      setChatError(null);
      const data = await getUsersWithRecentChatMessages(hrs);
      setChatUsers(data);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingChat(false);
    }
  };

  const fetchCheckinUsers = async (hrs: number) => {
    try {
      setLoadingCheckins(true);
      setCheckinsError(null);
      const data = await getUsersWithRecentCheckins(hrs);
      setCheckinUsers(data);
    } catch (e) {
      setCheckinsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingCheckins(false);
    }
  };

  const fetchOnboardingUsers = async (hrs: number) => {
    try {
      setLoadingOnboardings(true);
      setOnboardingsError(null);
      const data = await getUsersWithRecentOnboardings(hrs);
      setOnboardingUsers(data);
    } catch (e) {
      setOnboardingsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingOnboardings(false);
    }
  };

  // Debounce fetch when hours changes
  useEffect(() => {
    const parsed = parseInt(hours, 10);
    const validHours = !isNaN(parsed) && parsed > 0 ? parsed : 24;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchChatUsers(validHours);
      fetchCheckinUsers(validHours);
      fetchOnboardingUsers(validHours);
    }, 500);
  }, [hours]);

  // Initial load
  useEffect(() => {
    fetchChatUsers(24);
    fetchCheckinUsers(24);
    fetchOnboardingUsers(24);
  }, []);

  if (selectedUser) {
    return (
      <UserDetailScreen
        userProfile={selectedUser}
        onBack={() => setSelectedUser(null)}
      />
    );
  }

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Recent Activity</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.timeRangeContainer}>
          <Text style={styles.timeRangeText}>Last</Text>
          <TextInput
            style={styles.hoursInput}
            value={hours}
            onChangeText={setHours}
            keyboardType="number-pad"
          />
          <Text style={styles.timeRangeText}>Hours</Text>
        </View>

        <Text style={styles.sectionTitle}>Chat Messages</Text>
        {loadingChat && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color="#F47C3C" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}
        {chatError && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>Error: {chatError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => {
              const parsed = parseInt(hours, 10);
              fetchChatUsers(!isNaN(parsed) && parsed > 0 ? parsed : 24);
            }}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loadingChat && !chatError && chatUsers.length === 0 && (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>No recent user messages</Text>
          </View>
        )}
        {!loadingChat && !chatError && chatUsers.map(u => (
          <TouchableOpacity 
            key={`chat-${u.userProfile.user_id}`}
            style={styles.row}
            onPress={() => setSelectedUser(u.userProfile)}
          >
            <Text style={styles.rowText}>{`${u.userProfile.display_name || 'No Name'} (${u.messageCount})`}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}

        {/* Checkins Section (wired up) */}
        <Text style={styles.sectionTitle}>Checkins</Text>
        {loadingCheckins && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color="#F47C3C" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}
        {checkinsError && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>Error: {checkinsError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => {
              const parsed = parseInt(hours, 10);
              fetchCheckinUsers(!isNaN(parsed) && parsed > 0 ? parsed : 24);
            }}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loadingCheckins && !checkinsError && checkinUsers.length === 0 && (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>No recent checkins</Text>
          </View>
        )}
        {!loadingCheckins && !checkinsError && checkinUsers.map(u => (
          <TouchableOpacity 
            key={`checkin-${u.userProfile.user_id}`}
            style={styles.row}
            onPress={() => setSelectedUser(u.userProfile)}
          >
            <Text style={styles.rowText}>{`${u.userProfile.display_name || 'No Name'} (${u.checkinCount})`}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}

        {/* Onboardings (wired) */}
        <Text style={styles.sectionTitle}>Onboardings</Text>
        {loadingOnboardings && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color="#F47C3C" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        )}
        {onboardingsError && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>Error: {onboardingsError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => {
              const parsed = parseInt(hours, 10);
              fetchOnboardingUsers(!isNaN(parsed) && parsed > 0 ? parsed : 24);
            }}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loadingOnboardings && !onboardingsError && onboardingUsers.length === 0 && (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>No recent onboardings</Text>
          </View>
        )}
        {!loadingOnboardings && !onboardingsError && onboardingUsers.map(u => (
          <TouchableOpacity 
            key={`onboard-${u.user_id}`}
            style={styles.row}
            onPress={() => setSelectedUser(u)}
          >
            <Text style={styles.rowText}>{u.display_name || 'No Name'}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  headerRight: { width: 60 },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: '#F2F2F7',
  },
  timeRangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    justifyContent: 'center',
    gap: 12,
  },
  timeRangeText: {
    fontSize: 16,
    color: '#F2F2EE',
  },
  hoursInput: {
    minWidth: 60,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    fontSize: 16,
    textAlign: 'center',
    color: '#F2F2EE'
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 12,
    marginTop: 8,
  },
  row: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: {
    fontSize: 17,
    color: '#F2F2EE',
  },
  chevron: {
    fontSize: 17,
    color: '#C6C6C8',
  },
  loadingBlock: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  loadingText: {
    fontSize: 15,
    color: '#9AA3A6'
  },
  errorBlock: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14
  },
  errorText: {
    fontSize: 15,
    color: '#C65B5B',
    marginBottom: 8
  },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#F47C3C',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500'
  },
  emptyBlock: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14
  },
  emptyText: {
    fontSize: 15,
    color: '#9AA3A6'
  }
});
