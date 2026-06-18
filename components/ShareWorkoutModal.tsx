import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { appIcons } from '../assets/icons';
import { BrandColors } from '../constants/Colors';
import { Icon } from './Icon';
import { FontFamily, FontSize } from '../constants/Typography';
import { openCamera, openImageGallery } from '../lib/camera-helper';
import { glowLogger } from '../lib/glow-logger';
import {
  createSocialPost,
  DEFAULT_SHARE_OPTIONS,
  type MetricsSnapshot,
  type PostVisibility,
  type ShareOptions,
} from '../lib/social-posts';
import { uploadPostPhoto } from '../lib/storage-upload';
import { supabase } from '../lib/supabase_db_new';
import {
  buildShareMetrics,
  type WorkoutShareMetrics,
} from '../lib/workout-share-metrics';

export interface ShareWorkoutPayload {
  /** Local SQLite workout_logs.id — used to read metrics from the device DB. */
  localWorkoutLogId: number | null;
  /** Supabase workout_logs.id — used as FK in social_posts.workout_log_id. */
  supabaseWorkoutLogId: number | null;
  /** Local SQLite activity_logs.id — used to read metrics from the device DB. */
  localActivityLogId: number | null;
  /** Supabase activity_logs.id — used as FK in social_posts.activity_log_id. */
  supabaseActivityLogId: number | null;
  /** Default post title: workout day name or activity name. */
  displayTitle: string;
}

