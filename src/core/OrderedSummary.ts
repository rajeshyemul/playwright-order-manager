import * as fs from 'fs';
import * as path from 'path';
import { RunnerConstants } from '../constants';
import type {
  OrderedRunSummary,
  BucketExecutionRecord,
  ExecutedTestResult,
} from '../types';

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  if (hours > 0)   return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * A test is "flaky" if it ultimately passed but only after one or more retries.
 */
function isFlaky(result: ExecutedTestResult): boolean {
  return result.status === 'passed' && result.retries > 0;
}

// =============================================================================
// HTML GENERATION — PIECES
// =============================================================================

/**
 * Generates the stacked progress bar showing pass / fail / skip proportions.
 */
function generateProgressBar(summary: OrderedRunSummary): string {
  const total = summary.totals.tests;
  if (total === 0) return '';

  const passedPct  = Math.round((summary.totals.passed  / total) * 100);
  const failedPct  = Math.round((summary.totals.failed  / total) * 100);
  const skippedPct = Math.round((summary.totals.skipped / total) * 100);

  return `
    <div class="progress-wrap">
      <div class="progress-labels">
        <span class="pl-rate">${passedPct}% pass rate &nbsp;(${summary.totals.passed}/${total} tests)</span>
        <span class="pl-fail">${summary.totals.failed > 0 ? `${summary.totals.failed} failed` : ''}</span>
      </div>
      <div class="progress-bar" title="${passedPct}% passed, ${failedPct}% failed, ${skippedPct}% skipped">
        <div class="pb-pass"  style="width:${passedPct}%"></div>
        <div class="pb-fail"  style="width:${failedPct}%"></div>
        <div class="pb-skip"  style="width:${skippedPct}%"></div>
      </div>
    </div>
  `;
}

/**
 * Generates the bucket navigation pill bar at the top.
 * Each pill shows bucket number, label, test count, and pass/fail status.
 * Clicking scrolls to the matching bucket section.
 */
function generateBucketNav(buckets: BucketExecutionRecord[]): string {
  const pills = buckets.map((bucket, index) => {
    const num    = index + 1;
    const cls    = bucket.status === 'failed' ? 'pill-fail'
                 : bucket.status === 'skipped' ? 'pill-skip'
                 : 'pill-pass';
    const label  = escapeHtml(bucket.label);
    const count  = bucket.totalTests;
    return `<a href="#bucket-${num}" class="nav-pill ${cls}">#${num} ${label} (${count})</a>`;
  }).join('');

  return `<nav class="bucket-nav" aria-label="Jump to bucket">${pills}</nav>`;
}

/**
 * Generates the tag pills shown on each test row.
 */
