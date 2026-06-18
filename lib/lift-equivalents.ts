/**
 * Maps a lifted volume (in kg) to a fun, shareable "you lifted the equivalent
 * of X" comparison. 20 levels span a house cat (~5 kg) up to a humpback whale
 * (~20 t) so even a light session lands on something playful and a monster
 * session feels epic.
 *
 * Each level returns an emoji plus an i18n key. The human-readable object name
 * (with its article, e.g. "a house cat" / "un gato doméstico") lives in the
 * locale files under `workout:<objectKey>` so copy stays translatable.
 */
export interface LiftEquivalent {
  /** 1-based level, 1 (lightest) → 20 (heaviest). */
  level: number;
  /** Lower bound in kg for this level (inclusive). */
  minKg: number;
  /** Decorative emoji shown alongside the message. */
  emoji: string;
  /** i18n key for the object name, resolved as `workout:<objectKey>`. */
  objectKey: string;
}

/**
 * Ordered lightest → heaviest. Thresholds are approximate real-world masses;
 * the ordering matters more than exact precision.
 */
export const LIFT_EQUIVALENTS: readonly LiftEquivalent[] = [
  { level: 1, minKg: 0, emoji: '🐱', objectKey: 'liftObj1' },
  { level: 2, minKg: 10, emoji: '🚲', objectKey: 'liftObj2' },
  { level: 3, minKg: 20, emoji: '🛞', objectKey: 'liftObj3' },
  { level: 4, minKg: 35, emoji: '🐕', objectKey: 'liftObj4' },
  { level: 5, minKg: 55, emoji: '🐆', objectKey: 'liftObj5' },
  { level: 6, minKg: 75, emoji: '🧍', objectKey: 'liftObj6' },
  { level: 7, minKg: 110, emoji: '🐼', objectKey: 'liftObj7' },
  { level: 8, minKg: 160, emoji: '🦁', objectKey: 'liftObj8' },
  { level: 9, minKg: 220, emoji: '🦍', objectKey: 'liftObj9' },
  { level: 10, minKg: 320, emoji: '🎹', objectKey: 'liftObj10' },
  { level: 11, minKg: 450, emoji: '🐄', objectKey: 'liftObj11' },
  { level: 12, minKg: 650, emoji: '🐎', objectKey: 'liftObj12' },
  { level: 13, minKg: 900, emoji: '🚗', objectKey: 'liftObj13' },
  { level: 14, minKg: 1300, emoji: '🚙', objectKey: 'liftObj14' },
  { level: 15, minKg: 1800, emoji: '🦛', objectKey: 'liftObj15' },
  { level: 16, minKg: 2500, emoji: '🦏', objectKey: 'liftObj16' },
  { level: 17, minKg: 4000, emoji: '🦕', objectKey: 'liftObj17' },
  { level: 18, minKg: 6000, emoji: '🐘', objectKey: 'liftObj18' },
  { level: 19, minKg: 10000, emoji: '🚌', objectKey: 'liftObj19' },
  { level: 20, minKg: 20000, emoji: '🐋', objectKey: 'liftObj20' },
] as const;

/**
 * Returns the matching equivalent for a lifted volume, or `null` when there's
 * nothing to brag about (zero/negative volume).
 */
export function getLiftEquivalent(volumeKg: number): LiftEquivalent | null {
  if (!Number.isFinite(volumeKg) || volumeKg <= 0) return null;
  let match: LiftEquivalent = LIFT_EQUIVALENTS[0];
  for (const eq of LIFT_EQUIVALENTS) {
    if (volumeKg >= eq.minKg) match = eq;
    else break;
  }
  return match;
}
