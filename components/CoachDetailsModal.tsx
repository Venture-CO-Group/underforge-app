import React from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { coachImages } from '../assets/images/coaches';
import { resolveCoachConfig } from '../lib/coach-config';
import { Coach } from '../types/onboarding_config';

interface CoachDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  coachInfo: Coach | null;
  coachName: string;
}

export default function CoachDetailsModal({
  visible,
  onClose,
  coachInfo,
  coachName
}: CoachDetailsModalProps) {
  const { t, i18n } = useTranslation(['onboarding']);

  if (!coachInfo) return null;

  const isSpanish = i18n.language?.startsWith('es');
  const coachLabel = (isSpanish && coachInfo.label_es) ? coachInfo.label_es : coachInfo.label_en;
  const coachDescription = (isSpanish && coachInfo.short_description_es)
    ? coachInfo.short_description_es
    : coachInfo.short_description;
  const coachLongDescription = (isSpanish && coachInfo.description_es)
    ? coachInfo.description_es
    : coachInfo.description;

  const getCoachImage = (imageName: string) => {
    return coachImages[imageName as keyof typeof coachImages] || null;
  };

  const coachImage = getCoachImage(coachInfo.image);

  const approachParagraph = (() => {
    try {
      const config = require('../assets/onboarding_config');
      const fullCoachInfo = resolveCoachConfig(
        config.general_info?.coach_selection ?? {},
        coachName,
      );
      const selectIf = isSpanish && typeof fullCoachInfo?.select_if_es === 'string'
        ? fullCoachInfo.select_if_es
        : fullCoachInfo?.select_if;
      if (typeof selectIf === 'string' && selectIf.trim().length > 0) {
        return selectIf.trim();
      }
      return t('onboarding:coachDetailsApproachDefault', { name: coachLabel });
    } catch {
      return t('onboarding:coachDetailsApproachDefault', { name: coachLabel });
    }
  })();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft} />
          <Text style={styles.headerTitle}>{t('onboarding:coachDetailsTitle')}</Text>
          <TouchableOpacity
            style={styles.headerRight}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.doneButton}>{t('onboarding:coachDetailsDone')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileSection}>
            <View style={styles.imageContainer}>
              {coachImage ? (
                coachName !== 'Ruth' ? (
                  <View style={{ width: 120, height: 120, borderRadius: 60, overflow: 'hidden' }}>
                    <Image
                      source={coachImage}
                      style={{
                        width: 120,
                        height: 160,
                        marginTop: coachName === 'Alonso' ? -20 : 0
                      }}
                      resizeMode="cover"
                    />
                  </View>
                ) : (
                  <Image source={coachImage} style={styles.coachImage} />
                )
              ) : (
                <View style={styles.coachImagePlaceholder}>
                  <Text style={styles.coachImageText}>
                    {coachName.charAt(0)}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.coachName}>{coachLabel}</Text>
            <Text style={styles.coachTagline}>{coachDescription}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('onboarding:coachDetailsAbout', { name: coachLabel })}</Text>
            <Text style={styles.sectionContent}>{coachLongDescription}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('onboarding:coachDetailsCoachingApproach')}</Text>
            <Text style={styles.sectionContent}>{approachParagraph}</Text>
          </View>

          {(() => {
            try {
              const config = require('../assets/onboarding_config');
              const fullCoachInfo = resolveCoachConfig(
        config.general_info?.coach_selection ?? {},
        coachName,
      );

              if (fullCoachInfo?.persona) {
                const personalHistory = isSpanish && fullCoachInfo.persona.personal_history_es
                  ? fullCoachInfo.persona.personal_history_es
                  : fullCoachInfo.persona.personal_history;
                return (
                  <>
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{t('onboarding:coachDetailsBackground')}</Text>
                      <Text style={styles.sectionContent}>
                        {personalHistory}
                      </Text>
                    </View>

                    {fullCoachInfo.science_roots && fullCoachInfo.science_roots.length > 0 && (
                      <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('onboarding:coachDetailsScienceMethods')}</Text>
                        <Text style={styles.sectionContent}>
                          {t('onboarding:coachDetailsScienceGrounded', { name: coachLabel })}
                        </Text>
                        <View style={styles.methodsList}>
                          {(isSpanish && fullCoachInfo.science_roots_es?.length
                            ? fullCoachInfo.science_roots_es
                            : fullCoachInfo.science_roots
                          ).map((method: string, index: number) => (
                            <View key={index} style={styles.methodItem}>
                              <Text style={styles.methodBullet}>•</Text>
                              <Text style={styles.methodText}>{method}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </>
                );
              }
            } catch (error) {
              console.error('Error loading full coach info:', error);
            }
            return null;
          })()}

          <View style={styles.footer} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1A1A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(242,242,238,0.06)',
  },
  headerLeft: {
    width: 50,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  headerRight: {
    width: 50,
    alignItems: 'flex-end',
  },
  doneButton: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  profileSection: {
    backgroundColor: '#0E1A1A',
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  imageContainer: {
    marginBottom: 16,
  },
  coachImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  coachImagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coachImageText: {
    color: 'white',
    fontSize: 48,
    fontWeight: 'bold',
  },
  coachName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F2F2EE',
    marginBottom: 4,
  },
  coachTagline: {
    fontSize: 17,
    color: '#F2F2EE',
    fontWeight: '500',
  },
  section: {
    backgroundColor: '#0E1A1A',
    marginBottom: 20,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 12,
  },
  sectionContent: {
    fontSize: 16,
    lineHeight: 24,
    color: '#F2F2EE',
    fontWeight: '400',
  },
  bulletContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  bulletPoint: {
    fontSize: 18,
    color: '#F2F2EE',
    fontWeight: '500',
    marginRight: 12,
    marginTop: 0,
  },
  methodsList: {
    marginTop: 12,
  },
  methodItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  methodBullet: {
    fontSize: 16,
    color: '#F47C3C',
    fontWeight: 'bold',
    marginRight: 12,
    marginTop: 2,
  },
  methodText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#F2F2EE',
    flex: 1,
  },
  footer: {
    height: 20,
  },
});
