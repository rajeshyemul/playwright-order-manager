/**
 * playwright.merge.config.ts
 *
 * Copy this file into your project root and adjust as needed.
 *
 * This config is used by playwright-order-manager during the merge phase —
 * after all buckets have executed, it merges their individual JSON reports
 * into one combined HTML report using Playwright's built-in merge-reports.
 *
 * SETUP:
 *   1. Copy this file to your project root:
 *      cp node_modules/playwright-order-manager/templates/playwright.merge.config.ts .
 *
 *   2. Point the runner at it via env var or RunConfig:
 *      PLAYWRIGHT_MERGE_CONFIG=./playwright.merge.config.ts
 *
 * DOCS:
 *   https://playwright.dev/docs/test-reporters#merge-reports-cli
 */

import { defineConfig } from '@playwright/test';
import * as path from 'path';

/**
 * The directory where playwright-order-manager writes per-bucket blob reports.
 * Must match the ORDERED_REPORT_ROOT env var (default: 'ordered-results').
 */
const REPORT_ROOT = process.env['ORDERED_REPORT_ROOT'] ?? 'ordered-results';

export default defineConfig({
  // The merge config does not run tests — it only merges reports.
  // Point testDir at a non-existent path so no tests are accidentally discovered.
  testDir: './this-dir-does-not-exist',

  reporter: [
    // 1. HTML reporter — opens in browser, full test details
    [
      'html',
      {
        outputFolder: path.join(REPORT_ROOT, 'playwright-html-report'),
        open: 'never', // never auto-open — let the user decide
      },
    ],

    // 2. JUnit XML — useful for CI systems like Jenkins, GitLab, Azure DevOps
    // Comment this out if you don't need JUnit output.
    [
      'junit',
      {
        outputFile: path.join(REPORT_ROOT, 'junit-results.xml'),
      },
    ],

    // 3. Line reporter — shows a summary line in the terminal during merge
    ['line'],
  ],
});