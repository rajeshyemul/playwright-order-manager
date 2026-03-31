// =============================================================================
// ORDER MODES & POLICIES
// =============================================================================

/**
 * Controls how tests are grouped and sequenced before execution.
 *
 * - 'basic'    → runs tests in the order Playwright discovers them. No reordering.
 * - 'priority' → groups tests by @P1/@P2/@P3/@P4 tags, runs highest priority first.
 * - 'custom'   → reserved for v2. Allows user-defined ordering functions.
 */
export type OrderMode = 'basic' | 'priority' | 'custom';

/**
 * Controls what happens when a bucket (group of tests) fails.
 *
 * - 'critical'   → if a bucket marked critical fails, stop the entire run immediately.
 * - 'continue'   → log the failure and continue running remaining buckets.
 * - 'immediate'  → stop the entire run on the very first failure, regardless of bucket.
 */
export type FailurePolicy = 'critical' | 'continue' | 'immediate';

/**
 * The four priority tags your tests can be annotated with.
 * @P1 = highest priority, @P4 = lowest priority.
 */
export type PriorityTag = '@P1' | '@P2' | '@P3' | '@P4';

/**
 * How a bucket was formed.
 *
 * - 'boundary'  → a special bucket: the @runFirst or @runLast group.
 * - 'priority'  → a bucket formed from a @P1/@P2/@P3/@P4 group.
 * - 'none'      → a bucket formed from tests with no priority tag (NoPriority group).
 */
export type BucketKind = 'boundary' | 'priority' | 'none';

// =============================================================================
// DISCOVERY — what Playwright tells us before running anything
// =============================================================================

/**
 * Represents a single test case as discovered by `playwright --list`.
 * This is the raw information before any ordering or grouping happens.
 */
export interface DiscoveredTestCase {
  /** Full test title including describe block(s), e.g. "Login > should redirect on success" */
  title: string;

  /** Absolute path to the test file on disk */
  file: string;

  /** Line number where the test is defined in its file */
  line: number;

  /**
   * All tags attached to this test.
   * e.g. ['@P1', '@runFirst', '@smoke']
   */
  tags: string[];

  /**
   * The project name this test belongs to, as defined in playwright.config.ts.
   * e.g. 'chromium', 'firefox', 'Mobile Chrome'
   */
  project: string;
}

// =============================================================================
// EXECUTION — what comes back after tests run
// =============================================================================

/**
 * The outcome of a single test after it has been executed.
 */
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';

/**
 * Represents the result of one test case after a Playwright run completes.
 */
export interface ExecutedTestResult {
  /** Full test title, matching what was in DiscoveredTestCase */
  title: string;

  /** Absolute path to the test file */
  file: string;

  /**
   * Line number where the test is defined in its file, when available.
   * Useful for disambiguating tests that share the same title.
   */
  line?: number;

  /** Final status of this test */
  status: TestStatus;

  /**
   * How long this test took to run, in milliseconds.
   * Will be 0 for skipped tests.
   */
  duration: number;

  /**
   * Number of retry attempts used.
   * 0 means the test passed (or failed) on the first try.
   */
  retries: number;

  /** Error message if the test failed. undefined if it passed or was skipped. */
  errorMessage?: string;

  /**
   * Tags attached to this test, e.g. ['@P1', '@runFirst', '@smoke'].
   * Optional — populated during discovery, carried through to the report.
   */
  tags?: string[];
}

// =============================================================================
// BUCKETS — the core grouping concept
// =============================================================================

/**
 * A planned group of tests before execution begins.
 * OrderedExecution.buildBuckets() produces an array of these.
 */
export interface BucketPlan {
  /**
   * Unique identifier for this bucket.
   * e.g. 'boundary-run-first', 'priority-P1', 'priority-P2', 'none'
   */
  key: string;

  /**
   * Human-readable label shown in logs and reports.
   * e.g. 'Run First', 'Priority P1', 'No Priority'
   */
  label: string;

  /** How this bucket was formed */
  kind: BucketKind;

