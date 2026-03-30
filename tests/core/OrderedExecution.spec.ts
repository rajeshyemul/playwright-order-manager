import { test, expect } from '@playwright/test';
import { OrderedExecution } from '../../src/core/OrderedExecution';
import { RunnerConstants } from '../../src/constants';
import type { DiscoveredTestCase } from '../../src/types';

// =============================================================================
// FIXTURES — reusable test data builders
// =============================================================================

/**
 * Creates a minimal DiscoveredTestCase.
 * Only override what your test cares about.
 */
function makeTest(
  title: string,
  tags: string[] = [],
  overrides: Partial<DiscoveredTestCase> = {}
): DiscoveredTestCase {
  return {
    title,
    file:    `tests/${title.replace(/\s+/g, '-')}.spec.ts`,
    line:    1,
    tags,
    project: 'chromium',
    ...overrides,
  };
}

// =============================================================================
// buildBuckets — edge cases
// =============================================================================

test.describe('OrderedExecution.buildBuckets — edge cases', () => {

  test('returns empty array when no tests provided', () => {
    const buckets = OrderedExecution.buildBuckets({
      tests:     [],
      orderMode: 'priority',
    });
    expect(buckets).toHaveLength(0);
  });

  test('throws for custom orderMode in v1', () => {
    expect(() =>
      OrderedExecution.buildBuckets({
        tests:     [makeTest('some test')],
        orderMode: 'custom',
      })
    ).toThrow(/custom.*not implemented/i);
  });

  test('throws for unknown orderMode', () => {
    expect(() =>
      OrderedExecution.buildBuckets({
        tests:     [makeTest('some test')],
        orderMode: 'unknown' as any,
      })
    ).toThrow(/unknown orderMode/i);
  });

});

// =============================================================================
// buildBuckets — basic mode
// =============================================================================

test.describe('OrderedExecution.buildBuckets — basic mode', () => {

  test('puts all tests in a single middle bucket when no boundary tags', () => {
    const tests = [
      makeTest('test one'),
      makeTest('test two'),
      makeTest('test three'),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets).toHaveLength(1);
    expect(buckets[0].kind).toBe('none');
    expect(buckets[0].tests).toHaveLength(3);
  });

  test('creates runFirst bucket for @runFirst tests', () => {
    const tests = [
      makeTest('seed db', [RunnerConstants.RUN_FIRST_TAG]),
      makeTest('regular test'),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets).toHaveLength(2);
    expect(buckets[0].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_FIRST);
    expect(buckets[0].kind).toBe('boundary');
    expect(buckets[0].tests).toHaveLength(1);
    expect(buckets[0].tests[0].title).toBe('seed db');
  });

  test('creates runLast bucket for @runLast tests', () => {
    const tests = [
      makeTest('regular test'),
      makeTest('clean up', [RunnerConstants.RUN_LAST_TAG]),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets).toHaveLength(2);
    const lastBucket = buckets[buckets.length - 1];
    expect(lastBucket.key).toBe(RunnerConstants.BUCKET_KEYS.RUN_LAST);
    expect(lastBucket.kind).toBe('boundary');
  });

  test('runFirst bucket is marked critical', () => {
    const tests = [makeTest('seed db', [RunnerConstants.RUN_FIRST_TAG])];
    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets[0].critical).toBe(true);
  });

  test('runLast bucket is NOT marked critical', () => {
    const tests = [makeTest('cleanup', [RunnerConstants.RUN_LAST_TAG])];
    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets[0].critical).toBe(false);
  });

  test('produces correct order: runFirst → middle → runLast', () => {
    const tests = [
      makeTest('middle test'),
      makeTest('run last',  [RunnerConstants.RUN_LAST_TAG]),
      makeTest('run first', [RunnerConstants.RUN_FIRST_TAG]),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets).toHaveLength(3);
    expect(buckets[0].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_FIRST);
    expect(buckets[1].key).toBe(RunnerConstants.BUCKET_KEYS.NO_PRIORITY);
    expect(buckets[2].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_LAST);
  });

  test('omits runFirst bucket when no @runFirst tests exist', () => {
    const tests = [
      makeTest('regular test'),
      makeTest('cleanup', [RunnerConstants.RUN_LAST_TAG]),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'basic' });

    expect(buckets.some((b) => b.key === RunnerConstants.BUCKET_KEYS.RUN_FIRST)).toBe(false);
  });

  test('respects custom runFirstTags option', () => {
    const tests = [
      makeTest('custom boundary test', ['@smokeFirst']),
      makeTest('regular test'),
    ];

    const buckets = OrderedExecution.buildBuckets({
      tests,
      orderMode:    'basic',
      runFirstTags: ['@smokeFirst'],
    });

    expect(buckets[0].kind).toBe('boundary');
    expect(buckets[0].tests[0].title).toBe('custom boundary test');
  });

});

