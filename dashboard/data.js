import fs from 'fs';
import path from 'path';
import { config } from '../core/config.js';
import { buildReport } from '../core/reporting.js';

const ACTIVE_STATES = new Set(['researching', 'scripted', 'rendering', 'validating', 'uploading']);
const WARNING_STATES = new Set(['retryable_failure', 'blocked', 'needs_review']);

function nextDailyAt(hour, now) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function nextWeeklyAt(dayOfWeek, hour, now) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  let days = (dayOfWeek - next.getDay() + 7) % 7;
  if (days === 0 && next <= now) days = 7;
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

function latestReportArtifact() {
  if (!fs.existsSync(config.reportDir)) return null;
  const files = fs.readdirSync(config.reportDir)
    .filter(name => name.endsWith('.json') || name.endsWith('.md'))
    .map(name => {
      const filePath = path.join(config.reportDir, name);
      return { name, filePath, modifiedAt: fs.statSync(filePath).mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return files[0] || null;
}

function healthForJobs(jobs) {
  if (!jobs.length) return 'idle';
  if (jobs.some(job => ACTIVE_STATES.has(job.state))) return 'working';
  if (jobs[0]?.state === 'failed') return 'critical';
  if (jobs.some(job => WARNING_STATES.has(job.state))) return 'warning';
  return 'healthy';
}

function latestNotification(events, jobId) {
  const event = events.find(item => item.job_id === jobId && ['email_notification', 'failure_notification'].includes(item.to_state));
  return event ? { type: event.to_state, createdAt: event.created_at, ...event.details } : {
    status: 'not_recorded',
    reason: 'No durable email audit event exists for this job.',
  };
}

function validationSummary(validation) {
  if (!validation) return { status: 'not_run' };
  return {
    status: Object.values(validation).every(value => value?.valid !== false) ? 'passed' : 'attention',
    citations: validation.citations ? {
      valid: validation.citations.valid,
      sourceCount: validation.citations.sourceCount,
      claimCount: validation.citations.claimCount,
    } : null,
    transcript: validation.transcript ? {
      valid: validation.transcript.valid,
      wordErrorRate: validation.transcript.wordErrorRate,
      threshold: validation.transcript.threshold,
    } : null,
    media: validation.media?.details || null,
    security: validation.security || null,
    youtube: validation.youtubeUpload?.final || validation.youtubeUploadRecovery?.final || null,
  };
}

function summarizeJob(job, events) {
  const topic = job.metadata?.research?.topic_slug || job.metadata?.uploadIntent?.title || 'Topic not recorded';
  const lastEvent = events.find(event => event.job_id === job.id) || null;
  return {
    id: job.id,
    kind: job.kind,
    agentId: job.kind === 'short' ? 'agentB' : 'agentA',
    topic,
    state: job.state,
    health: healthForJobs([job]),
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    scheduledFor: job.scheduled_for,
    publishAt: job.publish_at,
    nextAttemptAt: job.next_attempt_at,
    attempts: { current: job.attempt_count, maximum: job.max_attempts },
    youtubeVideoId: job.youtube_video_id,
    youtubeUrl: job.youtube_video_id ? `https://youtu.be/${job.youtube_video_id}` : null,
    sourceCount: job.source_urls.length,
    sources: job.source_urls,
    assets: job.asset_paths,
    validation: validationSummary(job.validation_result),
    error: job.error_details ? {
      code: job.error_details.code,
      message: job.error_details.message?.split(/\r?\n/)[0].slice(0, 300),
    } : null,
    notification: latestNotification(events, job.id),
    lastEvent: lastEvent ? {
      type: lastEvent.to_state,
      fromState: lastEvent.from_state,
      createdAt: lastEvent.created_at,
      details: lastEvent.details,
    } : null,
  };
}

function agentSummary({ id, name, purpose, jobs, events }) {
  const uploaded = jobs.find(job => job.youtubeVideoId) || null;
  const active = jobs.filter(job => ACTIVE_STATES.has(job.state));
  const counts = Object.create(null);
  for (const job of jobs) counts[job.state] = (counts[job.state] || 0) + 1;
  return {
    id,
    name,
    purpose,
    health: healthForJobs(jobs),
    totalJobs: jobs.length,
    activeJobs: active,
    stateCounts: counts,
    latestJob: jobs[0] || null,
    lastUploadedVideo: uploaded,
    latestNotification: jobs[0]?.notification || { status: 'not_recorded' },
    recentActivity: events
      .filter(event => jobs.some(job => job.id === event.job_id))
      .slice(0, 8)
      .map(event => ({
        jobId: event.job_id,
        type: event.to_state,
        fromState: event.from_state,
        createdAt: event.created_at,
        details: event.details,
      })),
  };
}

function nextActualSchedule(jobs, kind, now) {
  return jobs
    .filter(job => job.kind === kind)
    .flatMap(job => [
      job.publish_at ? { jobId: job.id, type: 'publish', at: job.publish_at } : null,
      job.scheduled_for ? { jobId: job.id, type: 'production', at: job.scheduled_for } : null,
    ].filter(Boolean))
    .filter(item => new Date(item.at) > now)
    .sort((a, b) => a.at.localeCompare(b.at))[0] || null;
}

export function buildDashboardSnapshot(store, {
  now = new Date(),
  schedulerStatus = {},
} = {}) {
  const rawJobs = store.listJobs({ limit: 500 });
  const events = store.getRecentEvents(300);
  const jobs = rawJobs.map(job => summarizeJob(job, events));
  const shortJobs = jobs.filter(job => job.kind === 'short');
  const longJobs = jobs.filter(job => job.kind === 'long');
  const locks = store.listActiveLocks(now.getTime());
  const report = buildReport(store, { period: 'daily', now });
  const shortActual = nextActualSchedule(rawJobs, 'short', now);
  const longActual = nextActualSchedule(rawJobs, 'long', now);
  const retryTimes = jobs
    .filter(job => job.nextAttemptAt)
    .map(job => job.nextAttemptAt)
    .sort();
  const dueRetryTimes = retryTimes.filter(value => new Date(value) <= now);
  const futureRetryTimes = retryTimes.filter(value => new Date(value) > now);

  const agentA = agentSummary({
    id: 'agentA', name: 'Agent A', purpose: 'Long-form production', jobs: longJobs, events,
  });
  const agentB = agentSummary({
    id: 'agentB', name: 'Agent B', purpose: 'Shorts production', jobs: shortJobs, events,
  });

  const cHealth = locks.length || jobs.some(job => ACTIVE_STATES.has(job.state))
    ? 'working'
    : (jobs.some(job => WARNING_STATES.has(job.state)) ? 'warning' : 'healthy');
  const agentC = {
    id: 'agentC',
    name: 'Agent C',
    purpose: 'Deterministic operations, retries, validation hand-off, and publishing',
    health: cHealth,
    activeLocks: locks,
    dueRetries: jobs.filter(job => job.nextAttemptAt && new Date(job.nextAttemptAt) <= now),
    nextRetryAt: futureRetryTimes[0] || null,
    oldestDueAt: dueRetryTimes[0] || null,
    analyses: events.slice(0, 18).map(event => ({
      jobId: event.job_id,
      kind: event.kind,
      type: event.to_state,
      fromState: event.from_state,
      createdAt: event.created_at,
      details: event.details,
    })),
  };

  const master = {
    id: 'master',
    name: 'Master',
    purpose: 'Read-only operational reporting and root-cause overview',
    health: 'healthy',
    latestReport: latestReportArtifact(),
    repeatedFailures: report.repeatedFailures,
    diskUsage: report.diskUsage,
  };

  const stateCounts = Object.create(null);
  for (const job of jobs) stateCounts[job.state] = (stateCounts[job.state] || 0) + 1;
  return {
    generatedAt: now.toISOString(),
    refreshMs: config.dashboardRefreshMs,
    system: {
      health: [agentA.health, agentB.health, agentC.health].includes('critical') ? 'critical'
        : ([agentA.health, agentB.health, agentC.health].includes('warning') ? 'warning' : 'healthy'),
      database: 'connected',
      localOnly: true,
      billingFallback: false,
      timezone: config.publishTimezone,
      totalJobs: jobs.length,
      activeJobs: jobs.filter(job => ACTIVE_STATES.has(job.state)).length,
      needsAttention: jobs.filter(job => WARNING_STATES.has(job.state) || job.state === 'failed').length,
      published: jobs.filter(job => job.state === 'published').length,
      stateCounts,
      diskUsage: report.diskUsage,
    },
    hierarchy: {
      master,
      agentC,
      agentA,
      agentB,
    },
    schedules: {
      short: {
        label: 'Daily Short',
        candidateRunAt: nextDailyAt(config.publishHourLocal, now),
        actual: shortActual,
        scheduler: schedulerStatus.agentB || { status: 'unknown' },
        note: shortActual ? 'Exact job time from SQLite.' : 'Candidate time only; no future job is scheduled in SQLite.',
      },
      long: {
        label: 'Weekly long-form',
        candidateRunAt: nextWeeklyAt(0, config.publishHourLocal, now),
        actual: longActual,
        scheduler: schedulerStatus.agentA || { status: 'unknown' },
        note: longActual ? 'Exact job time from SQLite.' : 'Candidate Sunday time only; no future job is scheduled in SQLite.',
      },
      retryWorker: {
        dueCount: dueRetryTimes.length,
        oldestDueAt: dueRetryTimes[0] || null,
        nextRetryAt: futureRetryTimes[0] || null,
        candidateCheckAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        scheduler: schedulerStatus.agentC || { status: 'unknown' },
      },
    },
    jobs: jobs.slice(0, 80),
    notifications: events
      .filter(event => ['email_notification', 'failure_notification'].includes(event.to_state))
      .slice(0, 20)
      .map(event => ({ jobId: event.job_id, kind: event.kind, type: event.to_state, createdAt: event.created_at, ...event.details })),
  };
}

export function buildJobDetail(store, jobId) {
  const job = store.getJob(jobId);
  if (!job) return null;
  const events = store.getEvents(jobId, 300);
  const allEvents = events.map(event => ({ ...event, kind: job.kind }));
  return {
    job: summarizeJob(job, allEvents),
    rawValidation: job.validation_result,
    timeline: events,
  };
}
