import React, { useState } from 'react';
import {
  Alert,
  Clipboard,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { updateUserProfile } from '../lib/supabase_db_new';
import { Onboard, hypothesisToLLMString } from '../types/onboard';
import { UserProfile } from '../types/user_profile';
import { FormattedStepDetails } from './FormattedStepDetails';

let onboardingConfig: any = null;
try {
  onboardingConfig = require('../assets/onboarding_config');
} catch (error) {
  console.warn('Failed to load onboarding config:', error);
}

interface DeveloperCoachEditPlanProps {
  visible: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  onUpdate?: (updatedData: Onboard) => void;
  readOnly?: boolean;
}

export const DeveloperCoachEditPlan: React.FC<DeveloperCoachEditPlanProps> = ({
  visible,
  onClose,
  userProfile,
  onUpdate,
  readOnly = false
}) => {
  const [editMode, setEditMode] = useState<'view' | 'edit' | 'confirm' | 'editStep' | 'confirmStep' | 'editStepDetails' | 'confirmStepDetails' | 'editStepRationale' | 'confirmStepRationale' | 'editStepDetailedRationale' | 'confirmStepDetailedRationale' | 'editStepBonusHacks' | 'confirmStepBonusHacks'>('view');
  const [editedRationale, setEditedRationale] = useState('');
  const [editingStepIndex, setEditingStepIndex] = useState<number>(-1);
  const [editedStepTitle, setEditedStepTitle] = useState('');
  const [editedStepDescription, setEditedStepDescription] = useState('');
  const [editedStepDetails, setEditedStepDetails] = useState('');
  const [editedStepRationale, setEditedStepRationale] = useState('');
  const [editedDetailedRationaleItems, setEditedDetailedRationaleItems] = useState<string[]>([]);
  const [editedBonusHacksItems, setEditedBonusHacksItems] = useState<string[]>([]);
  const { t, i18n } = useTranslation(['menu', 'common']);

  const onboardingData = userProfile.onboardingProfile;
  
  if (!onboardingData) {
    return null;
  }

  const getQuestionText = (questionKey: string): string => {
    if (!onboardingConfig?.question_bank) {
      return questionKey; // Fallback to question key if config not available
    }
    
    const questionConfig = onboardingConfig.question_bank[questionKey];
    const labelKey = i18n.language?.toLowerCase().startsWith('es') ? 'label_es' : 'label_en';
    if (questionConfig?.[labelKey]) {
      return questionConfig[labelKey];
    }
    if (questionConfig?.label_en) {
      return questionConfig.label_en;
    }
    
    return questionKey; // Fallback to question key if not found
  };

  const formatDaysOfWeek = (days?: string[], timeOfDay?: string) => {
    if (!days || days.length === 0) return t('menu:onboardingData.scheduleAsNeeded');
    
    const dayMap: { [key: string]: string } = {
      mon: t('menu:onboardingData.dayMon'),
      tue: t('menu:onboardingData.dayTue'),
      wed: t('menu:onboardingData.dayWed'),
      thu: t('menu:onboardingData.dayThu'),
      fri: t('menu:onboardingData.dayFri'),
      sat: t('menu:onboardingData.daySat'),
      sun: t('menu:onboardingData.daySun'),
    };

    let scheduleText = '';

    if (days.length === 7) {
      scheduleText = t('menu:onboardingData.scheduleDaily');
    } else if (days.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every(day => days.includes(day))) {
      scheduleText = t('menu:onboardingData.scheduleWeekdays');
    } else if (days.length === 2 && ['sat', 'sun'].every(day => days.includes(day))) {
      scheduleText = t('menu:onboardingData.scheduleWeekends');
    } else {
      scheduleText = days.map(day => dayMap[day] || day).join(', ');
    }
    
    // Add time if available - already in 24-hour format
    if (timeOfDay) {
      scheduleText += t('menu:onboardingData.scheduleAt', { time: timeOfDay });
    }
    
    return scheduleText;
  };

  const showReadOnlyAlert = () => {
    Alert.alert(t('menu:onboardingData.readOnlyTitle'), t('menu:onboardingData.readOnlyBody'));
  };

  const handleEditRationale = () => {
    if (readOnly) {
      showReadOnlyAlert();
      return;
    }
    setEditedRationale(onboardingData.actionPlan?.rationale || '');
    setEditMode('edit');
  };

  const handleEditStep = (stepIndex: number) => {
    if (readOnly) {
      showReadOnlyAlert();
      return;
    }
    const step = onboardingData.actionPlan?.steps[stepIndex];
    if (step) {
      setEditingStepIndex(stepIndex);
      setEditedStepTitle(step.title);
      setEditedStepDescription(step.description);
      setEditMode('editStep');
    }
  };

  const handleEditStepDetails = (stepIndex: number) => {
    if (readOnly) {
      showReadOnlyAlert();
      return;
    }
    const step = onboardingData.actionPlan?.steps[stepIndex];
    if (step && step.step_details) {
      setEditingStepIndex(stepIndex);
      // Convert step_details to string format for editing
      const detailsText = typeof step.step_details === 'string' 
        ? step.step_details 
        : Array.isArray(step.step_details) && step.step_details.length > 0 
          ? step.step_details.map(detail => detail.text).join('\n\n')
          : '';
      setEditedStepDetails(detailsText);
      setEditMode('editStepDetails');
    }
  };

  const handleEditStepRationale = (stepIndex: number) => {
    if (readOnly) {
      showReadOnlyAlert();
      return;
    }
    const step = onboardingData.actionPlan?.steps[stepIndex];
    if (step && step.rationale) {
      setEditingStepIndex(stepIndex);
      setEditedStepRationale(step.rationale);
      setEditMode('editStepRationale');
    }
  };

  const handleEditStepDetailedRationale = (stepIndex: number) => {
    if (readOnly) {
      showReadOnlyAlert();
      return;
    }
    const step = onboardingData.actionPlan?.steps[stepIndex];
    if (step && step.detailed_rationale) {
      setEditingStepIndex(stepIndex);
      // Extract just the text from each detailed rationale item
      const textItems = step.detailed_rationale.map(item => item.text);
      setEditedDetailedRationaleItems(textItems);
      setEditMode('editStepDetailedRationale');
    }
  };

  const handleEditStepBonusHacks = (stepIndex: number) => {
    if (readOnly) {
      showReadOnlyAlert();
      return;
    }
    const step = onboardingData.actionPlan?.steps[stepIndex];
    if (step && step.bonus_hacks) {
      setEditingStepIndex(stepIndex);
      // Extract just the text from each bonus hack item
      const textItems = step.bonus_hacks.map(hack => hack.text);
      setEditedBonusHacksItems(textItems);
      setEditMode('editStepBonusHacks');
    }
  };

  const handleCancelEdit = () => {
    setEditMode('view');
    setEditedRationale('');
    setEditingStepIndex(-1);
    setEditedStepTitle('');
    setEditedStepDescription('');
    setEditedStepDetails('');
    setEditedStepRationale('');
    setEditedDetailedRationaleItems([]);
    setEditedBonusHacksItems([]);
  };

  const handleSaveEdit = () => {
    setEditMode('confirm');
  };

  const handleSaveStepEdit = () => {
    setEditMode('confirmStep');
  };

  const handleSaveStepDetailsEdit = () => {
    setEditMode('confirmStepDetails');
  };

  const handleSaveStepRationaleEdit = () => {
    setEditMode('confirmStepRationale');
  };

  const handleSaveStepDetailedRationaleEdit = () => {
    setEditMode('confirmStepDetailedRationale');
  };

  const handleSaveStepBonusHacksEdit = () => {
    setEditMode('confirmStepBonusHacks');
  };

  const handleConfirmSave = async () => {
    try {
      if (!onboardingData.actionPlan) {
        Alert.alert(t('common:error'), t('menu:onboardingData.noActionPlanFound'));
        return;
      }

      // Update the onboarding data
      const updatedOnboardingData = {
        ...onboardingData,
        actionPlan: {
          ...onboardingData.actionPlan,
          rationale: editedRationale
        }
      };

      // Update the user profile with new onboarding data
      const updatedProfile = {
        ...userProfile,
        onboardingProfile: updatedOnboardingData
      };

      // Save to remote
      await updateUserProfile(updatedProfile);
      
      // Call onUpdate to refresh parent component
      onUpdate?.(updatedOnboardingData);

      Alert.alert(t('common:success'), t('menu:onboardingData.planRationaleUpdated'), [
        {
          text: t('common:ok'),
          onPress: () => {
            setEditMode('view');
            setEditedRationale('');
          }
        }
      ]);
    } catch (error) {
      console.error('Error updating plan rationale:', error);
      Alert.alert(t('common:error'), t('menu:onboardingData.planRationaleUpdateFailed'));
    }
  };

  const handleConfirmStepSave = async () => {
    try {
      if (!onboardingData.actionPlan || editingStepIndex < 0) {
        Alert.alert(t('common:error'), t('menu:onboardingData.noStepSelected'));
        return;
      }

      // Update the step in the action plan
      const updatedSteps = [...onboardingData.actionPlan.steps];
      updatedSteps[editingStepIndex] = {
        ...updatedSteps[editingStepIndex],
        title: editedStepTitle,
        description: editedStepDescription
      };

      const updatedOnboardingData = {
        ...onboardingData,
        actionPlan: {
          ...onboardingData.actionPlan,
          steps: updatedSteps
        }
      };

      // Update the user profile with new onboarding data
      const updatedProfile = {
        ...userProfile,
        onboardingProfile: updatedOnboardingData
      };

      // Save to remote
      await updateUserProfile(updatedProfile);
      
      // Call onUpdate to refresh parent component
      onUpdate?.(updatedOnboardingData);

      Alert.alert(t('common:success'), t('menu:onboardingData.stepUpdated'), [
        {
          text: t('common:ok'),
          onPress: () => {
            setEditMode('view');
            setEditingStepIndex(-1);
            setEditedStepTitle('');
            setEditedStepDescription('');
          }
        }
      ]);
    } catch (error) {
      console.error('Error updating step:', error);
      Alert.alert(t('common:error'), t('menu:onboardingData.stepUpdateFailed'));
    }
  };

  const handleConfirmStepDetailsave = async () => {
    try {
      if (!onboardingData.actionPlan || editingStepIndex < 0) {
        Alert.alert(t('common:error'), t('menu:onboardingData.noStepSelected'));
        return;
      }

      // Update the step details in the action plan
      const updatedSteps = [...onboardingData.actionPlan.steps];
      updatedSteps[editingStepIndex] = {
        ...updatedSteps[editingStepIndex],
        step_details: [{ text: editedStepDetails }]
      };

      const updatedOnboardingData = {
        ...onboardingData,
        actionPlan: {
          ...onboardingData.actionPlan,
          steps: updatedSteps
        }
      };

      // Update the user profile with new onboarding data
      const updatedProfile = {
        ...userProfile,
        onboardingProfile: updatedOnboardingData
      };

      await updateUserProfile(updatedProfile);
      onUpdate?.(updatedOnboardingData);

      Alert.alert(t('common:success'), t('menu:onboardingData.stepDetailsUpdated'), [
        {
          text: t('common:ok'),
          onPress: () => {
            setEditMode('view');
            setEditingStepIndex(-1);
            setEditedStepDetails('');
          }
        }
      ]);
    } catch (error) {
      console.error('Error updating step details:', error);
      Alert.alert(t('common:error'), t('menu:onboardingData.stepDetailsUpdateFailed'));
    }
  };

  const handleConfirmStepRationaleSave = async () => {
    try {
      if (!onboardingData.actionPlan || editingStepIndex < 0) {
        Alert.alert(t('common:error'), t('menu:onboardingData.noStepSelected'));
        return;
      }

      // Update the step rationale in the action plan
      const updatedSteps = [...onboardingData.actionPlan.steps];
      updatedSteps[editingStepIndex] = {
        ...updatedSteps[editingStepIndex],
        rationale: editedStepRationale
      };

      const updatedOnboardingData = {
        ...onboardingData,
        actionPlan: {
          ...onboardingData.actionPlan,
          steps: updatedSteps
        }
      };

      // Update the user profile with new onboarding data
      const updatedProfile = {
        ...userProfile,
        onboardingProfile: updatedOnboardingData
      };

      await updateUserProfile(updatedProfile);
      onUpdate?.(updatedOnboardingData);

      Alert.alert(t('common:success'), t('menu:onboardingData.stepRationaleUpdated'), [
        {
          text: t('common:ok'),
          onPress: () => {
            setEditMode('view');
            setEditingStepIndex(-1);
            setEditedStepRationale('');
          }
        }
      ]);
    } catch (error) {
      console.error('Error updating step rationale:', error);
      Alert.alert(t('common:error'), t('menu:onboardingData.stepRationaleUpdateFailed'));
    }
  };

  const handleConfirmStepDetailedRationaleSave = async () => {
    try {
      if (!onboardingData.actionPlan || editingStepIndex < 0) {
        Alert.alert(t('common:error'), t('menu:onboardingData.noStepSelected'));
        return;
      }

      // Update the detailed rationale items
      const updatedSteps = [...onboardingData.actionPlan.steps];
      
      const updatedDetailedRationale = editedDetailedRationaleItems.map((text) => ({
        text: text,
      }));

      updatedSteps[editingStepIndex] = {
        ...updatedSteps[editingStepIndex],
        detailed_rationale: updatedDetailedRationale
      };

      const updatedOnboardingData = {
        ...onboardingData,
        actionPlan: {
          ...onboardingData.actionPlan,
          steps: updatedSteps
        }
      };

      // Update the user profile with new onboarding data
      const updatedProfile = {
        ...userProfile,
        onboardingProfile: updatedOnboardingData
      };

      await updateUserProfile(updatedProfile);
      onUpdate?.(updatedOnboardingData);

      Alert.alert(t('common:success'), t('menu:onboardingData.detailedRationaleUpdated'), [
        {
          text: t('common:ok'),
          onPress: () => {
            setEditMode('view');
            setEditingStepIndex(-1);
            setEditedDetailedRationaleItems([]);
          }
        }
      ]);
    } catch (error) {
      console.error('Error updating detailed rationale:', error);
      Alert.alert(t('common:error'), t('menu:onboardingData.detailedRationaleUpdateFailed'));
    }
  };


  const handleCopyClarifyingQuestions = () => {
    if (!onboardingData.clarifyingQuestions || onboardingData.clarifyingQuestions.length === 0) {
      Alert.alert(t('menu:onboardingData.noDataTitle'), t('menu:onboardingData.noClarifyingQuestions'));
      return;
    }
    const questionsText = onboardingData.clarifyingQuestions.map((qa, index) => {
      const questionText = getQuestionText(qa.question);
      return `Q${index + 1}: ${questionText}\nA${index + 1}: ${qa.answer}`;
    }).join('\n\n');
    Clipboard.setString(questionsText);
    Alert.alert(t('common:copied'), t('menu:onboardingData.clarifyingQuestionsCopied'));
  };

  // Coach hypothesis removed from onboarding view per UX request.

  const handleCopyActionPlan = () => {
    if (!onboardingData.actionPlan) {
      Alert.alert(t('menu:onboardingData.noDataTitle'), t('menu:onboardingData.noActionPlan'));
      return;
    }
    const actionPlanJson = JSON.stringify(onboardingData.actionPlan, null, 2);
    Clipboard.setString(actionPlanJson);
    Alert.alert(t('common:copied'), t('menu:onboardingData.actionPlanCopied'));
  };

  const handleCopyEntireJSON = () => {
    const entireJson = JSON.stringify(onboardingData, null, 2);
    Clipboard.setString(entireJson);
    Alert.alert(t('common:copied'), t('menu:onboardingData.entireJsonCopied'));
  };

  const handleConfirmStepBonusHacksSave = async () => {
    try {
      if (!onboardingData.actionPlan || editingStepIndex < 0) {
        Alert.alert(t('common:error'), t('menu:onboardingData.noStepSelected'));
        return;
      }

      // Update the bonus hacks items
      const updatedSteps = [...onboardingData.actionPlan.steps];
      
      const updatedBonusHacks = editedBonusHacksItems.map((text) => ({
        text: text,
      }));

      updatedSteps[editingStepIndex] = {
        ...updatedSteps[editingStepIndex],
        bonus_hacks: updatedBonusHacks
      };

      const updatedOnboardingData = {
        ...onboardingData,
        actionPlan: {
          ...onboardingData.actionPlan,
          steps: updatedSteps
        }
      };

      // Update the user profile with new onboarding data
      const updatedProfile = {
        ...userProfile,
        onboardingProfile: updatedOnboardingData
      };

      await updateUserProfile(updatedProfile);
      onUpdate?.(updatedOnboardingData);

      Alert.alert(t('common:success'), t('menu:onboardingData.bonusHacksUpdated'), [
        {
          text: t('common:ok'),
          onPress: () => {
            setEditMode('view');
            setEditingStepIndex(-1);
            setEditedBonusHacksItems([]);
          }
        }
      ]);
    } catch (error) {
      console.error('Error updating bonus hacks:', error);
      Alert.alert(t('common:error'), t('menu:onboardingData.bonusHacksUpdateFailed'));
    }
  };

  const renderEditScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={handleCancelEdit} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.editPlanRationale')}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveEdit} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{t('common:save')}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.editContainer}>
        <Text style={styles.editLabel}>{t('menu:onboardingData.planRationale')}</Text>
        <TextInput
          style={styles.editTextInput}
          value={editedRationale}
          onChangeText={setEditedRationale}
          multiline
          placeholder={t('menu:onboardingData.enterPlanRationale')}
          placeholderTextColor="#8E8E93"
        />
      </View>
    </SafeAreaView>
  );

  const renderConfirmScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={() => setEditMode('edit')} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.confirmChanges')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <View style={styles.confirmContainer}>
        <View style={styles.confirmButtons}>
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonPrimary]} 
            onPress={handleConfirmSave}
          >
            <Text style={styles.confirmButtonTextPrimary}>{t('menu:onboardingData.saveChanges')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonSecondary]} 
            onPress={() => setEditMode('edit')}
          >
            <Text style={styles.confirmButtonTextSecondary}>{t('menu:onboardingData.editMore')}</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.confirmTitle}>{t('menu:onboardingData.reviewChanges')}</Text>
        <Text style={styles.confirmLabel}>{t('menu:onboardingData.planRationale')}</Text>
        <View style={styles.confirmTextContainer}>
          <Text style={styles.confirmText}>{editedRationale}</Text>
        </View>
      </View>
    </SafeAreaView>
  );

  const renderStepEditScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={handleCancelEdit} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.editStep')}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveStepEdit} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{t('common:save')}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.editContainer}>
        <Text style={styles.editLabel}>{t('menu:onboardingData.stepTitle')}</Text>
        <TextInput
          style={styles.editTitleInput}
          value={editedStepTitle}
          onChangeText={setEditedStepTitle}
          placeholder={t('menu:onboardingData.enterStepTitle')}
          placeholderTextColor="#8E8E93"
        />
        
        <Text style={styles.editLabel}>{t('menu:onboardingData.stepDescription')}</Text>
        <TextInput
          style={styles.editTextInput}
          value={editedStepDescription}
          onChangeText={setEditedStepDescription}
          multiline
          placeholder={t('menu:onboardingData.enterStepDescription')}
          placeholderTextColor="#8E8E93"
        />
      </View>
    </SafeAreaView>
  );

  const renderStepConfirmScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={() => setEditMode('editStep')} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.confirmChanges')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <View style={styles.confirmContainer}>
        <View style={styles.confirmButtons}>
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonPrimary]} 
            onPress={handleConfirmStepSave}
          >
            <Text style={styles.confirmButtonTextPrimary}>{t('menu:onboardingData.saveChanges')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonSecondary]} 
            onPress={() => setEditMode('editStep')}
          >
            <Text style={styles.confirmButtonTextSecondary}>{t('menu:onboardingData.editMore')}</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.confirmTitle}>{t('menu:onboardingData.reviewChanges')}</Text>
        <Text style={styles.confirmLabel}>{t('menu:onboardingData.stepTitle')}</Text>
        <View style={styles.confirmTextContainer}>
          <Text style={styles.confirmText}>{editedStepTitle}</Text>
        </View>
        
        <Text style={styles.confirmLabel}>{t('menu:onboardingData.stepDescription')}</Text>
        <View style={styles.confirmTextContainer}>
          <Text style={styles.confirmText}>{editedStepDescription}</Text>
        </View>
      </View>
    </SafeAreaView>
  );

  const renderStepDetailsEditScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={handleCancelEdit} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.editStepDetails')}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveStepDetailsEdit} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{t('common:save')}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.editContainer}>
        <Text style={styles.editLabel}>{t('menu:onboardingData.stepDetails')}</Text>
        <TextInput
          style={styles.editTextInput}
          value={editedStepDetails}
          onChangeText={setEditedStepDetails}
          multiline
          placeholder={t('menu:onboardingData.enterStepDetails')}
          placeholderTextColor="#8E8E93"
        />
      </View>
    </SafeAreaView>
  );

  const renderStepDetailsConfirmScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={() => setEditMode('editStepDetails')} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.confirmChanges')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <View style={styles.confirmContainer}>
        <View style={styles.confirmButtons}>
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonPrimary]} 
            onPress={handleConfirmStepDetailsave}
          >
            <Text style={styles.confirmButtonTextPrimary}>{t('menu:onboardingData.saveChanges')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonSecondary]} 
            onPress={() => setEditMode('editStepDetails')}
          >
            <Text style={styles.confirmButtonTextSecondary}>{t('menu:onboardingData.editMore')}</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.confirmTitle}>{t('menu:onboardingData.reviewChanges')}</Text>
        <Text style={styles.confirmLabel}>{t('menu:onboardingData.stepDetails')}</Text>
        <View style={styles.confirmTextContainer}>
          <Text style={styles.confirmText}>{editedStepDetails}</Text>
        </View>
      </View>
    </SafeAreaView>
  );

  const renderStepRationaleEditScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={handleCancelEdit} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.editStepRationale')}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveStepRationaleEdit} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{t('common:save')}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.editContainer}>
        <Text style={styles.editLabel}>{t('menu:onboardingData.stepRationale')}</Text>
        <TextInput
          style={styles.editTextInput}
          value={editedStepRationale}
          onChangeText={setEditedStepRationale}
          multiline
          placeholder={t('menu:onboardingData.enterStepRationale')}
          placeholderTextColor="#8E8E93"
        />
      </View>
    </SafeAreaView>
  );

  const renderStepRationaleConfirmScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={() => setEditMode('editStepRationale')} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.confirmChanges')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <View style={styles.confirmContainer}>
        <View style={styles.confirmButtons}>
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonPrimary]} 
            onPress={handleConfirmStepRationaleSave}
          >
            <Text style={styles.confirmButtonTextPrimary}>{t('menu:onboardingData.saveChanges')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonSecondary]} 
            onPress={() => setEditMode('editStepRationale')}
          >
            <Text style={styles.confirmButtonTextSecondary}>{t('menu:onboardingData.editMore')}</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.confirmTitle}>{t('menu:onboardingData.reviewChanges')}</Text>
        <Text style={styles.confirmLabel}>{t('menu:onboardingData.stepRationale')}</Text>
        <View style={styles.confirmTextContainer}>
          <Text style={styles.confirmText}>{editedStepRationale}</Text>
        </View>
      </View>
    </SafeAreaView>
  );

  const renderStepDetailedRationaleEditScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={handleCancelEdit} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.editDetailedRationale')}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveStepDetailedRationaleEdit} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{t('common:save')}</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView style={styles.editContainer} showsVerticalScrollIndicator={false}>
        {editedDetailedRationaleItems.map((text, index) => (
          <View key={index} style={styles.rationaleItemEditContainer}>
            <Text style={styles.editLabel}>Point {index + 1}:</Text>
            <TextInput
              style={styles.editTextInput}
              value={text}
              onChangeText={(newText) => {
                const updatedItems = [...editedDetailedRationaleItems];
                updatedItems[index] = newText;
                setEditedDetailedRationaleItems(updatedItems);
              }}
              multiline
              placeholder={`Enter rationale point ${index + 1}...`}
              placeholderTextColor="#8E8E93"
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  const renderStepDetailedRationaleConfirmScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={() => setEditMode('editStepDetailedRationale')} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.confirmChanges')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <ScrollView style={styles.confirmContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.confirmButtons}>
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonPrimary]} 
            onPress={handleConfirmStepDetailedRationaleSave}
          >
            <Text style={styles.confirmButtonTextPrimary}>{t('menu:onboardingData.saveChanges')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonSecondary]} 
            onPress={() => setEditMode('editStepDetailedRationale')}
          >
            <Text style={styles.confirmButtonTextSecondary}>{t('menu:onboardingData.editMore')}</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.confirmTitle}>{t('menu:onboardingData.reviewChanges')}</Text>
        {editedDetailedRationaleItems.map((text, index) => (
          <View key={index}>
            <Text style={styles.confirmLabel}>Point {index + 1}:</Text>
            <View style={styles.confirmTextContainer}>
              <Text style={styles.confirmText}>{text}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  const renderStepBonusHacksEditScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={handleCancelEdit} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:cancel')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.editBonusHacks')}</Text>
        </View>
        <TouchableOpacity onPress={handleSaveStepBonusHacksEdit} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>{t('common:save')}</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView style={styles.editContainer} showsVerticalScrollIndicator={false}>
        {editedBonusHacksItems.map((text, index) => (
          <View key={index} style={styles.rationaleItemEditContainer}>
            <Text style={styles.editLabel}>Hack {index + 1}:</Text>
            <TextInput
              style={styles.editTextInput}
              value={text}
              onChangeText={(newText) => {
                const updatedItems = [...editedBonusHacksItems];
                updatedItems[index] = newText;
                setEditedBonusHacksItems(updatedItems);
              }}
              multiline
              placeholder={`Enter bonus hack ${index + 1}...`}
              placeholderTextColor="#8E8E93"
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  const renderStepBonusHacksConfirmScreen = () => (
    <SafeAreaView style={styles.dataModalContainer}>
      <View style={styles.dataModalHeader}>
        <TouchableOpacity onPress={() => setEditMode('editStepBonusHacks')} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>{t('common:back')}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('menu:onboardingData.confirmChanges')}</Text>
        </View>
        <View style={styles.headerRight} />
      </View>
      
      <ScrollView style={styles.confirmContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.confirmButtons}>
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonPrimary]} 
            onPress={handleConfirmStepBonusHacksSave}
          >
            <Text style={styles.confirmButtonTextPrimary}>{t('menu:onboardingData.saveChanges')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.confirmButton, styles.confirmButtonSecondary]} 
            onPress={() => setEditMode('editStepBonusHacks')}
          >
            <Text style={styles.confirmButtonTextSecondary}>{t('menu:onboardingData.editMore')}</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.confirmTitle}>{t('menu:onboardingData.reviewChanges')}</Text>
        {editedBonusHacksItems.map((text, index) => (
          <View key={index}>
            <Text style={styles.confirmLabel}>Hack {index + 1}:</Text>
            <View style={styles.confirmTextContainer}>
              <Text style={styles.confirmText}>{text}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );

  if (editMode === 'edit') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderEditScreen()}
      </Modal>
    );
  }

  if (editMode === 'confirm') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderConfirmScreen()}
      </Modal>
    );
  }

  if (editMode === 'editStep') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepEditScreen()}
      </Modal>
    );
  }

  if (editMode === 'confirmStep') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepConfirmScreen()}
      </Modal>
    );
  }

  if (editMode === 'editStepDetails') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepDetailsEditScreen()}
      </Modal>
    );
  }

  if (editMode === 'confirmStepDetails') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepDetailsConfirmScreen()}
      </Modal>
    );
  }

  if (editMode === 'editStepRationale') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepRationaleEditScreen()}
      </Modal>
    );
  }

  if (editMode === 'confirmStepRationale') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepRationaleConfirmScreen()}
      </Modal>
    );
  }

  if (editMode === 'editStepDetailedRationale') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepDetailedRationaleEditScreen()}
      </Modal>
    );
  }

  if (editMode === 'confirmStepDetailedRationale') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepDetailedRationaleConfirmScreen()}
      </Modal>
    );
  }

  if (editMode === 'editStepBonusHacks') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepBonusHacksEditScreen()}
      </Modal>
    );
  }

  if (editMode === 'confirmStepBonusHacks') {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {renderStepBonusHacksConfirmScreen()}
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.dataModalContainer}>
        <View style={styles.dataModalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>{t('common:done')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerCenter}
            onLongPress={handleCopyEntireJSON}
            delayLongPress={800}
          >
            <Text style={styles.headerTitle}>
              {readOnly ? t('menu:onboardingData.title') : t('menu:onboardingData.editTitle')}
            </Text>
          </TouchableOpacity>
          <View style={styles.headerRight} />
        </View>

        <ScrollView style={styles.dataModalContent} showsVerticalScrollIndicator={false}>
          {/* Basic Info */}
          <View style={styles.dataSection}>
            <Text style={styles.dataSectionTitle}>{t('menu:onboardingData.basicInfo')}</Text>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('menu:onboardingData.name')}</Text>
              <Text style={styles.dataValue}>{onboardingData.name}</Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('menu:onboardingData.email')}</Text>
              <Text style={styles.dataValue}>{onboardingData.email}</Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>{t('menu:onboardingData.coach')}</Text>
              <Text style={styles.dataValue}>{onboardingData.selectedCoach}</Text>
            </View>
          </View>

          {/* Selected Modules */}
          {onboardingData.selectedModules && onboardingData.selectedModules.length > 0 && (
            <View style={styles.dataSection}>
              <Text style={styles.dataSectionTitle}>{t('menu:onboardingData.selectedModules')}</Text>
              {onboardingData.selectedModules.map((module, index) => (
                <View key={index} style={styles.moduleItem}>
                  <Text style={styles.moduleText}>{module}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Secondary Goals */}
          {onboardingData.selectedSecondaryGoal && (
            <View style={styles.dataSection}>
              <Text style={styles.dataSectionTitle}>{t('menu:onboardingData.secondaryGoals')}</Text>
              {Array.isArray(onboardingData.selectedSecondaryGoal) ? (
                onboardingData.selectedSecondaryGoal.map((goal, index) => (
                  <View key={index} style={styles.goalContainer}>
                    <Text style={styles.goalText}>{index + 1}. {goal}</Text>
                  </View>
                ))
              ) : (
                <View style={styles.goalContainer}>
                  <Text style={styles.goalText}>1. {onboardingData.selectedSecondaryGoal}</Text>
                </View>
              )}
            </View>
          )}

          {/* Motivation */}
          {(onboardingData.motivationLevel || onboardingData.motivationWhy) && (
            <View style={styles.dataSection}>
              <Text style={styles.dataSectionTitle}>{t('menu:onboardingData.motivation')}</Text>
              {onboardingData.motivationLevel && (
                <View style={styles.motivationLevelContainer}>
                  <View style={styles.motivationLevelHeader}>
                    <Text style={styles.motivationLevelLabel}>{t('menu:onboardingData.motivationLevel')}</Text>
                    <View style={styles.motivationScoreContainer}>
                      <Text style={styles.motivationScore}>{onboardingData.motivationLevel}</Text>
                      <Text style={styles.motivationScoreMax}>/10</Text>
                    </View>
                  </View>
                  <View style={styles.motivationBar}>
                    <View 
                      style={[
                        styles.motivationBarFill, 
                        { width: `${(onboardingData.motivationLevel / 10) * 100}%` }
                      ]} 
                    />
                  </View>
                </View>
              )}
              {onboardingData.motivationWhy && (
                <View style={styles.motivationWhyContainer}>
                  <Text style={styles.motivationWhyLabel}>{t('menu:onboardingData.motivationWhy')}</Text>
                  <Text style={styles.motivationWhyText}>{onboardingData.motivationWhy}</Text>
                </View>
              )}
            </View>
          )}

          {/* Clarifying Questions */}
          {onboardingData.clarifyingQuestions && onboardingData.clarifyingQuestions.length > 0 && (
            <View style={styles.dataSection}>
              <View style={styles.sectionHeaderWithCopy}>
                <Text style={styles.dataSectionTitle}>{t('menu:onboardingData.clarifyingQuestions')}</Text>
                <TouchableOpacity onPress={handleCopyClarifyingQuestions} style={styles.copyButton}>
                  <Text style={styles.copyButtonText}>{t('menu:onboardingData.copy')}</Text>
                </TouchableOpacity>
              </View>
              {onboardingData.clarifyingQuestions.map((qa, index) => (
                <View key={index} style={styles.questionContainer}>
                  <Text style={styles.questionKey}>Q{index + 1}: {qa.question}</Text>
                  <Text style={styles.questionLabel}>{getQuestionText(qa.question)}</Text>
                  <Text style={styles.answerText}>A{index + 1}: {qa.answer}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Coach hypotheses intentionally omitted from onboarding view */}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  dataModalContainer: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  dataModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#0E1A1A',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  closeButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '400',
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  saveButtonText: {
    fontSize: 17,
    color: '#F47C3C',
    fontWeight: '600',
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
  dataModalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  dataSection: {
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  dataSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 12,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  editableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  editableValueContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dataLabel: {
    fontSize: 15,
    color: '#3C3C43',
    fontWeight: '500',
    minWidth: 80,
    marginRight: 8,
  },
  dataValue: {
    fontSize: 15,
    color: '#F2F2EE',
    flex: 1,
    flexWrap: 'wrap',
  },
  editChevron: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  editChevronText: {
    fontSize: 18,
    color: '#F47C3C',
    fontWeight: '300',
  },
  moduleItem: {
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  moduleText: {
    fontSize: 15,
    color: '#3C3C43',
    fontWeight: '500',
  },
  qaContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  questionText: {
    fontSize: 15,
    color: '#3C3C43',
    fontWeight: '500',
    marginBottom: 6,
  },
  answerText: {
    fontSize: 15,
    color: '#F2F2EE',
    lineHeight: 20,
  },
  stepsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginTop: 8,
    marginBottom: 12,
  },
  stepContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  stepImageContainer: {
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    position: 'relative',
  },
  stepImage: {
    width: '100%',
    height: '100%',
  },
  stepTitleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  stepTitleOverlayText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stepNumberContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F47C3C',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumber: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  stepTitleContainer: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 6,
  },
  categoryBadges: {
    marginTop: 4,
    marginBottom: 4,
  },
  stepDescription: {
    fontSize: 15,
    color: '#3C3C43',
    lineHeight: 20,
    marginBottom: 8,
  },
  scheduleSection: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    marginBottom: 16,
    marginTop: 8,
  },
  scheduleSectionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  scheduleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  scheduleIconText: {
    fontSize: 16,
  },
  scheduleTextContainer: {
    flex: 1,
  },
  scheduleText: {
    fontSize: 14,
    color: '#F47C3C',
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  planRationaleContainer: {
    backgroundColor: '#F0F8FF',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F47C3C',
    flex: 1,
  },
  rationaleContainer: {
    backgroundColor: '#F2F2F7',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F47C3C',
  },
  rationaleText: {
    fontSize: 14,
    color: '#3C3C43',
    lineHeight: 19,
  },
  stepDetailsContainer: {
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
  },
  stepDetailsText: {
    fontSize: 14,
    color: '#3C3C43',
    lineHeight: 20,
    marginBottom: 8,
  },
  bonusHacksContainer: {
    backgroundColor: '#FFF8E1',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF6B35',
  },
  bonusHackItem: {
    marginBottom: 12,
  },
  bonusHackText: {
    fontSize: 14,
    color: '#3C3C43',
    lineHeight: 20,
  },
  detailedRationaleContainer: {
    backgroundColor: '#F0F8FF',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4FAE8A',
  },
  rationaleItem: {
    marginBottom: 8,
  },
  rationaleItemText: {
    fontSize: 14,
    color: '#3C3C43',
    lineHeight: 18,
    marginBottom: 4,
  },
  citationsContainer: {
    marginLeft: 12,
  },
  citationText: {
    fontSize: 12,
    color: '#9AA3A6',
    fontStyle: 'italic',
  },
  goalContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  goalText: {
    fontSize: 15,
    color: '#3C3C43',
    lineHeight: 20,
  },
  // Edit screen styles
  editContainer: {
    flex: 1,
    padding: 20,
  },
  editLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  editTextInput: {
    flex: 1,
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#F2F2EE',
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  editTitleInput: {
    backgroundColor: '#0E1A1A',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#F2F2EE',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    marginBottom: 16,
  },
  stepHeaderEditable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stepContentContainer: {
    flex: 1,
    marginRight: 8,
  },
  stepDescriptionContainer: {
    flex: 1,
  },
  rationaleItemEditContainer: {
    marginBottom: 20,
  },
  // Confirm screen styles
  confirmContainer: {
    flex: 1,
    padding: 20,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 16,
  },
  confirmLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  confirmTextContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 32,
    minHeight: 100,
  },
  confirmText: {
    fontSize: 15,
    color: '#F2F2EE',
    lineHeight: 20,
  },
  confirmButtons: {
    gap: 12,
    marginBottom: 24,
  },
  confirmButton: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonPrimary: {
    backgroundColor: '#F47C3C',
  },
  confirmButtonSecondary: {
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#C6C6C8',
  },
  confirmButtonTextPrimary: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  confirmButtonTextSecondary: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F47C3C',
  },
  /* hypothesis styles removed */
  // Motivation styles
  motivationLevelContainer: {
    marginBottom: 16,
  },
  motivationLevelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  motivationLevelLabel: {
    fontSize: 15,
    color: '#3C3C43',
    fontWeight: '500',
  },
  motivationScoreContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  motivationScore: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F47C3C',
  },
  motivationScoreMax: {
    fontSize: 16,
    fontWeight: '500',
    color: '#9AA3A6',
  },
  motivationBar: {
    height: 8,
    backgroundColor: '#F2F2F7',
    borderRadius: 4,
    overflow: 'hidden',
  },
  motivationBarFill: {
    height: '100%',
    backgroundColor: '#F47C3C',
    borderRadius: 4,
  },
  motivationWhyContainer: {
    backgroundColor: '#F0F8FF',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#F47C3C',
  },
  motivationWhyLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3C3C43',
    marginBottom: 6,
  },
  motivationWhyText: {
    fontSize: 14,
    color: '#3C3C43',
    lineHeight: 20,
  },
  sectionContainer: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: '#0E1A1A',
    borderRadius: 12,
  },
  questionContainer: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  questionKey: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9AA3A6',
    marginBottom: 4,
  },
  questionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#F2F2EE',
    marginBottom: 8,
  },
  sectionHeaderWithCopy: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  copyButton: {
    backgroundColor: '#F47C3C',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
