import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { appIcons } from '../assets/icons';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '../constants/Typography';
import {
  fetchHumanCoachStepNotes,
  getHumanCoachNoteForStep,
  parseHumanCoachStepNotesJson,
} from '../lib/human-coach-step-notes';
import { Icon } from './Icon';

/**
 * Bottom-of-step-detail card that shows per-step notes written manually by the
 * human coach (in Supabase Studio). Falls back to a discrete placeholder when
 * no note exists for this step. Visual chrome mirrors `BaselineMovementCard`.
 */
export const HumanCoachStepNotesCard: React.FC<{
  stepId?: string;
  userId?: string;
  /** Cached value from the already-loaded user profile, if available. */
  notesJson?: string | null;
}> = ({ stepId, userId, notesJson }) => {
  const { t } = useTranslation(['plan']);
  const [remoteNotesJson, setRemoteNotesJson] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!userId) return;
      const fresh = await fetchHumanCoachStepNotes(userId);
      if (!cancelled) setRemoteNotesJson(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const note = useMemo(() => {
    const raw = remoteNotesJson !== undefined ? remoteNotesJson : notesJson;
    const parsed = parseHumanCoachStepNotesJson(raw ?? null);
    return getHumanCoachNoteForStep(parsed, stepId);
  }, [remoteNotesJson, notesJson, stepId]);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Icon source={appIcons.coach} width={18} height={18} fill={BrandColors.accent} />
        <Text style={styles.title}>{t('plan:humanCoachStepNotesTitle')}</Text>
      </View>

      {note ? (
        <Text style={styles.body}>{note}</Text>
      ) : (
        <Text style={styles.placeholder}>{t('plan:humanCoachStepNotesPlaceholder')}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.accent,
    letterSpacing: LetterSpacing.extraWide,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  body: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 14,
    lineHeight: LineHeight.body,
    color: BrandColors.textSecondary,
  },
  placeholder: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 14,
    lineHeight: LineHeight.body,
    color: BrandColors.textTertiary,
    fontStyle: 'italic',
  },
});
