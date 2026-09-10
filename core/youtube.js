// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — YouTube Upload + Scheduled Publishing + Dry-Run & Review Modes
// ─────────────────────────────────────────────────────────────────────────────

import { google } from 'googleapis';
import fs from 'fs';
import { config } from './config.js';
import { verifyUploadAtIntervals } from './youtube-verification.js';
import { sendUploadNotification } from './notifications.js';

const JOB_REFERENCE_PREFIX = 'Automation reference:';

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function zoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedDateTimeToUtc(parts, timeZone) {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0, 0);
  let result = new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
  result = new Date(guess - zoneOffsetMs(result, timeZone));
  return result;
}

function classifyYouTubeError(error, { uploadStarted = false } = {}) {
  const message = error?.message || '';
  if (/quota|dailyLimitExceeded|uploadLimitExceeded|rateLimitExceeded|429/i.test(message)) {
    error.code = 'YOUTUBE_FREE_QUOTA_EXHAUSTED';
    error.isQuotaBlocked = true;
  } else if (/invalid.?grant|unauthorized|forbidden|401|403/i.test(message)) {
    error.code = error.code || 'YOUTUBE_AUTH_FAILED';
    error.isBlocked = true;
  } else if (uploadStarted) {
    error.code = error.code || 'YOUTUBE_UPLOAD_AMBIGUOUS';
    error.isUploadAmbiguous = true;
  }
  return error;
}

export function createYoutubeAuthClientForAnalytics() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
  return oauth2Client;
}

export function createYouTubeClient() {
  return google.youtube({ version: 'v3', auth: createYoutubeAuthClientForAnalytics() });
}

/**
 * Computes the next 18:00 local time as an ISO string.
 * If the current time is already past 18:00 today, schedules for 18:00 tomorrow.
 * YouTube requires publishAt to be at least 5 minutes in the future.
 */
export function getPublishAt(now = new Date(), timeZone = config.publishTimezone, hour = config.publishHourLocal) {
  const local = zonedParts(now, timeZone);
  let day = { year: local.year, month: local.month, day: local.day };
  let target = zonedDateTimeToUtc({ ...day, hour, minute: 0 }, timeZone);
  if (now.getTime() >= target.getTime() - 5 * 60_000) {
    const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
    day = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
    target = zonedDateTimeToUtc({ ...day, hour, minute: 0 }, timeZone);
  }
  return target.toISOString();
}

/**
 * Formats chapter timestamps from ACT objects into a description block.
 * @param {Array<{label: string, timestamp: string}>} chapters
 * @returns {string}
 */
function formatChapters(chapters) {
  if (!chapters || !chapters.length) return '';
  return '\n\n' + chapters.map(c => `${c.timestamp} ${c.label}`).join('\n');
}

/**
 * Uploads a video to YouTube with scheduled publishing at 18:00 local time.
 * Supports --dry-run (simulation) and --review (private draft without publishAt).
 *
 * @param {object} opts
 * @param {string}   opts.videoPath   - Path to the final rendered MP4
 * @param {string}   opts.title       - Video title
 * @param {string}   opts.description - Base description (chapters appended if provided)
 * @param {string[]} opts.tags        - Tag array
 * @param {string}   opts.categoryId  - YouTube category ID (default: '27' = Education)
 * @param {Array}    opts.chapters    - Optional chapter markers for long-form
 * @param {string}   opts.type        - 'short' or 'long' (for email label only)
 * @param {boolean}  [opts.dryRun=false] - Simulation mode (skips real API upload)
 * @param {boolean}  [opts.humanReview=false] - Uploads as private draft without auto-publish
 * @param {string}   opts.jobId - Durable local job reference embedded for recovery
 * @returns {Promise<{videoId: string, link: string, publishAt: string, simulated?: boolean}>}
 */
