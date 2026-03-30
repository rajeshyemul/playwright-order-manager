import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import { RunnerConstants } from '../constants';
import { OrderedExecution } from '../core/OrderedExecution';
import { OrderedReportParser } from '../core/OrderedReportParser';
import { OrderedSummary } from '../core/OrderedSummary';
import type {
  RunConfig,
  OrderMode,
  FailurePolicy,
  DiscoveredTestCase,
  BucketPlan,
  BucketExecutionRecord,
  ExecutedTestResult,
} from '../types';

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * The fully-resolved configuration for a run.
 * All fields are required — defaults have been applied.
 * This is what the runner actually uses internally.
 */
interface ResolvedConfig {
  playwrightConfigPath: string;
  mergeConfigPath:      string;
  reportRoot:           string;
  orderMode:            OrderMode;
  failurePolicy:        FailurePolicy;
  project:              string[];
  extraArgs:            string[];
}

/**
 * The result of executing a single bucket.
 */
interface BucketRunResult {
  record:       BucketExecutionRecord;
  shouldAbort:  boolean;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Merges env vars and a RunConfig object into a ResolvedConfig.
 * RunConfig values take priority over env vars.
 * Env vars take priority over hardcoded defaults.
 *
 * Priority order (highest → lowest):
 *   RunConfig object  →  env vars  →  RunnerConstants.DEFAULTS
 */
function resolveConfig(userConfig?: RunConfig): ResolvedConfig {
  const env = process.env;

  const orderMode = (
    userConfig?.orderMode ??
    env['ORDER_MODE'] ??
    RunnerConstants.DEFAULTS.ORDER_MODE
  ) as OrderMode;

  const failurePolicy = (
    userConfig?.failurePolicy ??
    env['FAILURE_POLICY'] ??
    RunnerConstants.DEFAULTS.FAILURE_POLICY
  ) as FailurePolicy;

  const reportRoot =
    userConfig?.reportRoot ??
    env['ORDERED_REPORT_ROOT'] ??
    RunnerConstants.DEFAULTS.REPORT_ROOT;

  const playwrightConfigPath =
    userConfig?.playwrightConfigPath ??
    env['PLAYWRIGHT_CONFIG'] ??
    'playwright.config.ts';

  const mergeConfigPath =
    userConfig?.mergeConfigPath ??
    env['PLAYWRIGHT_MERGE_CONFIG'] ??
    'playwright.merge.config.ts';

  // project can be a string, array, or comma-separated env var
  let project: string[] = [];
  if (userConfig?.project) {
    project = Array.isArray(userConfig.project)
      ? userConfig.project
      : [userConfig.project];
  } else if (env['PLAYWRIGHT_PROJECT']) {
    project = env['PLAYWRIGHT_PROJECT'].split(',').map((p) => p.trim());
  }

  const extraArgs = userConfig?.extraArgs ?? [];

  return {
    playwrightConfigPath,
    mergeConfigPath,
    reportRoot,
    orderMode,
    failurePolicy,
    project,
    extraArgs,
  };
}

/**
 * Ensures a directory exists, creating it recursively if needed.
 */
function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Logs a message with a [pw-order] prefix.
 * Using a prefix makes our output easy to distinguish from Playwright's output.
 */
function log(message: string): void {
  console.log(`[pw-order] ${message}`);
}

/**
 * Logs an error with a [pw-order] prefix.
 */
function logError(message: string): void {
  console.error(`[pw-order] ERROR: ${message}`);
}

/**
 * Returns the absolute path to the Playwright CLI binary.
 * We always use the local installation (node_modules/.bin/playwright)
 * rather than a global one — ensures we use the version the project depends on.
 */
function getPlaywrightBin(): string {
  return path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    os.platform() === 'win32' ? 'playwright.cmd' : 'playwright'
  );
}

/**
 * Spawns a child process and returns a promise that resolves
 * with the exit code when the process finishes.
 *
 * stdout and stderr are piped to the parent process in real time
 * so the user sees Playwright's output as it happens.
 *
 * @param command - The executable to run
 * @param args    - Arguments to pass to the executable
 * @param env     - Additional environment variables to inject
 */
function spawnProcess(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, {
      stdio: 'inherit',        // pipe stdout/stderr straight to terminal
      env: {
        ...process.env,        // inherit everything from the parent
        ...env,                // then add/override our extras
      },
      shell: false,            // never use shell — avoids platform quoting issues
    });

    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => reject(
      new Error(`Failed to spawn ${command}: ${err.message}`)
    ));
  });
}

/**
 * Builds the Playwright CLI args for a discovery run (--list).
 * We set --reporter=json and point it at a temp file so we can
 * parse the discovered tests after the process exits.
 */
