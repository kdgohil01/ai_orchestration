import fs from 'fs';
import path from 'path';
import { projectPath } from './config.js';

const LOG_DIR = projectPath('.runtime', 'logs');
const ERROR_LOG = path.join(LOG_DIR, 'errors.log');
const EXECUTION_LOG = path.join(LOG_DIR, 'execution.jsonl');
const activeStages = new Map();

function ensureLogDir() { fs.mkdirSync(LOG_DIR, { recursive: true }); }
function appendStructured(entry) {
  ensureLogDir();
  fs.appendFileSync(EXECUTION_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function startStage(stageName) {
  const timer = { id: Symbol(stageName), stageName, startTime: Date.now(), isoStart: new Date().toISOString() };
  activeStages.set(timer.id, timer);
  console.log(`\n[STAGE START] ${stageName}`);
  return timer;
}

export function endStage(timer, success = true, metadata = {}) {
  activeStages.delete(timer.id);
  const entry = {
    timestamp: new Date().toISOString(),
    stage: timer.stageName,
    durationMs: Date.now() - timer.startTime,
    status: success ? 'SUCCESS' : 'FAILED',
    ...metadata
  };
  appendStructured(entry);
  console.log(`[STAGE END] ${timer.stageName} - ${entry.status} (${entry.durationMs}ms)`);
  return entry;
}

export function failOpenStages(error) {
  for (const timer of [...activeStages.values()]) {
    endStage(timer, false, { error: error.message, code: error.code || null });
  }
}

export function logError(stage, error, retryCount = 0) {
  ensureLogDir();
  const payload = {
    timestamp: new Date().toISOString(), stage, message: error.message,
    code: error.code || null, retries: retryCount,
    stack: (error.stack || '').split('\n').slice(0, 6)
  };
  fs.appendFileSync(ERROR_LOG, `${JSON.stringify(payload)}\n`, 'utf8');
  console.error(`[${payload.timestamp}] ${stage}: ${error.message}`);
}
