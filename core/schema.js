const CATEGORIES = new Set([
  'historical anomaly', 'biological extreme', 'psychological phenomenon',
  'physics edge case', 'engineering disaster', 'lost civilization'
]);

function requireString(value, field, { min = 1, max = Infinity } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new Error(`${field} must be a string between ${min} and ${max} characters.`);
  }
}

function requireStringArray(value, field, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${field} must contain ${min}-${max} items.`);
  }
  value.forEach((item, i) => requireString(item, `${field}[${i}]`, { min: 2, max: 100 }));
}

function validateSegments(segments, expected) {
  if (!Array.isArray(segments) || segments.length !== expected) {
    throw new Error(`visualSegments must contain exactly ${expected} items.`);
  }
  segments.forEach((segment, i) => {
    if (!segment || segment.part !== i + 1) throw new Error(`visualSegments[${i}].part must equal ${i + 1}.`);
    requireString(segment.keyword, `visualSegments[${i}].keyword`, { min: 4, max: 100 });
  });
}

function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > 4) {
    throw new Error('sources must contain 2-4 authoritative references.');
  }
  const unique = new Set();
  sources.forEach((source, i) => {
    requireString(source?.title, `sources[${i}].title`, { min: 3, max: 180 });
    requireString(source?.url, `sources[${i}].url`, { min: 10, max: 500 });
    let parsed;
    try { parsed = new URL(source.url); } catch { throw new Error(`sources[${i}].url is invalid.`); }
    if (parsed.protocol !== 'https:') throw new Error(`sources[${i}].url must use HTTPS.`);
    if (unique.has(parsed.href)) throw new Error('Source URLs must be unique.');
    unique.add(parsed.href);
  });
}

function validateCommon(data, { segments, keywordMin, keywordMax, titleMax }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('AI response must be an object.');
  requireString(data.topic_slug, 'topic_slug', { min: 5, max: 80 });
  if (!CATEGORIES.has(data.topic_category)) throw new Error(`Unsupported topic_category: ${data.topic_category}`);
  requireString(data.title, 'title', { min: 8, max: titleMax });
  requireString(data.seo_hook, 'seo_hook', { min: 15, max: 250 });
  requireString(data.comment_cta, 'comment_cta', { min: 8, max: 250 });
  requireStringArray(data.keywords, 'keywords', keywordMin, keywordMax);
  validateSegments(data.visualSegments, segments);
  validateSources(data.sources);
}

export function validateShortSchema(data) {
  validateCommon(data, { segments: 5, keywordMin: 5, keywordMax: 8, titleMax: 55 });
  requireString(data.script, 'script', { min: 80, max: 500 });
  return true;
}

export function validateLongSchema(data) {
  validateCommon(data, { segments: 8, keywordMin: 6, keywordMax: 10, titleMax: 65 });
  requireString(data.fullScript, 'fullScript', { min: 1500, max: 9000 });
  if (!Array.isArray(data.chapters) || data.chapters.length !== 4) throw new Error('chapters must contain exactly 4 items.');
  data.chapters.forEach((chapter, i) => requireString(chapter?.label, `chapters[${i}].label`, { min: 3, max: 80 }));
  return true;
}

