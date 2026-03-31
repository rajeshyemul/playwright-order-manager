/**
 * playwright.merge.config.ts
 *
 * Optional example Playwright merge config.
 *
 * Important:
 * - `pw-order` does NOT automatically invoke this config in v0.1.x
 * - The package already writes its own ordered JSON summary and HTML report
 * - This file is only for users who want to experiment with a separate,
 *   manual Playwright `merge-reports` workflow
 *
 * Manual usage example:
 *   1. Copy this file to your project root:
 *      cp node_modules/playwright-order-manager/templates/playwright.merge.config.ts .
 *   2. Adjust the reporters as needed for your own workflow
 *   3. Run Playwright's merge command yourself
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
  // This config does not run tests — it only defines reporters for a
  // manual Playwright merge-reports step.
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
