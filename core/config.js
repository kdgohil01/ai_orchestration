import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const ROOT_DIR = path.resolve('.');

function intFromEnv(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new Error(`Invalid ${name}: expected an integer${min !== undefined ? ` >= ${min}` : ''}${max !== undefined ? ` and <= ${max}` : ''}.`);
  }
  return value;
}

export const config = Object.freeze({
  rootDir: ROOT_DIR,
  databasePath: path.resolve(process.env.ORCHESTRATION_DB_PATH || 'data/orchestration.db'),
  tempDir: path.resolve(process.env.TEMP_DIR || 'temp'),
  outputDir: path.resolve(process.env.OUTPUT_DIR || 'output/jobs'),
  logDir: path.resolve(process.env.LOG_DIR || 'logs'),
  publishHourLocal: intFromEnv('PUBLISH_HOUR_LOCAL', 18, { min: 0, max: 23 }),
  publishTimezone: process.env.PUBLISH_TIMEZONE || 'Asia/Kolkata',
  maxJobAttempts: intFromEnv('MAX_JOB_ATTEMPTS', 3, { min: 1, max: 10 }),
  lockLeaseMinutes: intFromEnv('LOCK_LEASE_MINUTES', 180, { min: 5, max: 720 }),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  approvedGeminiModels: Object.freeze(['gemini-2.5-flash']),
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