function buildDiscoveryArgs(
  config: ResolvedConfig,
  discoveryJsonPath: string
): string[] {
  const args = [
    'test',
    '--list',
    '--config', config.playwrightConfigPath,
    `--reporter=json`,
  ];

  for (const project of config.project) {
    args.push('--project', project);
  }

  args.push(...config.extraArgs);

  return args;
}

/**
 * Builds the Playwright CLI args for executing a single bucket.
 *
 * We pass the test file paths as positional arguments so Playwright
 * only runs the tests that belong to this bucket.
 */
function buildBucketArgs(
  config: ResolvedConfig,
  bucket: BucketPlan,
  executionJsonPath: string
): string[] {
  // Collect unique file paths for tests in this bucket
  const files = [...new Set(bucket.tests.map((t) => t.file))];

  const args = [
    'test',
    '--config', config.playwrightConfigPath,
    `--reporter=json`,
  ];

  for (const project of config.project) {
    args.push('--project', project);
  }

  // Add each file as a positional argument
  args.push(...files);

  args.push(...config.extraArgs);

  return args;
}

/**
 * Aggregates an array of ExecutedTestResult into bucket-level counts.
 */
function aggregateResults(results: ExecutedTestResult[]): {
  passed: number;
  failed: number;
  skipped: number;
  totalDuration: number;
} {
  return results.reduce(
    (acc, r) => ({
      passed:        acc.passed  + (r.status === 'passed'  ? 1 : 0),
      failed:        acc.failed  + (r.status === 'failed' || r.status === 'timedOut' ? 1 : 0),
      skipped:       acc.skipped + (r.status === 'skipped' ? 1 : 0),
      totalDuration: acc.totalDuration + r.duration,
    }),
    { passed: 0, failed: 0, skipped: 0, totalDuration: 0 }
  );
}

// =============================================================================
// CORE RUNNER CLASS
// =============================================================================

export class TestOrderManager {

  // ---------------------------------------------------------------------------
  // PHASE 1 — DISCOVERY
  // ---------------------------------------------------------------------------

  /**
   * Runs `playwright --list` to discover all tests matching the config.
   * Sets ORDERED_DISCOVERY=true so our fixture captures test metadata.
   * Returns the discovered tests parsed from the discovery JSON file.
   */
  private static async discover(
    config: ResolvedConfig
  ): Promise<DiscoveredTestCase[]> {
    log('Starting discovery phase...');

    const discoveryFilePath = path.resolve(
      process.cwd(),
      config.reportRoot,
      RunnerConstants.DEFAULTS.DISCOVERY_FILENAME
    );

    // Clean up any previous discovery file so we start fresh
    ensureDir(path.dirname(discoveryFilePath));
    if (fs.existsSync(discoveryFilePath)) {
      fs.unlinkSync(discoveryFilePath);
    }

    // Write to a temp JSON file — Playwright's --list with --reporter=json
    // doesn't write to disk by default, our fixture handles the actual write
    const discoveryArgs = buildDiscoveryArgs(config, discoveryFilePath);

    log(`Running: playwright ${discoveryArgs.join(' ')}`);

    const exitCode = await spawnProcess(
      getPlaywrightBin(),
      discoveryArgs,
      {
        ORDERED_DISCOVERY: 'true',
        ORDERED_REPORT_ROOT: config.reportRoot,
      }
    );

    // --list exits with 0 even if no tests found, but non-zero means a config error
    if (exitCode !== 0) {
      throw new Error(
        `Discovery failed with exit code ${exitCode}. ` +
        `Check your playwright.config.ts for errors.`
      );
    }

    // Read and parse the discovery file written by our fixture
    if (!fs.existsSync(discoveryFilePath)) {
      log('Warning: no discovery file found. Did you import test from playwright-order-manager in your test files?');
      return [];
    }

    const raw = JSON.parse(fs.readFileSync(discoveryFilePath, 'utf8'));
    const tests = OrderedReportParser.parseDiscoveryReport(raw);

    log(`Discovered ${tests.length} tests across ${config.project.length || 'all'} projects`);

    return tests;
  }

  // ---------------------------------------------------------------------------
  // PHASE 2 — PLANNING
  // ---------------------------------------------------------------------------

  /**
   * Takes discovered tests and builds the ordered bucket plan.
   * Logs the plan so the user can see exactly what will run and in what order.
   */
  private static plan(
    tests: DiscoveredTestCase[],
    config: ResolvedConfig
  ): BucketPlan[] {
    log(`Planning execution order (mode: ${config.orderMode})...`);

    const buckets = OrderedExecution.buildBuckets({
      tests,
      orderMode: config.orderMode,
    });

    log(`Execution plan: ${buckets.length} bucket(s)`);
    buckets.forEach((bucket, index) => {
      const critical = bucket.critical ? ' [critical]' : '';
      log(`  #${index + 1} ${bucket.label}${critical} — ${bucket.tests.length} tests`);
    });

    return buckets;
  }

