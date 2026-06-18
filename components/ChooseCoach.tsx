import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Image, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { coachImagesByID } from '../assets/images/coaches';
import { getCanonicalCoachKey, getCoachDescription, getCoachShortDescription, resolveCoachConfig } from '../lib/coach-config';
import { isSpanishLocale } from '../lib/exercise-localization';
import { glowLogger } from '../lib/glow-logger';
import { CoachData } from '../lib/supabase_db_new';
import { styles } from '../styles/OnboardingModal.styles';
import { CoachType } from '../types/onboard';
import { Coach, OnboardingConfig } from '../types/onboarding_config';
import { ShaderBackground } from './ShaderBackground';

interface ChooseCoachProps {
  config: OnboardingConfig;
  dbCoaches: CoachData[];
  selectedCoachId?: number;
  lockedCoachId?: number;
  onCoachSelect: (coachId: number, displayName: string) => void;
  onNext: () => void;
}

// Reference height is iPhone 14 (logical pixels with safe areas excluded)
const REFERENCE_CONTENT_HEIGHT = 750;

/** Carousel order on the choose-coach screen (first-name keys from onboarding config). */
const COACH_DISPLAY_ORDER = ['Alonso', 'Dana', 'Jesús', 'Ruth', 'Dey', 'Manu'];

// Extract first name from full name (e.g., "Dey Rodriguez" -> "Dey").
// Defensive: the DB column can be NULL despite the CoachData typing.
const getFirstName = (fullName: string | null | undefined): string => {
  if (typeof fullName !== 'string') return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
};

