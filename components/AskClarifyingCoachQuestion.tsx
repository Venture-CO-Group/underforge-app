import Slider from '@react-native-community/slider';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily } from '../constants/Typography';
import { glowLogger } from '../lib/glow-logger';
import { OnboardingConfig } from '../types/onboarding_config';
import { BodyMapSelector } from './BodyMapSelector';
import {
  CardioTriadSelector,
  CardioTriadValue,
  EMPTY_TRIAD,
  isCardioTriadComplete,
  parseCardioTriadAnswer,
  stringifyCardioTriad,
} from './CardioTriadSelector';
import { CoachInfoHeader } from './CoachInfoHeader';
import { QuantitativeGoalChart } from './QuantitativeGoalChart';
import { SectionKey, SectionNavigator } from './SectionNavigator';
import { ShaderBackground } from './ShaderBackground';

interface AskClarifyingCoachQuestionProps {
  config: OnboardingConfig;
  selectedCoach: string;
  questionKey: string;
  questionConfig: any;
  userAnswer?: any;
  isLoading?: boolean;
  questionNumber?: number;
  totalQuestions?: number;
  onAnswerChange: (answer: any) => void;
  onNext: () => void;
  onPrevious?: () => void;
  canGoBack?: boolean;
  hideSectionNavigator?: boolean;
  userGender?: string;
  /** Renders at the top of the scroll content (e.g. survey modal header). Scrolls with everything else. */
  headerSlot?: React.ReactNode;
}

// Helper to determine which section a question belongs to
const getQuestionSection = (questionKey: string, config: OnboardingConfig): SectionKey => {
  try {
    const sections = {
      'you': config.common_general_information || [],
      'training_familiarity': config.common_training_familiarity || [],
      'health': [
        ...((config as any).common_nutrition_initial || []),
        ...((config as any).common_sleep_and_stress_initial || []),
        ...(config.common_health_background || []),
      ],
    };

    for (const [sectionKey, questions] of Object.entries(sections)) {
      if (Array.isArray(questions) && questions.includes(questionKey)) {
        return sectionKey;
      }
    }

    // Goal-specific quantitative targets -> You
    if (questionKey.startsWith('quantitative_goal_')) {
      return 'you';
    }

    // "What held you back" barriers -> Training
    if (questionKey.startsWith('what_held_back_')) {
      return 'training_familiarity';
    }

    // Other training-specific questions
    if (questionKey.includes('_training_') || questionKey.includes('lift_') ||
        questionKey.includes('rm_') || questionKey.includes('cardio_')) {
      return 'training_familiarity';
    }

    // Injury details conditional question -> Health
    if (questionKey === 'injury_details') {
      return 'health';
    }

    return 'other';
  } catch (error) {
    glowLogger.error('Error determining question section', {
      questionKey,
      error: error instanceof Error ? error.message : String(error)
    });
    return 'other';
  }
};

