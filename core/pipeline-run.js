import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from './config.js';
import { JobStore } from './job-store.js';

const PRODUCTION_LOCK = 'render_upload';

export class PipelineRun {
  constructor(kind, mode, { jobId = null } = {}) {
    this.store = new JobStore();
    try {
      if (jobId) {
        this.job = this.store.getJob(jobId);
        if (!this.job) throw new Error(`Retry job not found: ${jobId}`);
        if (this.job.kind !== kind) throw new Error(`Retry job ${jobId} is not a ${kind} job.`);
        if (this.job.state !== 'queued') throw new Error(`Retry job ${jobId} must be queued; current state is ${this.job.state}.`);
        this.job = this.store.updateJob(jobId, {
          metadata: { ...this.job.metadata, mode, resumedAt: new Date().toISOString() },
          nextAttemptAt: null,
        });
      } else {
        this.job = this.store.createJob({ kind, metadata: { mode } });
      }
    } catch (error) {
      this.store.close();
      throw error;
    }
    this.lockHeld = this.store.acquireLock(PRODUCTION_LOCK, this.job.id);

    if (!this.lockHeld) {
      this.store.transition(this.job.id, 'blocked', {
        reason: 'Another render or upload job owns the local production lock.',
      });
      this.store.close();
      const error = new Error('Another render or upload job is active. This job was safely blocked.');
      error.code = 'PRODUCTION_LOCKED';
      error.isBlocked = true;
      throw error;
    }

    try {
      this.tempDir = path.join(config.tempDir, `${kind}_${this.job.id}`);
      this.outputDir = path.join(config.outputDir, this.job.id);
      this.audioPath = path.join(this.tempDir, 'voice.mp3');
      this.uncaptionedPath = path.join(this.tempDir, 'uncaptioned.mp4');
      this.finalPath = path.join(this.outputDir, 'final.mp4');
      fs.mkdirSync(this.tempDir, { recursive: true });
      fs.mkdirSync(this.outputDir, { recursive: true });
      this.store.updateJob(this.job.id, {
        assetPaths: {
          tempDir: this.tempDir,
          outputDir: this.outputDir,
          finalVideo: this.finalPath,
        },
      });
      this.transition('researching');
    } catch (error) {
      try { this.store.failJob(this.job.id, error); } catch {}
      this.store.releaseLock(PRODUCTION_LOCK, this.job.id);
      this.lockHeld = false;
      this.store.close();
      throw error;
    }
  }

  transition(state, details = {}) {
    this.job = this.store.transition(this.job.id, state, details);
    return this.job;
  }

  update(patch) {
    this.job = this.store.updateJob(this.job.id, patch);
    return this.job;
  }

  fail(error) {
    this.job = this.store.failJob(this.job.id, error, {
      retryable: !error?.isQualityError,
      blocked: Boolean(error?.isBlocked || error?.isQuotaBlocked),
      needsReview: Boolean(error?.isQualityError || error?.isUploadAmbiguous),
      retryAfterSeconds: error?.isQuotaBlocked ? config.retryMaxSeconds : null,
    });
    return this.job;
  }

  cleanupTemp() {
    if (fs.existsSync(this.tempDir)) fs.rmSync(this.tempDir, { recursive: true, force: true });
  }

  close() {
    if (this.lockHeld) {
      this.store.releaseLock(PRODUCTION_LOCK, this.job.id);
      this.lockHeld = false;
    }
    this.store.close();
  }
}

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function fingerprintFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}