export const ChooseCoach: React.FC<ChooseCoachProps> = ({
  config,
  dbCoaches,
  selectedCoachId,
  lockedCoachId,
  onCoachSelect,
  onNext
}) => {
  const { t, i18n } = useTranslation(['onboarding']);
  const isSpanish = isSpanishLocale(i18n.language);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Scale proportionally to screen size; cap at 1 so we don't upscale on large devices
  const scale = Math.min(1, screenHeight / REFERENCE_CONTENT_HEIGHT);
  const imageSize = Math.round(150 * scale);
  const cardPadding = Math.round(20 * scale);
  const imageMarginBottom = Math.round(16 * scale);
  const subtitleMarginBottom = Math.round(24 * scale);
  const CARD_WIDTH = Math.round(screenWidth * 0.85);

  // Build coach cards from database coaches, with config data for descriptions
  const configCoaches: Record<string, Coach> = config.general_info.coach_selection;

  // Defensive filter: skip rows with missing/blank full_name so a bad DB row
  // can't crash the whole onboarding screen.
  const safeDbCoaches = useMemo(() => {
    const valid: CoachData[] = [];
    const invalid: { id: number; full_name: unknown }[] = [];
    for (const c of dbCoaches) {
      if (typeof c?.full_name === 'string' && c.full_name.trim().length > 0) {
        valid.push(c);
      } else {
        invalid.push({ id: c?.id, full_name: c?.full_name });
      }
    }
    if (invalid.length > 0) {
      glowLogger.warn('ChooseCoach: skipping coaches with missing full_name', {
        invalid_count: invalid.length,
        invalid_coaches: invalid,
      });
    }
    return valid;
  }, [dbCoaches]);

  const orderedDbCoaches = useMemo(() => {
    const orderIndex = new Map(COACH_DISPLAY_ORDER.map((name, i) => [name, i]));
    const filtered = lockedCoachId != null
      ? safeDbCoaches.filter((c) => c.id === lockedCoachId)
      : safeDbCoaches;
    return [...filtered].sort((a, b) => {
      const aName = getFirstName(a.full_name);
      const bName = getFirstName(b.full_name);
      const aIdx = orderIndex.get(aName) ?? COACH_DISPLAY_ORDER.length;
      const bIdx = orderIndex.get(bName) ?? COACH_DISPLAY_ORDER.length;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return aName.localeCompare(bName);
    });
  }, [safeDbCoaches, lockedCoachId]);

  const coachCards = [
    ...orderedDbCoaches.map((dbCoach) => {
      // Match database coach to config by first name
      const firstName = getFirstName(dbCoach.full_name);
      const configCoach = resolveCoachConfig(configCoaches, firstName);
      return {
        id: dbCoach.id,
        displayName: firstName,
        fullName: dbCoach.full_name,
        coachType: dbCoach.coach_type,
        configData: configCoach || null
      };
    }),
    ...(lockedCoachId != null ? [] : [{ id: -1, displayName: 'coming_soon', fullName: 'More Coaches', coachType: null as CoachType | null, configData: null }]),
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  // Pre-select the first coach if none is selected (skip when locked — handled below)
  useEffect(() => {
    if (lockedCoachId != null) return;
    if (!selectedCoachId && orderedDbCoaches.length > 0) {
      const firstCoach = orderedDbCoaches[0];
      const firstName = getFirstName(firstCoach.full_name);
      onCoachSelect(firstCoach.id, getCanonicalCoachKey(firstName));
    }
  }, [selectedCoachId, orderedDbCoaches, onCoachSelect, lockedCoachId]);

  // Pre-select locked coach when assigned via special code
  useEffect(() => {
    if (lockedCoachId == null || orderedDbCoaches.length === 0) return;
    const lockedCoach = orderedDbCoaches.find((c) => c.id === lockedCoachId);
    if (!lockedCoach) return;
    const firstName = getFirstName(lockedCoach.full_name);
    if (selectedCoachId !== lockedCoachId) {
      onCoachSelect(lockedCoachId, getCanonicalCoachKey(firstName));
    }
  }, [lockedCoachId, orderedDbCoaches, selectedCoachId, onCoachSelect]);

  useEffect(() => {
    if (selectedCoachId) {
      const idx = coachCards.findIndex(card => card.id === selectedCoachId);
      if (idx >= 0 && idx !== currentIndex) {
        setCurrentIndex(idx);
        flatListRef.current?.scrollToIndex({ index: idx, animated: true });
      }
    }
  }, [selectedCoachId]);

  const getCoachImage = (coachId: number) => {
    return coachImagesByID[coachId] || null;
  };

  const handleNext = () => {
    if (!selectedCoachId) {
      Alert.alert(
        t('onboarding:coachSelectAlertTitle'),
        t('onboarding:coachSelectAlertBody'),
        [{ text: 'OK', style: 'default' }]
      );
      return;
    }
    onNext();
  };

  const handleMomentumScrollEnd = (event: any) => {
    const idx = Math.round(event.nativeEvent.contentOffset.x / CARD_WIDTH);
    if (idx === currentIndex) return;
    setCurrentIndex(idx);
    const card = coachCards[idx];
    if (card && card.id !== -1) {
      onCoachSelect(card.id, getCanonicalCoachKey(card.displayName));
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ShaderBackground offsetY="70%" />
      <SafeAreaView style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScrollView 
          style={{ flex: 1 }} 
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.title}>
            {lockedCoachId != null
              ? t('onboarding:chooseCoachTitleAssigned')
              : t('onboarding:chooseCoachTitle')}
          </Text>
          <Text style={[styles.subtitle, { marginBottom: subtitleMarginBottom }]}>
            {lockedCoachId != null
              ? t('onboarding:chooseCoachSubtitleAssigned')
              : t('onboarding:chooseCoachSubtitle')}
          </Text>
          <View style={{ alignItems: 'center' }}>
            <FlatList
              ref={flatListRef}
              data={coachCards}
              keyExtractor={(item) => String(item.id)}
              horizontal
              scrollEnabled={lockedCoachId == null}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              snapToInterval={CARD_WIDTH}
              decelerationRate="fast"
              contentContainerStyle={{ alignItems: 'center' }}
              getItemLayout={(_data, index) => ({
                length: CARD_WIDTH,
                offset: CARD_WIDTH * index,
                index,
              })}
              onScrollToIndexFailed={(info) => {
                flatListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true,
                });
              }}
              renderItem={({ item }) => {
                if (item.id === -1) {
                  return (
                    <View style={[styles.coachCard, { width: CARD_WIDTH, padding: cardPadding }]}>
                      <View style={[styles.coachImageContainer, { marginBottom: imageMarginBottom }]}>
                        <View style={[styles.coachImagePlaceholder, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}>
                          <Text style={styles.coachImageText}>➕</Text>
                        </View>
                      </View>
                      <Text style={styles.coachName}>{t('onboarding:coachMoreCoaches')}</Text>
                      <Text style={styles.coachShortDescription}>{t('onboarding:coachComingSoon')}</Text>
                    </View>
                  );
                }
                
                const coachImage = getCoachImage(item.id);
                const coach = item.configData;
                
                return (
                  <TouchableOpacity
                    style={[
                      styles.coachCard,
                      { width: CARD_WIDTH, padding: cardPadding },
                      selectedCoachId === item.id && styles.coachCardSelected
                    ]}
                    activeOpacity={0.9}
                    onPress={() => onCoachSelect(item.id, getCanonicalCoachKey(item.displayName))}
                  >
                    {item.coachType && (
                      <View style={styles.typeBadge}>
                        <Text style={styles.typeBadgeText}>
                          {item.coachType === CoachType.AI_HUMAN_HYBRID
                            ? t('onboarding:coachTypeHybrid')
                            : t('onboarding:coachTypeAiOnly')}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.coachImageContainer, { marginBottom: imageMarginBottom }]}>
                      {coachImage ? (
                        item.displayName !== 'Ruth' ? (
                          <View style={{ width: imageSize, height: imageSize, borderRadius: imageSize / 2, overflow: 'hidden' }}>
                            <Image 
                              source={coachImage} 
                              style={{ 
                                width: imageSize, 
                                height: Math.round(imageSize * 1.33),
                                marginTop: item.displayName === 'Alonso' ? Math.round(-20 * scale) : 0
                              }}
                              resizeMode="cover"
                            />
                          </View>
                        ) : (
                          <Image source={coachImage} style={[styles.coachImage, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]} />
                        )
                      ) : (
                        <View style={[styles.coachImagePlaceholder, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}>
                          <Text style={styles.coachImageText}>
                            {item.displayName.charAt(0)}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.coachName}>{item.displayName}</Text>
                    <Text style={styles.coachShortDescription}>
                      {getCoachShortDescription(coach, isSpanish) || item.fullName}
                    </Text>
                    <Text style={styles.coachFullDescription}>
                      {getCoachDescription(coach, isSpanish)}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
          {/* Dots Indicator */}
          {lockedCoachId == null ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginVertical: 10 }}>
            {coachCards.map((_, idx) => (
              <View
                key={idx}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginHorizontal: 4,
                  backgroundColor: idx === currentIndex ? '#333' : '#ccc'
                }}
              />
            ))}
          </View>
          ) : null}
        </ScrollView>
        <View style={{ paddingBottom: 12 }}>
          <TouchableOpacity style={[styles.nextButton, { marginTop: 12, marginBottom: 12 }]} onPress={handleNext}>
            <Text style={styles.nextButtonText}>{t('onboarding:questionNext')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};
