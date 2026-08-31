import { google } from 'googleapis';
import { projectPath } from './config.js';
import { loadJson, saveJsonAtomic } from './state.js';
import { createYoutubeAuthClientForAnalytics } from './youtube.js';

const ANALYTICS_PATH = projectPath('.runtime', 'analytics.json');
const FALLBACKS = [projectPath('data', 'analytics.legacy.json'), projectPath('data', 'analytics.example.json')];
const EMPTY = { videos: [] };

function loadAnalytics() { return loadJson(ANALYTICS_PATH, FALLBACKS, EMPTY); }

export function recordAnalyticsEntry(record) {
  if (!record.youtubeId || String(record.youtubeId).startsWith('simulated_')) return;
  const analytics = loadAnalytics();
  analytics.videos ||= [];
  if (analytics.videos.some(video => video.id === record.youtubeId)) return;
  analytics.videos.push({
    id: record.youtubeId, title: record.title, topicSlug: record.topicSlug,
    format: record.format, category: record.category, publishAt: record.publishAt,
    wordCount: record.wordCount, durationSec: record.durationSec, sceneCount: record.sceneCount,
    loggedAt: new Date().toISOString(),
    metrics: { views: null, estimatedMinutesWatched: null, avgViewDuration: null, retentionPct: null, subscribersGained: null },
    metricsUpdatedAt: null
  });
  saveJsonAtomic(ANALYTICS_PATH, analytics);
}

export async function syncAnalyticsMetrics({ days = 90 } = {}) {
  const analytics = loadAnalytics();
  const tracked = new Map((analytics.videos || []).filter(v => v.id && !String(v.id).startsWith('simulated_')).map(v => [v.id, v]));
  if (!tracked.size) return { updated: 0 };
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  const isoDate = date => date.toISOString().slice(0, 10);
  const client = google.youtubeAnalytics({ version: 'v2', auth: createYoutubeAuthClientForAnalytics() });
  const response = await client.reports.query({
    ids: 'channel==MINE', startDate: isoDate(start), endDate: isoDate(end),
    dimensions: 'video', metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
    sort: '-views', maxResults: 200
  });
  let updated = 0;
  for (const row of response.data.rows || []) {
    const [id, views, watched, average, subscribers] = row;
    const video = tracked.get(id);
    if (!video) continue;
    video.metrics = {
      views, estimatedMinutesWatched: watched, avgViewDuration: average,
      retentionPct: video.durationSec ? Math.min(100, Math.round((average / video.durationSec) * 1000) / 10) : null,
      subscribersGained: subscribers
    };
    video.metricsUpdatedAt = new Date().toISOString();
    updated++;
  }
  saveJsonAtomic(ANALYTICS_PATH, analytics);
  return { updated };
}
