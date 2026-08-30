import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { safeErrorDetails } from './security.js';

export const JOB_STATES = Object.freeze([
  'queued',
  'researching',
  'scripted',
  'rendering',
  'validating',
  'ready_to_publish',
  'uploading',
  'published',
  'retryable_failure',
  'blocked',
  'failed',
  'needs_review',
]);

const TERMINAL_STATES = new Set(['published', 'failed']);

const ALLOWED_TRANSITIONS = Object.freeze({
  queued: ['researching', 'blocked', 'failed'],
  researching: ['scripted', 'retryable_failure', 'blocked', 'failed', 'needs_review'],
  scripted: ['rendering', 'retryable_failure', 'blocked', 'failed', 'needs_review'],
  rendering: ['validating', 'retryable_failure', 'blocked', 'failed', 'needs_review'],
  validating: ['ready_to_publish', 'retryable_failure', 'blocked', 'failed', 'needs_review'],
  ready_to_publish: ['uploading', 'blocked', 'failed', 'needs_review'],
  uploading: ['published', 'retryable_failure', 'blocked', 'failed', 'needs_review'],
  retryable_failure: ['queued', 'blocked', 'failed', 'needs_review'],
  blocked: ['queued', 'failed', 'needs_review'],
  needs_review: ['queued', 'published', 'failed'],
  published: [],
  failed: [],
});

function isoNow() {
  return new Date().toISOString();
}

function toJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function fromJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function hydrateJob(row) {
  if (!row) return null;
  return {
    ...row,
    asset_paths: fromJson(row.asset_paths, {}),
    source_urls: fromJson(row.source_urls, []),
    validation_result: fromJson(row.validation_result, null),
    error_details: fromJson(row.error_details, null),
    metadata: fromJson(row.metadata, {}),
  };
}

