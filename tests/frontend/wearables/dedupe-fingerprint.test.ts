/**
 * Unit tests for the cross-source dedupe fingerprint. Guarantees:
 *   - Same session from two providers collapses to the same key.
 *   - Small clock drift (<10 min) still collapses.
 *   - Different activity categories don't collide.
 */

import assert from 'node:assert/strict';
import { dedupeFingerprint } from '../../../lib/providers/types';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('dedupe-fingerprint');

test('identical inputs produce identical fingerprints', () => {
  const a = dedupeFingerprint('2026-04-22T14:05:00Z', 'running', 32);
  const b = dedupeFingerprint('2026-04-22T14:05:00Z', 'running', 32);
  assert.equal(a, b);
});

test('2-minute clock drift still collapses to the same bucket', () => {
  const a = dedupeFingerprint('2026-04-22T14:01:00Z', 'running', 30);
  const b = dedupeFingerprint('2026-04-22T14:03:00Z', 'running', 30);
  assert.equal(a, b);
});

test('11-minute drift crosses bucket boundary', () => {
  const a = dedupeFingerprint('2026-04-22T14:00:00Z', 'running', 30);
  const b = dedupeFingerprint('2026-04-22T14:11:00Z', 'running', 30);
  assert.notEqual(a, b);
});

test('different categories never collide', () => {
  const running = dedupeFingerprint('2026-04-22T14:05:00Z', 'running', 30);
  const cycling = dedupeFingerprint('2026-04-22T14:05:00Z', 'cycling', 30);
  assert.notEqual(running, cycling);
});

test('duration rounded to the nearest minute', () => {
  const a = dedupeFingerprint('2026-04-22T14:05:00Z', 'running', 30.2);
  const b = dedupeFingerprint('2026-04-22T14:05:00Z', 'running', 29.8);
  assert.equal(a, b);
});

test('missing startedAt returns undefined', () => {
  assert.equal(dedupeFingerprint(undefined, 'running', 30), undefined);
});

test('invalid startedAt returns undefined', () => {
  assert.equal(dedupeFingerprint('not-a-date', 'running', 30), undefined);
});

test('accepts Date objects in addition to ISO strings', () => {
  const iso = dedupeFingerprint('2026-04-22T14:05:00Z', 'running', 30);
  const date = dedupeFingerprint(new Date('2026-04-22T14:05:00Z'), 'running', 30);
  assert.equal(iso, date);
});

console.log('dedupe-fingerprint: OK');
