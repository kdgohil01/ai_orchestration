// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — YouTube Upload + Scheduled Publishing + Dry-Run & Review Modes
// ─────────────────────────────────────────────────────────────────────────────

import { google } from 'googleapis';
import fs from 'fs';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Computes the next 18:00 local time as an ISO string.
 * If the current time is already past 18:00 today, schedules for 18:00 tomorrow.
 * YouTube requires publishAt to be at least 5 minutes in the future.
 */
function getPublishAt() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(18, 0, 0, 0);

  // If we've passed 17:55 today, push to tomorrow
  if (now >= new Date(target.getTime() - 5 * 60 * 1000)) {
    target.setDate(target.getDate() + 1);
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
  humanReview = false
}) {
  const publishAt = getPublishAt();
  const chaptersText = formatChapters(chapters);
  const fullDescription = `${description}${chaptersText}`;

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
      simulated: true
    };
  }

  // ── Real Upload ─────────────────────────────────────────────────────────────
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  // Status configuration: humanReview mode sets private without publishAt for manual approval
  const statusConfig = humanReview
    ? { privacyStatus: 'private', selfDeclaredMadeForKids: false }
    : { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false };

  const response = await youtube.videos.insert({
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

  const videoId = response.data.id;
  const link = `https://youtu.be/${videoId}`;
  
  if (humanReview) {
    console.log(`🎉 Uploaded as PRIVATE DRAFT for Human Review!`);
    console.log(`   Video ID: ${videoId} | Link: ${link}`);
  } else {
    const publishLocal = new Date(publishAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`🎉 Uploaded! Scheduled → ${publishLocal}`);
    console.log(`   Link: ${link}`);
  }

  await sendEmail({ title, link, publishAt, type, humanReview });
  return { videoId, link, publishAt };
}

async function sendEmail({ title, link, publishAt, type, humanReview }) {
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS?.replace(/\s+/g, '');
  if (!emailUser || !emailPass) {
    console.warn('⚠️ Email skipped: EMAIL_USER or EMAIL_PASS missing.');
    return;
  }

  const label = humanReview
    ? `📝 Draft Upload for Review`
    : (type === 'short' ? '📱 Short Scheduled' : '🎥 Mini-Doc Scheduled');

  const publishLocal = new Date(publishAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass }
    });

    await transporter.sendMail({
      from: `"DeedLamp Automation" <${emailUser}>`,
      to: emailUser,
      subject: `📅 ${label}: ${title}`,
      html: `
        <div style="font-family: sans-serif; padding: 24px; border: 1px solid #e0e0e0; border-radius: 10px; max-width: 520px;">
          <h2 style="color: #1565c0; margin-top: 0;">${label}</h2>
          <p><strong>Title:</strong> ${title}</p>
          <p><strong>Status:</strong> ${humanReview ? 'Private Draft (Pending Human Review)' : `Scheduled for ${publishLocal} (IST)`}</p>
          <p><strong>Watch link:</strong><br>
             <a href="${link}" style="color: #1e88e5; font-weight: bold;">${link}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
          <p style="font-size: 12px; color: #999; font-style: italic;">
            Processed by DeedLamp Automation — The Weird Archivist
          </p>
        </div>
      `
    });
    console.log('✅ Telemetry notification email sent.');
  } catch (err) {
    console.warn('⚠️ Email delivery failed (upload still succeeded):', err.message);
  }
}
