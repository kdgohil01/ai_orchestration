import { projectPath } from './config.js';
import { loadJson, saveJsonAtomic } from './state.js';

const MEMORY_PATH = projectPath('.runtime', 'memory.json');
const FALLBACKS = [projectPath('data', 'memory.legacy.json'), projectPath('data', 'memory.example.json')];
const EMPTY = { published: [], topics_used: [] };
const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','about','into','over','after','how','why','what']);
const ALIASES = new Map([
  ['la', 'los'], ['ufo', 'unidentified'], ['wwii', 'worldwar2'], ['ww2', 'worldwar2'],
  ['uk', 'britain'], ['usa', 'america'], ['us', 'america']
]);

function loadMemory() { return loadJson(MEMORY_PATH, FALLBACKS, EMPTY); }
function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}
function tokens(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(Boolean).map(w => ALIASES.get(w) || w).map(stem).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}
function jaccard(a, b) {
  const one = new Set(a); const two = new Set(b);
  if (!one.size || !two.size) return 0;
  const intersection = [...one].filter(x => two.has(x)).length;
  return intersection / (one.size + two.size - intersection);
}
function bigrams(items) { return items.slice(0, -1).map((item, i) => `${item}:${items[i + 1]}`); }

export function topicSimilarity(left, right) {
  const a = tokens(left); const b = tokens(right);
  const tokenScore = jaccard(a, b);
  const phraseScore = jaccard(bigrams(a), bigrams(b));
  const compactA = a.join(''); const compactB = b.join('');
  const containment = compactA.includes(compactB) || compactB.includes(compactA) ? 1 : 0;
  return Math.max(tokenScore, phraseScore * 0.9, containment * 0.85);
}

export function checkNearDuplicate(candidate, threshold = 0.45) {
  const memory = loadMemory();
  const existing = [...(memory.topics_used || []), ...(memory.published || []).flatMap(p => [p.topic_slug, p.title]).filter(Boolean)];
  let best = { similarity: 0, matchedTopic: null };
  for (const topic of existing) {
    const similarity = topicSimilarity(candidate, topic);
    if (similarity > best.similarity) best = { similarity, matchedTopic: topic };
  }
  return best.similarity >= threshold ? { isDuplicate: true, ...best } : { isDuplicate: false, ...best };
}

export function getTopicsUsed() { return (loadMemory().topics_used || []).slice(-75); }
export function getRecentTitles(n = 20) { return (loadMemory().published || []).slice(-n).map(item => item.title); }

export function logPublished({ title, topicSlug, category, youtubeId, type, status = 'uploaded' }) {
  const memory = loadMemory();
  memory.published ||= []; memory.topics_used ||= [];
  if (memory.published.some(item => item.youtubeId && item.youtubeId === youtubeId)) return;
  memory.published.push({ title, topic_slug: topicSlug, category, type, status, youtubeId, uploadedAt: new Date().toISOString() });
  const slug = (topicSlug || title).toLowerCase().trim();
  if (!memory.topics_used.includes(slug)) memory.topics_used.push(slug);
  saveJsonAtomic(MEMORY_PATH, memory);
}
