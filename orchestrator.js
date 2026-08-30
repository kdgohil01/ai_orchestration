import fs from 'fs';
import path from 'path';
import { JobStore } from './core/job-store.js';
import { config } from './core/config.js';

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

function buildReport(store) {
  const jobs = store.listJobs({ limit: 500 });
  const byState = Object.create(null);
  const failures = Object.create(null);
  for (const job of jobs) {
    byState[job.state] = (byState[job.state] || 0) + 1;
    if (job.error_details?.message) {
      const reason = job.error_details.code && job.error_details.code !== 'N/A'
        ? `${job.error_details.code}: ${job.error_details.message}`
        : job.error_details.message;
      failures[reason] = (failures[reason] || 0) + 1;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    databasePath: config.databasePath,
    totalJobs: jobs.length,
    byState,
    recentJobs: jobs.slice(0, 10).map(job => ({
      id: job.id,
      kind: job.kind,
      state: job.state,
      attempts: `${job.attempt_count}/${job.max_attempts}`,
      updatedAt: job.updated_at,
      finalVideo: job.asset_paths?.finalVideo || null,
      youtubeVideoId: job.youtube_video_id,
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

function printReport(report) {
  console.log('\nDeedLamp Local Operations Report');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Jobs: ${report.totalJobs}`);
  console.log(`States: ${Object.entries(report.byState).map(([state, count]) => `${state}=${count}`).join(', ') || 'none'}`);
  console.log(`Disk: output ${report.diskUsage.durableOutput}, temp ${report.diskUsage.temporaryFiles}, logs ${report.diskUsage.logs}`);
  if (report.recentJobs.length) {
    console.table(report.recentJobs);
  }
  if (report.repeatedFailures.length) {
    console.log('Repeated failures:');
    for (const item of report.repeatedFailures) console.log(`  ${item.count}x ${item.reason}`);
  }
}

const command = process.argv[2] || 'report';
const jsonOutput = process.argv.includes('--json');
const store = new JobStore();

try {
  if (command === 'init') {
    console.log(`SQLite orchestration database ready: ${config.databasePath}`);
  } else if (command === 'report') {
    const report = buildReport(store);
    if (jsonOutput) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
  } else {
    console.error('Usage: node orchestrator.js [init|report] [--json]');
    process.exitCode = 1;
  }
} finally {
  store.close();
}
