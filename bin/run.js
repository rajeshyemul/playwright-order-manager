#!/usr/bin/env node

/**
 * bin/run.js — CLI entry point for playwright-order-manager
 *
 * This file is intentionally plain JavaScript (not TypeScript).
 * It runs directly from node_modules/.bin/pw-order and calls into
 * the compiled dist/ output.
 *
 * Usage:
 *   npx pw-order
 *   npx pw-order --project=chromium
 *   npx pw-order --project=chromium --order-mode=priority
 *
 * All flags are forwarded to the runner. Playwright-specific flags
 * (like --project) are forwarded directly to Playwright.
 * Runner-specific flags (like --order-mode) are parsed here.
 */

'use strict';

const { TestOrderManager } = require('../dist/runner/TestOrderManager');

// =============================================================================
// CLI ARG PARSING
// We keep this intentionally simple — no external arg-parsing library.
// The supported flags are few and well-defined.
// =============================================================================

/**
 * Parses a single --key=value or --key value argument pair.
 * Returns { key, value } or null if the arg doesn't match the expected key.
 */
function parseFlag(args, flag) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // --flag=value form
    if (arg.startsWith(`--${flag}=`)) {
      return arg.slice(`--${flag}=`.length);
    }

    // --flag value form (next arg is the value)
    if (arg === `--${flag}` && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}

/**
 * Collects all args that are NOT recognised runner flags.
 * These get forwarded to Playwright as extraArgs.
 */
function collectExtraArgs(args) {
  const runnerFlags = new Set([
    '--order-mode',
    '--failure-policy',
    '--report-root',
    '--config',
    '--merge-config',
    '--project',
  ]);

  const extra = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // Check if this is a known runner flag in --flag=value form
    const isKnownFlagWithEquals = [...runnerFlags].some((f) =>
      arg.startsWith(`${f}=`) || arg === f
    );

    if (isKnownFlagWithEquals) {
      // If it's --flag value form (no =), skip the next arg too
      if (!arg.includes('=')) i++;
      i++;
      continue;
    }

    extra.push(arg);
    i++;
  }

  return extra;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  // argv[0] = node, argv[1] = this script, argv[2+] = user args
  const args = process.argv.slice(2);

  // Parse runner-specific flags
  const orderMode     = parseFlag(args, 'order-mode');
  const failurePolicy = parseFlag(args, 'failure-policy');
  const reportRoot    = parseFlag(args, 'report-root');
  const config        = parseFlag(args, 'config');
  const mergeConfig   = parseFlag(args, 'merge-config');
  const project       = parseFlag(args, 'project');

  // Everything else gets forwarded to Playwright unchanged
  const extraArgs = collectExtraArgs(args);

  // Build the RunConfig — only include fields that were actually provided
  // so that env vars and defaults fill in the rest correctly
  const runConfig = {};

  if (orderMode)     runConfig.orderMode            = orderMode;
  if (failurePolicy) runConfig.failurePolicy         = failurePolicy;
  if (reportRoot)    runConfig.reportRoot            = reportRoot;
  if (config)        runConfig.playwrightConfigPath  = config;
  if (mergeConfig)   runConfig.mergeConfigPath       = mergeConfig;
  if (project)       runConfig.project               = project;
  if (extraArgs.length > 0) runConfig.extraArgs      = extraArgs;

  let exitCode = 1;

  try {
    exitCode = await TestOrderManager.run(runConfig);
  } catch (err) {
    console.error(`[pw-order] Unexpected error: ${err.message}`);
    exitCode = 1;
  }

  process.exit(exitCode);
}

main();