export const AskClarifyingCoachQuestion: React.FC<AskClarifyingCoachQuestionProps> = ({
  config,
  selectedCoach,
  questionKey,
  questionConfig,
  userAnswer = '',
  isLoading = false,
  questionNumber = 1,
  totalQuestions = 1,
  onAnswerChange,
  onNext,
  onPrevious,
  canGoBack = false,
  hideSectionNavigator = false,
  userGender,
  headerSlot,
}) => {
  // Ensure inputValue is always a string
  const getStringValue = (value: any): string => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return '';
  };

  const [inputValue, setInputValue] = useState(getStringValue(userAnswer));
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>(Array.isArray(userAnswer) ? userAnswer : []);
  const [sliderValue, setSliderValue] = useState<number>(
    questionConfig?.ui_widget === 'slider'
      ? (typeof userAnswer === 'number' ? userAnswer : Number(questionConfig.ui_widget_options?.[0]) || 1)
      : 1
  );
  const [otherValue, setOtherValue] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [bodyMapParts, setBodyMapParts] = useState<string[]>(Array.isArray(userAnswer) ? userAnswer : []);
  const [scrollEnabled, setScrollEnabled] = useState<boolean>(true);
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const insets = useSafeAreaInsets();
  const [cardioTriad, setCardioTriad] = useState<CardioTriadValue>(
    questionConfig?.ui_widget === 'cardio_triad'
      ? parseCardioTriadAnswer(userAnswer)
      : { ...EMPTY_TRIAD },
  );
  const scrollViewRef = useRef<ScrollView>(null);
  const otherInputRef = useRef<TextInput>(null);
  const textInputRef = useRef<TextInput>(null);
  const widgetYRef = useRef(0);
  const { t, i18n } = useTranslation(['onboarding']);
  const isSpanish = i18n.language?.startsWith('es');
  const isEmbedded = !!headerSlot;

  const scrollToInput = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, widgetYRef.current - 16),
          animated: true,
        });
      }, 100);
    });
  };

  // Returns translated display options; falls back to English options.
  // IMPORTANT: answers are always stored as English values so LLM prompts stay consistent.
  const getDisplayOptions = (cfg: any): string[] => {
    if (isSpanish && cfg?.ui_widget_options_es) {
      return cfg.ui_widget_options_es;
    }
    return cfg?.ui_widget_options || [];
  };

  useEffect(() => {
    // Reset "Other" input on question change
    setOtherValue('');

    if (questionConfig?.ui_widget === 'text') {
      setInputValue(getStringValue(userAnswer));
    } else if (questionConfig?.ui_widget === 'picker') {
      const ans = userAnswer || null;
      if (typeof ans === 'string' && ans.startsWith('Other: ')) {
        setSelectedOption('Other');
        setOtherValue(ans.replace('Other: ', ''));
      } else {
        setSelectedOption(ans);
      }
    } else if (questionConfig?.ui_widget === 'multi_select') {
      const initialArr = Array.isArray(userAnswer) ? userAnswer : [];
      const optionsForState: string[] = [];
      let foundOtherValue = '';

      for (const item of initialArr) {
        if (typeof item === 'string' && item.startsWith('Other: ')) {
          optionsForState.push('Other');
          foundOtherValue = item.replace('Other: ', '');
        } else {
          optionsForState.push(item);
        }
      }
      setSelectedOptions(optionsForState);
      if (foundOtherValue) {
        setOtherValue(foundOtherValue);
      }
    } else if (questionConfig?.ui_widget === 'slider' && typeof userAnswer === 'number') {
      setSliderValue(userAnswer);
    } else if (questionConfig?.ui_widget === 'body_map' || questionConfig?.ui_widget === 'body_map_focus') {
      setBodyMapParts(Array.isArray(userAnswer) ? userAnswer : []);
    } else if (questionConfig?.ui_widget === 'cardio_triad') {
      setCardioTriad(parseCardioTriadAnswer(userAnswer));
    }
  }, [questionKey, userAnswer, questionConfig]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardVisible && questionConfig?.ui_widget === 'text') {
      scrollToInput();
    }
  }, [keyboardVisible, questionConfig?.ui_widget, questionKey]);

  // Scroll to "Other" input when it appears
  useEffect(() => {
    const hasOtherMulti =
      questionConfig?.ui_widget === 'multi_select' &&
      selectedOptions.some(opt => opt?.toLowerCase() === 'other');
    const hasOtherPicker =
      questionConfig?.ui_widget === 'picker' &&
      selectedOption?.toLowerCase() === 'other';
    if (hasOtherMulti || hasOtherPicker) {
      // Use requestAnimationFrame for smoother scroll after render
      requestAnimationFrame(() => {
        setTimeout(() => {
          otherInputRef.current?.focus();
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      });
    }
  }, [selectedOptions, selectedOption, questionConfig, questionKey]);

  const selectedCoachInfo = config.general_info.coach_selection[selectedCoach];
  
  // Determine current section
  const currentSection = getQuestionSection(questionKey, config);
  // Hide navigator for back-matter / final 'anything_else_for_coach' question
  const isBackMatterQuestion = Array.isArray((config as any).back_matter_questions) && (config as any).back_matter_questions.includes(questionKey);
  const hideNavigator = hideSectionNavigator || isBackMatterQuestion || questionKey === 'anything_else_for_coach';

  const handleTextChange = (text: string) => {
    setInputValue(text);
    onAnswerChange(text);
  };

  const handlePickerSelect = (option: string) => {
    setSelectedOption(option);
    onAnswerChange(option);
  };

  const handleMultiSelectToggle = (option: string) => {
    let newSelectedOptions;
    if (selectedOptions.includes(option)) {
      newSelectedOptions = selectedOptions.filter(item => item !== option);
    } else {
      newSelectedOptions = [...selectedOptions, option];
    }
    setSelectedOptions(newSelectedOptions);
    onAnswerChange(newSelectedOptions);
  };

  const handleSliderChange = (value: number) => {
    setSliderValue(value);
    onAnswerChange(value);
  };

  const handleBodyMapChange = (parts: string[]) => {
    setBodyMapParts(parts);
    onAnswerChange(parts);
  };

  const handleCardioTriadChange = (next: CardioTriadValue) => {
    setCardioTriad(next);
    // Always emit the (potentially partial) state as JSON so we can recover
    // it if the user navigates back. `canProceed` blocks Next until the
    // triad is complete.
    onAnswerChange(stringifyCardioTriad(next));
  };

  const handleNext = () => {
    let finalAnswer = userAnswer;

    // For optional questions, if user hasn't provided any input, send empty answer
    if (questionConfig?.optional) {
      const hasAnswer = (() => {
        switch (questionConfig.ui_widget) {
          case 'text':
            return inputValue.trim().length > 0;
          case 'picker':
            return selectedOption !== null && (!selectedOption?.toLowerCase().includes('other') || otherValue.trim().length > 0);
          case 'multi_select':
            return selectedOptions.length > 0 && (!selectedOptions.some(opt => opt?.toLowerCase() === 'other') || otherValue.trim().length > 0);
          case 'slider':
            return true; // Sliders always have a value
          case 'body_map':
            return true; // Empty selection means "no pain" which is valid
          case 'body_map_focus':
            return bodyMapParts.length > 0;
          case 'cardio_triad':
            return isCardioTriadComplete(cardioTriad);
          default:
            return false;
        }
      })();

      if (!hasAnswer) {
        onAnswerChange(''); // Send empty answer for skipped optional questions
        onNext();
        return;
      }
    }

    if (
      questionConfig?.ui_widget === 'multi_select' &&
      selectedOptions.some(opt => opt?.toLowerCase() === 'other')
    ) {
      // Replace "Other"/"other" with the specified value
      const updatedOptions = selectedOptions.map(opt =>
        opt?.toLowerCase() === 'other' ? `Other: ${otherValue.trim()}` : opt
      );
      finalAnswer = updatedOptions;
      onAnswerChange(updatedOptions);
    } else if (
      questionConfig?.ui_widget === 'picker' &&
      selectedOption?.toLowerCase() === 'other'
    ) {
      finalAnswer = `Other: ${otherValue.trim()}`;
      onAnswerChange(finalAnswer);
    } else if (questionConfig?.ui_widget === 'body_map' || questionConfig?.ui_widget === 'body_map_focus') {
      finalAnswer = bodyMapParts;
      onAnswerChange(finalAnswer);
    } else {
      onAnswerChange(finalAnswer);
    }

    onNext();
  };

  const hasUserProvidedAnswer = (): boolean => {
    if (!questionConfig) return false;

    switch (questionConfig.ui_widget) {
      case 'text':
        return inputValue.trim().length > 0;
      case 'picker':
        if (selectedOption?.toLowerCase() === 'other') {
          return otherValue.trim().length > 0;
        }
        return selectedOption !== null;
      case 'multi_select':
        if (selectedOptions.length === 0) return false;
        if (selectedOptions.some(opt => opt?.toLowerCase() === 'other')) {
          return otherValue.trim().length > 0;
        }
        return true;
      case 'slider':
        return true; // Sliders always have a value
      case 'body_map':
        return true; // Empty array (no pain) is a valid answer
      case 'body_map_focus':
        return bodyMapParts.length > 0;
      case 'cardio_triad':
        return isCardioTriadComplete(cardioTriad);
      default:
        return false;
    }
  };

  const canProceed = () => {
    if (!questionConfig) return true; // Allow proceeding if question config is missing

    // If question is optional, user can always proceed (skip)
    if (questionConfig.optional) {
      return true;
    }

    return hasUserProvidedAnswer();
  };

  const renderQuestionWidget = () => {
    if (!questionConfig) {
      glowLogger.error('Question configuration not found', {
        question_key: questionKey,
        question_number: questionNumber,
        total_questions: totalQuestions,
        selected_coach: selectedCoach
      });
      return null;
    }

    switch (questionConfig.ui_widget) {
      case 'text':
        return (
            <TextInput
            ref={textInputRef}
            style={styles.textInput}
            value={inputValue}
            onChangeText={handleTextChange}
            onFocus={scrollToInput}
            placeholder={
              questionConfig.optional
                ? t('onboarding:questionTextPlaceholderOptional')
                : t('onboarding:questionTextPlaceholder')
            }
            placeholderTextColor="#999"
            multiline={true}
            textAlignVertical="top"
            scrollEnabled={false}
          />
        );

      case 'picker':
        // Quantitative goal questions get a visual chart selector
        if (questionKey.startsWith('quantitative_goal_')) {
          const chartOptions = questionConfig.ui_widget_options || [];
          const chartDisplayOptions = getDisplayOptions(questionConfig);
          const chartSelectedIdx = selectedOption
            ? chartOptions.indexOf(selectedOption)
            : null;
          return (
            <QuantitativeGoalChart
              questionKey={questionKey}
              options={chartOptions}
              displayOptions={chartDisplayOptions}
              selectedIndex={chartSelectedIdx === -1 ? null : chartSelectedIdx}
              onSelect={(index: number) => {
                const option = chartOptions[index];
                if (option) handlePickerSelect(option);
              }}
            />
          );
        }

        // Check if this is a scrollable picker (age, height, weight, 10RM/1RM fields)
        const isScrollablePicker = [
          'current_age_question',
          'current_height_question',
          'current_weight_question',
          '10rm_squat',
          '10rm_bench',
          '1rm_squat',
          '1rm_bench'
        ].includes(questionKey);
        
        if (isScrollablePicker) {
          const scrollEnOptions: string[] = questionConfig.ui_widget_options || [];
          const scrollDisplayOptions = getDisplayOptions(questionConfig);
          // Find the display label for the currently selected English value
          const selectedDisplayLabel = selectedOption
            ? (scrollDisplayOptions[scrollEnOptions.indexOf(selectedOption)] ?? selectedOption)
            : (scrollDisplayOptions[0] ?? scrollEnOptions[0] ?? '');

          if (Platform.OS === 'android') {
            // Custom modal picker for Android with dark theme
            return (
              <>
                <TouchableOpacity
                  style={styles.androidPickerButton}
                  onPress={() => setShowCustomPicker(true)}
                >
                  <Text style={styles.androidPickerButtonText}>
                    {selectedDisplayLabel || 'Select...'}
                  </Text>
                  <Text style={styles.androidPickerButtonArrow}>▼</Text>
                </TouchableOpacity>
                <Modal
                  visible={showCustomPicker}
                  transparent={true}
                  animationType="slide"
                  onRequestClose={() => setShowCustomPicker(false)}
                >
                  <View style={styles.customPickerModalOverlay}>
                    <View style={styles.customPickerModalContent}>
                      <View style={styles.customPickerHeader}>
                        <TouchableOpacity onPress={() => setShowCustomPicker(false)}>
                          <Text style={styles.customPickerCancelText}>{t('common:cancel')}</Text>
                        </TouchableOpacity>
                        <Text style={styles.customPickerTitle}>{isSpanish ? 'Seleccionar' : 'Select Option'}</Text>
                        <TouchableOpacity onPress={() => setShowCustomPicker(false)}>
                          <Text style={styles.customPickerDoneText}>{t('common:done')}</Text>
                        </TouchableOpacity>
                      </View>
                      <FlatList
                        data={scrollEnOptions}
                        keyExtractor={(item, index) => `${item}-${index}`}
                        renderItem={({ item, index }) => {
                          const displayLabel = scrollDisplayOptions[index] ?? item;
                          return (
                            <TouchableOpacity
                              style={[
                                styles.customPickerItem,
                                selectedOption === item && styles.customPickerItemSelected
                              ]}
                              onPress={() => {
                                handlePickerSelect(item);
                                setShowCustomPicker(false);
                              }}
                            >
                              <Text style={[
                                styles.customPickerItemText,
                                selectedOption === item && styles.customPickerItemTextSelected
                              ]}>
                                {displayLabel}
                              </Text>
                              {selectedOption === item && (
                                <Text style={styles.customPickerCheckmark}>✓</Text>
                              )}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </View>
                  </View>
                </Modal>
              </>
            );
          }
          // iOS uses native Picker — value stays English, label is translated
          return (
            <View style={styles.nativePickerContainer}>
              <Picker
                selectedValue={selectedOption || scrollEnOptions[0]}
                onValueChange={(itemValue) => handlePickerSelect(itemValue)}
                style={styles.nativePicker}
                itemStyle={styles.nativePickerItem}
              >
                {scrollEnOptions.map((option: string, index: number) => (
                  <Picker.Item
                    key={index}
                    label={scrollDisplayOptions[index] ?? option}
                    value={option}
                    color="#F2F2EE"
                  />
                ))}
              </Picker>
              <View style={styles.pickerSelectionOverlay} pointerEvents="none" />
            </View>
          );
        }
        
        // Regular button-style picker for other questions
        {
          const pickerEnOptions: string[] = questionConfig.ui_widget_options || [];
          const pickerDisplayOptions = getDisplayOptions(questionConfig);
          return (
          <View style={styles.pickerContainer}>
            {pickerEnOptions.map((option: string, index: number) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.pickerOption,
                  selectedOption === option && styles.pickerOptionSelected
                ]}
                onPress={() => handlePickerSelect(option)}
              >
                <Text style={[
                  styles.pickerOptionText,
                  selectedOption === option && styles.pickerOptionTextSelected
                ]}>
                  {pickerDisplayOptions[index] ?? option}
                </Text>
              </TouchableOpacity>
            ))}
            {/* Show Other input if "Other" or "other" is selected */}
            {(selectedOption?.toLowerCase() === 'other') && (
              <View style={styles.otherInputContainer}>
                <Text style={styles.otherInputLabel}>
                  {questionConfig.other_specify?.label_es || questionConfig.other_specify?.label_en || t('onboarding:questionOtherLabel')}
                </Text>
                <TextInput
                  ref={otherInputRef}
                  style={styles.otherInput}
                  value={otherValue}
                  onChangeText={setOtherValue}
                  placeholder={
                    questionConfig.optional
                      ? t('onboarding:questionOtherPlaceholderOptional')
                      : t('onboarding:questionOtherPlaceholder')
                  }
                  placeholderTextColor="#999"
                  multiline={true}
                  textAlignVertical="top"
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>
        );
        }

      case 'multi_select':
        {
          const msEnOptions: string[] = questionConfig.ui_widget_options || [];
          const msDisplayOptions = getDisplayOptions(questionConfig);
          return (
          <View style={styles.multiSelectContainer}>
            {msEnOptions.map((option: string, index: number) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.multiSelectOption,
                  selectedOptions.includes(option) && styles.multiSelectOptionSelected
                ]}
                onPress={() => handleMultiSelectToggle(option)}
              >
                <Text style={[
                  styles.multiSelectOptionText,
                  selectedOptions.includes(option) && styles.multiSelectOptionTextSelected
                ]}>
                  {msDisplayOptions[index] ?? option}
                </Text>
                {selectedOptions.includes(option) && (
                  <View style={styles.checkmarkContainer}>
                    <Text style={styles.checkmark}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
            {/* Show Other input if "Other" or "other" is selected */}
            {selectedOptions.some(opt => opt?.toLowerCase() === 'other') && (
              <View style={styles.otherInputContainer}>
                <Text style={styles.otherInputLabel}>
                  {questionConfig.other_specify?.label_es || questionConfig.other_specify?.label_en || t('onboarding:questionOtherLabel')}
                </Text>
                <TextInput
                  ref={otherInputRef}
                  style={styles.otherInput}
                  value={otherValue}
                  onChangeText={setOtherValue}
                  placeholder={
                    questionConfig.optional
                      ? t('onboarding:questionOtherPlaceholderOptional')
                      : t('onboarding:questionOtherPlaceholder')
                  }
                  placeholderTextColor="#999"
                  multiline={true}
                  textAlignVertical="top"
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>
        );
        }

      case 'body_map':
      case 'body_map_focus': {
        const bodyGender: 'male' | 'female' =
          userGender?.toLowerCase() === 'male' ? 'male' : 'female';
        const mapVariant = questionConfig.ui_widget === 'body_map_focus' ? 'focus' : 'pain';
        return (
          <BodyMapSelector
            selectedParts={bodyMapParts}
            onPartsChange={handleBodyMapChange}
            gender={bodyGender}
            variant={mapVariant}
          />
        );
      }

      case 'cardio_triad':
        return (
          <CardioTriadSelector
            value={cardioTriad}
            onChange={handleCardioTriadChange}
            onInteractionChange={(active) => setScrollEnabled(!active)}
          />
        );

      case 'slider':
        {
          const minValue = Number(questionConfig.ui_widget_options?.[0]) || 1;
          const maxValue = Number(questionConfig.ui_widget_options?.[1]) || 10;
          const sliderLabels = (isSpanish && questionConfig.ui_widget_options_labels_es)
            ? questionConfig.ui_widget_options_labels_es
            : questionConfig.ui_widget_options_labels;
          return (
            <View style={styles.sliderContainer}>
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderLabel}>{minValue}</Text>
                <Text style={styles.sliderValue}>{sliderValue}</Text>
                <Text style={styles.sliderLabel}>{maxValue}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={minValue}
                maximumValue={maxValue}
                step={1}
                value={sliderValue}
                onValueChange={handleSliderChange}
                minimumTrackTintColor="#F47C3C"
                maximumTrackTintColor="#E0E0E0"
                thumbTintColor="#F47C3C"
              />
              {sliderLabels && (
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabelText}>
                    {sliderLabels[0]}
                  </Text>
                  <Text style={styles.sliderLabelText}>
                    {sliderLabels[1]}
                  </Text>
                </View>
              )}
            </View>
          );
        }

      default:
        return <Text style={styles.errorText}>
          {t('onboarding:questionUnsupportedType', { type: String(questionConfig?.ui_widget ?? '') })}
        </Text>;
    }
  };

  if (!selectedCoachInfo) {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      {!isEmbedded && <ShaderBackground offsetY="70%" />}
      <SafeAreaView style={styles.safeArea} edges={isEmbedded ? [] : ['top', 'left', 'right']}>
        <KeyboardAvoidingView 
        style={[styles.container, isEmbedded && styles.containerEmbedded]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.contentContainer}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: keyboardVisible ? 12 : Math.max(insets.bottom, 12) },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={scrollEnabled}
          >
            {headerSlot ? (
              <View style={styles.embeddedHeader}>{headerSlot}</View>
            ) : null}

            <View style={styles.headerSection}>
              {questionKey === 'typical_day_eating' ? (
                <Image
                  source={require('../assets/images/coaches/emotions/1_manu_rodriguez_explaining.jpeg')}
                  style={styles.coachExplainingImage}
                  resizeMode="cover"
                />
              ) : (
                <CoachInfoHeader 
                  config={config} 
                  selectedCoach={selectedCoach} 
                  imageSize="small" 
                />
              )}
            </View>

            {!hideNavigator && (
              <SectionNavigator activeSection={currentSection} />
            )}

            <Text style={[styles.questionText, questionKey === 'typical_day_eating' && { marginTop: 16 }]}>
              {(() => {
                const baseLabel = (i18n.language?.startsWith('es') && questionConfig?.label_es) || questionConfig?.label_en || '';
                const highlight = t('onboarding:questionHighlightModeratePain');
                const idx = baseLabel.indexOf(highlight);
                if (idx === -1) return baseLabel || 'Question';
                return (
                  <>
                    {baseLabel.slice(0, idx)}
                    <Text style={{ color: '#F47C3C' }}>{highlight}</Text>
                    {baseLabel.slice(idx + highlight.length)}
                  </>
                );
              })()}
              {questionConfig?.optional && (
                <Text style={styles.optionalIndicator}> {t('onboarding:questionOptionalSuffix')}</Text>
              )}
            </Text>
            
            <View
              style={styles.widgetContainer}
              onLayout={(event) => {
                widgetYRef.current = event.nativeEvent.layout.y;
              }}
            >
              {renderQuestionWidget()}
            </View>

            <View style={styles.buttonSection}>
              <View style={styles.buttonRow}>
                {canGoBack && onPrevious && (
                  <TouchableOpacity 
                    style={styles.backButton} 
                    onPress={onPrevious}
                  >
                    <Text style={styles.backButtonText}>{t('onboarding:questionBack')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity 
                  style={[
                    styles.nextButton, 
                    !canProceed() && styles.nextButtonDisabled,
                    canGoBack && styles.nextButtonWithBack
                  ]} 
                  onPress={handleNext}
                  disabled={!canProceed()}
                >
                  <Text style={[styles.nextButtonText, !canProceed() && styles.nextButtonTextDisabled]}>
                    {questionConfig?.optional && !hasUserProvidedAnswer()
                      ? t('onboarding:questionSkip')
                      : t('onboarding:questionNext')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  containerEmbedded: {
    paddingTop: 0,
  },
  scrollContent: {
    flexGrow: 1,
  },
  embeddedHeader: {
    marginHorizontal: -24,
    marginBottom: 8,
  },
  headerSection: {
    paddingBottom: 0,
  },
  coachExplainingImage: {
    width: '100%',
    height: 300,
    borderRadius: 16,
    marginBottom: 8,
  },
  contentContainer: {
    flex: 1,
  },
  questionText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#F2F2EE',
    fontFamily: FontFamily.displayBold,
    marginBottom: 24,
    lineHeight: 28,
    textAlign: 'center',
  },
  optionalIndicator: {
    fontSize: 16,
    fontWeight: '400',
    color: '#F47C3C',
    fontStyle: 'italic',
  },
  widgetContainer: {
    marginBottom: 20,
  },
  buttonSection: {
    paddingTop: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    backgroundColor: '#E0E0E0',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#9AA3A6',
    fontSize: 14,
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: '#F47C3C',
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
    flex: 1,
  },
  nextButtonWithBack: {
    flex: 1,
  },
  nextButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  nextButtonTextDisabled: {
    color: '#6F7A7E',
  },
  errorText: {
    fontSize: 16,
    color: '#C65B5B',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  textInput: {
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 15,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#0E1A1A',
    color: '#F2F2EE',
    minHeight: 80,
    textAlignVertical: 'top',
    flexShrink: 1,
  },
  pickerContainer: {
    gap: 12,
  },
  pickerOption: {
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 15,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  pickerOptionSelected: {
    borderColor: '#F47C3C',
    backgroundColor: '#fff9f7',
  },
  pickerOptionText: {
    fontSize: 16,
    color: '#F2F2EE',
  },
  pickerOptionTextSelected: {
    color: '#F47C3C',
    fontWeight: '600',
  },
  nativePickerContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  nativePicker: {
    height: 216,
    backgroundColor: 'transparent',
  },
  nativePickerItem: {
    fontSize: 24,
    color: '#F2F2EE',
  },
  pickerItem: {
    color: Platform.OS === 'android' ? '#FFFFFF' : '#F2F2EE',
    fontSize: 24,
  },
  pickerSelectionOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 86,
    height: 44,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'transparent',
  },
  multiSelectContainer: {
    gap: 12,
  },
  multiSelectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 15,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  multiSelectOptionSelected: {
    borderColor: '#F47C3C',
    backgroundColor: '#fff9f7',
  },
  multiSelectOptionText: {
    fontSize: 16,
    color: '#F2F2EE',
    flex: 1,
  },
  multiSelectOptionTextSelected: {
    color: '#F47C3C',
    fontWeight: '500',
  },
  checkmarkContainer: {
    marginLeft: 8,
  },
  checkmark: {
    color: '#F47C3C',
    fontSize: 16,
    fontWeight: 'bold',
  },
  otherInputContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  otherInputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 12,
  },
  otherInput: {
    borderWidth: 2,
    borderColor: '#F47C3C',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#0E1A1A',
    color: '#F2F2EE',
    minHeight: 52,
    textAlignVertical: 'top',
  },
  sliderContainer: {
    paddingVertical: 20,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sliderLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  sliderValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#F47C3C',
  },
  slider: {
    width: '100%',
    height: 40,
    marginBottom: 20,
  },
  sliderThumb: {
    backgroundColor: '#F47C3C',
    width: 24,
    height: 24,
  },
  sliderLabelText: {
    fontSize: 14,
    color: '#9AA3A6',
    textAlign: 'center',
    fontStyle: 'italic',
    flex: 1,
  },
  // Custom Android Picker Styles
  androidPickerButton: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  androidPickerButtonText: {
    fontSize: 16,
    color: '#F2F2EE',
    flex: 1,
  },
  androidPickerButtonArrow: {
    fontSize: 12,
    color: '#F2F2EE',
    marginLeft: 8,
  },
  customPickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  customPickerModalContent: {
    backgroundColor: '#0E1A1A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: Platform.OS === 'android' ? 20 : 0,
  },
  customPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A2C',
  },
  customPickerCancelText: {
    fontSize: 17,
    color: '#F47C3C',
  },
  customPickerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F2F2EE',
  },
  customPickerDoneText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F47C3C',
  },
  customPickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A2C',
  },
  customPickerItemSelected: {
    backgroundColor: '#141E1E',
  },
  customPickerItemText: {
    fontSize: 17,
    color: '#F2F2EE',
    flex: 1,
  },
  customPickerItemTextSelected: {
    color: '#F47C3C',
    fontWeight: '600',
  },
  customPickerCheckmark: {
    fontSize: 18,
    color: '#F47C3C',
    fontWeight: 'bold',
  },
});