export async function uploadToYouTube({
  videoPath,
  title,
  description,
  tags,
  categoryId = '27',
  chapters = null,
  type = 'long',
  dryRun = false,
  humanReview = false,
  jobId
}) {
  if (!dryRun && !jobId) throw new Error('Live/review YouTube upload requires a durable jobId.');
  const publishAt = getPublishAt();
  const chaptersText = formatChapters(chapters);
  const jobReference = jobId ? `\n\n${JOB_REFERENCE_PREFIX} ${jobId}` : '';
  const fullDescription = `${description}${chaptersText}${jobReference}`;

  // ── Dry-Run Simulation Mode ────────────────────────────────────────────────
  if (dryRun) {
    console.log('\n🧪 [DRY-RUN SIMULATION] Skipping real YouTube API upload.');
    console.log(`   Title        : ${title}`);
    console.log(`   Category ID  : ${categoryId} (Education)`);
    console.log(`   Tags Count   : ${tags.length}`);
    console.log(`   Video File   : ${videoPath} (${Math.round(fs.statSync(videoPath).size / 1024)} KB)`);
    console.log(`   Schedule At  : ${publishAt}`);
    console.log(`   Description  : ${fullDescription.slice(0, 150)}...`);

    const simId = `simulated_${Date.now()}`;
    const simLink = `https://youtu.be/${simId}`;
    return {
      videoId: simId,
      link: simLink,
      publishAt,
      simulated: true,
      notification: {
        status: 'not_applicable',
        attemptedAt: new Date().toISOString(),
        reason: 'dry_run',
      },
    };
  }

  // ── Real Upload ─────────────────────────────────────────────────────────────
  const youtube = createYouTubeClient();

  // Status configuration: humanReview mode sets private without publishAt for manual approval
  const statusConfig = humanReview
    ? { privacyStatus: 'private', selfDeclaredMadeForKids: false }
    : { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false };

  let response;
  try {
    response = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title,
          description: fullDescription,
          categoryId,
          tags
        },
        status: statusConfig
      },
      media: { body: fs.createReadStream(videoPath) }
    });
  } catch (error) {
    throw classifyYouTubeError(error, { uploadStarted: true });
  }

  const videoId = response.data.id;
  const link = `https://youtu.be/${videoId}`;
  
  if (humanReview) {
    console.log(`🎉 Uploaded as PRIVATE DRAFT for Human Review!`);
    console.log(`   Video ID: ${videoId} | Link: ${link}`);
  } else {
    const publishLocal = new Date(publishAt).toLocaleString('en-IN', { timeZone: config.publishTimezone });
    console.log(`🎉 Uploaded! Scheduled → ${publishLocal}`);
    console.log(`   Link: ${link}`);
  }

  const notification = await sendUploadNotification({ title, link, publishAt, type, humanReview });
  if (notification.status === 'sent') console.log('✅ Upload notification email sent.');
  else console.warn(`⚠️ Upload notification email ${notification.status}: ${notification.reason || 'unknown reason'}`);
  return { videoId, link, publishAt, notification };
}

export async function verifyYouTubeUpload(videoId, { onCheck = async () => {}, offsetsMs, sleepFn } = {}) {
  const youtube = createYouTubeClient();
  return verifyUploadAtIntervals({
    videoId,
    offsetsMs,
    sleepFn,
    onCheck,
    fetchStatus: async id => {
      try {
        const response = await youtube.videos.list({ part: 'status,processingDetails', id: [id] });
        return response.data.items?.[0] || null;
      } catch (error) {
        throw classifyYouTubeError(error);
      }
    },
  });
}

export async function findUploadByJobReference(jobId) {
  if (!jobId) throw new Error('Upload recovery requires a job ID.');
  const youtube = createYouTubeClient();
  try {
    const channelResponse = await youtube.channels.list({ part: 'contentDetails', mine: true });
    const uploadsPlaylist = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) return null;
    const playlistResponse = await youtube.playlistItems.list({
      part: 'contentDetails',
      playlistId: uploadsPlaylist,
      maxResults: 50,
    });
    const videoIds = (playlistResponse.data.items || []).map(item => item.contentDetails?.videoId).filter(Boolean);
    if (!videoIds.length) return null;
    const videosResponse = await youtube.videos.list({
      part: 'snippet,status,processingDetails',
      id: videoIds,
    });
    const marker = `${JOB_REFERENCE_PREFIX} ${jobId}`;
    return (videosResponse.data.items || []).find(video => video.snippet?.description?.includes(marker)) || null;
  } catch (error) {
    throw classifyYouTubeError(error);
  }
}