  /**
   * If true, a failure in this bucket will trigger the FailurePolicy.
   * Boundary buckets (@runFirst) are typically critical.
   */
  critical: boolean;

  /** The tests that belong to this bucket, in execution order */
  tests: DiscoveredTestCase[];
}

/**
 * The result record for a bucket after it has been fully executed.
 * One of these is written to disk for every bucket that ran.
 */
export interface BucketExecutionRecord {
  /** Matches the key from BucketPlan */
  key: string;

  /** Matches the label from BucketPlan */
  label: string;

  /** Whether this bucket was marked critical */
  critical: boolean;

  /** Total number of tests in this bucket */
  totalTests: number;

  /** How many tests passed */
  passed: number;

  /** How many tests failed */
  failed: number;

  /** How many tests were skipped */
  skipped: number;

  /** Total wall-clock time for the entire bucket, in milliseconds */
  duration: number;

  /** The final status of the bucket as a whole */
  status: 'passed' | 'failed' | 'skipped';


  /**
   * ISO 8601 timestamp of when this bucket started executing.
   * Optional — only present when the runner records timing per bucket.
   */
  startedAt?: string;

  /**
   * ISO 8601 timestamp of when this bucket finished executing.
   * Optional — only present when the runner records timing per bucket.
   */
  finishedAt?: string;

  /** Individual test results within this bucket */
  results: ExecutedTestResult[];
}

// =============================================================================
// SUMMARY — the final output written to disk after all buckets complete
// =============================================================================

/**
 * The complete summary of an ordered test run.
 * Written to disk as JSON and used to generate the HTML report.
 */
export interface OrderedRunSummary {
  /** ISO 8601 timestamp of when the run started, e.g. "2024-03-27T10:30:00.000Z" */
  startedAt: string;

  /** ISO 8601 timestamp of when the run finished */
  finishedAt: string;

  /** Total wall-clock duration of the entire run, in milliseconds */
  totalDuration: number;

  /** The OrderMode that was used for this run */
  orderMode: OrderMode;

  /** The FailurePolicy that was used for this run */
  failurePolicy: FailurePolicy;

  /** Summary counts across all buckets */
  totals: {
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
    buckets: number;
  };

  /** Whether the overall run should be considered a success */
  success: boolean;

  /** One record per bucket that was executed */
  buckets: BucketExecutionRecord[];
}

// =============================================================================
// CONFIGURATION — what the user passes in to configure a run
// =============================================================================

/**
 * Options passed to OrderedExecution.buildBuckets().
 * Controls how tests are grouped into buckets.
 */
export interface BuildBucketOptions {
  /** The discovered tests to group */
  tests: DiscoveredTestCase[];

  /** How to order and group them */
  orderMode: OrderMode;

  /**
   * Tags that force a test to run first, before all other buckets.
   * Defaults to ['@runFirst']
   */
  runFirstTags?: string[];

  /**
   * Tags that force a test to run last, after all other buckets.
   * Defaults to ['@runLast']
   */
  runLastTags?: string[];
}

/**
 * The full configuration object for a programmatic run.
 * Passed to TestOrderManager when used as a library (not via CLI).
 * All fields are optional — anything not provided falls back to env vars,
 * then to the defaults in RunnerConstants.
 */
export interface RunConfig {
  /** Path to your playwright.config.ts. Defaults to ./playwright.config.ts */
  playwrightConfigPath?: string;

  /** Path to your merge config. Defaults to ./playwright.merge.config.ts */
  mergeConfigPath?: string;

  /** Directory where run output (JSON, HTML) is written. Defaults to ./ordered-results */
  reportRoot?: string;

  /** How to order tests. Defaults to 'priority' */
  orderMode?: OrderMode;

  /** What to do when a critical bucket fails. Defaults to 'critical' */
  failurePolicy?: FailurePolicy;

  /** Playwright project name(s) to run, e.g. 'chromium'. Forwarded to Playwright. */
  project?: string | string[];

  /** Any extra flags to forward to the Playwright CLI */
  extraArgs?: string[];
}
