import { StyleSheet } from 'react-native';
import { BrandColors } from '../constants/Colors';
import { FontFamily, FontSize, LineHeight } from '../constants/Typography';

export const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: BrandColors.backgroundPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: BrandColors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.divider,
  },
  backButton: {
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  backButtonText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.body,
    color: BrandColors.accent,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
  },
  headerRight: { width: 64 },
  progressSection: {
    backgroundColor: BrandColors.backgroundSecondary,
    paddingHorizontal: 28,
    paddingTop: 26,
    paddingBottom: 22,
  },
  scroll: { flex: 1 },
  scrollContent: { 
    padding: 24, 
    paddingBottom: 88,
  },
  card: {
    backgroundColor: BrandColors.backgroundSecondary,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 12,
  },
  streakText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.body,
    color: BrandColors.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
    alignSelf: 'center',
  },
  dayCard: {
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  dayHeaderRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
  },
  dayLabel: { 
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.body, 
    color: BrandColors.textPrimary,
  },
  dayChevron: {
    fontSize: 24,
    lineHeight: 24,
    color: BrandColors.textTertiary,
    fontWeight: '500',
    transform: [{ rotate: '0deg' }],
    paddingLeft: 8,
  },
  dayChevronExpanded: { 
    transform: [{ rotate: '90deg' }],
  },
  dayProgressWrapper: {
    marginTop: 8,
    width: '75%',
    alignSelf: 'flex-start',
  },
  dayProgressText: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta,
    color: BrandColors.textTertiary,
    marginTop: 6,
    textAlign: 'left',
  },
  tasksContainer: { 
    marginTop: 12, 
    paddingLeft: 0,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  checkbox: {
    fontSize: FontSize.body,
    width: 24,
    textAlign: 'center',
  },
  taskText: {
    flex: 1,
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.bodySmall,
    lineHeight: LineHeight.bodySmall,
    color: BrandColors.textPrimary,
  },
  taskTextCompleted: { 
    textDecorationLine: 'line-through', 
    color: BrandColors.textTertiary,
  },
  taskRowDisabled: { 
    opacity: 0.4,
  },
  taskTextDisabled: { 
    color: BrandColors.textTertiary,
  },
  noTasksTextSmall: { 
    fontFamily: FontFamily.bodyRegular,
    fontSize: FontSize.meta, 
    color: BrandColors.textTertiary, 
    fontStyle: 'italic', 
    paddingTop: 6,
  },
});
