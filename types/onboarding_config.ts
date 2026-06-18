export interface CoachPersona {
  name: string;
  demographics: string;
  personality: string;
  sample_message: string;
  personal_history: string;
  personal_history_es?: string;

  toLLMString(): string;
}

export interface Coach {
  label_en: string;
  label_es?: string;
  short_description: string;
  short_description_es?: string;
  image: string;
  type: string; // "Human and AI" or "AI-only"
  science_roots: string[];
  science_roots_es?: string[];
  persona: CoachPersona;
  description: string;
  description_es?: string;
  select_if: string;
  select_if_es?: string;

  toLLMString(): string;
}

export function coachPersonaToLLMString(persona: CoachPersona): string {
  const lines: string[] = [];
  lines.push(`Name: ${persona.name}`);
  lines.push(`Demographics: ${persona.demographics}`);
  lines.push(`Personality: ${persona.personality}`);
  lines.push(`Sample Message: "${persona.sample_message}"`);
  lines.push(`Personal History: ${persona.personal_history}`);
  return lines.join('\n');
}

export function coachToLLMString(coach: Coach): string {
  const lines: string[] = [];
  lines.push(`Coach: ${coach.label_en}`);
  lines.push(`Type: ${coach.type}`);
  lines.push(`Short Description: ${coach.short_description}`);
  lines.push(`Description: ${coach.description}`);
  lines.push(`Select If: ${coach.select_if}`);
  lines.push(`Science Roots: ${coach.science_roots.join(', ')}`);
  lines.push('Persona:');
  lines.push(coachPersonaToLLMString(coach.persona).split('\n').map(line => `  ${line}`).join('\n'));
  return lines.join('\n');
}

export interface FormField {
  label_en: string;
  label_es?: string;
  ui_widget: string;
  ui_widget_options?: string[];
  ui_widget_options_es?: string[];
  ui_widget_options_labels?: string[];
  ui_widget_options_labels_es?: string[];
  required?: boolean;
  optional?: boolean;
  depends_on?: {
    question: string;
    value?: string;
    not_value?: string;
    includes_value?: string;
  };
  other_specify?: {
    label_en?: string;
    label_es?: string;
  };
}

export interface OnboardingConfig {
  available_languages: string[];
  available_ui_widgets: string;
  general_info: {
    coach_selection: Record<string, Coach>;
    primary_goals: string[];
    primary_goals_es?: string[];
    secondary_goals: string[];
    secondary_goals_es?: string[];
    primary_goals_motivation_reasons: Record<string, string[]>;
    primary_goals_motivation_reasons_es?: Record<string, string[]>;
    primary_goals_interesting_facts: Record<string, string[]>;
    primary_goals_interesting_facts_es?: Record<string, string[]>;
    name: FormField;
    [key: string]: any; // Allow additional dynamic fields
  };
  question_bank: Record<string, FormField>;
  back_matter_questions: string[];
  // Goal-specific question sequences
  burn_body_fat: string[];
  build_muscle_mass: string[];
  increase_strength: string[];
  get_challenged: string[];
  // Survey sequences (deferred from initial onboarding)
  nutrition_survey: string[];
  recovery_survey: string[];
  // Common section arrays (for reference)
  common_general_information?: string[];
  common_training_familiarity?: string[];
  common_nutrition_initial?: string[];
  common_sleep_and_stress_initial?: string[];
  common_health_background?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  missingQuestions: { section: string; missingKeys: string[] }[];
}

export function validateOnboardingConfig(config: OnboardingConfig): ValidationResult {
  const errors: string[] = [];
  const missingQuestions: { section: string; missingKeys: string[] }[] = [];
  
  // Get all available question keys from the question bank
  const availableQuestionKeys = Object.keys(config.question_bank || {});
  
  // Define all sections that contain question key arrays
  const sectionsToValidate = [
    'back_matter_questions',
    'burn_body_fat',
    'build_muscle_mass',
    'increase_strength',
    'get_challenged',
    'nutrition_survey',
    'recovery_survey'
  ] as const;
  
  // Validate each section
  for (const sectionName of sectionsToValidate) {
    const section = config[sectionName];
    
    if (!Array.isArray(section)) {
      errors.push(`Section '${sectionName}' is not an array or is missing`);
      continue;
    }
    
    const missingKeys: string[] = [];
    
    for (const questionKey of section) {
      if (!availableQuestionKeys.includes(questionKey)) {
        missingKeys.push(questionKey);
      }
    }
    
    if (missingKeys.length > 0) {
      missingQuestions.push({
        section: sectionName,
        missingKeys
      });
      errors.push(`Section '${sectionName}' references ${missingKeys.length} missing question(s): ${missingKeys.join(', ')}`);
    }
  }
  
  // Check for empty question bank
  if (availableQuestionKeys.length === 0) {
    errors.push('Question bank is empty or missing');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    missingQuestions
  };
}
