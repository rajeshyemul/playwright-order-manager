import { test, expect } from '@playwright/test';
import { OrderedReportParser } from '../../src/core/OrderedReportParser';

// =============================================================================
// FIXTURES — minimal Playwright JSON shapes for testing
// =============================================================================

/**
 * Minimal valid Playwright execution JSON report.
 * Matches the shape Playwright writes when --reporter=json is used.
 */
const VALID_EXECUTION_REPORT = {
  suites: [
    {
      title: 'tests/login.spec.ts',
      file:  'tests/login.spec.ts',
      suites: [],
      specs: [
        {
          title: 'user can log in',
          ok:    true,
          tags:  ['@P1'],
          tests: [
            {
              projectName: 'chromium',
              status:      'expected',
              duration:    1200,
              results: [
                { status: 'passed', duration: 1200, retry: 0, errors: [] },
              ],
            },
          ],
        },
        {
          title: 'user sees error on wrong password',
          ok:    false,
          tags:  ['@P1'],
          tests: [
            {
              projectName: 'chromium',
              status:      'unexpected',
              duration:    800,
              results: [
                { status: 'failed', duration: 400, retry: 0, errors: [{ message: 'Expected text "Error" to be visible' }] },
                { status: 'failed', duration: 400, retry: 1, errors: [{ message: 'Expected text "Error" to be visible' }] },
              ],
              errors: [{ message: 'Expected text "Error" to be visible' }],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Minimal valid discovery JSON written by our fixture.
 */
const VALID_DISCOVERY_REPORT = {
  tests: [
    {
      title:   'user can log in',
      file:    'tests/login.spec.ts',
      line:    5,
      tags:    ['@P1'],
      project: 'chromium',
    },
    {
      title:   'user sees dashboard',
      file:    'tests/dashboard.spec.ts',
      line:    10,
      tags:    ['@P2'],
      project: 'chromium',
    },
  ],
};

// =============================================================================
// parseExecutionReport
// =============================================================================

test.describe('OrderedReportParser.parseExecutionReport', () => {

  test('returns one result per test per project', () => {
    const results = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    // Two specs, one project each → two results
    expect(results).toHaveLength(2);
  });

  test('maps passed test status correctly', () => {
    const results = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    const passed  = results.find((r) => r.title === 'user can log in');

    expect(passed).toBeDefined();
    expect(passed?.status).toBe('passed');
  });

  test('maps failed test status correctly', () => {
    const results = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    const failed  = results.find((r) => r.title === 'user sees error on wrong password');

    expect(failed).toBeDefined();
    expect(failed?.status).toBe('failed');
  });

  test('calculates retry count correctly', () => {
    const results  = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    const failed   = results.find((r) => r.title === 'user sees error on wrong password');

    // Two result entries (initial + 1 retry) → retries = 1
    expect(failed?.retries).toBe(1);
  });

  test('sets retries to 0 for tests that passed first attempt', () => {
    const results = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    const passed  = results.find((r) => r.title === 'user can log in');

    expect(passed?.retries).toBe(0);
  });

  test('extracts error message from failed test', () => {
    const results = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    const failed  = results.find((r) => r.title === 'user sees error on wrong password');

    expect(failed?.errorMessage).toBeDefined();
    expect(failed?.errorMessage).toContain('Expected text');
  });

  test('errorMessage is undefined for passing tests', () => {
    const results = OrderedReportParser.parseExecutionReport(VALID_EXECUTION_REPORT);
    const passed  = results.find((r) => r.title === 'user can log in');

    expect(passed?.errorMessage).toBeUndefined();
  });

  test('handles deeply nested suites', () => {
    const nestedReport = {
      suites: [
        {
          title: 'tests/nested.spec.ts',
          file:  'tests/nested.spec.ts',
          suites: [
            {
              title: 'describe outer',
              suites: [
                {
                  title: 'describe inner',
                  specs: [
                    {
                      title: 'deeply nested test',
                      ok:    true,
                      tags:  [],
                      tests: [
                        {
                          projectName: 'chromium',
                          status:      'expected',
                          duration:    500,
                          results: [
                            { status: 'passed', duration: 500, retry: 0, errors: [] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const results = OrderedReportParser.parseExecutionReport(nestedReport);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('deeply nested test');
  });

  test('returns empty array for report with no specs', () => {
    const emptyReport = { suites: [] };
    const results = OrderedReportParser.parseExecutionReport(emptyReport);
    expect(results).toHaveLength(0);
  });

  test('throws for non-object input', () => {
    expect(() =>
      OrderedReportParser.parseExecutionReport('not an object')
    ).toThrow();
  });

  test('throws when suites array is missing', () => {
    expect(() =>
      OrderedReportParser.parseExecutionReport({ notSuites: [] })
    ).toThrow();
  });

  test('throws for null input', () => {
    expect(() =>
      OrderedReportParser.parseExecutionReport(null)
    ).toThrow();
  });

});

// =============================================================================
// parseDiscoveryReport
// =============================================================================

test.describe('OrderedReportParser.parseDiscoveryReport', () => {

  test('returns correct number of discovered tests', () => {
    const tests = OrderedReportParser.parseDiscoveryReport(VALID_DISCOVERY_REPORT);
    expect(tests).toHaveLength(2);
  });

  test('preserves all fields on each discovered test', () => {
    const tests = OrderedReportParser.parseDiscoveryReport(VALID_DISCOVERY_REPORT);
    const first = tests[0];

    expect(first.title).toBe('user can log in');
    expect(first.file).toBe('tests/login.spec.ts');
    expect(first.line).toBe(5);
    expect(first.tags).toEqual(['@P1']);
    expect(first.project).toBe('chromium');
  });

  test('filters out entries missing required fields', () => {
    const reportWithInvalid = {
      tests: [
        // Valid entry
        { title: 'valid test', file: 'tests/foo.spec.ts', line: 1, tags: [], project: 'chromium' },
        // Invalid — missing title
        { file: 'tests/bar.spec.ts', line: 2, tags: [], project: 'chromium' },
        // Invalid — missing file
        { title: 'no file test', line: 3, tags: [], project: 'chromium' },
        // Invalid — tags is not an array
        { title: 'bad tags', file: 'tests/baz.spec.ts', line: 4, tags: 'wrong', project: 'chromium' },
      ],
    };

    const tests = OrderedReportParser.parseDiscoveryReport(reportWithInvalid);
    // Only the valid entry should survive
    expect(tests).toHaveLength(1);
    expect(tests[0].title).toBe('valid test');
  });

  test('throws for non-object input', () => {
    expect(() =>
      OrderedReportParser.parseDiscoveryReport(42)
    ).toThrow();
  });

  test('throws when tests array is missing', () => {
    expect(() =>
      OrderedReportParser.parseDiscoveryReport({ notTests: [] })
    ).toThrow();
  });

  test('returns empty array when tests array is empty', () => {
    const tests = OrderedReportParser.parseDiscoveryReport({ tests: [] });
    expect(tests).toHaveLength(0);
  });

});