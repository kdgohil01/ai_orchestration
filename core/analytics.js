// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Analytics & Performance Tracker
// Records publication records and performance metric stubs in data/analytics.json
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

const ANALYTICS_PATH = path.resolve('data/analytics.json');

function loadAnalytics() {
  if (!fs.existsSync(ANALYTICS_PATH)) {
    return { _note: 'Per-video performance metrics stub', videos: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf8'));
  } catch {
    return { _note: 'Per-video performance metrics stub', videos: [] };
  }
}

function saveAnalytics(data) {
  fs.mkdirSync(path.dirname(ANALYTICS_PATH), { recursive: true });
  fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Records a video publication record in analytics.json for future analytics ingestion.
 *
 * @param {object} record
 * @param {string} record.youtubeId
 * @param {string} record.title
 * @param {string} record.topicSlug
 * @param {string} record.format ('short'|'long')
 * @param {string} record.category
 * @param {string} record.publishAt
 * @param {number} record.wordCount
 * @param {number} record.durationSec
 * @param {number} record.sceneCount
 */
export function recordAnalyticsEntry({
  youtubeId,
  title,
  topicSlug,
  format,
  category,
  publishAt,
  wordCount,
  durationSec,
  sceneCount
}) {
  const analytics = loadAnalytics();

  const entry = {
    id: youtubeId || `local_${Date.now()}`,
    title,
    topicSlug,
    format,
    category,
    publishAt,
    wordCount,
    durationSec,
    sceneCount,
    loggedAt: new Date().toISOString(),
    metrics: {
      ctr: null,             // Click-through rate (%)
      avgViewDuration: null, // Average view duration (seconds)
      retentionPct: null,    // Average retention percentage (%)
      subscribersGained: null,
      views: null
    }
  };

  analytics.videos.push(entry);
  saveAnalytics(analytics);
  console.log(`📊 Recorded video entry in data/analytics.json (${format.toUpperCase()}: "${title}")`);
}
