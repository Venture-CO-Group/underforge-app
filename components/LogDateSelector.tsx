import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Typography } from '../constants/Typography';

interface LogDateSelectorProps {
  selectedDate: string; // YYYY-MM-DD
  onDateChange: (date: string) => void;
  daysBack?: number;
}

function formatYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const LogDateSelector: React.FC<LogDateSelectorProps> = ({
  selectedDate,
  onDateChange,
  daysBack = 6,
}) => {
  const { t } = useTranslation(['activity']);
  const [expanded, setExpanded] = useState(false);
  const today = new Date();
  const todayStr = formatYMD(today);

  const DAY_KEYS = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'] as const;

  const days: { label: string; sub: string; value: string }[] = [];
  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const value = formatYMD(d);
    const label = i === 0 ? t('activity:dateToday') : i === 1 ? t('activity:dateYesterday') : t(`activity:${DAY_KEYS[d.getDay()]}`);
    const sub = i <= 1 ? '' : `${d.getDate()}/${d.getMonth() + 1}`;
    days.push({ label, sub, value });
  }

  if (selectedDate === todayStr && !expanded) {
    return (
      <TouchableOpacity style={styles.compactRow} onPress={() => setExpanded(true)}>
        <Text style={styles.compactLabel}>{t('activity:dateToday')}</Text>
        <Text style={styles.changeLink}>{t('activity:changeDate')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {days.map((day) => {
          const isSelected = day.value === selectedDate;
          return (
            <TouchableOpacity
              key={day.value}
              style={[styles.pill, isSelected && styles.pillSelected]}
              onPress={() => {
                onDateChange(day.value);
                if (day.value === todayStr) setExpanded(false);
              }}
            >
              <Text style={[styles.pillLabel, isSelected && styles.pillLabelSelected]}>
                {day.label}
              </Text>
              {day.sub ? (
                <Text style={[styles.pillSub, isSelected && styles.pillSubSelected]}>
                  {day.sub}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1A2A2A',
    alignItems: 'center',
    minWidth: 56,
  },
  pillSelected: {
    backgroundColor: '#F47C3C',
  },
  pillLabel: {
    color: '#8E9A9A',
    fontSize: 13,
    fontFamily: Typography.fontFamily.semiBold,
  },
  pillLabelSelected: {
    color: '#0B1114',
  },
  pillSub: {
    color: '#6B7777',
    fontSize: 11,
    fontFamily: Typography.fontFamily.regular,
    marginTop: 1,
  },
  pillSubSelected: {
    color: '#0B1114',
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  compactLabel: {
    color: '#8E9A9A',
    fontSize: 13,
    fontFamily: Typography.fontFamily.semiBold,
  },
  changeLink: {
    color: '#F47C3C',
    fontSize: 13,
    fontFamily: Typography.fontFamily.regular,
  },
});
