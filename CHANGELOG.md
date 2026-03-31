# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-03-31

### Fixed

- Discovery now supports raw Playwright `--list --reporter=json` output, so
  ordered runs no longer depend solely on fixture teardown writing the
  discovery file
- Playwright metadata tags like `P1` and `runFirst` are normalized to
  internal `@P1` and `@runFirst` tags during discovery
- Bucket execution now inserts `--` before `file:line` selectors so Playwright
  treats them as test filters instead of extra `--project` values
- `pw-order --help` now prints package help instead of forwarding to the
  Playwright CLI
- Stale `bucket-*.json` files are removed from the report directory before a
  new run starts, preventing old artifacts from leaking into later runs

## [0.1.1] - 2026-03-31

### Changed

- Documented official support for both Playwright `tag` metadata and
  legacy title-based tags, with `tag` metadata now recommended for new tests
- Clarified tag precedence rules and corrected the fixture import path in the README
- Bucket execution now targets individual tests via `file:line` selectors
  instead of whole files, so mixed-priority tests in the same spec file
  run in the correct bucket order
- HTML report now shows `file:line` when Playwright provides line numbers
- Clarified that `pw-order` does not require `playwright.merge.config.ts`
  for its standard JSON/HTML output

### Fixed

- Discovery de-duplication now uses project, file, line, and title so tests
  with the same name in different files are preserved correctly
- Execution result matching now uses line-aware lookup, improving tag attachment
  and reporting accuracy for similarly named tests

## [0.1.0] - 2026-03-30

### First release

- `OrderedExecution` — pure bucketing algorithm with `basic` and `priority` modes
- `TestOrderManager` — full CLI orchestrator (discover → plan → execute → report)
- `OrderedReportParser` — parses Playwright JSON reports into typed objects
- `OrderedSummary` — writes JSON summary and self-contained HTML report
- Playwright fixtures via `playwright-order-manager/fixtures` subpath export
- `@runFirst` / `@runLast` boundary tags
- `@P1` / `@P2` / `@P3` / `@P4` priority tags
- Three failure policies: `critical`, `continue`, `immediate`
- HTML report with progress bar, bucket navigation, flaky detection,
  collapsible sections, and inline error preview
- CLI via `npx pw-order`
- Full TypeScript types exported for consumers
