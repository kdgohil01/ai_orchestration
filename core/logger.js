// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Enhanced Structured Logger
// Logs timing, duration, stages, errors, and writes JSONL execution logs.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve('logs');
const ERROR_LOG = path.resolve('error-log.txt');
const EXECUTION_LOG = path.join(LOG_DIR, 'execution.jsonl');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Starts a stage timer.
 * @param {string} stageName
 * @returns {object} Timer object to pass to endStage
 */
export function startStage(stageName) {
  ensureLogDir();
  console.log(`\n⏳ [STAGE START] ${stageName}`);
  return {
    stageName,
    startTime: Date.now(),
    isoStart: new Date().toISOString()
  };
}

/**
 * Ends a stage timer and logs structured output.
 * @param {object} timer - Timer object returned by startStage
 * @param {boolean} success - Whether the stage completed successfully
 * @param {object} [metadata] - Optional key-value metadata to record
 */
export function endStage(timer, success = true, metadata = {}) {
  const durationMs = Date.now() - timer.startTime;
  const status = success ? 'SUCCESS' : 'FAILED';
  const icon = success ? '✅' : '❌';

  console.log(`${icon} [STAGE END] ${timer.stageName} — ${status} (${durationMs}ms)`);

  const logEntry = {
    timestamp: new Date().toISOString(),
    stage: timer.stageName,
    durationMs,
    status,
    ...metadata
  };

  try {
    fs.appendFileSync(EXECUTION_LOG, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (e) {
    console.warn('⚠️ Could not write execution log entry:', e.message);
  }
}

/**
 * Logs a detailed error entry to console and error-log.txt.
 * @param {string} stage
 * @param {Error} error
 * @param {number} [retryCount=0]
 */
export function logError(stage, error, retryCount = 0) {
  const timestamp = new Date().toISOString();
  const entry = `\n[${timestamp}] ❌ FAILED AT: ${stage}\n  Message : ${error.message}\n  Code    : ${error.code || 'N/A'}\n  Retries : ${retryCount}\n  Stack   : ${(error.stack || '').split('\n').slice(0, 4).join(' | ')}\n${'─'.repeat(60)}`;
  
  try {
    fs.appendFileSync(ERROR_LOG, entry, 'utf8');
  } catch (e) {
    // Ignore error write failure
  }
  console.error(entry);
}
