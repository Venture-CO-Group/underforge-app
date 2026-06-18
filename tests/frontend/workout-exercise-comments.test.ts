import { describe, it, expect } from 'vitest';

import {
  getExerciseCommentDisplay,
  getPersistedSetComment,
  getPreviousExerciseComment,
  normalizeAllExerciseComments,
  reassignExerciseCommentInSets,
} from '../../lib/workout-exercise-comments';

describe('workout-exercise-comments', () => {
  const sets = [
    { exerciseId: 'a', setNumber: 1, completed: true, comments: '' },
    { exerciseId: 'a', setNumber: 2, completed: true, comments: 'knee ok' },
    { exerciseId: 'a', setNumber: 3, completed: false, comments: '' },
  ];

  it('reads comment from last checked set', () => {
    expect(getExerciseCommentDisplay(sets)).toBe('knee ok');
  });

  it('TEMP intentional failure to verify CI gate (will be reverted)', () => {
    expect(getExerciseCommentDisplay(sets)).toBe('this is wrong on purpose');
  });

  it('preserves spaces while typing (no trim on display value)', () => {
    const trailingSpace = [
      { exerciseId: 'a', setNumber: 1, completed: true, comments: 'Careful with left ' },
    ];
    expect(getExerciseCommentDisplay(trailingSpace)).toBe('Careful with left ');
  });

  it('trims only when persisting', () => {
    const trailingSpace = [
      { exerciseId: 'a', setNumber: 1, completed: true, comments: '  knee ok  ' },
    ];
    expect(getPersistedSetComment(trailingSpace[0], trailingSpace)).toBe('knee ok');
  });

  it('persists comment only on last checked set', () => {
    expect(getPersistedSetComment(sets[0], sets)).toBeUndefined();
    expect(getPersistedSetComment(sets[1], sets)).toBe('knee ok');
    expect(getPersistedSetComment(sets[2], sets)).toBeUndefined();
  });

  it('reassigns comment when a higher set is checked', () => {
    const next = reassignExerciseCommentInSets(
      sets.map(s => (s.setNumber === 3 ? { ...s, completed: true } : s)),
      'a',
    );
    expect(getPersistedSetComment(next[2], next)).toBe('knee ok');
    expect(next[1].comments).toBe('');
  });

  it('normalizes legacy comments onto last checked set', () => {
    const legacy = [
      { exerciseId: 'b', setNumber: 1, completed: true, comments: 'old note' },
      { exerciseId: 'b', setNumber: 2, completed: true, comments: '' },
    ];
    const normalized = normalizeAllExerciseComments(legacy);
    expect(normalized[0].comments).toBe('');
    expect(normalized[1].comments).toBe('old note');
  });

  it('picks highest set number from prior workout map', () => {
    expect(
      getPreviousExerciseComment({
        1: { comments: 'a' },
        3: { comments: 'latest' },
      }),
    ).toBe('latest');
  });
});