interface ShareWorkoutModalProps {
  visible: boolean;
  userId: string;
  payload: ShareWorkoutPayload | null;
  /** Current user's profile for the preview card. */
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  onClose: () => void;
  onPosted?: (postId: number) => void;
}

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)} kg`;
}

function formatDistance(value: number, unit: 'km' | 'mi'): string {
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}

/**
 * Full-screen page-sheet composer. Top to bottom:
 *  1. Photo card (tap to add / replace / remove from camera or library)
 *  2. Editable title (defaults to workout day name)
 *  3. Toggleable metric rows — hidden when zero/null so the list stays tight
 *  4. Live preview card showing exactly how the post will render in the feed
 *  5. Visibility segmented control (Public / My Circles)
 *  6. Sticky Share CTA
 */
export const ShareWorkoutModal: React.FC<ShareWorkoutModalProps> = ({
  visible,
  userId,
  payload,
  authorDisplayName,
  authorAvatarUrl,
  onClose,
  onPosted,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const insets = useSafeAreaInsets();

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [metrics, setMetrics] = useState<WorkoutShareMetrics | null>(null);
  const [title, setTitle] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [share, setShare] = useState<ShareOptions>({ ...DEFAULT_SHARE_OPTIONS });
  const [visibility, setVisibility] = useState<PostVisibility>('circle');
  const [posting, setPosting] = useState(false);
  /** Wizard step: 1 = compose, 2 = review (preview + location + audience). */
  const [step, setStep] = useState<1 | 2>(1);
  /** Optional free-text location ("gym, city"). Persisted in social_posts.location. */
  const [location, setLocation] = useState('');
  /** Step-2 preview: exercise / PR rows the user tapped × to omit from the post. */
  const [excludedExerciseIds, setExcludedExerciseIds] = useState<Set<string>>(() => new Set());
  const [excludedPrIds, setExcludedPrIds] = useState<Set<string>>(() => new Set());

  // Hydrate metrics each time the modal opens with a new payload.
  useEffect(() => {
    if (!visible || !payload) return;
    let cancelled = false;
    setPhotoPickerOpen(false);
    setLoadingMetrics(true);
    setMetrics(null);
    setPhotoUri(null);
    setShare({ ...DEFAULT_SHARE_OPTIONS });
    setStep(1);
    setLocation('');
    setExcludedExerciseIds(new Set());
    setExcludedPrIds(new Set());
    // Start with the user's default audience from their profile; falls back to
    // 'circle' if the field hasn't been loaded yet. The Supabase read below
    // updates this in place once we have the answer.
    setVisibility('circle');
    setTitle(payload.displayTitle || '');

    (async () => {
      // Pre-load the user's default audience in parallel with the metrics so
      // step 2 lands on the user's preferred visibility without a flash. The
      // post `visibility` enum is still 'public'/'circle'; this just maps the
      // profile's 'circles' default to the singular post column value.
      const audiencePromise: Promise<'public' | 'circle'> = supabase
        ? supabase
            .from('user_profile')
            .select('default_share_audience')
            .eq('user_id', userId)
            .single()
            .then((res: { data: { default_share_audience?: string } | null }) =>
              res.data?.default_share_audience === 'public' ? 'public' : 'circle',
            )
            .catch(() => 'circle' as const)
        : Promise.resolve('circle');

      // Metrics come from local SQLite, so we always use the local ids.
      const result = await buildShareMetrics(userId, {
        workoutLogId: payload.localWorkoutLogId,
        activityLogId: payload.localActivityLogId,
      });
      const defaultAudience = await audiencePromise;
      if (cancelled) return;
      setVisibility(defaultAudience);
      if (result) {
        setMetrics(result);
        setTitle(prev => prev || result.workoutTitle);
      }
      setLoadingMetrics(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, payload, userId]);

  const filteredSnapshot: MetricsSnapshot = useMemo(() => {
    if (!metrics) return {};
    const snap: MetricsSnapshot = { workoutTitle: title || metrics.workoutTitle };
    if (share.exercises && metrics.exercises.length > 0) {
      snap.exercises = metrics.exercises
        .filter(e => !excludedExerciseIds.has(e.exerciseId))
        .map(e => ({
          exerciseName: e.exerciseName,
          setsCompleted: e.setsCompleted,
          summary: e.summary,
        }));
    }
    if (share.kcals && metrics.totalKcal > 0) snap.totalKcal = metrics.totalKcal;
    if (share.totalVolume && metrics.totalVolumeKg > 0) snap.totalVolumeKg = metrics.totalVolumeKg;
    if (share.newPR && metrics.newPRs.length > 0) {
      snap.newPRs = metrics.newPRs
        .filter(pr => !excludedPrIds.has(pr.exerciseId))
        .map(pr => ({
          exerciseName: pr.exerciseName,
          weightKg: pr.weightKg,
          reps: pr.reps,
          e1rmKg: pr.e1rmKg,
        }));
    }
    if (share.distance && metrics.activity?.distanceValue && metrics.activity.distanceUnit) {
      snap.distance = { value: metrics.activity.distanceValue, unit: metrics.activity.distanceUnit };
    }
    if (share.altitude && metrics.activity?.elevationGainMeters) {
      snap.elevationGainMeters = metrics.activity.elevationGainMeters;
    }
    // Duration is always surfaced for activity-only posts. There's no extra
    // toggle in the composer — it would clutter the UI for a number that's
    // already implied by "I did a workout/activity".
    if (metrics.activity?.durationMinutes && metrics.activity.durationMinutes > 0) {
      snap.durationMinutes = metrics.activity.durationMinutes;
    }
    return snap;
  }, [metrics, share, title, excludedExerciseIds, excludedPrIds]);

  const excludeExercise = useCallback((exerciseId: string) => {
    setExcludedExerciseIds(prev => new Set(prev).add(exerciseId));
  }, []);

  const excludePr = useCallback((exerciseId: string) => {
    setExcludedPrIds(prev => new Set(prev).add(exerciseId));
  }, []);

  const handlePickPhoto = useCallback(() => {
    setPhotoPickerOpen(true);
  }, []);

  const handlePhotoFromCamera = useCallback(async () => {
    setPhotoPickerOpen(false);
    const uri = await openCamera({ requireVertical: true });
    if (uri) setPhotoUri(uri);
  }, []);

  const handlePhotoFromLibrary = useCallback(async () => {
    setPhotoPickerOpen(false);
    const uri = await openImageGallery({ requireVertical: true });
    if (uri) setPhotoUri(uri);
  }, []);

  const handleShare = useCallback(async () => {
    if (!payload || !metrics) return;
    const isActivityOnly = !payload.localWorkoutLogId && !!payload.localActivityLogId;
    const fallbackTitle = isActivityOnly
      ? t('social:defaultActivityTitle')
      : t('social:defaultWorkoutTitle');
    const finalTitle = (title.trim() || metrics.workoutTitle || fallbackTitle).slice(0, 80);
    setPosting(true);
    try {
      let uploadedPhotoUrl: string | null = null;
      if (photoUri) {
        uploadedPhotoUrl = await uploadPostPhoto(userId, photoUri);
        if (!uploadedPhotoUrl) {
          Alert.alert(t('common:error'), t('social:photoUploadError'));
          // continue without photo to avoid losing the user's post
        }
      }

      // social_posts.workout_log_id references the Supabase workout_logs.id.
      // If sync hasn't landed yet we store null — the post still carries the
      // full metrics_snapshot so the card renders fine without the FK.
      const postId = await createSocialPost({
        userId,
        workoutLogId: payload.supabaseWorkoutLogId,
        activityLogId: payload.supabaseActivityLogId,
        title: finalTitle,
        photoUrl: uploadedPhotoUrl,
        location: location.trim() || null,
        visibility,
        shareOptions: share,
        metricsSnapshot: filteredSnapshot,
      });

      if (!postId) {
        Alert.alert(t('common:error'), t('social:postFailedBody'));
        return;
      }
      onPosted?.(postId);
      onClose();
    } catch (e) {
      glowLogger.error('ShareWorkoutModal share failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      Alert.alert(t('common:error'), t('social:postFailedBody'));
    } finally {
      setPosting(false);
    }
  }, [payload, metrics, title, photoUri, userId, visibility, share, filteredSnapshot, location, onClose, onPosted, t]);

  // Reuses the feed card layout exactly so the preview = the published card.
  const renderPreview = () => {
    if (!metrics) return null;
    const initial = (authorDisplayName || '?').trim().charAt(0).toUpperCase();
    const previewExercises = filteredSnapshot.exercises ?? [];
    const previewExerciseCount = previewExercises.length;
    const visiblePrs = (share.newPR ? metrics.newPRs : []).filter(
      pr => !excludedPrIds.has(pr.exerciseId),
    );
    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHeader}>
          {authorAvatarUrl ? (
            <Image source={{ uri: authorAvatarUrl }} style={styles.previewAvatar} />
          ) : (
            <View style={[styles.previewAvatar, styles.previewAvatarFallback]}>
              <Text style={styles.previewAvatarText}>{initial}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.previewAuthor}>{authorDisplayName}</Text>
            <Text style={styles.previewMeta}>{t('social:previewMetaJustNow')}</Text>
          </View>
        </View>

        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.previewPhoto} resizeMode="cover" />
        ) : null}

        <View style={styles.previewBody}>
          <Text style={styles.previewTitle}>{title || metrics.workoutTitle}</Text>

          {location.trim() ? (
            <View style={styles.previewLocationRow}>
              <Text style={styles.previewLocationGlyph}>{'\u{1F4CD}'}</Text>
              <Text style={styles.previewLocationText} numberOfLines={1}>{location.trim()}</Text>
            </View>
          ) : null}

          {visiblePrs.length > 0 && (
            <View style={styles.prRow}>
              {visiblePrs.map(pr => (
                <View key={pr.exerciseId} style={styles.prChip}>
                  <Text style={styles.prChipLabel}>{t('social:prBadge')}</Text>
                  <Text style={styles.prChipText} numberOfLines={1}>
                    {pr.exerciseName} · {Math.round(pr.weightKg)}kg × {pr.reps}
                  </Text>
                  <TouchableOpacity
                    onPress={() => excludePr(pr.exerciseId)}
                    style={styles.previewDismissBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('social:removeFromPreview', { item: pr.exerciseName })}
                  >
                    <Text style={styles.previewDismissText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.chipRow}>
            {filteredSnapshot.totalKcal ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{filteredSnapshot.totalKcal}</Text>
                <Text style={styles.chipUnit}>kcal</Text>
              </View>
            ) : null}
            {filteredSnapshot.totalVolumeKg ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{formatVolume(filteredSnapshot.totalVolumeKg)}</Text>
                <Text style={styles.chipUnit}>{t('social:chipVolume')}</Text>
              </View>
            ) : null}
            {filteredSnapshot.distance ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>{formatDistance(filteredSnapshot.distance.value, filteredSnapshot.distance.unit)}</Text>
                <Text style={styles.chipUnit}>{t('social:chipDistance')}</Text>
              </View>
            ) : null}
            {filteredSnapshot.elevationGainMeters ? (
              <View style={styles.chip}>
                <Text style={styles.chipValue}>+{Math.round(filteredSnapshot.elevationGainMeters)} m</Text>
                <Text style={styles.chipUnit}>{t('social:chipAltitude')}</Text>
              </View>
            ) : null}
          </View>

          {previewExerciseCount > 0 ? (
            <View style={styles.exerciseList}>
              {(share.exercises ? metrics.exercises : [])
                .filter(e => !excludedExerciseIds.has(e.exerciseId))
                .map(e => (
                  <View key={e.exerciseId} style={styles.exerciseRow}>
                    <Text style={styles.exerciseName} numberOfLines={1}>{e.exerciseName}</Text>
                    <Text style={styles.exerciseSummary} numberOfLines={1}>{e.summary}</Text>
                    <TouchableOpacity
                      onPress={() => excludeExercise(e.exerciseId)}
                      style={styles.previewDismissBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('social:removeFromPreview', { item: e.exerciseName })}
                    >
                      <Text style={styles.previewDismissText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const metricsAvailable = !!metrics;
  const hasExercises = (metrics?.exercises.length ?? 0) > 0;
  const hasKcal = (metrics?.totalKcal ?? 0) > 0;
  const hasVolume = (metrics?.totalVolumeKg ?? 0) > 0;
  const hasDistance = !!metrics?.activity?.distanceValue && !!metrics?.activity?.distanceUnit;
  const hasAltitude = !!metrics?.activity?.elevationGainMeters;
  const hasPR = (metrics?.newPRs.length ?? 0) > 0;

  // Decide which toggle set to render based on payload type. Strength/workout
  // payloads always show exercises/kcals/totalVolume/newPR. Pure activity
  // payloads (no workout id) show kcals/distance/altitude. Unavailable
  // metrics are rendered disabled so users still see what they *could* share.
  const isWorkoutPayload = !!payload?.localWorkoutLogId;
  const isActivityPayload = !payload?.localWorkoutLogId && !!payload?.localActivityLogId;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          {step === 1 ? (
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Text style={styles.headerCancelText}>{t('common:cancel')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setStep(1)}
              style={styles.headerBtn}
              accessibilityRole="button"
              accessibilityLabel={t('social:back')}
              hitSlop={8}
            >
              <Text style={styles.headerCancelText}>{`\u2039 ${t('social:back')}`}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {step === 1
              ? t('social:shareModalTitleStep1')
              : t('social:shareModalTitleStep2')}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {loadingMetrics || !metricsAvailable ? (
              <View style={styles.centerLoader}>
                <ActivityIndicator color={BrandColors.accent} />
                <Text style={styles.loadingText}>{t('social:buildingPreview')}</Text>
              </View>
            ) : step === 1 ? (
              <>
                {/* 1. Photo card */}
                <Pressable
                  onPress={handlePickPhoto}
                  style={({ pressed }) => [
                    styles.photoCard,
                    photoUri ? styles.photoCardFilled : styles.photoCardEmpty,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  {photoUri ? (
                    <>
                      <Image source={{ uri: photoUri }} style={styles.photoImage} resizeMode="cover" />
                      <View style={styles.photoOverlayActions}>
                        <TouchableOpacity onPress={handlePickPhoto} style={styles.photoActionButton}>
                          <Text style={styles.photoActionText}>{t('social:replacePhoto')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setPhotoUri(null)} style={[styles.photoActionButton, styles.photoActionDanger]}>
                          <Text style={styles.photoActionText}>{t('social:removePhoto')}</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <View style={styles.photoEmptyInner}>
                      <View style={styles.photoOptionalChip}>
                        <Text style={styles.photoOptionalChipText}>{t('social:photoOptional')}</Text>
                      </View>
                      <Text style={styles.photoEmptyTitle}>{t('social:addPhoto')}</Text>
                      <View style={styles.photoVerticalNoteBadge}>
                        <Text style={styles.photoVerticalNoteText}>↕ {t('social:photoVerticalNote')}</Text>
                      </View>
                    </View>
                  )}
                </Pressable>

                {/* 2. Title */}
                <Text style={styles.sectionLabel}>{t('social:editTitle')}</Text>
                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder={metrics?.workoutTitle}
                  placeholderTextColor={BrandColors.textTertiary}
                  maxLength={80}
                />

                {/* 3. What to share — always render the applicable toggle
                    set; toggles with no underlying data render disabled +
                    greyed so users still see what they *could* share. */}
                <Text style={styles.sectionLabel}>{t('social:whatToShare')}</Text>
                <View style={styles.optionsCard}>
                  {(isWorkoutPayload || !isActivityPayload) && (
                    <>
                      <ToggleRow
                        label={t('social:optExercises')}
                        value={hasExercises && share.exercises}
                        onChange={(v) => setShare({ ...share, exercises: v })}
                        detail={hasExercises
                          ? t('social:optExercisesDetail', { count: metrics!.exercises.length })
                          : t('social:metricUnavailable')}
                        disabled={!hasExercises}
                      />
                      <ToggleRow
                        label={t('social:optKcals')}
                        value={hasKcal && share.kcals}
                        onChange={(v) => setShare({ ...share, kcals: v })}
                        detail={hasKcal ? `${metrics!.totalKcal} kcal` : t('social:metricUnavailable')}
                        disabled={!hasKcal}
                      />
                      <ToggleRow
                        label={t('social:optTotalVolume')}
                        value={hasVolume && share.totalVolume}
                        onChange={(v) => setShare({ ...share, totalVolume: v })}
                        detail={hasVolume ? formatVolume(metrics!.totalVolumeKg) : t('social:metricUnavailable')}
                        disabled={!hasVolume}
                      />
                      <ToggleRow
                        label={t('social:optNewPR')}
                        value={hasPR && share.newPR}
                        onChange={(v) => setShare({ ...share, newPR: v })}
                        detail={hasPR
                          ? metrics!.newPRs.map(pr => pr.exerciseName).join(', ')
                          : t('social:metricUnavailable')}
                        disabled={!hasPR}
                      />
                    </>
                  )}
                  {isActivityPayload && (
                    <>
                      <ToggleRow
                        label={t('social:optKcals')}
                        value={hasKcal && share.kcals}
                        onChange={(v) => setShare({ ...share, kcals: v })}
                        detail={hasKcal ? `${metrics!.totalKcal} kcal` : t('social:metricUnavailable')}
                        disabled={!hasKcal}
                      />
                      <ToggleRow
                        label={t('social:optDistance')}
                        value={hasDistance && share.distance}
                        onChange={(v) => setShare({ ...share, distance: v })}
                        detail={hasDistance
                          ? formatDistance(metrics!.activity!.distanceValue!, metrics!.activity!.distanceUnit!)
                          : t('social:metricUnavailable')}
                        disabled={!hasDistance}
                      />
                      <ToggleRow
                        label={t('social:optAltitude')}
                        value={hasAltitude && share.altitude}
                        onChange={(v) => setShare({ ...share, altitude: v })}
                        detail={hasAltitude
                          ? `+${Math.round(metrics!.activity!.elevationGainMeters!)} m`
                          : t('social:metricUnavailable')}
                        disabled={!hasAltitude}
                      />
                    </>
                  )}
                </View>

                <View style={{ height: 24 }} />
              </>
            ) : (
              <>
                {/* Step 2: Preview, location, visibility */}
                <Text style={styles.sectionLabel}>{t('social:previewLabel')}</Text>
                {renderPreview()}

                <Text style={styles.sectionLabel}>{t('social:locationPlaceholder')}</Text>
                <TextInput
                  style={styles.titleInput}
                  value={location}
                  onChangeText={setLocation}
                  placeholder={t('social:locationOptionalHint')}
                  placeholderTextColor={BrandColors.textTertiary}
                  maxLength={80}
                  autoCorrect={false}
                />

                <Text style={styles.sectionLabel}>{t('social:visibilityLabel')}</Text>
                <View style={styles.segmentedRow}>
                  <SegmentButton
                    selected={visibility === 'circle'}
                    label={t('social:visibilityCircle')}
                    subtitle={t('social:visibilityCircleHint')}
                    onPress={() => setVisibility('circle')}
                  />
                  <SegmentButton
                    selected={visibility === 'public'}
                    label={t('social:visibilityPublic')}
                    subtitle={t('social:visibilityPublicHint')}
                    onPress={() => setVisibility('public')}
                  />
                </View>

                <View style={{ height: 24 }} />
              </>
            )}
          </ScrollView>

          {metricsAvailable && step === 1 && (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
              <TouchableOpacity
                style={styles.shareCta}
                onPress={() => setStep(2)}
                activeOpacity={0.85}
              >
                <Text style={styles.shareCtaText}>{t('social:continue')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {metricsAvailable && step === 2 && (
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
              <TouchableOpacity
                style={[styles.shareCta, posting && styles.shareCtaDisabled]}
                onPress={handleShare}
                disabled={posting}
                activeOpacity={0.85}
              >
                {posting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.shareCtaText}>{t('social:shareCta')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>

        {photoPickerOpen ? (
          <View style={styles.photoPickerOverlay} pointerEvents="box-none">
            <Pressable
              style={styles.photoPickerBackdrop}
              onPress={() => setPhotoPickerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={t('common:cancel')}
            >
              <Pressable
                style={[styles.photoPickerSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.photoPickerHandle} />
                <Text style={styles.photoPickerTitle}>{t('social:addPhoto')}</Text>

                <View style={styles.photoPickerOptions}>
                  <TouchableOpacity
                    style={styles.photoPickerOption}
                    onPress={handlePhotoFromCamera}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <View style={styles.photoPickerIconCircle}>
                      <Icon source={appIcons.camera} width={22} height={22} fill={BrandColors.accent} />
                    </View>
                    <Text style={styles.photoPickerOptionLabel}>{t('social:avatarPickFromCamera')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.photoPickerOption}
                    onPress={handlePhotoFromLibrary}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <View style={styles.photoPickerIconCircle}>
                      <Icon source={appIcons.gallery_thumbnail} width={22} height={22} fill={BrandColors.accent} />
                    </View>
                    <Text style={styles.photoPickerOptionLabel}>{t('social:avatarPickFromLibrary')}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.photoPickerDismiss}
                  onPress={() => setPhotoPickerOpen(false)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.photoPickerDismissText}>{t('common:cancel')}</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
};

// ─── Local subcomponents ────────────────────────────────────────────────────

function ToggleRow({
  label,
  value,
  onChange,
  detail,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDetail} numberOfLines={1}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#3A484C', true: BrandColors.accent }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#3A484C"
      />
    </View>
  );
}

function SegmentButton({
  selected,
  label,
  subtitle,
  onPress,
}: {
  selected: boolean;
  label: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.segmentBtn, selected && styles.segmentBtnSelected]}
      activeOpacity={0.85}
    >
      <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{label}</Text>
      <Text style={[styles.segmentSubtitle, selected && styles.segmentSubtitleSelected]}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BrandColors.backgroundPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: 'rgba(244,124,60,0.15)',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    minWidth: 60,
  },
  headerCancelText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  centerLoader: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textTertiary,
  },
  sectionLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.meta,
    color: BrandColors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  // ── Photo card ──
  photoCard: {
    alignSelf: 'center',
    width: '68%',
    maxWidth: 300,
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
    backgroundColor: BrandColors.backgroundSecondary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  photoCardEmpty: {
    borderStyle: 'dashed',
    borderColor: 'rgba(244,124,60,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCardFilled: {
    borderStyle: 'solid',
  },
  photoImage: {
    ...StyleSheet.absoluteFillObject,
  },
  photoOverlayActions: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  photoActionButton: {
    backgroundColor: 'rgba(11,17,20,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  photoActionDanger: {
    backgroundColor: 'rgba(198,91,91,0.85)',
  },
  photoActionText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.metaSmall,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  photoEmptyInner: {
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 6,
  },
  photoOptionalChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(244,124,60,0.18)',
    marginBottom: 4,
  },
  photoOptionalChipText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.accent,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  photoEmptyTitle: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.accent,
    marginBottom: 4,
  },
  photoVerticalNoteBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(78,205,196,0.18)',
  },
  photoVerticalNoteText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: '#4ECDC4',
    letterSpacing: 0.4,
  },
  // ── Title input ──
  titleInput: {
    backgroundColor: BrandColors.inputBackground,
    borderWidth: 1,
    borderColor: BrandColors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontFamily: FontFamily.bodyBold,
    fontSize: 19,
    color: BrandColors.textPrimary,
  },
  // ── Options card ──
  optionsCard: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingHorizontal: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomColor: BrandColors.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleRowDisabled: {
    opacity: 0.45,
  },
  toggleLabel: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  toggleDetail: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginTop: 2,
  },
  // ── Preview ──
  previewCard: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    overflow: 'hidden',
    shadowColor: BrandColors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 4,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  previewAvatarFallback: {
    backgroundColor: '#1E2A2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewAvatarText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
  },
  previewAuthor: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  previewMeta: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
    marginTop: 1,
  },
  previewPhoto: {
    width: '75%',
    alignSelf: 'center',
    aspectRatio: 4 / 5,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0B1114',
  },
  previewBody: {
    padding: 14,
    gap: 10,
  },
  previewTitle: {
    fontFamily: FontFamily.bodyBold,
    fontSize: 19,
    color: BrandColors.textPrimary,
  },
  previewLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -2,
  },
  previewLocationGlyph: {
    fontSize: 13,
  },
  previewLocationText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    flex: 1,
    minWidth: 0,
  },
  prRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  prChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.accent,
    backgroundColor: 'rgba(244,124,60,0.12)',
  },
  prChipLabel: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.metaSmall,
    color: BrandColors.accent,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  prChipText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textPrimary,
    flexShrink: 1,
  },
  previewDismissBtn: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  previewDismissText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: 18,
    lineHeight: 20,
    color: BrandColors.textTertiary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BrandColors.backgroundTertiary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  chipValue: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  chipUnit: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
  },
  exerciseList: {
    paddingTop: 4,
    gap: 4,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseName: {
    flex: 1,
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.bodySmall,
    color: BrandColors.textPrimary,
  },
  exerciseSummary: {
    flexShrink: 1,
    maxWidth: '42%',
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textSecondary,
    textAlign: 'right',
  },
  // ── Segmented ──
  segmentedRow: {
    flexDirection: 'row',
    gap: 10,
  },
  segmentBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    backgroundColor: BrandColors.backgroundSecondary,
  },
  segmentBtnSelected: {
    borderColor: BrandColors.accent,
    backgroundColor: 'rgba(244,124,60,0.08)',
  },
  segmentLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  segmentLabelSelected: {
    color: BrandColors.accent,
  },
  segmentSubtitle: {
    marginTop: 2,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.metaSmall,
    color: BrandColors.textTertiary,
  },
  segmentSubtitleSelected: {
    color: BrandColors.textSecondary,
  },
  // ── Footer ──
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: BrandColors.backgroundPrimary,
    borderTopColor: 'rgba(244,124,60,0.15)',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  shareCta: {
    backgroundColor: BrandColors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  shareCtaDisabled: {
    opacity: 0.6,
  },
  shareCtaText: {
    fontFamily: FontFamily.bodyBold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  // ── Photo source picker (branded bottom sheet) ──
  photoPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  photoPickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: BrandColors.overlayDark,
  },
  photoPickerSheet: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  photoPickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BrandColors.inputBorder,
    alignSelf: 'center',
    marginBottom: 16,
    opacity: 0.7,
  },
  photoPickerTitle: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  photoPickerOptions: {
    gap: 8,
    marginBottom: 12,
  },
  photoPickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: BrandColors.backgroundTertiary,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
  },
  photoPickerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244,124,60,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244,124,60,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPickerOptionLabel: {
    flex: 1,
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  photoPickerDismiss: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  photoPickerDismissText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
});