function generateTagPills(tags?: string[]): string {
  if (!tags || tags.length === 0) return '<span class="no-tags">—</span>';
  return tags
    .map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`)
    .join(' ');
}

/**
 * Generates the rows for a single bucket's test table.
 * Each row: status (with flaky badge) | test title + file:line | tags | duration | retries | error preview
 */
function generateTestRows(results: ExecutedTestResult[]): string {
  return results.map((result) => {
    const flaky   = isFlaky(result);
    const rowCls  = result.status === 'failed'  ? 'row-fail'
                  : result.status === 'skipped' ? 'row-skip'
                  : result.status === 'timedOut' ? 'row-timeout'
                  : '';

    // Status cell — dot + label + optional flaky badge
    const statusCell = `
      <div class="td-status">
        <span class="s-dot s-${result.status}"></span>
        <span class="s-lbl">${result.status}</span>
        ${flaky ? '<span class="badge-flaky">flaky</span>' : ''}
      </div>`;

    // Title + file:line cell
    const fileWithLine = result.line
      ? `${result.file}:${result.line}`
      : result.file;
    const fileDisplay = result.file
      ? `<div class="td-file">${escapeHtml(fileWithLine)}</div>`
      : '';
    const titleCell = `
      <div class="td-title">${escapeHtml(result.title)}</div>
      ${fileDisplay}`;

    // Tags cell
    const tagsCell = generateTagPills(result.tags);

    // Duration cell
    const durCell = `<span class="td-dur">${formatDuration(result.duration)}</span>`;

    // Retries cell
    const retryCell = result.retries > 0
      ? `<span class="td-retry">${result.retries} retry${result.retries > 1 ? 's' : ''}</span>`
      : '<span class="no-tags">—</span>';

    // Error cell — first line inline, full detail on expand
    let errorCell = '<span class="no-tags">—</span>';
    if (result.errorMessage) {
      const firstLine = escapeHtml(result.errorMessage.split('\n')[0].slice(0, 120));
      const fullMsg   = escapeHtml(result.errorMessage);
      errorCell = `
        <details class="err-details">
          <summary class="err-summary">${firstLine}</summary>
          <pre class="err-pre">${fullMsg}</pre>
        </details>`;
    }

    return `
      <tr class="${rowCls}">
        <td>${statusCell}</td>
        <td>${titleCell}</td>
        <td>${tagsCell}</td>
        <td>${durCell}</td>
        <td>${retryCell}</td>
        <td>${errorCell}</td>
      </tr>`;
  }).join('');
}

/**
 * Generates the full HTML section for one bucket.
 * Includes: collapsible header with sequence number, timestamps, stats, and test table.
 */
function generateBucketSection(
  bucket: BucketExecutionRecord,
  index: number
): string {
  const num       = index + 1;
  const statusCls = bucket.status === 'failed'  ? 'bkt-fail'
                  : bucket.status === 'skipped' ? 'bkt-skip'
                  : 'bkt-pass';

  // Timestamp range — only shown if the runner recorded them
  const timestampHtml = (bucket.startedAt && bucket.finishedAt)
    ? `<span class="bkt-timing">
         ${formatTime(bucket.startedAt)} &rarr; ${formatTime(bucket.finishedAt)}
       </span>`
    : '';

  const criticalBadge = bucket.critical
    ? '<span class="badge-critical">critical</span>'
    : '';

  const statsHtml = `
    <span class="bkt-stat">
      <span class="stat-pass">${bucket.passed}</span> passed
    </span>
    <span class="bkt-stat">
      <span class="stat-fail">${bucket.failed}</span> failed
    </span>
    <span class="bkt-stat">
      <span class="stat-skip">${bucket.skipped}</span> skipped
    </span>
    <span class="bkt-dur">${formatDuration(bucket.duration)}</span>`;

  const tableHtml = `
    <table class="test-table">
      <thead>
        <tr>
          <th style="width:110px">Status</th>
          <th>Test &amp; file</th>
          <th style="width:160px">Tags</th>
          <th style="width:80px">Duration</th>
          <th style="width:80px">Retries</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${generateTestRows(bucket.results)}
      </tbody>
    </table>`;

  return `
    <section class="bucket ${statusCls}" id="bucket-${num}">
      <button
        class="bkt-header"
        aria-expanded="true"
        aria-controls="bkt-body-${num}"
        onclick="toggleBucket(this)"
      >
        <div class="bkt-left">
          <span class="bkt-seq">#${num}</span>
          <span class="bkt-dot"></span>
          <span class="bkt-name">${escapeHtml(bucket.label)}</span>
          ${criticalBadge}
        </div>
        <div class="bkt-right">
          ${timestampHtml}
          ${statsHtml}
          <span class="bkt-chevron" aria-hidden="true">&#9660;</span>
        </div>
      </button>
      <div class="bkt-body" id="bkt-body-${num}">
        ${tableHtml}
      </div>
    </section>`;
}

// =============================================================================
// FULL HTML DOCUMENT
// =============================================================================

function generateHtml(summary: OrderedRunSummary): string {
  const overallCls   = summary.success ? 'overall-pass' : 'overall-fail';
  const overallLabel = summary.success ? 'Run passed'   : 'Run failed';

  const bucketSections = summary.buckets
    .map((b, i) => generateBucketSection(b, i))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ordered Test Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d0f1a;
      color: #e2e8f0;
      padding: 1.5rem 2rem 4rem;
      line-height: 1.5;
      font-size: 14px;
    }

    a { color: inherit; text-decoration: none; }

    /* ── Header ──────────────────────────────────────────────── */
    .header {
      background: #131625;
      border: 1px solid #1e2235;
      border-radius: 10px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: .75rem;
    }
    .overall-status {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: 600;
    }
    .status-dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .overall-pass .status-dot { background: #4ade80; }
    .overall-fail .status-dot { background: #f87171; }
    .overall-pass .status-text { color: #4ade80; }
    .overall-fail .status-text { color: #f87171; }

    .run-meta {
      display: flex; gap: 1.5rem; flex-wrap: wrap;
      font-size: 12px; color: #94a3b8;
    }
    .run-meta strong { color: #e2e8f0; font-weight: 500; }

    /* progress bar */
    .progress-wrap { margin-top: 1rem; }
    .progress-labels {
      display: flex; justify-content: space-between;
      font-size: 12px; color: #94a3b8; margin-bottom: 5px;
    }
    .pl-fail { color: #f87171; }
    .progress-bar {
      height: 6px; border-radius: 999px;
      background: #1e2235;
      display: flex; overflow: hidden;
    }
    .pb-pass { background: #4ade80; transition: width .3s; }
    .pb-fail { background: #f87171; transition: width .3s; }
    .pb-skip { background: #facc15; transition: width .3s; }

    /* ── Summary cards ───────────────────────────────────────── */
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 1rem;
    }
    .card {
      background: #131625;
      border: 1px solid #1e2235;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .card-val {
      font-size: 28px; font-weight: 600;
      line-height: 1; margin-bottom: 4px;
    }
    .card-lbl {
      font-size: 11px; color: #64748b;
      text-transform: uppercase; letter-spacing: .05em;
    }
    .cv-total   { color: #60a5fa; }
    .cv-pass    { color: #4ade80; }
    .cv-fail    { color: #f87171; }
    .cv-skip    { color: #facc15; }
    .cv-rate    { color: #e2e8f0; }

    /* ── Bucket nav ──────────────────────────────────────────── */
    .bucket-nav {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin-bottom: 1.25rem;
    }
    .nav-pill {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid #1e2235;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity .15s;
    }
    .nav-pill:hover { opacity: .8; }
    .pill-pass {
      color: #4ade80;
      background: rgba(74,222,128,.08);
      border-color: rgba(74,222,128,.3);
    }
    .pill-fail {
      color: #f87171;
      background: rgba(248,113,113,.08);
      border-color: rgba(248,113,113,.3);
    }
    .pill-skip {
      color: #facc15;
      background: rgba(250,204,21,.08);
      border-color: rgba(250,204,21,.3);
    }

    /* ── Bucket sections ─────────────────────────────────────── */
    .bucket {
      background: #131625;
      border: 1px solid #1e2235;
      border-radius: 10px;
      margin-bottom: .875rem;
      overflow: hidden;
    }
    .bucket.bkt-fail { border-color: rgba(248,113,113,.4); }
    .bucket.bkt-pass { border-color: rgba(74,222,128,.2);  }
    .bucket.bkt-skip { border-color: rgba(250,204,21,.2);  }

    .bkt-header {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .875rem 1.25rem;
      background: #0d0f1a;
      border: none;
      cursor: pointer;
      color: #e2e8f0;
      text-align: left;
      flex-wrap: wrap;
      gap: .5rem;
    }
    .bkt-header:hover { background: #131625; }

    .bkt-left {
      display: flex; align-items: center; gap: 10px;
    }
    .bkt-seq {
      font-size: 11px; color: #475569;
      font-weight: 600; min-width: 22px;
      font-variant-numeric: tabular-nums;
    }
    .bkt-dot {
      width: 8px; height: 8px;
      border-radius: 50%; flex-shrink: 0;
    }
    .bkt-pass .bkt-dot { background: #4ade80; }
    .bkt-fail .bkt-dot { background: #f87171; }
    .bkt-skip .bkt-dot { background: #facc15; }

    .bkt-name {
      font-size: 13px; font-weight: 600;
    }
    .badge-critical {
      font-size: 10px; font-weight: 600;
      padding: 2px 7px; border-radius: 999px;
      background: rgba(248,113,113,.15);
      color: #fca5a5;
      border: 1px solid rgba(248,113,113,.3);
      text-transform: uppercase; letter-spacing: .04em;
    }

    .bkt-right {
      display: flex; align-items: center;
      gap: 1.25rem; flex-wrap: wrap;
    }
    .bkt-timing {
      font-size: 11px; color: #475569;
      font-variant-numeric: tabular-nums;
    }
    .bkt-stat { font-size: 12px; color: #94a3b8; }
    .stat-pass { color: #4ade80; font-weight: 600; }
    .stat-fail { color: #f87171; font-weight: 600; }
    .stat-skip { color: #facc15; font-weight: 600; }
    .bkt-dur   { font-size: 12px; color: #94a3b8; }

    .bkt-chevron {
      font-size: 12px; color: #475569;
      transition: transform .2s;
      flex-shrink: 0;
    }
    .bkt-header[aria-expanded="false"] .bkt-chevron {
      transform: rotate(-90deg);
    }

    /* collapsible body */
    .bkt-body { padding: 0 1.25rem 1rem; }
    .bkt-body.collapsed { display: none; }

    /* ── Test table ──────────────────────────────────────────── */
    .test-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: .75rem;
      table-layout: fixed;
    }
    .test-table th {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: .05em; color: #475569;
      padding: 7px 10px; text-align: left;
      border-bottom: 1px solid #1e2235;
      background: #0d0f1a;
    }
    .test-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #131625;
      vertical-align: top;
    }
    .test-table tr:last-child td { border-bottom: none; }
    .test-table tr:hover td { background: rgba(255,255,255,.02); }

    /* row tints */
    tr.row-fail    td { background: rgba(248,113,113,.05); }
    tr.row-skip    td { background: rgba(250,204,21, .04); }
    tr.row-timeout td { background: rgba(251,146,60, .05); }

    /* status cell */
    .td-status {
      display: flex; align-items: center; gap: 6px;
      white-space: nowrap;
    }
    .s-dot {
      width: 6px; height: 6px;
      border-radius: 50%; flex-shrink: 0;
    }
    .s-passed    { background: #4ade80; }
    .s-failed    { background: #f87171; }
    .s-skipped   { background: #facc15; }
    .s-timedOut  { background: #fb923c; }
    .s-interrupted { background: #a78bfa; }
    .s-lbl { font-size: 11px; color: #94a3b8; }

    .badge-flaky {
      font-size: 10px; padding: 1px 6px;
      border-radius: 999px;
      background: rgba(250,204,21,.12);
      color: #facc15;
      border: 1px solid rgba(250,204,21,.3);
    }

    /* title + file cell */
    .td-title { color: #e2e8f0; word-break: break-word; }
    .td-file {
      font-size: 11px; color: #475569;
      font-family: 'SFMono-Regular', Consolas, monospace;
      margin-top: 2px; word-break: break-all;
    }

    /* tag pills */
    .tag-pill {
      display: inline-block;
      font-size: 10px; padding: 1px 7px;
      border-radius: 999px;
      background: rgba(96,165,250,.1);
      color: #93c5fd;
      border: 1px solid rgba(96,165,250,.25);
      margin-right: 3px; margin-bottom: 2px;
      white-space: nowrap;
    }
    .no-tags { color: #334155; }

    .td-dur   { color: #64748b; white-space: nowrap; }
    .td-retry { color: #facc15; font-size: 11px;    }

    /* error cell */
    .err-details { cursor: pointer; }
    .err-summary {
      color: #f87171; font-size: 11px;
      list-style: none; cursor: pointer;
      overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; max-width: 260px;
      display: block;
    }
    .err-summary::-webkit-details-marker { display: none; }
    .err-summary::before {
      content: '▸ ';
      font-size: 9px; color: #f87171;
    }
    details[open] .err-summary::before { content: '▾ '; }
    .err-pre {
      margin-top: .5rem; padding: .625rem;
      background: #0d0f1a;
      border-radius: 4px; font-size: 11px;
      overflow-x: auto; white-space: pre-wrap;
      word-break: break-word; color: #fca5a5;
      border: 1px solid #1e2235;
      max-height: 200px; overflow-y: auto;
    }

    /* ── Footer ──────────────────────────────────────────────── */
    .footer {
      text-align: center; margin-top: 3rem;
      font-size: 11px; color: #334155;
    }

    /* ── Scroll offset for anchor links ─────────────────────── */
    .bucket { scroll-margin-top: 1rem; }
  </style>
</head>
<body>

  <!-- ── Header ── -->
  <div class="header">
    <div class="header-top">
      <div class="overall-status ${overallCls}">
        <span class="status-dot"></span>
        <span class="status-text">${overallLabel}</span>
      </div>
      <div class="run-meta">
        <div><strong>Mode:</strong> ${escapeHtml(summary.orderMode)}</div>
        <div><strong>Policy:</strong> ${escapeHtml(summary.failurePolicy)}</div>
        <div><strong>Started:</strong> ${new Date(summary.startedAt).toLocaleString()}</div>
        <div><strong>Finished:</strong> ${new Date(summary.finishedAt).toLocaleString()}</div>
        <div><strong>Duration:</strong> ${formatDuration(summary.totalDuration)}</div>
        <div><strong>Buckets:</strong> ${summary.totals.buckets}</div>
      </div>
    </div>
    ${generateProgressBar(summary)}
  </div>

  <!-- ── Summary cards ── -->
  <div class="summary-cards">
    <div class="card">
      <div class="card-val cv-total">${summary.totals.tests}</div>
      <div class="card-lbl">Total</div>
    </div>
    <div class="card">
      <div class="card-val cv-pass">${summary.totals.passed}</div>
      <div class="card-lbl">Passed</div>
    </div>
    <div class="card">
      <div class="card-val cv-fail">${summary.totals.failed}</div>
      <div class="card-lbl">Failed</div>
    </div>
    <div class="card">
      <div class="card-val cv-skip">${summary.totals.skipped}</div>
      <div class="card-lbl">Skipped</div>
    </div>
    <div class="card">
      <div class="card-val cv-rate">${summary.totals.tests > 0
        ? Math.round((summary.totals.passed / summary.totals.tests) * 100)
        : 0}%</div>
      <div class="card-lbl">Pass rate</div>
    </div>
  </div>

  <!-- ── Bucket navigation ── -->
  ${generateBucketNav(summary.buckets)}

  <!-- ── Bucket sections ── -->
  ${bucketSections}

  <div class="footer">
    Generated by playwright-order-manager &nbsp;&bull;&nbsp;
    ${new Date(summary.finishedAt).toLocaleString()}
  </div>

  <script>
    function toggleBucket(btn) {
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      var bodyId = btn.getAttribute('aria-controls');
      var body   = document.getElementById(bodyId);
      if (body) {
        body.classList.toggle('collapsed', expanded);
      }
    }

    // On page load — auto-collapse all passing buckets
    // if there are any failing ones, so failures are immediately visible
    window.addEventListener('DOMContentLoaded', function() {
      var hasFailing = document.querySelector('.bucket.bkt-fail');
      if (!hasFailing) return;

      document.querySelectorAll('.bucket.bkt-pass .bkt-header').forEach(function(btn) {
        btn.setAttribute('aria-expanded', 'false');
        var bodyId = btn.getAttribute('aria-controls');
        var body   = document.getElementById(bodyId);
        if (body) body.classList.add('collapsed');
      });
    });
  </script>

</body>
</html>`;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export class OrderedSummary {
  /**
   * Writes the ordered run summary to disk as both JSON and HTML.
   *
   * @param summary    - The complete run summary to write
   * @param reportRoot - Directory to write into. Defaults to RunnerConstants.DEFAULTS.REPORT_ROOT
   * @returns Absolute paths of the files written: { jsonPath, htmlPath }
   */
  static write(
    summary: OrderedRunSummary,
    reportRoot: string = RunnerConstants.DEFAULTS.REPORT_ROOT
  ): { jsonPath: string; htmlPath: string } {
    ensureDir(reportRoot);

    const jsonPath = path.join(reportRoot, RunnerConstants.DEFAULTS.SUMMARY_FILENAME);
    const htmlPath = path.join(reportRoot, RunnerConstants.DEFAULTS.REPORT_FILENAME);

    try {
      fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
    } catch (err) {
      throw new Error(
        `OrderedSummary.write: failed to write JSON to ${jsonPath}\n` +
        `Cause: ${(err as Error).message}`
      );
    }

    try {
      fs.writeFileSync(htmlPath, generateHtml(summary), 'utf8');
    } catch (err) {
      throw new Error(
        `OrderedSummary.write: failed to write HTML to ${htmlPath}\n` +
        `Cause: ${(err as Error).message}`
      );
    }

    return { jsonPath, htmlPath };
  }

  /**
   * Builds an OrderedRunSummary from raw bucket execution records.
   * Call this after all buckets finish, then pass the result to write().
   */
  static buildSummary(
    buckets: BucketExecutionRecord[],
    startedAt: string,
    orderMode: string,
    failurePolicy: string
  ): OrderedRunSummary {
    const finishedAt = new Date().toISOString();
    const startMs    = new Date(startedAt).getTime();
    const endMs      = new Date(finishedAt).getTime();

    const totals = buckets.reduce(
      (acc, bucket) => ({
        tests:   acc.tests   + bucket.totalTests,
        passed:  acc.passed  + bucket.passed,
        failed:  acc.failed  + bucket.failed,
        skipped: acc.skipped + bucket.skipped,
        buckets: acc.buckets + 1,
      }),
      { tests: 0, passed: 0, failed: 0, skipped: 0, buckets: 0 }
    );

    const success = buckets.every((b) => b.status !== 'failed');

    return {
      startedAt,
      finishedAt,
      totalDuration: endMs - startMs,
      orderMode:     orderMode     as OrderedRunSummary['orderMode'],
      failurePolicy: failurePolicy as OrderedRunSummary['failurePolicy'],
      totals,
      success,
      buckets,
    };
  }
}
