import type {
  DiscoveredTestCase,
  ExecutedTestResult,
  TestStatus,
} from '../types';

// =============================================================================
// INTERNAL PLAYWRIGHT JSON TYPES
// These match the shape of JSON that Playwright writes to disk.
// They are intentionally NOT exported — they are internal to this file only.
// Playwright can change these formats between versions. Our job is to absorb
// that change here, so the rest of the package never knows it happened.
// =============================================================================

/**
 * The root shape of Playwright's JSON report file.
 * Written when you pass --reporter=json to Playwright.
 */
interface PlaywrightJsonReport {
  suites: PlaywrightSuite[];
  stats?: {
    startTime: string;
    duration: number;
  };
}

/**
 * A suite in Playwright's JSON report.
 * Suites are nested — a file is a suite, a describe() block is a suite,
 * and suites can contain other suites or specs.
 */
interface PlaywrightSuite {
  title: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

/**
 * A spec is a single test (it() or test() call) in Playwright's JSON.
 * One spec can have multiple tests inside it (one per project/retry).
 */
interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tags?: string[];
  tests: PlaywrightTest[];
  line?: number;
  column?: number;
}

/**
 * A single test execution inside a spec.
 * There is one PlaywrightTest per project that ran this spec.
 */
interface PlaywrightTest {
  projectName: string;
  projectId?: string;
  status: string;
  duration: number;
  errors?: Array<{ message?: string; value?: string }>;
  results?: PlaywrightTestResult[];
}

/**
 * One attempt at running a test (Playwright supports retries).
 * A test that passed on retry 2 will have 3 PlaywrightTestResult entries.
 */
