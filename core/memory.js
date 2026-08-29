// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Structured Memory System & Near-Duplicate Protection
// Replaces the flat history-log.txt with a JSON database.
// Adds Jaccard similarity slug matching to prevent near-duplicate topics.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

const MEMORY_PATH = path.resolve('data/memory.json');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'how', 'why', 'what'
]);

function loadMemory() {
  if (!fs.existsSync(MEMORY_PATH)) {
    return { published: [], topics_used: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
  } catch {
    console.warn('⚠️ memory.json parse error — starting with empty memory.');
    return { published: [], topics_used: [] };
  }
}

function saveMemory(memory) {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf8');
}

/**
 * Normalizes a text string into a set of clean word tokens.
 * Strips punctuation, numbers, and stop words.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  const words = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Calculates Jaccard similarity coefficient between two token sets.
 * Returns a value between 0.0 (no overlap) and 1.0 (identical tokens).
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} Jaccard similarity index
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach(token => {
    if (setB.has(token)) intersection++;
  });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Checks if a proposed topic slug or title is a near-duplicate
 * of any previously published topic.
 *
 * @param {string} candidateSlug - Proposed topic slug or title
 * @param {number} [threshold=0.55] - Max allowed Jaccard similarity (default 55%)
 * @returns {{isDuplicate: boolean, matchedTopic?: string, similarity?: number}}
 */
export function checkNearDuplicate(candidateSlug, threshold = 0.55) {
  const memory = loadMemory();
  const candidateTokens = tokenize(candidateSlug);

  const existingTopics = [
    ...(memory.topics_used || []),
    ...(memory.published || []).map(p => p.title)
  ];

  for (const existing of existingTopics) {
    const existingTokens = tokenize(existing);
    const sim = jaccardSimilarity(candidateTokens, existingTokens);
    if (sim >= threshold) {
      return {
        isDuplicate: true,
        matchedTopic: existing,
        similarity: Math.round(sim * 100) / 100
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Returns a clean list of topic slugs to pass to Gemini as the
 * "do not repeat" constraint. Capped at 50 to keep prompt size sane.
 */
export function getTopicsUsed() {
  const memory = loadMemory();
  return (memory.topics_used || []).slice(-50);
}

/**
 * Returns the last N published titles (for human readability in logs).
 */
export function getRecentTitles(n = 20) {
  const memory = loadMemory();
  return memory.published.slice(-n).map(p => p.title);
}

/**
 * Logs a successfully published video to memory.json.
 * @param {object} entry
 * @param {string} entry.title         - Full video title
 * @param {string} entry.topicSlug     - Short 3-5 word identifier slug
 * @param {string} entry.category      - Topic category label
 * @param {string} entry.youtubeId     - YouTube video ID
 * @param {'short'|'long'} entry.type  - Content type
 */
export function logPublished({ title, topicSlug, category, youtubeId, type }) {
  const memory = loadMemory();

  memory.published.push({
    title,
    topic_slug: topicSlug,
    category,
    type,
    youtubeId,
    uploadedAt: new Date().toISOString()
  });

  const slug = (topicSlug || title).toLowerCase().trim();
  if (!memory.topics_used.includes(slug)) {
    memory.topics_used.push(slug);
  }

  saveMemory(memory);
}
