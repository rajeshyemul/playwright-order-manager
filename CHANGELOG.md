# Changelog

All notable changes to this project will be documented in this file.

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