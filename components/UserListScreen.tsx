import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { glowLogger } from '../lib/glow-logger';
import { onboardingEvents } from '../lib/supabase_db';
import { getAllUserProfiles } from '../lib/supabase_db_new';
import { UserProfile } from '../types/user_profile';
import { UserDetailScreen } from './UserDetailScreen';

interface UserListScreenProps {
  onBack: () => void;
}

type ActiveFilter = 'all' | 'active' | 'inactive';
type DeviceFilter = 'all' | 'ios_device' | 'ios_simulator';

export const UserListScreen: React.FC<UserListScreenProps> = ({ onBack }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all');

  useEffect(() => {
    loadUsers();
    
    // Listen for onboarding data changes to refresh user list
    const handleOnboardingDataChanged = () => {
      loadUsers();
    };

    onboardingEvents.on('onboardingDataChanged', handleOnboardingDataChanged);

    return () => {
      onboardingEvents.off('onboardingDataChanged', handleOnboardingDataChanged);
    };
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const userProfiles = await getAllUserProfiles();
      setUsers(userProfiles);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load users';
      setError(errorMessage);
      glowLogger.error('Failed to load users in UserListScreen', { error: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  const handleUserPress = (user: UserProfile) => {
    setSelectedUser(user);
  };

  const filteredUsers = users.filter(user => {
    // Filter by active status
    if (activeFilter === 'active' && !user.active) return false;
    if (activeFilter === 'inactive' && user.active) return false;
    
    // Filter by device type
    if (deviceFilter !== 'all' && user.device_type !== deviceFilter) return false;
    
    return true;
  });

  const renderFilterButton = (
    label: string, 
    isSelected: boolean, 
    onPress: () => void
  ) => (
    <TouchableOpacity 
      style={[styles.filterButton, isSelected && styles.filterButtonSelected]}
      onPress={onPress}
    >
      <Text style={[styles.filterButtonText, isSelected && styles.filterButtonTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  if (selectedUser) {
    return (
      <UserDetailScreen 
        userProfile={selectedUser} 
        onBack={() => setSelectedUser(null)} 
      />
    );
  }

  const renderUserItem = ({ item }: { item: UserProfile }) => (
    <TouchableOpacity 
      style={styles.userItem}
      onPress={() => handleUserPress(item)}
    >
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.display_name || 'No Name'}</Text>
        <Text style={styles.userId}>ID: {item.user_id}</Text>
        <Text style={styles.userDetails}>
          {item.device_type} • {item.active ? 'Active' : 'Inactive'}
        </Text>
        {item.created_at && (
          <Text style={styles.userDate}>
            Created: {new Date(item.created_at).toLocaleDateString()}
          </Text>
        )}
      </View>
      <View style={styles.rightSection}>
        <View style={styles.statusIndicator}>
          <View style={[styles.statusDot, { backgroundColor: item.active ? '#4FAE8A' : '#8E8E93' }]} />
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Users</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.filterContainer}>
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Status:</Text>
          <View style={styles.filterButtons}>
            {renderFilterButton('All', activeFilter === 'all', () => setActiveFilter('all'))}
            {renderFilterButton('Active', activeFilter === 'active', () => setActiveFilter('active'))}
            {renderFilterButton('Inactive', activeFilter === 'inactive', () => setActiveFilter('inactive'))}
          </View>
        </View>
        
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>Device:</Text>
          <View style={styles.filterButtons}>
            {renderFilterButton('All', deviceFilter === 'all', () => setDeviceFilter('all'))}
            {renderFilterButton('Device', deviceFilter === 'ios_device', () => setDeviceFilter('ios_device'))}
            {renderFilterButton('Simulator', deviceFilter === 'ios_simulator', () => setDeviceFilter('ios_simulator'))}
          </View>
        </View>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#F47C3C" />
            <Text style={styles.loadingText}>Loading users...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
            <TouchableOpacity onPress={loadUsers} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filteredUsers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {users.length === 0 ? 'No users found' : 'No users match the selected filters'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            renderItem={renderUserItem}
            keyExtractor={(item) => item.user_id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
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
  headerRight: {
    width: 60,
  },
  filterContainer: {
    backgroundColor: '#0E1A1A',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  filterSection: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  filterButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#C6C6C8',
  },
  filterButtonSelected: {
    backgroundColor: '#F47C3C',
    borderColor: '#F47C3C',
  },
  filterButtonText: {
    fontSize: 14,
    color: '#9AA3A6',
    fontWeight: '500',
  },
  filterButtonTextSelected: {
    color: '#fff',
  },
  content: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#9AA3A6',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#C65B5B',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#F47C3C',
    paddingHorizontal: 24,
    paddingVertical: 12,
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
  },
  emptyText: {
    fontSize: 16,
    color: '#9AA3A6',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  userItem: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  userId: {
    fontSize: 13,
    color: '#9AA3A6',
    marginBottom: 4,
  },
  userDetails: {
    fontSize: 13,
    color: '#9AA3A6',
    marginBottom: 2,
  },
  userDate: {
    fontSize: 12,
    color: '#9AA3A6',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  statusIndicator: {
    marginRight: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chevron: {
    fontSize: 17,
    color: '#C6C6C8',
    fontWeight: '400',
  },
});
