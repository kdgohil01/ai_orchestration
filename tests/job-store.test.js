import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JobStore } from '../core/job-store.js';
import { redactSecrets, scanForSecretLeaks } from '../core/security.js';
import { calculateWordErrorRate } from '../core/transcript-validator.js';

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deedlamp-test-'));
  const databasePath = path.join(directory, 'test.db');
  const store = new JobStore(databasePath);
  try {
    return callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('persists required job fields and valid lifecycle transitions', () => {
  withStore(store => {
    const created = store.createJob({ kind: 'short' });
    assert.equal(created.state, 'queued');
    assert.deepEqual(created.asset_paths, {});
    assert.deepEqual(created.source_urls, []);
    assert.equal(created.attempt_count, 0);

    store.transition(created.id, 'researching');
    store.transition(created.id, 'scripted');
    store.transition(created.id, 'rendering');
    store.transition(created.id, 'validating');
    store.transition(created.id, 'ready_to_publish');
    assert.equal(store.getJob(created.id).state, 'ready_to_publish');
  });
});

test('rejects invalid state transitions', () => {
  withStore(store => {
    const job = store.createJob({ kind: 'long' });
    assert.throws(() => store.transition(job.id, 'published'), /Invalid job transition/);
  });
});

test('allows only one owner for the render/upload lock', () => {
  withStore(store => {
    assert.equal(store.acquireLock('render_upload', 'job-a', 60_000), true);
    assert.equal(store.acquireLock('render_upload', 'job-b', 60_000), false);
    assert.equal(store.releaseLock('render_upload', 'job-a'), true);
    assert.equal(store.acquireLock('render_upload', 'job-b', 60_000), true);
  });
});

test('enforces the render/upload lock across separate SQLite connections', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deedlamp-lock-test-'));
  const databasePath = path.join(directory, 'test.db');
  const first = new JobStore(databasePath);
  const second = new JobStore(databasePath);
  try {
    assert.equal(first.acquireLock('render_upload', 'job-a', 60_000), true);
    assert.equal(second.acquireLock('render_upload', 'job-b', 60_000), false);
    assert.equal(first.releaseLock('render_upload', 'job-a'), true);
    assert.equal(second.acquireLock('render_upload', 'job-b', 60_000), true);
  } finally {
    first.close();
    second.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('enforces unique rendered-video fingerprints', () => {
  withStore(store => {
    const first = store.createJob({ kind: 'short' });
    const second = store.createJob({ kind: 'short' });
    store.updateJob(first.id, { videoFingerprint: 'same-fingerprint' });
    assert.throws(() => store.updateJob(second.id, { videoFingerprint: 'same-fingerprint' }), /UNIQUE constraint failed/);
  });
});

test('finds duplicate active script hashes but ignores failed jobs', () => {
  withStore(store => {
    const first = store.createJob({ kind: 'short' });
    store.transition(first.id, 'researching');
    store.updateJob(first.id, { scriptHash: 'script-hash' });
    store.transition(first.id, 'scripted');
    const second = store.createJob({ kind: 'short' });
    assert.equal(store.findActiveByScriptHash('script-hash', second.id).id, first.id);
  });
});

test('records free-tier quota failures as blocked', () => {
  withStore(store => {
    const job = store.createJob({ kind: 'long' });
    store.transition(job.id, 'researching');
    const error = new Error('Free quota exhausted');
    error.code = 'FREE_TIER_QUOTA_EXHAUSTED';
    error.isQuotaBlocked = true;
    const failed = store.failJob(job.id, error, { blocked: true });
    assert.equal(failed.state, 'blocked');
    assert.equal(failed.attempt_count, 1);
    assert.equal(failed.error_details.code, 'FREE_TIER_QUOTA_EXHAUSTED');
  });
});

test('persists deterministic exponential retry timing', () => {
  withStore(store => {
    const job = store.createJob({ kind: 'short' });
    store.transition(job.id, 'researching');
    const before = Date.now();
    const failed = store.failJob(job.id, new Error('temporary network failure'));
    assert.equal(failed.state, 'retryable_failure');
    assert.ok(Date.parse(failed.next_attempt_at) >= before + 299_000);
    assert.equal(store.listDueRetries({ now: '9999-12-31T23:59:59.999Z' })[0].id, job.id);
  });
});

test('quota blocks receive a bounded later retry time', () => {
  withStore(store => {
    const job = store.createJob({ kind: 'long' });
    store.transition(job.id, 'researching');
    const error = new Error('quota exhausted');
    const failed = store.failJob(job.id, error, { blocked: true, retryAfterSeconds: 600 });
    assert.equal(failed.state, 'blocked');
    assert.ok(failed.next_attempt_at);
  });
});

test('stops retrying when maximum attempts is reached', () => {
  withStore(store => {
    const job = store.createJob({ kind: 'short', maxAttempts: 1 });
    store.transition(job.id, 'researching');
    const failed = store.failJob(job.id, new Error('still failing'));
    assert.equal(failed.state, 'failed');
    assert.equal(failed.next_attempt_at, null);
  });
});

test('redacts configured and recognizable secrets', () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'example-secret-value';
  try {
    const recognizableGoogleKey = 'AIza' + '1'.repeat(25);
    const redacted = redactSecrets(`key=example-secret-value token=${recognizableGoogleKey}`);
    assert.doesNotMatch(redacted, /example-secret-value|AIza1/);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test('detects secret-shaped values in text artifacts without returning the value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deedlamp-secret-scan-'));
  try {
    const artifact = path.join(dir, 'metadata.json');
    fs.writeFileSync(artifact, JSON.stringify({ token: `AIza${'B'.repeat(24)}` }), 'utf8');
    const result = scanForSecretLeaks([dir]);
    assert.equal(result.valid, false);
    assert.equal(result.leaks[0].category, 'google_api_key');
    assert.equal(Object.hasOwn(result.leaks[0], 'value'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('calculates transcript word error rate for matching and mismatching speech', () => {
  assert.equal(calculateWordErrorRate('The archive opens tonight.', 'the archive opens tonight'), 0);
  assert.equal(calculateWordErrorRate('one two three four', 'one two wrong four'), 0.25);
});
