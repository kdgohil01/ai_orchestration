import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JobStore } from '../core/job-store.js';
import { buildReport, reportMarkdown, writeReport } from '../core/reporting.js';

test('Master report is read-only and can write daily JSON and Markdown artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deedlamp-report-'));
  const store = new JobStore(path.join(root, 'jobs.db'));
  try {
    const job = store.createJob({ kind: 'short' });
    const before = store.getJob(job.id);
    const report = buildReport(store, { period: 'daily', now: new Date() });
    const markdown = reportMarkdown(report);
    const paths = writeReport(report, path.join(root, 'reports'));

    assert.equal(report.totalJobs, 1);
    assert.equal(report.byState.queued, 1);
    assert.match(markdown, /DeedLamp daily operations report/);
    assert.equal(fs.existsSync(paths.jsonPath), true);
    assert.equal(fs.existsSync(paths.markdownPath), true);
    assert.deepEqual(store.getJob(job.id), before);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