interface PlaywrightTestResult {
  status: string;
  duration: number;
  retry: number;
  errors?: Array<{ message?: string; value?: string }>;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Normalises whatever status string Playwright gives us into our TestStatus type.
 * Playwright uses 'expected', 'unexpected', 'flaky', 'skipped' — we map those
 * to our simpler 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted'.
 */
function normaliseStatus(raw: string): TestStatus {
  switch (raw) {
    case 'expected':
    case 'passed':
      return 'passed';

    case 'skipped':
      return 'skipped';

    case 'timedOut':
      return 'timedOut';

    case 'interrupted':
      return 'interrupted';

    // 'unexpected', 'flaky', or anything else we don't recognise → failed
    default:
      return 'failed';
  }
}

/**
 * Extracts the most useful error message from a Playwright error array.
 * Playwright can report multiple errors per test — we take the first non-empty one.
 */
function extractErrorMessage(
  errors?: Array<{ message?: string; value?: string }>
): string | undefined {
  if (!errors || errors.length === 0) return undefined;

  for (const error of errors) {
    const msg = error.message ?? error.value;
    if (msg && msg.trim().length > 0) {
      // Trim to first 500 chars — full stack traces belong in the HTML report,
      // not in our summary JSON
      return msg.trim().slice(0, 500);
    }
  }

  return undefined;
}

/**
 * Recursively walks a Playwright suite tree and collects all specs.
 * Suites can be nested arbitrarily deep (file → describe → describe → spec).
 *
 * @param suite     - The current suite node to walk
 * @param filePath  - The file path, carried down from the top-level suite
 * @param collected - Accumulator array — specs are pushed here
 */
function collectSpecs(
  suite: PlaywrightSuite,
  filePath: string,
  collected: Array<{ spec: PlaywrightSpec; file: string }>
): void {
  // Collect specs at this level
  if (suite.specs) {
    for (const spec of suite.specs) {
      collected.push({ spec, file: filePath });
    }
  }

  // Recurse into nested suites
  if (suite.suites) {
    for (const child of suite.suites) {
      // Use the child's own file path if it has one, otherwise inherit from parent
      collectSpecs(child, child.file ?? filePath, collected);
    }
  }
}

/**
 * Playwright's JSON reporter returns tags without the leading '@'
 * when tests are declared with metadata like { tag: ['@P1'] }.
 * Normalize everything to the internal '@tag' format the runner expects.
 */
function normaliseTag(tag: unknown): string | undefined {
  if (typeof tag !== 'string') return undefined;

  const trimmed = tag.trim();
  if (trimmed.length === 0) return undefined;

  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function normaliseTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const normalised: string[] = [];

  for (const rawTag of tags) {
    const tag = normaliseTag(rawTag);
    if (!tag || seen.has(tag)) continue;

    seen.add(tag);
    normalised.push(tag);
  }

  return normalised;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export class OrderedReportParser {
  /**
   * Parses Playwright's execution JSON report into our typed ExecutedTestResult array.
   *
   * Call this after a Playwright run completes and writes its JSON report.
   * The result is what OrderedSummary uses to build the final summary.
   *
   * @param rawJson - The parsed contents of Playwright's JSON report file.
   *                  Pass the result of JSON.parse(fs.readFileSync(reportPath, 'utf8')).
   * @returns A flat array of ExecutedTestResult, one entry per test per project.
   *
   * @example
   * ```typescript
   * const raw = JSON.parse(fs.readFileSync('./test-results/report.json', 'utf8'));
   * const results = OrderedReportParser.parseExecutionReport(raw);
   * ```
   */
  static parseExecutionReport(rawJson: unknown): ExecutedTestResult[] {
    // Validate that we got something that looks like a Playwright report
    if (!rawJson || typeof rawJson !== 'object') {
      throw new Error(
        'OrderedReportParser.parseExecutionReport: ' +
        'expected a JSON object, got ' + typeof rawJson
      );
    }

    const report = rawJson as PlaywrightJsonReport;

    if (!Array.isArray(report.suites)) {
      throw new Error(
        'OrderedReportParser.parseExecutionReport: ' +
        'JSON does not look like a Playwright report (missing "suites" array)'
      );
    }

    const results: ExecutedTestResult[] = [];

    // Collect all specs from the entire suite tree
    const allSpecs: Array<{ spec: PlaywrightSpec; file: string }> = [];

    for (const topSuite of report.suites) {
      collectSpecs(topSuite, topSuite.file ?? '', allSpecs);
    }

    // Convert each spec + its tests into ExecutedTestResult entries
    for (const { spec, file } of allSpecs) {
      if (!spec.tests || spec.tests.length === 0) continue;

      for (const test of spec.tests) {
        // How many retries were used?
        // results array has one entry per attempt. retries = attempts - 1.
        const retries = test.results
          ? Math.max(0, test.results.length - 1)
          : 0;

        // The final error comes from the last result attempt (if it failed)
        const lastResult = test.results?.[test.results.length - 1];
        const errorMessage = extractErrorMessage(
          lastResult?.errors ?? test.errors
        );

        results.push({
          title: spec.title,
          file,
          line: spec.line,
          status: normaliseStatus(test.status),
          duration: test.duration,
          retries,
          errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Parses the discovery JSON written during `playwright --list` phase.
   *
   * During discovery, our fixture writes a JSON file containing the list
   * of all tests Playwright found. This method reads that file's contents
   * and converts them into DiscoveredTestCase objects.
   *
   * @param rawJson - The parsed contents of the discovery JSON file.
   * @returns A flat array of DiscoveredTestCase objects.
   *
   * @example
   * ```typescript
   * const raw = JSON.parse(fs.readFileSync('./ordered-results/ordered-discovery.json', 'utf8'));
   * const tests = OrderedReportParser.parseDiscoveryReport(raw);
   * ```
   */
  static parseDiscoveryReport(rawJson: unknown): DiscoveredTestCase[] {
    if (!rawJson || typeof rawJson !== 'object') {
      throw new Error(
        'OrderedReportParser.parseDiscoveryReport: ' +
        'expected a JSON object, got ' + typeof rawJson
      );
    }

    const report = rawJson as PlaywrightJsonReport & { tests?: unknown };

    // Support our custom discovery file format: { tests: [...] }
    if (Array.isArray(report.tests)) {
      return report.tests
        .filter((entry): entry is DiscoveredTestCase => {
          return (
            entry !== null &&
            typeof entry === 'object' &&
            typeof (entry as DiscoveredTestCase).title === 'string' &&
            typeof (entry as DiscoveredTestCase).file === 'string' &&
            Array.isArray((entry as DiscoveredTestCase).tags)
          );
        })
        .map((entry) => ({
          ...entry,
          tags: normaliseTags(entry.tags),
        }));
    }

    // Also support raw Playwright JSON reporter output from `playwright test --list`.
    if (!Array.isArray(report.suites)) {
      throw new Error(
        'OrderedReportParser.parseDiscoveryReport: ' +
        'JSON is neither a custom discovery file nor a Playwright report.'
      );
    }

    const allSpecs: Array<{ spec: PlaywrightSpec; file: string }> = [];
    for (const topSuite of report.suites) {
      collectSpecs(topSuite, topSuite.file ?? '', allSpecs);
    }

    const discovered: DiscoveredTestCase[] = [];
    const seen = new Set<string>();

    for (const { spec, file } of allSpecs) {
      if (!Array.isArray(spec.tests) || spec.tests.length === 0) continue;

      const tags = normaliseTags(spec.tags);

      for (const test of spec.tests) {
        const project = test.projectName ?? test.projectId ?? '';
        const key = `${project}::${file}::${spec.line}::${spec.title}`;

        if (seen.has(key)) continue;
        seen.add(key);

        discovered.push({
          title: spec.title,
          file,
          line: spec.line ?? 0,
          tags,
          project,
        });
      }
    }

    return discovered;
  }
}
