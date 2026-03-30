// =============================================================================
// playwright-order-manager — public API
//
// This is the only file consumers should import from.
// Everything exported here is part of the stable public API.
// Anything NOT exported here is an internal implementation detail
// that can change between versions without a semver bump.
// =============================================================================

// ── Core logic ───────────────────────────────────────────────────────────────
// The pure ordered execution algorithm — zero I/O, fully testable.
// Most users won't need this directly, but it's valuable for anyone
// building custom tooling on top of the package.
export { OrderedExecution } from './core/OrderedExecution';

// ── Runner ───────────────────────────────────────────────────────────────────
// The full orchestrator for programmatic use.
// CLI users don't need this — it's called by bin/run.js automatically.
// Library users who want to embed ordered execution into their own
// scripts or CI tooling use this directly.
export { TestOrderManager } from './runner/TestOrderManager';

// ── Playwright fixtures ──────────────────────────────────────────────────────
// Drop-in replacement for @playwright/test's `test` and `expect`.
// Users import from here instead of @playwright/test — they get our
// extended test object that hooks into the discovery phase.
export { test, expect } from './fixtures';

// Re-export the Playwright types that consumers commonly need
// so they don't have to mix imports from two packages.
export type {
  Page,
  Browser,
  BrowserContext,
  Locator,
  APIRequestContext,
} from '@playwright/test';

// ── All public types ─────────────────────────────────────────────────────────
// Consumers who build wrappers or custom reporters around this package
// need these types. Exporting them here means they never have to reach
// into internal paths like 'playwright-order-manager/src/types'.
export type {
  // Core data shapes
  DiscoveredTestCase,
  ExecutedTestResult,
  TestStatus,

  // Bucket types
  BucketPlan,
  BucketExecutionRecord,
  BucketKind,

  // Summary
  OrderedRunSummary,

  // Configuration
  BuildBucketOptions,
  RunConfig,

  // Union types
  OrderMode,
  FailurePolicy,
  PriorityTag,
} from './types';

// ── Constants ────────────────────────────────────────────────────────────────
// Exported for users who want to reference tag names without hardcoding
// strings in their own code.
// e.g. if (tag === RunnerConstants.RUN_FIRST_TAG) { ... }
export { RunnerConstants } from './constants';