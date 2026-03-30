import { RunnerConstants } from '../constants';
import type {
  DiscoveredTestCase,
  BucketPlan,
  BuildBucketOptions,
  OrderMode,
} from '../types';

// =============================================================================
// INTERNAL HELPERS
// These are private to this file. Not exported. Not part of the public API.
// =============================================================================

/**
 * Returns true if the test has ANY of the given tags.
 *
 * Why a separate helper?
 * Tag matching happens in multiple places (boundary detection, priority grouping).
 * Centralizing it means if Playwright ever changes how tags work, we fix one place.
 */
function hasAnyTag(test: DiscoveredTestCase, tags: string[]): boolean {
  return test.tags.some((tag) => tags.includes(tag));
}

/**
 * Returns the highest-priority tag found on a test.
 *
 * "Highest priority" means earliest in the PRIORITY_TAGS array.
 * So if a test has both '@P2' and '@P3', this returns '@P2'.
 *
 * Returns undefined if the test has no priority tag at all.
 */
function getHighestPriorityTag(
  test: DiscoveredTestCase
): (typeof RunnerConstants.PRIORITY_TAGS)[number] | undefined {
  return RunnerConstants.PRIORITY_TAGS.find((tag) =>
    test.tags.includes(tag)
  );
}

// =============================================================================
// BUCKET BUILDERS — one function per OrderMode
// =============================================================================

/**
 * Builds buckets for 'basic' mode.
 *
 * Basic mode does the minimum: boundary tests (@runFirst / @runLast) get
 * their own buckets, everything else goes into one single bucket in the
 * middle. No priority ordering within that middle bucket.
 */
function buildBasicBuckets(
  tests: DiscoveredTestCase[],
  runFirstTags: string[],
  runLastTags: string[]
): BucketPlan[] {
  const runFirstTests: DiscoveredTestCase[] = [];
  const middleTests: DiscoveredTestCase[] = [];
  const runLastTests: DiscoveredTestCase[] = [];

  for (const test of tests) {
    if (hasAnyTag(test, runFirstTags)) {
      runFirstTests.push(test);
    } else if (hasAnyTag(test, runLastTags)) {
      runLastTests.push(test);
    } else {
      middleTests.push(test);
    }
  }

  const buckets: BucketPlan[] = [];

  if (runFirstTests.length > 0) {
    buckets.push({
      key: RunnerConstants.BUCKET_KEYS.RUN_FIRST,
      label: 'Run First',
      kind: 'boundary',
      critical: true,
      tests: runFirstTests,
    });
  }

  if (middleTests.length > 0) {
    buckets.push({
      key: RunnerConstants.BUCKET_KEYS.NO_PRIORITY,
      label: 'All Tests',
      kind: 'none',
      critical: false,
      tests: middleTests,
    });
  }

  if (runLastTests.length > 0) {
    buckets.push({
      key: RunnerConstants.BUCKET_KEYS.RUN_LAST,
      label: 'Run Last',
      kind: 'boundary',
      critical: false,
      tests: runLastTests,
    });
  }

  return buckets;
}

/**
 * Builds buckets for 'priority' mode.
 *
 * Priority mode creates one bucket per priority level that has at least
 * one test. So if you have @P1 and @P3 tests but no @P2, you get two
 * priority buckets (not three). Tests with no priority tag go into the
 * NoPriority bucket, which runs after all priority buckets.
 *
 * Full execution order:
 *   [runFirst] → [@P1] → [@P2] → [@P3] → [@P4] → [NoPriority] → [runLast]
 *
 * Empty buckets are omitted entirely.
 */
