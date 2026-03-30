/**
 * RunnerConstants — the single source of truth for all tags, tokens, and defaults.
 *
 * Every magic string in the package comes from here.
 * No file should ever hardcode '@P1' or '@runFirst' directly.
 */
export const RunnerConstants = {

  // ===========================================================================
  // BOUNDARY TAGS
  // These tags, when attached to a test, force it into a special bucket
  // that runs before or after everything else.
  // ===========================================================================

  /**
   * Tests tagged with this run in their own bucket before all other buckets.
   * Example test tag: test('@runFirst should seed the database', ...)
   */
  RUN_FIRST_TAG: '@runFirst',

  /**
   * Tests tagged with this run in their own bucket after all other buckets.
   * Example test tag: test('@runLast should clean up test data', ...)
   */
  RUN_LAST_TAG: '@runLast',

  // ===========================================================================
  // PRIORITY TAGS
  // Used to group tests into priority buckets.
  // P1 = highest priority (runs first), P4 = lowest priority (runs last).
  // ===========================================================================

  /**
   * All valid priority tags, in execution order (highest to lowest).
   * `as const` makes this a readonly tuple: ['@P1', '@P2', '@P3', '@P4']
   * This means TypeScript knows the exact values, not just `string[]`.
   */
  PRIORITY_TAGS: ['@P1', '@P2', '@P3', '@P4'] as const,

  // ===========================================================================
  // TOKENS
  // Internal identifiers used in bucket keys and report labels.
  // ===========================================================================

  /**
   * Used as the bucket key for tests that have no priority tag at all.
   * These tests run after all prioritized buckets.
   */
  NO_PRIORITY_TOKEN: 'NoPriority',

  // ===========================================================================
  // DEFAULTS
  // Fallback values used when the user hasn't configured something explicitly.
  // ===========================================================================

  DEFAULTS: {
    /**
     * The default OrderMode when ORDER_MODE env var is not set.
     * 'priority' means tests are grouped by @P1/@P2/@P3/@P4 tags.
     */
    ORDER_MODE: 'priority' as const,

    /**
     * The default FailurePolicy when FAILURE_POLICY env var is not set.
     * 'critical' means: stop the run if a critical bucket fails.
     */
    FAILURE_POLICY: 'critical' as const,

    /**
     * The default folder where run output is written.
     * Relative to wherever the user runs the CLI command from.
     */
    REPORT_ROOT: 'ordered-results',

    /**
     * Default filename for the summary JSON written after a full run.
     */
    SUMMARY_FILENAME: 'ordered-summary.json',

    /**
     * Default filename for the HTML report written after a full run.
     */
    REPORT_FILENAME: 'ordered-report.html',

    /**
     * Default filename for the discovery output written during --list phase.
     */
    DISCOVERY_FILENAME: 'ordered-discovery.json',
  },

  // ===========================================================================
  // BUCKET KEYS
  // Stable string identifiers for each bucket type.
  // Used as keys in BucketPlan and BucketExecutionRecord.
  // ===========================================================================

  BUCKET_KEYS: {
    /** The bucket containing @runFirst tests */
    RUN_FIRST: 'boundary-run-first',

    /** The bucket containing @runLast tests */
    RUN_LAST: 'boundary-run-last',

    /** The bucket containing tests with no priority tag */
    NO_PRIORITY: 'none',
  },

} as const;

// =============================================================================
// DERIVED TYPES
// These are computed from the constants above using TypeScript's type system.
// This means if you ever add '@P5' to PRIORITY_TAGS, the PriorityTag type
// in types/index.ts automatically becomes valid for '@P5' too.
// =============================================================================

/**
 * The type of PRIORITY_TAGS entries, derived directly from the array.
 * Results in: '@P1' | '@P2' | '@P3' | '@P4'
 */
export type PriorityTagValue =
  typeof RunnerConstants.PRIORITY_TAGS[number];