  // ---------------------------------------------------------------------------
  // PHASE 3 — EXECUTION (one bucket at a time)
  // ---------------------------------------------------------------------------

  /**
   * Executes a single bucket by spawning Playwright and parsing the results.
   *
   * Returns a BucketRunResult containing:
   *   - record:      The completed BucketExecutionRecord to add to the summary
   *   - shouldAbort: Whether the failure policy says we must stop the run
   */
  private static async executeBucket(
    bucket: BucketPlan,
    bucketIndex: number,
    totalBuckets: number,
    config: ResolvedConfig
  ): Promise<BucketRunResult> {
    const num = bucketIndex + 1;
    log(`\nExecuting bucket #${num}/${totalBuckets}: ${bucket.label} (${bucket.tests.length} tests)`);

    const startedAt = new Date().toISOString();

    // Path where Playwright writes its JSON report for this bucket
    const executionJsonPath = path.resolve(
      process.cwd(),
      config.reportRoot,
      `bucket-${num}-${bucket.key}.json`
    );

    const bucketArgs = buildBucketArgs(config, bucket, executionJsonPath);

    log(`Running: playwright ${bucketArgs.join(' ')}`);

    const exitCode = await spawnProcess(
      getPlaywrightBin(),
      bucketArgs,
      {
        ORDERED_REPORT_ROOT: config.reportRoot,
        // Tell Playwright to write its JSON report to our path
        PLAYWRIGHT_JSON_OUTPUT_NAME: executionJsonPath,
      }
    );

    const finishedAt = new Date().toISOString();

    // Parse results from the JSON report Playwright wrote
    let results: ExecutedTestResult[] = [];

    if (fs.existsSync(executionJsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(executionJsonPath, 'utf8'));
        results = OrderedReportParser.parseExecutionReport(raw);

        // Attach tags from the original bucket plan to each result
        // so the HTML report can show them per test
        results = results.map((result) => {
          const originalTest = bucket.tests.find(
            (t) => t.title === result.title && t.file === result.file
          );
          return {
            ...result,
            tags: originalTest?.tags ?? [],
          };
        });
      } catch (err) {
        logError(`Failed to parse execution report for bucket ${bucket.label}: ${(err as Error).message}`);
      }
    } else {
      logError(`No execution report found for bucket ${bucket.label}. Tests may not have run.`);
    }

    // Aggregate results into bucket-level counts
    const counts = aggregateResults(results);

    const bucketStatus: BucketExecutionRecord['status'] =
      counts.failed > 0 ? 'failed' : 'passed';

    const record: BucketExecutionRecord = {
      key:        bucket.key,
      label:      bucket.label,
      critical:   bucket.critical,
      totalTests: bucket.tests.length,
      passed:     counts.passed,
      failed:     counts.failed,
      skipped:    counts.skipped,
      duration:   counts.totalDuration,
      status:     bucketStatus,
      startedAt,
      finishedAt,
      results,
    };

    // Log bucket result
    log(
      `Bucket #${num} complete: ` +
      `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`
    );

    // Determine if we should abort based on failure policy
    const shouldAbort = TestOrderManager.shouldAbortRun(
      record,
      config.failurePolicy
    );

    if (shouldAbort) {
      logError(
        `Aborting run after bucket #${num} (${bucket.label}) — ` +
        `failure policy: ${config.failurePolicy}`
      );
    }

