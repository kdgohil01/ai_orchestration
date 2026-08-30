import fs from 'fs';
import path from 'path';
import { config } from './config.js';

function directorySize(root) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else total += fs.statSync(entryPath).size;
    }
  }
  return total;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function periodStart(period, now) {
  const result = new Date(now);
  if (period === 'daily') result.setUTCDate(result.getUTCDate() - 1);
  else if (period === 'weekly') result.setUTCDate(result.getUTCDate() - 7);
  else return null;
  return result;
}

export function buildReport(store, { period = 'all', now = new Date() } = {}) {
  if (!['all', 'daily', 'weekly'].includes(period)) throw new Error(`Unsupported report period: ${period}`);
  const cutoff = periodStart(period, now);
  const allJobs = store.listJobs({ limit: 500 });
  const jobs = cutoff ? allJobs.filter(job => new Date(job.updated_at) >= cutoff) : allJobs;
  const byState = Object.create(null);
  const failures = Object.create(null);
  for (const job of jobs) {
    byState[job.state] = (byState[job.state] || 0) + 1;
    if (job.error_details?.message) {
      const summary = job.error_details.message.split(/\r?\n/)[0].slice(0, 240);
      const reason = job.error_details.code && job.error_details.code !== 'N/A'
        ? `${job.error_details.code}: ${summary}`
        : summary;
      failures[reason] = (failures[reason] || 0) + 1;
    }
  }
  return {
    generatedAt: now.toISOString(),
    period,
    periodStart: cutoff?.toISOString() || null,
    databasePath: config.databasePath,
    totalJobs: jobs.length,
    nextRetryAt: allJobs
      .filter(job => ['retryable_failure', 'blocked'].includes(job.state) && job.next_attempt_at)
      .map(job => job.next_attempt_at)
      .sort()[0] || null,
    configuredSchedule: {
      shorts: `daily task (installer default 18:00 local; actual task remains operator-controlled)`,
      longForm: `optional weekly task (installer default 18:00 local)`,
      retryWorker: 'every 15 minutes when installed',
      timezone: config.publishTimezone,
    },
    byState,
    recentJobs: jobs.slice(0, 10).map(job => ({
      id: job.id,
      kind: job.kind,
      state: job.state,
      attempts: `${job.attempt_count}/${job.max_attempts}`,
      updatedAt: job.updated_at,
      finalVideo: job.asset_paths?.finalVideo || null,
      youtubeVideoId: job.youtube_video_id,
      nextAttemptAt: job.next_attempt_at,
    })),
    repeatedFailures: Object.entries(failures)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ count, reason })),
    diskUsage: {
      durableOutput: formatBytes(directorySize(config.outputDir)),
      temporaryFiles: formatBytes(directorySize(config.tempDir)),
      logs: formatBytes(directorySize(config.logDir)),
    },
  };
}

export function reportMarkdown(report) {
  const states = Object.entries(report.byState).map(([state, count]) => `- ${state}: ${count}`).join('\n') || '- none';
  const failures = report.repeatedFailures.map(item => `- ${item.count}x ${item.reason}`).join('\n') || '- none';
  const jobs = report.recentJobs.map(job => `- ${job.id} | ${job.kind} | ${job.state} | attempts ${job.attempts}`).join('\n') || '- none';
  return `# DeedLamp ${report.period} operations report

Generated: ${report.generatedAt}  
Period start: ${report.periodStart || 'all history'}  
Jobs: ${report.totalJobs}  
Next retry: ${report.nextRetryAt || 'none'}

## States

${states}

## Repeated failures

${failures}

## Recent jobs

${jobs}

## Local disk usage

- Durable output: ${report.diskUsage.durableOutput}
- Temporary files: ${report.diskUsage.temporaryFiles}
- Logs: ${report.diskUsage.logs}
`;
}

export function writeReport(report, reportDir = config.reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const base = `${report.period}-${stamp}`;
  const jsonPath = path.join(reportDir, `${base}.json`);
  const markdownPath = path.join(reportDir, `${base}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, reportMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}
