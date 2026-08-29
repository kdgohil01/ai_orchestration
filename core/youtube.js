import fs from 'fs';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { NETWORK_TIMEOUT_MS, PUBLISH_HOUR, PUBLISH_TIMEZONE } from './config.js';

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function zoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedDateTimeToUtc(parts, timeZone) {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0, 0);
  let result = new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
  result = new Date(guess - zoneOffsetMs(result, timeZone));
  return result;
}

export function getPublishAt(now = new Date(), timeZone = PUBLISH_TIMEZONE, hour = PUBLISH_HOUR) {
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

function formatChapters(chapters) {
  return Array.isArray(chapters) && chapters.length
    ? `\n\n${chapters.map(chapter => `${chapter.timestamp} ${chapter.label}`).join('\n')}`
    : '';
}

function authClient() {
  const client = new google.auth.OAuth2(
    process.env.CLIENT_ID, process.env.CLIENT_SECRET, 'http://127.0.0.1:3000/oauth2callback'
  );
  client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
  return client;
}

export async function uploadToYouTube({
  videoPath, title, description, tags, categoryId = '27', chapters = null,
  type = 'long', dryRun = false, humanReview = true
}) {
  if (!fs.existsSync(videoPath)) throw new Error(`Upload file is missing: ${videoPath}`);
  const publishAt = humanReview ? null : getPublishAt();
  const fullDescription = `${description}${formatChapters(chapters)}`;
  if (dryRun) {
    return {
      videoId: `simulated_${Date.now()}`, link: null, publishAt,
      simulated: true, status: humanReview ? 'review-simulation' : 'publish-simulation'
    };
  }
  const youtube = google.youtube({ version: 'v3', auth: authClient() });
  const status = humanReview
    ? { privacyStatus: 'private', selfDeclaredMadeForKids: false }
    : { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false };
  const response = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: { snippet: { title, description: fullDescription, categoryId, tags }, status },
    media: { body: fs.createReadStream(videoPath) }
  }, { timeout: NETWORK_TIMEOUT_MS * 10 });
  const videoId = response.data.id;
  if (!videoId) throw new Error('YouTube upload returned no video ID.');
  const link = `https://youtu.be/${videoId}`;
  await sendEmail({ title, link, publishAt, type, humanReview });
  return { videoId, link, publishAt, status: humanReview ? 'private-review' : 'scheduled' };
}

async function sendEmail({ title, link, publishAt, type, humanReview }) {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.replace(/\s+/g, '');
  if (!user || !pass) return;
  const label = humanReview ? 'Draft ready for review' : (type === 'short' ? 'Short scheduled' : 'Mini-documentary scheduled');
  const timing = humanReview
    ? 'Private draft - review it in YouTube Studio before publishing.'
    : `Scheduled for ${new Date(publishAt).toLocaleString('en-IN', { timeZone: PUBLISH_TIMEZONE })} (${PUBLISH_TIMEZONE}).`;
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  try {
    await transporter.sendMail({
      from: `"DeedLamp Automation" <${user}>`, to: user,
      subject: `${label}: ${title}`,
      text: `${title}\n${timing}\n${link}`
    });
  } catch (err) {
    console.warn(`Upload succeeded, but email failed: ${err.message}`);
  }
}

export function createYoutubeAuthClientForAnalytics() { return authClient(); }