// =============================================================================
// buildBuckets — priority mode
// =============================================================================

test.describe('OrderedExecution.buildBuckets — priority mode', () => {

  test('creates one bucket per priority level that has tests', () => {
    const tests = [
      makeTest('p1 test', ['@P1']),
      makeTest('p3 test', ['@P3']),
      // No @P2 or @P4 tests
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    // Should have P1 and P3 buckets only — no empty P2 or P4 buckets
    expect(buckets).toHaveLength(2);
    expect(buckets[0].key).toBe('priority-P1');
    expect(buckets[1].key).toBe('priority-P3');
  });

  test('produces correct full priority order: runFirst → P1 → P2 → P3 → P4 → NoPriority → runLast', () => {
    const tests = [
      makeTest('no priority test'),
      makeTest('p4 test',    ['@P4']),
      makeTest('p2 test',    ['@P2']),
      makeTest('run last',   [RunnerConstants.RUN_LAST_TAG]),
      makeTest('p1 test',    ['@P1']),
      makeTest('run first',  [RunnerConstants.RUN_FIRST_TAG]),
      makeTest('p3 test',    ['@P3']),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const keys    = buckets.map((b) => b.key);

    expect(keys).toEqual([
      RunnerConstants.BUCKET_KEYS.RUN_FIRST,
      'priority-P1',
      'priority-P2',
      'priority-P3',
      'priority-P4',
      RunnerConstants.BUCKET_KEYS.NO_PRIORITY,
      RunnerConstants.BUCKET_KEYS.RUN_LAST,
    ]);
  });

  test('NoPriority bucket contains tests with no @Px tag', () => {
    const tests = [
      makeTest('tagged test',   ['@P1']),
      makeTest('untagged test', []),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const noPriority = buckets.find((b) => b.key === RunnerConstants.BUCKET_KEYS.NO_PRIORITY);

    expect(noPriority).toBeDefined();
    expect(noPriority?.tests).toHaveLength(1);
    expect(noPriority?.tests[0].title).toBe('untagged test');
  });

  test('when a test has multiple priority tags, highest priority wins', () => {
    const tests = [
      makeTest('multi-tagged test', ['@P3', '@P1']),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    // Should be in P1 bucket, not P3
    const p1Bucket = buckets.find((b) => b.key === 'priority-P1');
    const p3Bucket = buckets.find((b) => b.key === 'priority-P3');

    expect(p1Bucket?.tests).toHaveLength(1);
    expect(p3Bucket).toBeUndefined();
  });

  test('@runFirst takes precedence over @P1', () => {
    const tests = [
      makeTest('boundary and priority', [RunnerConstants.RUN_FIRST_TAG, '@P1']),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    // Test should be in runFirst bucket, NOT in P1 bucket
    const runFirst = buckets.find((b) => b.key === RunnerConstants.BUCKET_KEYS.RUN_FIRST);
    const p1       = buckets.find((b) => b.key === 'priority-P1');

    expect(runFirst?.tests).toHaveLength(1);
    expect(p1).toBeUndefined();
  });

  test('each test appears in exactly one bucket', () => {
    const tests = [
      makeTest('p1 test',       ['@P1']),
      makeTest('p2 test',       ['@P2']),
      makeTest('untagged test', []),
      makeTest('run first',     [RunnerConstants.RUN_FIRST_TAG]),
      makeTest('run last',      [RunnerConstants.RUN_LAST_TAG]),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    // Count total tests across all buckets
    const totalInBuckets = buckets.reduce((sum, b) => sum + b.tests.length, 0);

    expect(totalInBuckets).toBe(tests.length);
  });

  test('empty priority buckets are omitted', () => {
    const tests = [makeTest('p1 only', ['@P1'])];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const keys    = buckets.map((b) => b.key);

    // Only P1 should exist — no P2, P3, P4, NoPriority, or boundary buckets
    expect(keys).toEqual(['priority-P1']);
    expect(buckets).toHaveLength(1);
  });

  test('bucket labels are human readable', () => {
    const tests = [
      makeTest('p1 test', ['@P1']),
      makeTest('p2 test', ['@P2']),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    expect(buckets[0].label).toBe('Priority P1');
    expect(buckets[1].label).toBe('Priority P2');
  });

  test('priority buckets are not marked critical', () => {
    const tests = [makeTest('p1 test', ['@P1'])];
    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    expect(buckets[0].critical).toBe(false);
  });

  test('handles all 50 tests in a single priority level efficiently', () => {
    const tests = Array.from({ length: 50 }, (_, i) =>
      makeTest(`p1 test ${i}`, ['@P1'])
    );

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });

    expect(buckets).toHaveLength(1);
    expect(buckets[0].tests).toHaveLength(50);
  });

});

// =============================================================================
// groupBuckets
// =============================================================================

test.describe('OrderedExecution.groupBuckets', () => {

  test('splits buckets into runFirst, middle, and runLast phases', () => {
    const tests = [
      makeTest('run first',  [RunnerConstants.RUN_FIRST_TAG]),
      makeTest('p1 test',    ['@P1']),
      makeTest('p2 test',    ['@P2']),
      makeTest('run last',   [RunnerConstants.RUN_LAST_TAG]),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const { runFirst, middle, runLast } = OrderedExecution.groupBuckets(buckets);

    expect(runFirst).toHaveLength(1);
    expect(runFirst[0].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_FIRST);

    expect(middle).toHaveLength(2);
    expect(middle.map((b) => b.key)).toEqual(['priority-P1', 'priority-P2']);

    expect(runLast).toHaveLength(1);
    expect(runLast[0].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_LAST);
  });

  test('returns empty runFirst when no runFirst bucket exists', () => {
    const tests = [makeTest('p1 test', ['@P1'])];
    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const { runFirst } = OrderedExecution.groupBuckets(buckets);

    expect(runFirst).toHaveLength(0);
  });

  test('returns empty runLast when no runLast bucket exists', () => {
    const tests = [makeTest('p1 test', ['@P1'])];
    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const { runLast } = OrderedExecution.groupBuckets(buckets);

    expect(runLast).toHaveLength(0);
  });

  test('all buckets end up in exactly one phase', () => {
    const tests = [
      makeTest('run first', [RunnerConstants.RUN_FIRST_TAG]),
      makeTest('p1',        ['@P1']),
      makeTest('p2',        ['@P2']),
      makeTest('untagged',  []),
      makeTest('run last',  [RunnerConstants.RUN_LAST_TAG]),
    ];

    const buckets = OrderedExecution.buildBuckets({ tests, orderMode: 'priority' });
    const { runFirst, middle, runLast } = OrderedExecution.groupBuckets(buckets);

    const totalGrouped = runFirst.length + middle.length + runLast.length;
    expect(totalGrouped).toBe(buckets.length);
  });

  test('handles empty bucket array gracefully', () => {
    const { runFirst, middle, runLast } = OrderedExecution.groupBuckets([]);

    expect(runFirst).toHaveLength(0);
    expect(middle).toHaveLength(0);
    expect(runLast).toHaveLength(0);
  });

});