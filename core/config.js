import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(CORE_DIR, '..');

export function projectPath(...parts) {
  return path.join(PROJECT_ROOT, ...parts);
}

function intFromEnv(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`Invalid ${name}: expected an integer${min !== undefined ? ` >= ${min}` : ''}${max !== undefined ? ` and <= ${max}` : ''}.`);
  }
  return value;
}

export const envInt = intFromEnv;

export function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  if (/^(0|false|no)$/i.test(raw)) return false;
  throw new Error(`Invalid ${name}: expected true or false.`);
}

export const PUBLISH_TIMEZONE = process.env.PUBLISH_TIMEZONE || 'Asia/Kolkata';
export const PUBLISH_HOUR = intFromEnv(
  process.env.PUBLISH_HOUR_LOCAL === undefined ? 'PUBLISH_HOUR' : 'PUBLISH_HOUR_LOCAL',
  18,
  { min: 0, max: 23 },
);
export const FACT_CHECK_MIN_CONFIDENCE = intFromEnv('FACT_CHECK_MIN_CONFIDENCE', 80, { min: 50, max: 100 });
export const NETWORK_TIMEOUT_MS = intFromEnv('NETWORK_TIMEOUT_MS', 30_000, { min: 5_000, max: 120_000 });
export const PROCESS_TIMEOUT_MS = intFromEnv('PROCESS_TIMEOUT_MS', 30 * 60_000, { min: 60_000, max: 2 * 60 * 60_000 });

export const config = Object.freeze({
  rootDir: PROJECT_ROOT,
  databasePath: path.resolve(PROJECT_ROOT, process.env.ORCHESTRATION_DB_PATH || 'data/orchestration.db'),
  tempDir: path.resolve(PROJECT_ROOT, process.env.TEMP_DIR || '.local/temp'),
  outputDir: path.resolve(PROJECT_ROOT, process.env.OUTPUT_DIR || 'output/jobs'),
  logDir: path.resolve(PROJECT_ROOT, process.env.LOG_DIR || 'logs'),
  reportDir: path.resolve(PROJECT_ROOT, process.env.REPORT_DIR || 'reports/generated'),
  dashboardPort: intFromEnv('DASHBOARD_PORT', 4317, { min: 1024, max: 65_535 }),
  dashboardRefreshMs: intFromEnv('DASHBOARD_REFRESH_MS', 2_000, { min: 1_000, max: 60_000 }),
  publishHourLocal: PUBLISH_HOUR,
  publishTimezone: PUBLISH_TIMEZONE,
  maxJobAttempts: intFromEnv('MAX_JOB_ATTEMPTS', 3, { min: 1, max: 10 }),
  retryBaseSeconds: intFromEnv('RETRY_BASE_SECONDS', 300, { min: 30, max: 86_400 }),
  retryMaxSeconds: intFromEnv('RETRY_MAX_SECONDS', 21_600, { min: 60, max: 604_800 }),
  lockLeaseMinutes: intFromEnv('LOCK_LEASE_MINUTES', 180, { min: 5, max: 720 }),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  approvedGeminiModels: Object.freeze(['gemini-2.5-flash']),
  factCheckMinConfidence: FACT_CHECK_MIN_CONFIDENCE,
  networkTimeoutMs: NETWORK_TIMEOUT_MS,
  processTimeoutMs: PROCESS_TIMEOUT_MS,
});

export function validateConfig({ requireContentApis = true, requireYoutube = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!config.approvedGeminiModels.includes(config.geminiModel)) {
    errors.push(`GEMINI_MODEL '${config.geminiModel}' is not in the local free-tier allowlist.`);
  }

  if (requireContentApis) {
    for (const key of ['GEMINI_API_KEY', 'PEXELS_API_KEY']) {
      if (!process.env[key]?.trim()) errors.push(`Missing required environment variable: ${key}`);
    }
  }

  if (requireYoutube) {
    for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']) {
      if (!process.env[key]?.trim()) errors.push(`Missing required environment variable: ${key}`);
    }
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    warnings.push('Email notifications are disabled because EMAIL_USER or EMAIL_PASS is missing.');
  }

  return { valid: errors.length === 0, errors, warnings };
}