function buildPriorityBuckets(
  tests: DiscoveredTestCase[],
  runFirstTags: string[],
  runLastTags: string[]
): BucketPlan[] {
  const runFirstTests: DiscoveredTestCase[] = [];
  const runLastTests: DiscoveredTestCase[] = [];
  const noPriorityTests: DiscoveredTestCase[] = [];

  // One array per priority tag, keyed by tag name
  const priorityMap = new Map<string, DiscoveredTestCase[]>(
    RunnerConstants.PRIORITY_TAGS.map((tag) => [tag, []])
  );

  // Single pass through all tests — assign each to exactly one bucket
  for (const test of tests) {
    if (hasAnyTag(test, runFirstTags)) {
      runFirstTests.push(test);
      continue;
    }

    if (hasAnyTag(test, runLastTags)) {
      runLastTests.push(test);
      continue;
    }

    const priorityTag = getHighestPriorityTag(test);

    if (priorityTag) {
      // Non-null assertion safe here: we just found the tag in PRIORITY_TAGS
      priorityMap.get(priorityTag)!.push(test);
    } else {
      noPriorityTests.push(test);
    }
  }

  const buckets: BucketPlan[] = [];

  // 1. runFirst bucket (critical — if this fails, we stop)
  if (runFirstTests.length > 0) {
    buckets.push({
      key: RunnerConstants.BUCKET_KEYS.RUN_FIRST,
      label: 'Run First',
      kind: 'boundary',
      critical: true,
      tests: runFirstTests,
    });
  }

  // 2. One bucket per priority tag, in P1 → P4 order
  // Skip empty priority buckets entirely
  for (const tag of RunnerConstants.PRIORITY_TAGS) {
    const testsForTag = priorityMap.get(tag)!;

    if (testsForTag.length === 0) continue;

    // '@P1' → 'P1', '@P2' → 'P2', etc.
    const shortTag = tag.replace('@', '');

    buckets.push({
      key: `priority-${shortTag}`,
      label: `Priority ${shortTag}`,
      kind: 'priority',
      critical: false,
      tests: testsForTag,
    });
  }

  // 3. NoPriority bucket — tests with no @Px tag
  if (noPriorityTests.length > 0) {
    buckets.push({
      key: RunnerConstants.BUCKET_KEYS.NO_PRIORITY,
      label: RunnerConstants.NO_PRIORITY_TOKEN,
      kind: 'none',
      critical: false,
      tests: noPriorityTests,
    });
  }

  // 4. runLast bucket (not critical — cleanup should always attempt to run)
  if (runLastTests.length > 0) {
    buckets.push({
      key: RunnerConstants.BUCKET_KEYS.RUN_LAST,
      label: 'Run Last',
      kind: 'boundary',
      critical: false,
      tests: runLastTests,
    });
  }

  return buckets;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export class OrderedExecution {
  /**
   * Takes a flat list of discovered tests and groups them into ordered buckets.
   *
   * This is the core algorithm of the entire package. The buckets returned
   * here define the execution order — the runner executes them one by one,
   * in the order they appear in this array.
   *
   * @param options - See BuildBucketOptions in types/index.ts
   * @returns An ordered array of BucketPlan objects, ready for execution
   *
   * @example
   * ```typescript
   * const buckets = OrderedExecution.buildBuckets({
   *   tests: discoveredTests,
   *   orderMode: 'priority',
   * });
   * // buckets[0] = runFirst tests (if any)
   * // buckets[1] = @P1 tests (if any)
   * // buckets[2] = @P2 tests (if any)
   * // ...and so on
   * ```
   */
  static buildBuckets(options: BuildBucketOptions): BucketPlan[] {
    const {
      tests,
      orderMode,
      runFirstTags = [RunnerConstants.RUN_FIRST_TAG],
      runLastTags = [RunnerConstants.RUN_LAST_TAG],
    } = options;

    // Guard: nothing to do with an empty test list
    if (tests.length === 0) {
      return [];
    }

    switch (orderMode) {
      case 'basic':
        return buildBasicBuckets(tests, runFirstTags, runLastTags);

      case 'priority':
        return buildPriorityBuckets(tests, runFirstTags, runLastTags);

      case 'custom':
        // v2 — not implemented yet
        // We throw instead of silently falling back so the user knows immediately
        throw new Error(
          `OrderMode 'custom' is not implemented in v1. ` +
          `Use 'basic' or 'priority'.`
        );

      default: {
        // This branch should be unreachable if TypeScript types are respected.
        // But if someone passes an invalid value via JavaScript or env vars,
        // we want a clear error message.
        const exhaustiveCheck: never = orderMode;
        throw new Error(
          `Unknown orderMode: '${exhaustiveCheck}'. ` +
          `Valid values are: 'basic', 'priority'.`
        );
      }
    }
  }

  /**
   * Splits an array of buckets into three phases for the runner to process.
   *
   * Why split into phases?
   * The runner needs to handle the runFirst bucket specially — if it fails
   * and the FailurePolicy is 'critical', we stop before running any middle
   * buckets. Similarly, runLast should always attempt to run (cleanup)
   * even if middle buckets failed.
   *
   * @param buckets - The output from buildBuckets()
   * @returns An object with three arrays: runFirst, middle, runLast
   *
   * @example
   * ```typescript
   * const { runFirst, middle, runLast } = OrderedExecution.groupBuckets(buckets);
   * // Run runFirst phase, check failure policy
   * // Run middle phase buckets in order
   * // Run runLast phase regardless of middle results
   * ```
   */
  static groupBuckets(buckets: BucketPlan[]): {
    runFirst: BucketPlan[];
    middle: BucketPlan[];
    runLast: BucketPlan[];
  } {
    const runFirst = buckets.filter(
      (b) => b.key === RunnerConstants.BUCKET_KEYS.RUN_FIRST
    );

    const runLast = buckets.filter(
      (b) => b.key === RunnerConstants.BUCKET_KEYS.RUN_LAST
    );

    const middle = buckets.filter(
      (b) =>
        b.key !== RunnerConstants.BUCKET_KEYS.RUN_FIRST &&
        b.key !== RunnerConstants.BUCKET_KEYS.RUN_LAST
    );

    return { runFirst, middle, runLast };
  }
}