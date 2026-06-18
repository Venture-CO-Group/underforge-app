/**
 * Onboarding Config Barrel
 * 
 * Combines the separate config files (goals, questions, coaches, interesting facts)
 * into a single config object that matches the OnboardingConfig interface.
 * 
 * The config is split into:
 * - onboarding_goals.json: Primary/secondary goals, motivation reasons
 * - onboarding_questions.json: Question bank and goal-specific question sequences
 * - onboarding_coaches.json: Coach definitions
 * - onboarding_interesting_facts.json: Fun facts shown during onboarding
 */

const goals = require('./onboarding_goals.json');
const questions = require('./onboarding_questions.json');
const coaches = require('./onboarding_coaches.json');
const interestingFacts = require('./onboarding_interesting_facts.json');

const onboardingConfig = {
  available_languages: ["en", "es"],
  available_ui_widgets: "See https://nativewindui.com/component/text-field for available widgets",
  general_info: {
    coach_selection: coaches.coach_selection,
    primary_goals: goals.primary_goals,
    primary_goals_es: goals.primary_goals_es,
    secondary_goals: goals.secondary_goals,
    secondary_goals_es: goals.secondary_goals_es,
    primary_goals_motivation_reasons: goals.primary_goals_motivation_reasons,
    primary_goals_motivation_reasons_es: goals.primary_goals_motivation_reasons_es,
    primary_goals_interesting_facts: interestingFacts.primary_goals_interesting_facts,
    name: goals.name,
  },
  question_bank: questions.question_bank,
  back_matter_questions: questions.back_matter_questions,
  // Goal-specific question sequences
  burn_body_fat: questions.burn_body_fat,
  build_muscle_mass: questions.build_muscle_mass,
  increase_strength: questions.increase_strength,
  get_challenged: questions.get_challenged,
  // Survey sequences (deferred from initial onboarding)
  nutrition_survey: questions.nutrition_survey,
  recovery_survey: questions.recovery_survey,
  // Common section arrays (for reference/documentation, not directly consumed by sequence logic)
  common_general_information: questions.common_general_information,
  common_training_familiarity: questions.common_training_familiarity,
  common_nutrition_initial: questions.common_nutrition_initial,
  common_sleep_and_stress_initial: questions.common_sleep_and_stress_initial,
  common_health_background: questions.common_health_background,
};

module.exports = onboardingConfig;
