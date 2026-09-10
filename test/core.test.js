import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProportionalChapters, formatTimestamp } from '../core/chapters.js';
import { topicSimilarity } from '../core/memory.js';
import { getPublishAt } from '../core/youtube.js';
import { validateShortQuality, validateLongQuality } from '../core/quality-gate.js';

const common = {
  topic_slug: 'london test event 1918',
  topic_category: 'historical anomaly',
  seo_hook: 'A documented London event from 1918 remains frequently misunderstood.',
  comment_cta: 'Which interpretation is better supported by the surviving evidence?',
  keywords: ['London', '1918', 'archive', 'history', 'evidence', 'records'],
  source_urls: [
    'https://nationalarchives.gov.uk/example',
    'https://si.edu/example'
  ]
};

test('publish time is always 18:00 in the configured timezone', () => {
  assert.equal(getPublishAt(new Date('2026-08-29T10:00:00Z'), 'Asia/Kolkata', 18), '2026-08-29T12:30:00.000Z');
  assert.equal(getPublishAt(new Date('2026-08-29T13:00:00Z'), 'Asia/Kolkata', 18), '2026-08-30T12:30:00.000Z');
});

test('chapters scale to measured runtime', () => {
  const chapters = buildProportionalChapters(240, [
    { label: 'Start' }, { label: 'Context' }, { label: 'Turn' }, { label: 'Echo' }
  ]);
  assert.deepEqual(chapters.map(item => item.timestamp), ['0:00', '0:46', '1:46', '3:00']);
  assert.equal(formatTimestamp(125), '2:05');
});

test('topic matching recognizes common aliases', () => {
  assert.ok(topicSimilarity('LA 1942 air raid', 'Los Angeles 1942 air raid') >= 0.45);
});

test('short quality gate accepts a structurally valid script', () => {
  const script = 'In 1918, London clerk Ada Morris opened a sealed ledger and found every page damp, though the archive was dry. Tests later traced the moisture to a leaking wall, but one entry had already vanished, leaving historians with only its shadow.';
  const data = {
    ...common, script, title: 'London Ledger Lost to a Hidden Leak',
    visualSegments: Array.from({ length: 5 }, (_, i) => ({ part: i + 1, keyword: `London archive scene ${i + 1}` }))
  };
  assert.equal(script.split(/\s+/).length, 41);
  assert.equal(validateShortQuality(data), true);
});

test('long quality gate enforces factual structure and duration-oriented word count', () => {
  const ending = 'If you want more from The Archive, subscribe. The next one is stranger than this.'.split(/\s+/);
  const opening = 'In 1918, London archivist Ada Morris opened a documented municipal ledger.'.split(/\s+/);
  const middle = Array(600 - opening.length - ending.length).fill('evidence');
  const fullScript = [...opening, ...middle, ...ending].join(' ');
  const data = {
    ...common, fullScript, title: 'The London Ledger Evidence',
    keywords: [...common.keywords, 'documentary'],
    chapters: [{ label: 'Opening' }, { label: 'Context' }, { label: 'Escalation' }, { label: 'Echo' }],
    visualSegments: Array.from({ length: 8 }, (_, i) => ({ part: i + 1, keyword: `London documentary scene ${i + 1}` }))
  };
  assert.equal(validateLongQuality(data), true);
});
