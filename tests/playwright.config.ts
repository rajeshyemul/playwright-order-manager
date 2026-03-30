import { defineConfig } from '@playwright/test';

/**
 * Playwright config for running the package's own unit tests.
 * This is separate from the user's playwright.config.ts.
 *
 * Key differences from a typical e2e config:
 * - No browser launched — these are pure Node.js unit tests
 * - No baseURL, no devices, no viewport
 * - Fast timeout — unit tests should never take more than 5 seconds
 */
export default defineConfig({
  // Look for tests only inside the tests/ directory
  testDir: '.',

  // Only pick up *.spec.ts files
  testMatch: '**/*.spec.ts',

  // Unit tests should be fast — 5 second timeout per test
  timeout: 5_000,

  // Run all tests in this project — no parallelism needed for unit tests
  workers: 1,

  // No browser needed — these tests run in Node.js directly
  use: {
    // Explicitly no browser
  },

  // No projects — single flat run
  projects: [
    {
      name: 'unit',
      // No browser — pure Node.js
    },
  ],

  // Simple reporter for unit tests
  reporter: [
    ['line'],
    ['html', { outputFolder: '../ordered-results/unit-test-report', open: 'never' }],
  ],
});