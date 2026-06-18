/**
 * Entry point that imports every test file and fails the process on any
 * thrown assertion. Run via:
 *   npx ts-node --transpile-only -P tests/frontend/wearables/tsconfig.json \
 *     tests/frontend/wearables/run.ts
 *
 * We chose ts-node + node:assert over Jest because the project already
 * depends on ts-node for scripts/* and we don't need test-runner features
 * beyond "throw on unexpected value".
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const started = Date.now();

async function main() {
  console.log('wearables unit tests\n');
  await import('./nutrition-math.test');
  console.log('');
  await import('./met-table.test');
  console.log('');
  await import('./dedupe-fingerprint.test');
  console.log('');
  await import('./canonical-resolver.test');
  console.log('');
  await import('./normalize-helpers.test');
  console.log('');
  await import('./workout-energy.test');
  console.log(`\nall wearables tests passed in ${Date.now() - started}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
