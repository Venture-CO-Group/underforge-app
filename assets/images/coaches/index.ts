// Coach images indexed by coach ID for easy lookup
// Image naming convention: <id>_<full_name_lowercase>.<ext>
// NOTE: Filenames must NOT have spaces (Android AAPT fails on spaces)

export const coachImagesByID: Record<number, any> = {
  1: require('./1_manu_rodriguez.png'), // TODO: Replace with Manu's image
  2: require('./2_dey_schwarz.png'), // TODO: Replace with Dey's image
  3: require('./3_alonso_prieto.png'),
  4: require('./5_dana_thompson.png'), // 
  5: require('./4_ruth_morais.png'), // TODO: Replace with Ruth's image (will be ID 5 after INSERT)
  6: require('./6_jesus_guerrero.png'),
};

// Maps display name AND config image name to images
// - Display names: 'Manu', 'Dey', 'Alonso', 'Dana', 'Ruth' (used in ChooseCoach)
// - Config image names: 'Manu_1.png', 'Dey_1.png', 'Alonso_1.png', 'Dana_1.png', 'Ruth_1.png' (used in CoachInfoHeader)
export const coachImages: Record<string, any> = {
  'Manu': require('./1_manu_rodriguez.png'),
  'Dey': require('./2_dey_schwarz.png'),
  'Alonso': require('./3_alonso_prieto.png'),
  'Dana': require('./5_dana_thompson.png'),
  'Ruth': require('./4_ruth_morais.png'),
  'Jesús': require('./6_jesus_guerrero.png'),
  'Manu_1.png': require('./1_manu_rodriguez.png'),
  'Dey_1.png': require('./2_dey_schwarz.png'),
  'Alonso_1.png': require('./3_alonso_prieto.png'),
  'Dana_1.png': require('./5_dana_thompson.png'),
  'Ruth_1.png': require('./4_ruth_morais.png'),
  'Jesús_1.png': require('./6_jesus_guerrero.png'),
};

/** Coach "explaining" emotion photos (onboarding / hypothesis hero). */
export const coachExplainingImages: Record<string, number> = {
  Manu: require('./emotions/1_manu_rodriguez_explaining.jpeg'),
  Dey: require('./emotions/2_dey_schwarz_explaining.jpeg'),
  Alonso: require('./emotions/3_alonso_prieto_explaining.jpeg'),
  Ruth: require('./emotions/4_ruth_morais_explaining.jpeg'),
  Dana: require('./emotions/5_dana_thompson_explaining.jpeg'),
  Jesús: require('./emotions/6_jesus_guerrero_explaining.jpeg'),
};