    return { record, shouldAbort };
  }

  // ---------------------------------------------------------------------------
  // FAILURE POLICY
  // ---------------------------------------------------------------------------

  /**
   * Determines whether the run should be aborted after a bucket completes.
   *
   * - 'critical'  → abort only if this specific bucket is marked critical AND failed
   * - 'immediate' → abort on any failure, regardless of critical flag
   * - 'continue'  → never abort, always run all remaining buckets
   */
  private static shouldAbortRun(
    record: BucketExecutionRecord,
    policy: FailurePolicy
  ): boolean {
    if (record.status !== 'failed') return false;

    switch (policy) {
      case 'critical':
        return record.critical;

      case 'immediate':
        return true;

      case 'continue':
        return false;

      default: {
        const check: never = policy;
        throw new Error(`Unknown failure policy: ${check}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PHASE 4 — FULL ORCHESTRATED RUN
  // ---------------------------------------------------------------------------

  /**
   * Runs the complete ordered test suite.
   *
   * This is the main entry point — called by bin/run.js (CLI usage)
   * or directly by users who import TestOrderManager programmatically.
   *
   * @param userConfig - Optional RunConfig for programmatic use.
   *                     All fields fall back to env vars then defaults.
   *
   * @returns The process exit code: 0 for success, 1 for failure.
   *          When called from bin/run.js, we call process.exit() directly.
   *          When called programmatically, we return the code so the caller
   *          can decide what to do with it.
   *
   * @example CLI usage (via bin/run.js):
   * ```
   * npx pw-order --project=chromium
   * ```
   *
   * @example Programmatic usage:
   * ```typescript
   * import { TestOrderManager } from 'playwright-order-manager';
   *
   * const exitCode = await TestOrderManager.run({
   *   orderMode: 'priority',
   *   failurePolicy: 'continue',
   *   project: 'chromium',
   * });
   * ```
   */
  static async run(userConfig?: RunConfig): Promise<number> {
    const startedAt = new Date().toISOString();
    const config    = resolveConfig(userConfig);

    log('='.repeat(60));
    log('playwright-order-manager');
    log('='.repeat(60));
    log(`Order mode:     ${config.orderMode}`);
    log(`Failure policy: ${config.failurePolicy}`);
    log(`Report root:    ${config.reportRoot}`);
    log(`Config:         ${config.playwrightConfigPath}`);
    if (config.project.length > 0) {
      log(`Projects:       ${config.project.join(', ')}`);
    }
    log('='.repeat(60));

    // Ensure report root exists before anything else
    ensureDir(path.resolve(process.cwd(), config.reportRoot));

    let allBucketRecords: BucketExecutionRecord[] = [];
    let exitCode = 0;

    try {
      // ── Phase 1: Discover ──────────────────────────────────────────
      const tests = await TestOrderManager.discover(config);

      if (tests.length === 0) {
        log('No tests discovered. Exiting.');
        return 0;
      }

      // ── Phase 2: Plan ──────────────────────────────────────────────
      const buckets = TestOrderManager.plan(tests, config);

      if (buckets.length === 0) {
        log('No buckets to execute. Exiting.');
        return 0;
      }

      // ── Phase 3: Execute ───────────────────────────────────────────
      // We split into three phases: runFirst → middle → runLast
      // The runLast phase always executes even if middle buckets failed,
      // because runLast is typically cleanup and must always run.

      const { runFirst, middle, runLast } =
        OrderedExecution.groupBuckets(buckets);

      let aborted = false;

      // runFirst phase
      for (const bucket of runFirst) {
        const result = await TestOrderManager.executeBucket(
          bucket,
          allBucketRecords.length,
          buckets.length,
          config
        );
        allBucketRecords.push(result.record);

        if (result.shouldAbort) {
          aborted = true;
          exitCode = 1;
          break;
        }
      }

      // middle phase — skip if aborted in runFirst
      if (!aborted) {
        for (const bucket of middle) {
          const result = await TestOrderManager.executeBucket(
            bucket,
            allBucketRecords.length,
            buckets.length,
            config
          );
          allBucketRecords.push(result.record);

          if (result.record.status === 'failed') exitCode = 1;

          if (result.shouldAbort) {
            aborted = true;
            break;
          }
        }
      }

      // runLast phase — ALWAYS executes, even after abort
      // This ensures cleanup tests always run
      for (const bucket of runLast) {
        const result = await TestOrderManager.executeBucket(
          bucket,
          allBucketRecords.length,
          buckets.length,
          config
        );
        allBucketRecords.push(result.record);
        if (result.record.status === 'failed') exitCode = 1;
      }

    } catch (err) {
      logError((err as Error).message);
      exitCode = 1;
    }

    // ── Phase 4: Summarise ─────────────────────────────────────────────
    try {
      const summary = OrderedSummary.buildSummary(
        allBucketRecords,
        startedAt,
        config.orderMode,
        config.failurePolicy
      );

      const { jsonPath, htmlPath } = OrderedSummary.write(
        summary,
        path.resolve(process.cwd(), config.reportRoot)
      );

      log('='.repeat(60));
      log(`Run complete`);
      log(`  Total:   ${summary.totals.tests} tests`);
      log(`  Passed:  ${summary.totals.passed}`);
      log(`  Failed:  ${summary.totals.failed}`);
      log(`  Skipped: ${summary.totals.skipped}`);
      log(`  Result:  ${summary.success ? 'PASSED' : 'FAILED'}`);
      log(`  JSON:    ${jsonPath}`);
      log(`  HTML:    ${htmlPath}`);
      log('='.repeat(60));

    } catch (err) {
      logError(`Failed to write summary: ${(err as Error).message}`);
      exitCode = 1;
    }

    return exitCode;
  }
}