/**
 * Unit tests for the canonical-per-metric resolver used when multiple
 * wearable sources report the same daily metric (e.g. steps from both
 * Apple Health and Whoop on the same day).
 *
 * We test the Edge-Function-side mirror since it's a dependency-free
 * TypeScript file. The on-device version in `lib/daily-metrics-storage.ts`
 * shares the same priority table (see `lib/providers/types.ts`) and is
 * exercised transitively.
 */

import assert from 'node:assert/strict';
import {
  decideCanonical,
  CANONICAL_SOURCE_PRIORITY,
  type DailyMetricRow,
} from '../../../supabase/functions/_shared/canonical';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    throw e;
  }
}

console.log('canonical-resolver');

test('single source wins trivially with only_source reason', () => {
  const rows: DailyMetricRow[] = [{ id: 1, source: 'whoop', synced_at: '2026-04-22T10:00:00Z', value: 8200 }];
  const winner = decideCanonical(rows, 'steps');
  assert.ok(winner);
  assert.equal(winner!.winnerId, 1);
  assert.equal(winner!.winnerReason, 'only_source');
});

test('healthkit beats whoop for steps', () => {
  const rows: DailyMetricRow[] = [
    { id: 1, source: 'whoop', synced_at: '2026-04-22T10:00:00Z', value: 9000 },
    { id: 2, source: 'healthkit', synced_at: '2026-04-22T08:00:00Z', value: 8500 },
  ];
  const winner = decideCanonical(rows, 'steps');
  assert.equal(winner!.winnerId, 2);
  assert.equal(winner!.winnerReason, 'healthkit_aggregated');
});

test('garmin beats whoop for steps (priority-table defined)', () => {
  const rows: DailyMetricRow[] = [
    { id: 1, source: 'whoop', synced_at: '2026-04-22T12:00:00Z', value: 9000 },
    { id: 2, source: 'garmin', synced_at: '2026-04-22T06:00:00Z', value: 8900 },
  ];
  const winner = decideCanonical(rows, 'steps');
  assert.equal(winner!.winnerId, 2);
});

test('freshness tiebreaker when two readings share priority tier', () => {
  // Two healthkit rows -- same priority -- newest synced_at wins.
  const rows: DailyMetricRow[] = [
    { id: 1, source: 'healthkit', synced_at: '2026-04-22T08:00:00Z', value: 8500 },
    { id: 2, source: 'healthkit', synced_at: '2026-04-22T15:00:00Z', value: 8700 },
  ];
  const winner = decideCanonical(rows, 'steps');
  assert.equal(winner!.winnerId, 2);
});

test('empty input returns null', () => {
  const winner = decideCanonical([], 'steps');
  assert.equal(winner, null);
});

test('manual is last-resort for every metric', () => {
  for (const metric of Object.keys(CANONICAL_SOURCE_PRIORITY) as Array<keyof typeof CANONICAL_SOURCE_PRIORITY>) {
    const order = CANONICAL_SOURCE_PRIORITY[metric];
    assert.equal(order[order.length - 1], 'manual', `manual must be last for ${metric}`);
  }
});

test('active_energy_kcal prefers whoop over garmin', () => {
  // Per the plan Section 7: Whoop's strain/kilojoule is better-calibrated than
  // Garmin's active energy, so for kcal specifically Whoop ranks higher.
  const rows: DailyMetricRow[] = [
    { id: 1, source: 'garmin', synced_at: '2026-04-22T12:00:00Z', value: 600 },
    { id: 2, source: 'whoop', synced_at: '2026-04-22T06:00:00Z', value: 650 },
  ];
  const winner = decideCanonical(rows, 'active_energy_kcal');
  assert.equal(winner!.winnerId, 2);
});

console.log('canonical-resolver: OK');
