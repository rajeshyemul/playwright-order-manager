import { test, expect } from '@playwright/test';
import { OrderedSummary } from '../../src/core/OrderedSummary';
import type { BucketExecutionRecord } from '../../src/types';

// =============================================================================
// FIXTURES — reusable test data
// =============================================================================

/**
 * Creates a minimal BucketExecutionRecord for use in tests.
 * Only override the fields you care about — defaults fill the rest.
 */
function makeBucket(
  overrides: Partial<BucketExecutionRecord> = {}
): BucketExecutionRecord {
  return {
    key:        'priority-P1',
    label:      'Priority P1',
    critical:   false,
    totalTests: 3,
    passed:     3,
    failed:     0,
    skipped:    0,
    duration:   3000,
    status:     'passed',
    results:    [],
    ...overrides,
  };
}

// =============================================================================
// buildSummary — data aggregation
// =============================================================================

test.describe('OrderedSummary.buildSummary', () => {

  test('aggregates totals correctly across multiple buckets', () => {
    const buckets: BucketExecutionRecord[] = [
      makeBucket({ totalTests: 5, passed: 4, failed: 1, skipped: 0, status: 'failed' }),
      makeBucket({ totalTests: 3, passed: 3, failed: 0, skipped: 0, status: 'passed' }),
      makeBucket({ totalTests: 2, passed: 0, failed: 0, skipped: 2, status: 'skipped' }),
    ];

    const summary = OrderedSummary.buildSummary(
      buckets,
      new Date().toISOString(),
      'priority',
      'critical'
    );

    expect(summary.totals.tests).toBe(10);
    expect(summary.totals.passed).toBe(7);
    expect(summary.totals.failed).toBe(1);
    expect(summary.totals.skipped).toBe(2);
    expect(summary.totals.buckets).toBe(3);
  });

  test('marks run as failed when any bucket has failed status', () => {
    const buckets = [
      makeBucket({ status: 'passed' }),
      makeBucket({ status: 'failed', failed: 1 }),
      makeBucket({ status: 'passed' }),
    ];

    const summary = OrderedSummary.buildSummary(
      buckets,
      new Date().toISOString(),
      'priority',
      'critical'
    );

    expect(summary.success).toBe(false);
  });

  test('marks run as passed when all buckets passed', () => {
    const buckets = [
      makeBucket({ status: 'passed' }),
      makeBucket({ status: 'passed' }),
    ];

    const summary = OrderedSummary.buildSummary(
      buckets,
      new Date().toISOString(),
      'priority',
      'critical'
    );

    expect(summary.success).toBe(true);
  });

  test('marks run as passed when buckets are skipped but none failed', () => {
    const buckets = [
      makeBucket({ status: 'passed' }),
      makeBucket({ status: 'skipped' }),
    ];

    const summary = OrderedSummary.buildSummary(
      buckets,
      new Date().toISOString(),
      'priority',
      'critical'
    );

    // skipped is not failure — run should still be considered successful
    expect(summary.success).toBe(true);
  });

  test('returns zero totals for empty bucket array', () => {
    const summary = OrderedSummary.buildSummary(
      [],
      new Date().toISOString(),
      'priority',
      'critical'
    );

    expect(summary.totals.tests).toBe(0);
    expect(summary.totals.passed).toBe(0);
    expect(summary.totals.failed).toBe(0);
    expect(summary.totals.skipped).toBe(0);
    expect(summary.totals.buckets).toBe(0);
    expect(summary.success).toBe(true);
  });

  test('carries orderMode and failurePolicy through to the summary', () => {
    const summary = OrderedSummary.buildSummary(
      [],
      new Date().toISOString(),
      'basic',
      'continue'
    );

    expect(summary.orderMode).toBe('basic');
    expect(summary.failurePolicy).toBe('continue');
  });

  test('totalDuration is a positive number', () => {
    const startedAt = new Date(Date.now() - 5000).toISOString();

    const summary = OrderedSummary.buildSummary(
      [makeBucket()],
      startedAt,
      'priority',
      'critical'
    );

    // finishedAt is set inside buildSummary to now()
    // so totalDuration should be at least 5000ms
    expect(summary.totalDuration).toBeGreaterThanOrEqual(5000);
  });

  test('startedAt is preserved exactly as passed in', () => {
    const startedAt = '2024-03-27T10:30:00.000Z';

    const summary = OrderedSummary.buildSummary(
      [],
      startedAt,
      'priority',
      'critical'
    );

    expect(summary.startedAt).toBe(startedAt);
  });

  test('finishedAt is a valid ISO 8601 timestamp', () => {
    const summary = OrderedSummary.buildSummary(
      [],
      new Date().toISOString(),
      'priority',
      'critical'
    );

    // Should parse without throwing and produce a valid date
    const date = new Date(summary.finishedAt);
    expect(isNaN(date.getTime())).toBe(false);
  });
});