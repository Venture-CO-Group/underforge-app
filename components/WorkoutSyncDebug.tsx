import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { getCurrentLoggedInUser } from '../lib/db';
import {
    clearLocalWorkoutData,
    syncFromSupabaseToLocal
} from '../lib/workout-sync-utils';

interface WorkoutSyncDebugProps {
  onDataChanged?: () => void;
}

export default function WorkoutSyncDebug({ onDataChanged }: WorkoutSyncDebugProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleResetAndSync = async () => {
    setIsLoading(true);
    try {
      const user = await getCurrentLoggedInUser();
      if (!user) {
        Alert.alert('Error', 'No user logged in');
        return;
      }

      console.log(`🔄 Reset and sync for user: ${user.id}`);

      // Delete local data
      await clearLocalWorkoutData(user.id);

      // Sync from Supabase
      await syncFromSupabaseToLocal(user.id);

      Alert.alert('Success', 'Reset and sync completed!');

      // Notify parent to refresh data
      if (onDataChanged) {
        onDataChanged();
      }
    } catch (error) {
      console.error('Error during reset and sync:', error);
      Alert.alert('Error', 'Failed to reset and sync');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.bigButton, isLoading && styles.bigButtonDisabled]}
      onPress={handleResetAndSync}
      disabled={isLoading}
    >
      <Text style={styles.bigButtonText}>
        {isLoading ? '🔄 Syncing...' : '🛠️ DEBUG: Reset & Sync Workout Data'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bigButton: {
    backgroundColor: '#C65B5B',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  bigButtonDisabled: {
    opacity: 0.6,
  },
  bigButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
