import * as fs from 'fs';
import * as path from 'path';
import { test as base, type TestInfo } from '@playwright/test';
import { RunnerConstants } from '../constants';
import type { DiscoveredTestCase } from '../types';

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Extracts all tags from a TestInfo object.
 *
 * Playwright attaches tags to tests in two ways depending on version:
 *   1. testInfo.tags         — available in Playwright >= 1.43
 *   2. testInfo.annotations  — older versions used annotations with type 'tag'
 *
 * We support both so the package works with Playwright >= 1.40.
 */
function extractTags(testInfo: TestInfo): string[] {
  // Playwright >= 1.43 exposes tags directly
  if ('tags' in testInfo && Array.isArray((testInfo as any).tags)) {
    return (testInfo as any).tags as string[];
  }

  // Fallback: extract from annotations for older Playwright versions
  if (Array.isArray(testInfo.annotations)) {
    return testInfo.annotations
      .filter((a) => a.type === 'tag' && typeof a.description === 'string')
      .map((a) => a.description as string);
  }

  return [];
}

/**
 * Returns the path where the discovery JSON file will be written.
 *
 * We put it inside the reportRoot directory so it lives alongside
 * the summary JSON and HTML report after the run completes.
 *
 * The path can be overridden via the ORDERED_REPORT_ROOT env var,
 * which is the same variable the runner uses — so both always agree.
 */
function getDiscoveryFilePath(): string {
  const reportRoot =
    process.env['ORDERED_REPORT_ROOT'] ??
    RunnerConstants.DEFAULTS.REPORT_ROOT;

  return path.resolve(
    process.cwd(),
    reportRoot,
    RunnerConstants.DEFAULTS.DISCOVERY_FILENAME
  );
}

/**
 * Ensures a directory exists, creating it recursively if it doesn't.
 */
function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

// =============================================================================
// DISCOVERY ACCUMULATOR
// =============================================================================

/**
 * We accumulate discovered tests in this module-level array.
 *
 * Why module-level and not inside the fixture?
 * Playwright runs worker-scoped fixtures once per worker process.
 * Each worker discovers a subset of tests. We collect all of them
 * into this array across the worker's lifetime, then write once
 * when the worker tears down.
 *
 * This is safe because each worker is its own Node.js process —
 * there is no shared memory between workers.
 */
const discoveredTests: DiscoveredTestCase[] = [];

// =============================================================================
// FIXTURE TYPES
// =============================================================================

/**
 * The worker-scoped fixtures this package adds.
 * Consumers extend their test object with these using base.extend().
 */
interface OrderedDiscoveryFixtures {
  /**
   * Worker-scoped fixture that runs automatically during --list.
   * Users never call this directly — it hooks in automatically.
   */
  orderedDiscovery: void;
}

// =============================================================================
// EXTENDED TEST OBJECT
// =============================================================================

/**
 * Drop-in replacement for Playwright's `test`.
 *
 * Users import this instead of @playwright/test's test, and discovery
 * happens automatically during --list without any other configuration.
 *
 * @example
 * ```typescript
 * // In your test files, replace:
 * import { test, expect } from '@playwright/test';
 *
 * // With:
 * import { test, expect } from 'playwright-order-manager';
 * ```
 */
export const test = base.extend<{}, OrderedDiscoveryFixtures>({
  orderedDiscovery: [
    async ({}, use, workerInfo) => {
      // ── Setup phase (before tests in this worker run) ──────────────
      // Nothing to do here — we collect test info per-test in the
      // test-scoped hook below, not at worker startup.
      // We still need this worker fixture so that the teardown phase
      // (after all tests in this worker complete) can write the file.

      await use();

      // ── Teardown phase (after all tests in this worker complete) ───
      // Only write if we actually discovered something.
      // During a normal run (not --list), this array will be empty
      // because we only populate it via the beforeEach hook below.
      if (discoveredTests.length === 0) return;

      const filePath = getDiscoveryFilePath();
      ensureDir(path.dirname(filePath));

      // Read existing file if present (another worker may have written first)
      let existing: DiscoveredTestCase[] = [];
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { tests?: DiscoveredTestCase[] };
        if (Array.isArray(parsed.tests)) {
          existing = parsed.tests;
        }
      } catch {
        // File doesn't exist yet — that's fine, we'll create it
      }

      // Merge this worker's discoveries with what's already on disk.
      // De-duplicate by project + file + line + title so tests with the same
      // name in different files are preserved correctly.
      const seen = new Set(
        existing.map((t) => `${t.project}::${t.file}::${t.line}::${t.title}`)
      );
      const merged = [...existing];

      for (const discovered of discoveredTests) {
        const key =
          `${discovered.project}::${discovered.file}::` +
          `${discovered.line}::${discovered.title}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(discovered);
        }
      }

      fs.writeFileSync(
        filePath,
        JSON.stringify({ tests: merged }, null, 2),
        'utf8'
      );

      if (process.env['ORDERED_DEBUG']) {
        console.log(
          `[playwright-order-manager] Worker ${workerInfo.workerIndex} ` +
          `wrote ${discoveredTests.length} tests to ${filePath}`
        );
      }
    },
    // worker scope + auto:true means Playwright runs this automatically
    // for every worker, without the user needing to use it in their tests
    { scope: 'worker', auto: true },
  ],
});

// =============================================================================
// PER-TEST DISCOVERY HOOK
// =============================================================================

// We use beforeEach to capture each test's metadata as Playwright
// iterates through them during --list.
//
// Why beforeEach and not a test-scoped fixture?
// During --list, Playwright calls beforeEach hooks to enumerate tests.
// A test-scoped fixture would work too, but beforeEach gives us access
// to testInfo which has the full title, tags, file, and line number.

// We wrap this in try-catch because test.beforeEach() throws if called
// outside of a Playwright test context — for example when a plain Node.js
// script imports from playwright-order-manager for its non-fixture exports.
// In that case we skip registration silently. The beforeEach only matters
// when Playwright is actually running tests.
try {
  test.beforeEach(async ({}, testInfo) => {
    if (!process.env['ORDERED_DISCOVERY']) return;

    const tags = extractTags(testInfo);

    const discovered: DiscoveredTestCase = {
      title:   testInfo.title,
      file:    testInfo.file,
      line:    testInfo.line,
      tags,
      project: testInfo.project.name,
    };

    discoveredTests.push(discovered);
  });
} catch {
  // Not in a Playwright test context — beforeEach registration skipped.
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

// Re-export everything from @playwright/test so users can replace their
// import entirely. They get our extended `test` plus Playwright's `expect`,
// `Page`, `Browser`, and all other exports they're used to.
export { expect } from '@playwright/test';
export type {
  Page,
  Browser,
  BrowserContext,
  Locator,
  APIRequestContext,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
} from '@playwright/test';
