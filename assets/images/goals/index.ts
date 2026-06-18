import { ImageSourcePropType } from 'react-native';

const goalImagesMale: Record<string, ImageSourcePropType> = {
  'Build muscle mass': require('./male_muscle.jpeg'),
  'Burn body fat': require('./male_fat.jpeg'),
  'Increase strength': require('./male_strength.jpeg'),
};

const goalImagesFemale: Record<string, ImageSourcePropType> = {
  'Build muscle mass': require('./fem_muscle.jpeg'),
  'Burn body fat': require('./fem_fat.jpeg'),
  'Increase strength': require('./fem_strength.jpeg'),
};

const goalImagesMixed: Record<string, ImageSourcePropType> = {
  'Build muscle mass': require('./fem_muscle.jpeg'),
  'Burn body fat': require('./male_fat.jpeg'),
  'Increase strength': require('./fem_strength.jpeg'),
};

export const coachCelebrateImages: Record<string, ImageSourcePropType> = {
  'Manu': require('../coaches/emotions/1_manu_rodriguez_celebrate.jpeg'),
  'Dey': require('../coaches/emotions/2_dey_schwarz_celebrate.jpeg'),
  'Alonso': require('../coaches/emotions/3_alonso_prieto_celebrate.jpeg'),
  'Ruth': require('../coaches/emotions/4_ruth_morais_celebrate.jpeg'),
  'Dana': require('../coaches/emotions/5_dana_thompson_celebrate.jpeg'),
  'Jesús': require('../coaches/emotions/6_jesus_guerrero_celebrate.jpeg'),
};

export function getGoalImage(
  goalName: string,
  gender: string | undefined,
  selectedCoach: string
): ImageSourcePropType {
  if (goalName === 'Get challenged by my coach') {
    return coachCelebrateImages[selectedCoach] || coachCelebrateImages['Manu'];
  }

  const g = (gender || '').toLowerCase();
  if (g === 'male') {
    return goalImagesMale[goalName] || goalImagesMale['Build muscle mass'];
  }
  if (g === 'female') {
    return goalImagesFemale[goalName] || goalImagesFemale['Build muscle mass'];
  }
  return goalImagesMixed[goalName] || goalImagesMixed['Build muscle mass'];
}
