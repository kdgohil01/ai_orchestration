// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Content Quality Gates
// Validates Gemini API responses against anti-AI, retention, and quality rules.
// ─────────────────────────────────────────────────────────────────────────────

import { BANNED_VOCAB, BANNED_OPENERS } from './identity.js';

/**
 * Validates Gemini output for a Short video.
 * Throws a QualityError if any quality gate is breached.
 *
 * @param {object} data - Parsed Gemini response object for Short
 * @returns {boolean} True if passed
 */
export function validateShortQuality(data) {
  const errors = [];

  // 1. Structure check
  if (!data.script || !data.title || !data.seo_hook || !data.visualSegments) {
    errors.push('Response missing required fields (script, title, seo_hook, or visualSegments).');
  }

  const script = (data.script || '').trim();
  const wordCount = script.split(/\s+/).filter(Boolean).length;

  // 2. Word count bound (Shorts target 38-45, bounds 35-50)
  if (wordCount < 35 || wordCount > 52) {
    errors.push(`Script word count (${wordCount} words) outside acceptable bounds (35–50 words).`);
  }

  // 3. Opener check
  const lowerScript = script.toLowerCase();
  const foundBannedOpener = BANNED_OPENERS.find(op => lowerScript.startsWith(op.toLowerCase()));
  if (foundBannedOpener) {
    errors.push(`Script opens with banned AI formula phrase: "${foundBannedOpener}"`);
  }

  // 4. Banned vocabulary check
  const foundBannedWords = BANNED_VOCAB.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(script));
  if (foundBannedWords.length > 0) {
    errors.push(`Script contains banned overused AI vocabulary: ${foundBannedWords.join(', ')}`);
  }

  // 5. Specificity check (Must contain at least one digit or capitalized proper noun in first sentence)
  const firstSentence = script.split(/[.!?]/)[0] || '';
  const hasDigit = /\d+/.test(firstSentence);
  const hasProperNoun = /[A-Z][a-z]+/.test(firstSentence);
  if (!hasDigit && !hasProperNoun) {
    errors.push('Beat 1 fails specificity gate — no concrete number, date, or proper noun in the opener.');
  }

  // 6. Visual segment keywords check
  if (!Array.isArray(data.visualSegments) || data.visualSegments.length < 5) {
    errors.push('Must contain at least 5 visual segments.');
  } else {
    data.visualSegments.forEach((seg, i) => {
      const kw = (seg.keyword || '').trim();
      if (kw.length < 4 || /^(video|broll|nature|history|background)$/i.test(kw)) {
        errors.push(`Visual segment ${i + 1} has vague/generic search keyword: "${kw}"`);
      }
    });
  }

  if (errors.length > 0) {
    const errorMsg = `Short Quality Gate FAILED:\n  - ${errors.join('\n  - ')}`;
    console.warn(`⚠️ ${errorMsg}`);
    const err = new Error(errorMsg);
    err.isQualityError = true;
    throw err;
  }

  console.log(`✅ Short Content Quality Gate PASSED (${wordCount} words, opener verified).`);
  return true;
}

/**
 * Validates Gemini output for a Long-form documentary.
 * Throws a QualityError if any quality gate is breached.
 *
 * @param {object} data - Parsed Gemini response object for Long-form
 * @returns {boolean} True if passed
 */
export function validateLongQuality(data) {
  const errors = [];

  // 1. Structure check
  if (!data.fullScript || !data.title || !data.seo_hook || !data.chapters || !data.visualSegments) {
    errors.push('Response missing required documentary fields (fullScript, title, chapters, visualSegments).');
  }

  const script = (data.fullScript || '').trim();
  const wordCount = script.split(/\s+/).filter(Boolean).length;

  // 2. Word count bound (Long target 580-650 words, bounds 500-720)
  if (wordCount < 500 || wordCount > 720) {
    errors.push(`Documentary script word count (${wordCount} words) outside acceptable bounds (500–720 words).`);
  }

  // 3. Opener check
  const lowerScript = script.toLowerCase();
  const foundBannedOpener = BANNED_OPENERS.find(op => lowerScript.startsWith(op.toLowerCase()));
  if (foundBannedOpener) {
    errors.push(`Documentary opens with banned formula phrase: "${foundBannedOpener}"`);
  }

  // 4. Banned vocabulary check
  const foundBannedWords = BANNED_VOCAB.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(script));
  if (foundBannedWords.length > 0) {
    errors.push(`Documentary script contains banned AI vocabulary: ${foundBannedWords.join(', ')}`);
  }

  // 5. Outro CTA check
  if (!lowerScript.includes('if you want more from the archive') && !lowerScript.includes('subscribe')) {
    errors.push('Documentary script is missing the required verbal subscribe CTA in the outro.');
  }

  // 6. Chapters check
  if (!Array.isArray(data.chapters) || data.chapters.length < 4) {
    errors.push('Must provide at least 4 chapter markers.');
  } else {
    if (data.chapters[0].timestamp !== '0:00') {
      errors.push('First chapter timestamp must start at 0:00.');
    }
  }

  // 7. Visual segments check (8 scenes required)
  if (!Array.isArray(data.visualSegments) || data.visualSegments.length < 8) {
    errors.push(`Must contain 8 visual segments for long-form (found ${data.visualSegments?.length || 0}).`);
  }

  if (errors.length > 0) {
    const errorMsg = `Long Documentary Quality Gate FAILED:\n  - ${errors.join('\n  - ')}`;
    console.warn(`⚠️ ${errorMsg}`);
    const err = new Error(errorMsg);
    err.isQualityError = true;
    throw err;
  }

  console.log(`✅ Long Documentary Quality Gate PASSED (${wordCount} words, CTA & chapters verified).`);
  return true;
}
