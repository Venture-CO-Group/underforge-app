import { defineConfig } from 'vitest/config';

// Vitest runs the `describe/it`-style unit tests. The wearables suite under
// tests/frontend/wearables/ has its own ts-node + node:assert runner (invoked
// via `npm run test:wearables`) and self-executes on import, so it is excluded
// here to avoid breaking Vitest collection.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/frontend/wearables/**', '**/node_modules/**'],
    environment: 'node',
  },
});
