import { BANNED_VOCAB, BANNED_OPENERS } from './identity.js';
import { validateLongSchema, validateShortSchema } from './schema.js';

const COMMON_WORDS = new Set(['The', 'This', 'That', 'There', 'When', 'While', 'After', 'Before', 'Inside', 'During']);
const wordCount = text => text.trim().split(/\s+/).filter(Boolean).length;

function validateLanguage(script, errors) {
  const lower = script.toLowerCase();
  const opener = BANNED_OPENERS.find(item => lower.startsWith(item.toLowerCase()));
  if (opener) errors.push(`Banned opener: "${opener}".`);
  const banned = BANNED_VOCAB.filter(word => new RegExp(`\\b${word}\\b`, 'i').test(script));
  if (banned.length) errors.push(`Banned vocabulary: ${banned.join(', ')}.`);
}

function hasConcreteOpener(script) {
  const first = script.split(/[.!?]/)[0] || '';
  if (/\b\d{2,}\b/.test(first)) return true;
  const names = first.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  return names.some(name => !COMMON_WORDS.has(name));
}

function throwQuality(label, errors) {
  if (!errors.length) return true;
  const err = new Error(`${label} quality gate failed:\n- ${errors.join('\n- ')}`);
  err.isQualityError = true;
  throw err;
}

export function validateShortQuality(data) {
  const errors = [];
  try { validateShortSchema(data); } catch (err) { errors.push(err.message); }
  const script = String(data?.script || '').trim();
  const count = wordCount(script);
  if (count < 38 || count > 45) errors.push(`Script has ${count} words; expected 38-45.`);
  validateLanguage(script, errors);
  if (!hasConcreteOpener(script)) errors.push('Opening sentence needs a concrete date, measurement, or non-generic proper noun.');
  return throwQuality('Short', errors);
}

export function validateLongQuality(data) {
  const errors = [];
  try { validateLongSchema(data); } catch (err) { errors.push(err.message); }
  const script = String(data?.fullScript || '').trim();
  const count = wordCount(script);
  if (count < 780 || count > 880) errors.push(`Documentary has ${count} words; expected 780-880.`);
  validateLanguage(script, errors);
  if (!hasConcreteOpener(script)) errors.push('Opening sentence needs a concrete date, measurement, or non-generic proper noun.');
  if (!script.toLowerCase().includes('if you want more from the archive, subscribe')) errors.push('Required spoken subscribe CTA is missing.');
  return throwQuality('Long-form', errors);
}

