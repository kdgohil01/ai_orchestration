import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JobStore } from '../core/job-store.js';
import { buildDashboardSnapshot } from '../dashboard/data.js';
import { createDashboardServer } from '../dashboard/server.js';
import { sendOperationalEmail } from '../core/notifications.js';

function tempDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deedlamp-dashboard-'));
  return { directory, databasePath: path.join(directory, 'dashboard.db') };
}

function advanceToReady(store, id) {
  for (const state of ['researching', 'scripted', 'rendering', 'validating', 'ready_to_publish']) {
    store.transition(id, state);
  }
}

test('builds the hierarchical dashboard model from SQLite jobs and events', () => {
  const { directory, databasePath } = tempDatabase();
  const store = new JobStore(databasePath);
  try {
    const longJob = store.createJob({ kind: 'long', metadata: { research: { topic_slug: 'verified archive' } } });
    advanceToReady(store, longJob.id);
    store.transition(longJob.id, 'uploading');
    store.updateJob(longJob.id, {
      youtubeVideoId: 'youtube-long-1',
      publishAt: '2030-01-02T12:30:00.000Z',
      validationResult: { citations: { valid: true, sourceCount: 2, claimCount: 8 } },
    });
    store.recordEvent(longJob.id, 'email_notification', { status: 'sent', sentAt: '2030-01-01T00:00:00.000Z' });
    store.transition(longJob.id, 'published');

    const shortJob = store.createJob({ kind: 'short' });
    store.transition(shortJob.id, 'researching');
    const quotaError = Object.assign(new Error('free quota exhausted'), { code: 'FREE_TIER_QUOTA_EXHAUSTED' });
    store.failJob(shortJob.id, quotaError, { blocked: true, retryAfterSeconds: 3600 });

    const snapshot = buildDashboardSnapshot(store, {
      now: new Date('2029-12-31T10:00:00.000Z'),
      schedulerStatus: {
        agentA: { status: 'installed' }, agentB: { status: 'not_installed' }, agentC: { status: 'installed' },
      },
    });
    assert.equal(snapshot.system.totalJobs, 2);
    assert.equal(snapshot.hierarchy.agentA.lastUploadedVideo.youtubeVideoId, 'youtube-long-1');
    assert.equal(snapshot.hierarchy.agentA.latestNotification.status, 'sent');
    assert.equal(snapshot.hierarchy.agentB.health, 'warning');
    assert.equal(snapshot.schedules.long.actual.jobId, longJob.id);
    assert.ok(snapshot.hierarchy.agentC.analyses.length > 0);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('serves the loopback dashboard, job detail API, and SSE snapshot', async () => {
  const { directory, databasePath } = tempDatabase();
  const seed = new JobStore(databasePath);
  const job = seed.createJob({ kind: 'short' });
  seed.close();
  const dashboard = createDashboardServer({
    port: 0,
    databasePath,
    refreshMs: 1000,
    schedulerInspector: () => ({}),
  });
  try {
    const address = await dashboard.listen();
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Agent Observatory/);

    const snapshot = await fetch(`${base}/api/dashboard`).then(response => response.json());
    assert.equal(snapshot.system.totalJobs, 1);
    const detail = await fetch(`${base}/api/jobs/${job.id}`).then(response => response.json());
    assert.equal(detail.job.id, job.id);

    const controller = new AbortController();
    const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const first = await stream.body.getReader().read();
    assert.match(new TextDecoder().decode(first.value), /event: snapshot/);
    controller.abort();
  } finally {
    await dashboard.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('notification audit reports skipped and sent outcomes without real SMTP', async () => {
  const originalUser = process.env.EMAIL_USER;
  const originalPass = process.env.EMAIL_PASS;
  try {
    process.env.EMAIL_USER = '';
    process.env.EMAIL_PASS = '';
    const skipped = await sendOperationalEmail({ subject: 'test', html: '<p>test</p>' });
    assert.equal(skipped.status, 'skipped');

    process.env.EMAIL_USER = 'local@example.test';
    process.env.EMAIL_PASS = 'local-app-password';
    const sent = await sendOperationalEmail({
      subject: 'test',
      html: '<p>test</p>',
      transportFactory: () => ({ sendMail: async () => ({ messageId: 'mock-message' }) }),
    });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.messageId, 'mock-message');
  } finally {
    if (originalUser === undefined) delete process.env.EMAIL_USER;
    else process.env.EMAIL_USER = originalUser;
    if (originalPass === undefined) delete process.env.EMAIL_PASS;
    else process.env.EMAIL_PASS = originalPass;
  }
});
