import { test, expect } from '@playwright/test';
import { OrderedExecution } from '../../src/core/OrderedExecution';
import { RunnerConstants } from '../../src/constants';
import type { DiscoveredTestCase } from '../../src/types';

/**
 * Creates a discovered test case shaped like what the fixture writes after
 * Playwright has already resolved `tag` metadata or title-based tags.
 */
function makeDiscoveredTest(
  title: string,
  tags: string[],
  line: number
): DiscoveredTestCase {
  return {
    title,
    file: 'tests/examples/tag-based-ordering.spec.ts',
    line,
    tags,
    project: 'chromium',
  };
}

test.describe('Tag-based ordering examples', () => {

  test('README-style tag metadata example is ordered correctly', () => {
    // These correspond to Playwright tests like:
    // test('user can log in', { tag: ['@P1'] }, ...)
    // test('user can view dashboard', { tag: ['@P2'] }, ...)
    // test('seed the database', { tag: ['@runFirst'] }, ...)
    // test('clean up test data', { tag: ['@runLast', '@P4'] }, ...)
    const tests = [
      makeDiscoveredTest('user can log in', ['@P1'], 10),
      makeDiscoveredTest('user can view dashboard', ['@P2'], 20),
      makeDiscoveredTest('seed the database', [RunnerConstants.RUN_FIRST_TAG], 30),
      makeDiscoveredTest('clean up test data', [RunnerConstants.RUN_LAST_TAG, '@P4'], 40),
      makeDiscoveredTest('untagged smoke check', [], 50),
    ];

    const buckets = OrderedExecution.buildBuckets({
      tests,
      orderMode: 'priority',
    });

    expect(buckets.map((bucket) => bucket.label)).toEqual([
      'Run First',
      'Priority P1',
      'Priority P2',
      RunnerConstants.NO_PRIORITY_TOKEN,
      'Run Last',
    ]);

    expect(buckets[0].tests.map((item) => item.title)).toEqual([
      'seed the database',
    ]);
    expect(buckets[1].tests.map((item) => item.title)).toEqual([
      'user can log in',
    ]);
    expect(buckets[2].tests.map((item) => item.title)).toEqual([
      'user can view dashboard',
    ]);
    expect(buckets[3].tests.map((item) => item.title)).toEqual([
      'untagged smoke check',
    ]);
    expect(buckets[4].tests.map((item) => item.title)).toEqual([
      'clean up test data',
    ]);
  });

  test('@runLast wins over @P4 when both tags are present', () => {
    const buckets = OrderedExecution.buildBuckets({
      tests: [
        makeDiscoveredTest(
          'basic reporting with steps',
          [RunnerConstants.RUN_LAST_TAG, '@P4'],
          60
        ),
      ],
      orderMode: 'priority',
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_LAST);
    expect(buckets[0].tests[0].title).toBe('basic reporting with steps');
  });

  test('@runFirst wins over priority tags in tag metadata', () => {
    const buckets = OrderedExecution.buildBuckets({
      tests: [
        makeDiscoveredTest(
          'prepare shared data',
          [RunnerConstants.RUN_FIRST_TAG, '@P3'],
          70
        ),
      ],
      orderMode: 'priority',
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe(RunnerConstants.BUCKET_KEYS.RUN_FIRST);
    expect(buckets[0].critical).toBe(true);
  });

});
