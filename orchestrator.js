import path from 'path';
import { spawnSync } from 'child_process';
import { JobStore } from './core/job-store.js';
import { config } from './core/config.js';
import { findUploadByJobReference, verifyYouTubeUpload } from './core/youtube.js';
import { buildReport, writeReport } from './core/reporting.js';

function printReport(report) {
  console.log('\nDeedLamp Local Operations Report');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Jobs: ${report.totalJobs}`);
  console.log(`States: ${Object.entries(report.byState).map(([state, count]) => `${state}=${count}`).join(', ') || 'none'}`);
  console.log(`Next retry: ${report.nextRetryAt || 'none'}`);
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
const writeOutput = process.argv.includes('--write');
const periodArg = process.argv.find(argument => argument.startsWith('--period='));
const reportPeriod = periodArg?.split('=')[1] || 'all';
const store = new JobStore();

try {
  if (command === 'init') {
    console.log(`SQLite orchestration database ready: ${config.databasePath}`);
  } else if (command === 'report') {
    const report = buildReport(store, { period: reportPeriod });
    if (jsonOutput) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    if (writeOutput) {
      const paths = writeReport(report);
      console.log(`Written: ${paths.markdownPath}`);
      console.log(`Written: ${paths.jsonPath}`);
    }
  } else if (command === 'run-due') {
    const dueJobs = store.listDueRetries({ limit: 10 });
    if (!dueJobs.length) console.log('No retryable jobs are due.');
    for (const job of dueJobs) {
      const mode = job.metadata?.mode || 'local-only';
      if ((mode === 'publish' || mode === 'review') && job.metadata?.uploadIntent) {
        store.transition(job.id, 'needs_review', {
          reason: 'Upload-capable retries require manual review to prevent duplicate publication.',
        });
        console.warn(`Job ${job.id} requires manual review before another upload attempt.`);
        continue;
      }
      store.transition(job.id, 'queued', { reason: 'Deterministic retry became due.' });
      const scriptPath = path.join(config.rootDir, job.kind === 'short' ? 'short.js' : 'long.js');
      const modeFlag = mode === 'dry-run' ? '--dry-run' : '--skip-upload';
      const result = spawnSync(process.execPath, [scriptPath, modeFlag, `--job-id=${job.id}`], {
        cwd: config.rootDir,
        stdio: 'inherit',
      });
      if (result.status !== 0) {
        const refreshed = store.getJob(job.id);
        if (refreshed?.state === 'queued') {
          const error = new Error(`Retry worker exited before claiming job ${job.id}.`);
          error.code = 'RETRY_WORKER_START_FAILED';
          store.failJob(job.id, error);
        }
      }
    }
  } else if (command === 'job') {
    const jobId = process.argv[3];
    const job = jobId ? store.getJob(jobId) : null;
    if (!job) {
      console.error('Usage: node orchestrator.js job <job-id>');
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ job, events: store.getEvents(jobId) }, null, 2));
    }
  } else if (command === 'recover-upload') {
    const jobId = process.argv[3];
    let job = jobId ? store.getJob(jobId) : null;
    if (!job || !['uploading', 'blocked', 'needs_review'].includes(job.state)) {
      console.error('Usage: node orchestrator.js recover-upload <uploading|blocked|needs_review-job-id>');
      process.exitCode = 1;
    } else {
      const recoveryOwner = `upload-recovery:${job.id}`;
      if (!store.acquireLock('render_upload', recoveryOwner)) {
        console.warn('Render/upload resource is busy. Upload recovery did not run and no upload was attempted.');
      } else {
        try {
          const recovered = await findUploadByJobReference(job.id);
          if (!recovered) {
            store.recordEvent(job.id, 'upload_recovery_not_found', { checkedAt: new Date().toISOString() });
            console.warn(`No recent YouTube upload contains the durable reference for job ${job.id}. No retry was attempted.`);
          } else {
            store.updateJob(job.id, { youtubeVideoId: recovered.id });
            const verification = await verifyYouTubeUpload(recovered.id, {
              onCheck: check => store.recordEvent(job.id, 'upload_status_check', { ...check, recovery: true }),
            });
            store.updateJob(job.id, {
              validationResult: { ...job.validation_result, youtubeUploadRecovery: verification },
            });
            if (!verification.valid) {
              if (job.state !== 'needs_review') store.transition(job.id, 'needs_review', { reason: 'Recovered upload failed verification.' });
              console.warn(`Recovered video ${recovered.id}, but it still requires review.`);
            } else {
              const shouldPublish = job.metadata?.mode === 'publish' && !verification.needsReview;
              job = store.getJob(job.id);
              if (shouldPublish) {
                if (job.state === 'blocked') job = store.transition(job.id, 'needs_review', { reason: 'Recovered upload found.' });
                if (job.state === 'needs_review' || job.state === 'uploading') store.transition(job.id, 'published', { recoveredVideoId: recovered.id });
              } else if (job.state !== 'needs_review') {
                store.transition(job.id, 'needs_review', { recoveredVideoId: recovered.id });
              }
              console.log(`Recovered YouTube video ${recovered.id} for job ${job.id}.`);
            }
          }
        } finally {
          store.releaseLock('render_upload', recoveryOwner);
        }
      }
    }
  } else {
    console.error('Usage: node orchestrator.js [init|report|run-due|job <job-id>|recover-upload <job-id>] [--json] [--write] [--period=all|daily|weekly]');
    process.exitCode = 1;
  }
} finally {
  store.close();
}
