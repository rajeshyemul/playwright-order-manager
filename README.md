[![CI](https://github.com/rajeshyemul/playwright-order-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/rajeshyemul/playwright-order-manager/actions/workflows/ci.yml)

# playwright-order-manager

Priority-ordered test execution for Playwright. Run your most critical tests first, get faster feedback on failures, and keep your CI pipeline moving.

---

## Why

Playwright runs tests in parallel by default, which is fast but gives you no control over *which* tests run first. If your most critical test (say, user login) fails, you still wait for hundreds of other tests to finish before you find out.

`playwright-order-manager` solves this by:

- Grouping tests into **buckets** by priority (`@P1` → `@P2` → `@P3` → `@P4`)
- Running buckets **one at a time**, highest priority first
- Stopping early if a critical bucket fails — no wasted CI time
- Writing an **HTML report** showing exactly what ran, in what order, and why it failed

---

## Installation
```bash
npm install --save-dev playwright-order-manager
```

**Requirements:**
- Node.js >= 18
- `@playwright/test` >= 1.40 (installed separately as a peer dependency)

---

## Quick Start

### Step 1 — Tag your tests

Add priority tags to your tests. The tag goes in the test title:
```typescript
import { test, expect } from 'playwright-order-manager/fixtures';

// Runs first — highest priority
test('@P1 user can log in', async ({ page }) => {
  await page.goto('/login');
  // ...
});

// Runs second
test('@P2 user can view dashboard', async ({ page }) => {
  // ...
});

// Always runs before everything else
test('@runFirst seed the database', async ({ page }) => {
  // ...
});

// Always runs after everything else
test('@runLast clean up test data', async ({ page }) => {
  // ...
});
```

> **Important:** Import `test` from `playwright-order-manager` instead of
> `@playwright/test`. Everything else (`expect`, `Page`, `Browser`, etc.)
> works exactly the same — it is a drop-in replacement.

---

### Step 2 — Copy the merge config template
```bash
cp node_modules/playwright-order-manager/templates/playwright.merge.config.ts .
```

---

### Step 3 — Run
```bash
npx pw-order
```

That's it. The runner will:
1. Discover all your tests
2. Group them into priority buckets
3. Execute buckets in order
4. Write an HTML report to `./ordered-results/ordered-report.html`

---

## Execution Order

Given tests tagged with various priorities, the execution order is always:
```
[@runFirst tests]  →  [@P1 tests]  →  [@P2 tests]  →  [@P3 tests]  →  [@P4 tests]  →  [untagged tests]  →  [@runLast tests]
```

- Empty buckets are skipped entirely
- `@runLast` always executes, even if earlier buckets failed — it is your cleanup guarantee

---

## CLI Reference
```bash
npx pw-order [options]
```

| Flag | Description | Default |
|---|---|---|
| `--order-mode` | `priority` or `basic` | `priority` |
| `--failure-policy` | `critical`, `continue`, or `immediate` | `critical` |
| `--project` | Playwright project name (e.g. `chromium`) | all projects |
| `--config` | Path to your `playwright.config.ts` | `./playwright.config.ts` |
| `--report-root` | Directory for output files | `./ordered-results` |

**Examples:**
```bash
# Run with a specific project
npx pw-order --project=chromium

# Continue running even after failures
npx pw-order --failure-policy=continue

# Stop immediately on any failure
npx pw-order --failure-policy=immediate

# Custom config path
npx pw-order --config=./e2e/playwright.config.ts
```

---

## Failure Policies

| Policy | Behaviour |
|---|---|
| `critical` | Stop the run if a bucket marked **critical** fails. Only `@runFirst` buckets are critical by default. |
| `immediate` | Stop on the very first failure, regardless of bucket. |
| `continue` | Never stop early. Always run all buckets and collect all results. |

---

## Environment Variables

All CLI flags have equivalent environment variables. Useful for CI pipelines:

| Variable | Equivalent Flag |
|---|---|
| `ORDER_MODE` | `--order-mode` |
| `FAILURE_POLICY` | `--failure-policy` |
| `ORDERED_REPORT_ROOT` | `--report-root` |
| `PLAYWRIGHT_CONFIG` | `--config` |
| `PLAYWRIGHT_PROJECT` | `--project` (comma-separated for multiple) |
| `ORDERED_DEBUG` | Enables verbose debug logging |

---

## Programmatic Usage

If you want to embed ordered execution into your own script:
```typescript
import { TestOrderManager } from 'playwright-order-manager';

const exitCode = await TestOrderManager.run({
  orderMode:    'priority',
  failurePolicy: 'continue',
  project:       'chromium',
  reportRoot:    './test-output',
});

process.exit(exitCode);
```

---

## Using `OrderedExecution` directly

If you only want the bucketing algorithm without the full runner:
```typescript
import { OrderedExecution, RunnerConstants } from 'playwright-order-manager';
import type { DiscoveredTestCase } from 'playwright-order-manager';

const tests: DiscoveredTestCase[] = [ /* ... */ ];

const buckets = OrderedExecution.buildBuckets({
  tests,
  orderMode: 'priority',
});

const { runFirst, middle, runLast } = OrderedExecution.groupBuckets(buckets);
```

---

## Output Files

After a run, the `ordered-results/` directory contains:

| File | Description |
|---|---|
| `ordered-report.html` | Full HTML report — open in any browser |
| `ordered-summary.json` | Machine-readable summary of the entire run |
| `ordered-discovery.json` | List of all discovered tests (written during `--list` phase) |
| `bucket-N-*.json` | Per-bucket Playwright JSON reports (intermediate, safe to delete) |

---

## HTML Report Features

The HTML report is self-contained — no internet connection required. It includes:

- Overall pass/fail status with progress bar
- Bucket navigation bar — jump to any bucket, colour-coded by result
- Per-bucket execution timestamps — see exactly when each bucket ran
- Per-test tags — verify tests landed in the correct bucket
- Flaky test detection — tests that passed only after retries are marked
- Collapsible buckets — passing buckets auto-collapse when failures exist
- Inline error preview — first line of error visible without expanding

---

## CI Integration

### GitHub Actions
```yaml
- name: Run ordered tests
  run: npx pw-order --project=chromium
  env:
    ORDER_MODE: priority
    FAILURE_POLICY: critical

- name: Upload report
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: ordered-test-report
    path: ordered-results/
```

---

## Licence

MIT © [rajeshyemul](https://github.com/rajeshyemul)