import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ActionStep } from '../types/onboard';

interface ScheduleScreenProps {
  step?: ActionStep;
  onBack: () => void;
  onScheduleChange?: (stepId: string, newDaysOfWeek: string[], newTimeOfDay?: string) => void;
  onScheduleSave?: (stepId: string, selectedDays: string[], selectedTime?: string) => Promise<void>;
  embedded?: boolean;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

// Generate time options in 5-minute intervals for better UX
const generateTimeOptions = () => {
  const times = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      const hourStr = hour.toString().padStart(2, '0');
      const minuteStr = minute.toString().padStart(2, '0');
      const timeValue = `${hourStr}:${minuteStr}`;
      times.push({
        value: timeValue,
        label: timeValue
      });
    }
  }
  return times;
};

export const ScheduleScreen: React.FC<ScheduleScreenProps> = ({
  step,
  onBack,
  onScheduleChange,
  onScheduleSave,
  embedded = false,
}) => {
  const { t } = useTranslation(['plan']);

  const DAYS_OF_WEEK = [
    { key: 'mon', label: t('plan:scheduleDayMon') },
    { key: 'tue', label: t('plan:scheduleDayTue') },
    { key: 'wed', label: t('plan:scheduleDayWed') },
    { key: 'thu', label: t('plan:scheduleDayThu') },
    { key: 'fri', label: t('plan:scheduleDayFri') },
    { key: 'sat', label: t('plan:scheduleDaySat') },
    { key: 'sun', label: t('plan:scheduleDaySun') },
  ];

  // Initialize with currently selected days from the step, ensuring we handle the format correctly
  const [selectedDays, setSelectedDays] = useState<string[]>(() => {
    console.log('[ScheduleScreen] Initializing selectedDays with step:', step);
    console.log('[ScheduleScreen] Step daysOfWeek raw:', step?.daysOfWeek);
    
    if (!step?.daysOfWeek || !Array.isArray(step.daysOfWeek)) {
      console.log('[ScheduleScreen] No daysOfWeek or not array, returning empty');
      return [];
    }
    
    // Normalize the days to lowercase and map common variations
    const processedDays = step.daysOfWeek.map((day, index) => {
      console.log(`[ScheduleScreen] Processing day ${index}:`, day, typeof day);
      
      if (typeof day !== 'string') {
        console.log(`[ScheduleScreen] Day ${index} is not a string:`, day);
        return null;
      }
      
      const normalizedDay = day.toLowerCase().trim();
      console.log(`[ScheduleScreen] Normalized day ${index}:`, normalizedDay);
      
      // Handle common variations
      const dayMapping: { [key: string]: string } = {
        'monday': 'mon',
        'tuesday': 'tue', 
        'wednesday': 'wed',
        'thursday': 'thu',
        'friday': 'fri',
        'saturday': 'sat',
        'sunday': 'sun',
        'mon': 'mon',
        'tue': 'tue',
        'wed': 'wed', 
        'thu': 'thu',
        'fri': 'fri',
        'sat': 'sat',
        'sun': 'sun'
      };
      
      const mappedDay = dayMapping[normalizedDay] || normalizedDay;
      console.log(`[ScheduleScreen] Mapped day ${index}:`, mappedDay);
      return mappedDay;
    }).filter((day): day is string => {
      const isValid = day !== null && DAY_KEYS.includes(day as any);
      console.log(`[ScheduleScreen] Day validation:`, day, 'is valid:', isValid);
      return isValid;
    });
    
    console.log('[ScheduleScreen] Final processed days:', processedDays);
    return processedDays;
  });

  // Initialize time from step.timeOfDay or default to 09:00
  const [selectedTime, setSelectedTime] = useState<string>(() => {
    if (step?.timeOfDay) {
      // Ensure the time is in the correct format and round to nearest 5 minutes
      const [hour, minute] = step.timeOfDay.split(':');
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute || '0', 10);
      
      // Round to nearest 5 minutes
      const roundedMinute = Math.round(minuteNum / 5) * 5;
      const finalMinute = roundedMinute === 60 ? 0 : roundedMinute;
      const finalHour = roundedMinute === 60 ? hourNum + 1 : hourNum;
      
      return `${finalHour.toString().padStart(2, '0')}:${finalMinute.toString().padStart(2, '0')}`;
    }
    return '09:00';
  });
  
  const [isLoading, setIsLoading] = useState(false);

  console.log('[ScheduleScreen] Initialized with step:', step?.title);
  console.log('[ScheduleScreen] Step daysOfWeek:', step?.daysOfWeek);
  console.log('[ScheduleScreen] Processed selectedDays:', selectedDays);

  const toggleDay = (dayKey: string) => {
    setSelectedDays(prev => {
      if (prev.includes(dayKey)) {
        return prev.filter(day => day !== dayKey);
      } else {
        return [...prev, dayKey];
      }
    });
  };

  const handleDayToggle = async (dayKey: string) => {
    if (!step || !onScheduleSave) return;

    const newSelectedDays = selectedDays.includes(dayKey)
      ? selectedDays.filter(day => day !== dayKey)
      : [...selectedDays, dayKey];
    
    setSelectedDays(newSelectedDays);
    
    // Auto-save when day is toggled
    setIsLoading(true);
    try {
      await onScheduleSave(step.id, newSelectedDays, selectedTime);
      onScheduleChange?.(step.id, newSelectedDays, selectedTime);
    } catch (error) {
      console.error('Error saving schedule:', error);
      // Revert the change on error
      setSelectedDays(selectedDays);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTimeChange = async (newTime: string) => {
    if (!step || !onScheduleSave) {
      setSelectedTime(newTime);
      return;
    }

    setSelectedTime(newTime);
    
    // Auto-save when time is changed
    setIsLoading(true);
    try {
      await onScheduleSave(step.id, selectedDays, newTime);
      onScheduleChange?.(step.id, selectedDays, newTime);
    } catch (error) {
      console.error('Error saving time:', error);
      // Revert the change on error
      setSelectedTime(selectedTime);
    } finally {
      setIsLoading(false);
    }
  };

  // Add useEffect to log state changes
  useEffect(() => {
    console.log('[ScheduleScreen] selectedDays state changed:', selectedDays);
  }, [selectedDays]);

  // Add useEffect to re-initialize when step changes
  useEffect(() => {
    if (step?.daysOfWeek) {
      console.log('[ScheduleScreen] Step changed, re-initializing selectedDays');
      console.log('[ScheduleScreen] New step daysOfWeek:', step.daysOfWeek);
      
      const processedDays = step.daysOfWeek.map(day => {
        if (typeof day !== 'string') return null;
        
        const normalizedDay = day.toLowerCase().trim();
        const dayMapping: { [key: string]: string } = {
          'monday': 'mon',
          'tuesday': 'tue', 
          'wednesday': 'wed',
          'thursday': 'thu',
          'friday': 'fri',
          'saturday': 'sat',
          'sunday': 'sun',
          'mon': 'mon',
          'tue': 'tue',
          'wed': 'wed', 
          'thu': 'thu',
          'fri': 'fri',
          'sat': 'sat',
          'sun': 'sun'
        };
        
        return dayMapping[normalizedDay] || normalizedDay;
      }).filter((day): day is string => {
        return day !== null && DAY_KEYS.includes(day as any);
      });
      
      console.log('[ScheduleScreen] Re-initialized selectedDays:', processedDays);
      setSelectedDays(processedDays);
    }
  }, [step?.id, step?.daysOfWeek]); // Re-run when step ID or daysOfWeek changes

  // Add useEffect to re-initialize time when step changes
  useEffect(() => {
    if (step?.timeOfDay) {
      const [hour, minute] = step.timeOfDay.split(':');
      const hourNum = parseInt(hour, 10);
      const minuteNum = parseInt(minute || '0', 10);
      
      // Round to nearest 5 minutes
      const roundedMinute = Math.round(minuteNum / 5) * 5;
      const finalMinute = roundedMinute === 60 ? 0 : roundedMinute;
      const finalHour = roundedMinute === 60 ? hourNum + 1 : hourNum;
      
      const formattedTime = `${finalHour.toString().padStart(2, '0')}:${finalMinute.toString().padStart(2, '0')}`;
      setSelectedTime(formattedTime);
    }
  }, [step?.id, step?.timeOfDay]);

  const Wrapper = embedded ? View : SafeAreaView;

  return (
    <Wrapper style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{t('plan:backButton')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('plan:scheduleTitle')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Text style={styles.stepTitle}>{step?.title}</Text>
          
          <Text style={styles.sectionTitle}>{t('plan:scheduleDaysQuestion')}</Text>
          
          <View style={styles.daysGrid}>
            {DAYS_OF_WEEK.map((day) => (
              <TouchableOpacity
                key={day.key}
                style={[
                  styles.dayButton,
                  selectedDays.includes(day.key) && styles.dayButtonSelected
                ]}
                onPress={() => handleDayToggle(day.key)}
                disabled={isLoading}
              >
                <Text style={[
                  styles.dayButtonText,
                  selectedDays.includes(day.key) && styles.dayButtonTextSelected
                ]}>
                  {day.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>{t('plan:scheduleTimeQuestion')}</Text>

          <View style={styles.timePickerContainer}>
            <Picker
              selectedValue={selectedTime}
              onValueChange={handleTimeChange}
              style={styles.picker}
              itemStyle={styles.pickerItem}
              mode={Platform.OS === 'android' ? 'dropdown' : undefined}
              dropdownIconColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
            >
              {generateTimeOptions().map(time => (
                <Picker.Item
                  key={time.value}
                  label={time.label}
                  value={time.value}
                  color={Platform.OS === 'android' ? '#FFFFFF' : '#F2F2EE'}
                />
              ))}
            </Picker>
          </View>

          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#F47C3C" />
              <Text style={styles.loadingText}>{t('plan:scheduleSaving')}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1114',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0B1114',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F47C3C',
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
  scrollContainer: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 32,
    lineHeight: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 20,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 40,
  },
  dayButton: {
    backgroundColor: '#0E1A1A',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E5E5EA',
    minWidth: 80,
    alignItems: 'center',
  },
  dayButtonSelected: {
    backgroundColor: '#F47C3C',
    borderColor: '#F47C3C',
  },
  dayButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  dayButtonTextSelected: {
    color: '#fff',
  },
  timePickerContainer: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    marginBottom: 20,
    overflow: 'hidden',
  },
  picker: {
    height: 180,
  },
  pickerItem: {
    fontSize: 20,
    color: Platform.OS === 'android' ? '#FFFFFF' : '#F2F2EE',
  },
  loadingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: '500',
  },
});