export class JobStore {
  constructor(databasePath = config.databasePath) {
    this.databasePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('short', 'long')),
        state TEXT NOT NULL CHECK (state IN (${JOB_STATES.map(s => `'${s}'`).join(', ')})),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        scheduled_for TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        asset_paths TEXT NOT NULL DEFAULT '{}',
        source_urls TEXT NOT NULL DEFAULT '[]',
        validation_result TEXT,
        error_details TEXT,
        script_hash TEXT,
        video_fingerprint TEXT,
        youtube_video_id TEXT,
        publish_at TEXT,
        next_attempt_at TEXT,
        last_attempt_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_video_fingerprint
        ON jobs(video_fingerprint) WHERE video_fingerprint IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_youtube_video_id
        ON jobs(youtube_video_id) WHERE youtube_video_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_jobs_script_hash ON jobs(script_hash) WHERE script_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_jobs_state_updated ON jobs(state, updated_at);

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS resource_locks (
        resource TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

    `);
    const columns = new Set(this.db.prepare('PRAGMA table_info(jobs)').all().map(column => column.name));
    if (!columns.has('next_attempt_at')) this.db.exec('ALTER TABLE jobs ADD COLUMN next_attempt_at TEXT;');
    if (!columns.has('last_attempt_at')) this.db.exec('ALTER TABLE jobs ADD COLUMN last_attempt_at TEXT;');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_retry_due ON jobs(state, next_attempt_at);
      PRAGMA user_version = 2;
    `);
  }

  close() {
    this.db.close();
  }

  createJob({ id = crypto.randomUUID(), kind, scheduledFor = null, maxAttempts = config.maxJobAttempts, metadata = {} }) {
    if (!['short', 'long'].includes(kind)) throw new Error(`Unsupported job kind: ${kind}`);
    const now = isoNow();
    this.db.prepare(`
      INSERT INTO jobs (id, kind, state, created_at, updated_at, scheduled_for, max_attempts, metadata)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)
    `).run(id, kind, now, now, scheduledFor, maxAttempts, toJson(metadata, {}));
    this.db.prepare(`
      INSERT INTO job_events (job_id, created_at, from_state, to_state, details)
      VALUES (?, ?, NULL, 'queued', '{}')
    `).run(id, now);
    return this.getJob(id);
  }

  getJob(id) {
    return hydrateJob(this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
  }

  findByVideoFingerprint(fingerprint) {
    return hydrateJob(this.db.prepare('SELECT * FROM jobs WHERE video_fingerprint = ?').get(fingerprint));
  }

  findActiveByScriptHash(scriptHash, excludeId) {
    return hydrateJob(this.db.prepare(`
      SELECT * FROM jobs
      WHERE script_hash = ? AND id <> ?
        AND state IN ('scripted', 'rendering', 'validating', 'ready_to_publish', 'uploading', 'published', 'needs_review')
      ORDER BY created_at DESC LIMIT 1
    `).get(scriptHash, excludeId));
  }

  listJobs({ limit = 50, state = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const rows = state
      ? this.db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC LIMIT ?').all(state, boundedLimit)
      : this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(boundedLimit);
    return rows.map(hydrateJob);
  }

  listDueRetries({ now = isoNow(), limit = 10 } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
    return this.db.prepare(`
      SELECT * FROM jobs
      WHERE state IN ('retryable_failure', 'blocked') AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC LIMIT ?
    `).all(now, boundedLimit).map(hydrateJob);
  }

  recordEvent(id, type, details = {}) {
    const current = this.getJob(id);
    if (!current) throw new Error(`Job not found: ${id}`);
    this.db.prepare(`
      INSERT INTO job_events (job_id, created_at, from_state, to_state, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, isoNow(), current.state, type, toJson(details, {}));
  }

  getEvents(id, limit = 100) {
    return this.db.prepare(`
      SELECT * FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?
    `).all(id, Math.max(1, Math.min(Number(limit) || 100, 500))).map(row => ({
      ...row,
      details: fromJson(row.details, {}),
    }));
  }

  transition(id, nextState, details = {}) {
    if (!JOB_STATES.includes(nextState)) throw new Error(`Unknown job state: ${nextState}`);
    const current = this.getJob(id);
    if (!current) throw new Error(`Job not found: ${id}`);
    if (!ALLOWED_TRANSITIONS[current.state].includes(nextState)) {
      throw new Error(`Invalid job transition: ${current.state} -> ${nextState}`);
    }
    const now = isoNow();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?').run(nextState, now, id);
      this.db.prepare(`
        INSERT INTO job_events (job_id, created_at, from_state, to_state, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, now, current.state, nextState, toJson(details, {}));
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
    return this.getJob(id);
  }

  updateJob(id, patch = {}) {
    const allowed = new Map([
      ['assetPaths', ['asset_paths', value => toJson(value, {})]],
      ['sourceUrls', ['source_urls', value => toJson(value, [])]],
      ['validationResult', ['validation_result', value => toJson(value, null)]],
      ['errorDetails', ['error_details', value => toJson(value, null)]],
      ['scriptHash', ['script_hash', value => value]],
      ['videoFingerprint', ['video_fingerprint', value => value]],
      ['youtubeVideoId', ['youtube_video_id', value => value]],
      ['publishAt', ['publish_at', value => value]],
      ['nextAttemptAt', ['next_attempt_at', value => value]],
      ['lastAttemptAt', ['last_attempt_at', value => value]],
      ['metadata', ['metadata', value => toJson(value, {})]],
    ]);
    const assignments = [];
    const values = [];
    for (const [key, value] of Object.entries(patch)) {
      const definition = allowed.get(key);
      if (!definition) throw new Error(`Unsupported job field: ${key}`);
      assignments.push(`${definition[0]} = ?`);
      values.push(definition[1](value));
    }
    if (!assignments.length) return this.getJob(id);
    assignments.push('updated_at = ?');
    values.push(isoNow(), id);
    this.db.prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    return this.getJob(id);
  }

  incrementAttempt(id) {
    const now = isoNow();
    this.db.prepare('UPDATE jobs SET attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    return this.getJob(id);
  }

  failJob(id, error, { retryable = true, blocked = false, needsReview = false, retryAfterSeconds = null } = {}) {
    const current = this.getJob(id);
    if (!current || TERMINAL_STATES.has(current.state)) return current;
    const attempted = this.incrementAttempt(id);
    const errorDetails = safeErrorDetails(error);
    this.updateJob(id, { errorDetails });
    let nextState = 'failed';
    let nextAttemptAt = null;
    if (needsReview) nextState = 'needs_review';
    else if (blocked) {
      nextState = 'blocked';
      if (retryAfterSeconds && attempted.attempt_count < attempted.max_attempts) {
        nextAttemptAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
      }
    }
    else if (retryable && attempted.attempt_count < attempted.max_attempts) {
      nextState = 'retryable_failure';
      const delaySeconds = Math.min(
        config.retryMaxSeconds,
        config.retryBaseSeconds * (2 ** Math.max(0, attempted.attempt_count - 1))
      );
      nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    }
    if (!ALLOWED_TRANSITIONS[current.state].includes(nextState)) nextState = 'failed';
    this.updateJob(id, { nextAttemptAt });
    return this.transition(id, nextState, { error: errorDetails, nextAttemptAt });
  }

  acquireLock(resource, ownerId, leaseMs = config.lockLeaseMinutes * 60_000) {
    const nowMs = Date.now();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare('DELETE FROM resource_locks WHERE expires_at <= ?').run(nowMs);
      const existing = this.db.prepare('SELECT * FROM resource_locks WHERE resource = ?').get(resource);
      if (existing && existing.owner_id !== ownerId) {
        this.db.exec('ROLLBACK;');
        return false;
      }
      this.db.prepare(`
        INSERT INTO resource_locks (resource, owner_id, acquired_at, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(resource) DO UPDATE SET
          owner_id = excluded.owner_id,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at
      `).run(resource, ownerId, isoNow(), nowMs + leaseMs);
      this.db.exec('COMMIT;');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  releaseLock(resource, ownerId) {
    return this.db.prepare('DELETE FROM resource_locks WHERE resource = ? AND owner_id = ?').run(resource, ownerId).changes > 0;
  }
}
