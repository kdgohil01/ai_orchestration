import path from 'path';
import { fileURLToPath } from 'url';

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(CORE_DIR, '..');

export function projectPath(...parts) {
  return path.join(PROJECT_ROOT, ...parts);
}

export function envInt(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  if (/^(0|false|no)$/i.test(raw)) return false;
  throw new Error(`${name} must be true or false.`);
}

export const PUBLISH_TIMEZONE = process.env.PUBLISH_TIMEZONE || 'Asia/Kolkata';
export const PUBLISH_HOUR = envInt('PUBLISH_HOUR', 18, { min: 0, max: 23 });
export const FACT_CHECK_MIN_CONFIDENCE = envInt('FACT_CHECK_MIN_CONFIDENCE', 80, { min: 50, max: 100 });
export const NETWORK_TIMEOUT_MS = envInt('NETWORK_TIMEOUT_MS', 30_000, { min: 5_000, max: 120_000 });
export const PROCESS_TIMEOUT_MS = envInt('PROCESS_TIMEOUT_MS', 30 * 60_000, { min: 60_000, max: 2 * 60 * 60_000 });

