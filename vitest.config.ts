import { defineConfig } from 'vitest/config';

const coverageExclude = [
  'src/server.ts',
  'src/types/**',
];

if (process.env.USE_MOCK_DB === 'true') {
  coverageExclude.push('src/services/soundlog.service.ts');
}

export default defineConfig({
  test: {
    coverage: {
      exclude: coverageExclude,
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        branches: 50,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    pool: 'threads',
    testTimeout: 15_000,
  },
});
