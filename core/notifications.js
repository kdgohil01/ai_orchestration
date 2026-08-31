import nodemailer from 'nodemailer';
import { config } from './config.js';
import { safeErrorDetails } from './security.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendOperationalEmail({ subject, html, transportFactory = nodemailer.createTransport } = {}) {
  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS?.replace(/\s+/g, '');
  const attemptedAt = new Date().toISOString();
  if (!emailUser || !emailPass) {
    return { status: 'skipped', attemptedAt, reason: 'email_not_configured' };
  }

  try {
    const transporter = transportFactory({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    const result = await transporter.sendMail({
      from: `"DeedLamp Automation" <${emailUser}>`,
      to: emailUser,
      subject,
      html,
    });
    return {
      status: 'sent',
      attemptedAt,
      sentAt: new Date().toISOString(),
      messageId: result?.messageId || null,
    };
  } catch (error) {
    const safe = safeErrorDetails(error);
    return { status: 'failed', attemptedAt, reason: safe.code, message: safe.message };
  }
}

export async function sendUploadNotification({ title, link, publishAt, type, humanReview }) {
  const label = humanReview
    ? 'Draft Upload for Review'
    : (type === 'short' ? 'Short Scheduled' : 'Mini-Doc Scheduled');
  const publishLocal = new Date(publishAt).toLocaleString('en-IN', { timeZone: config.publishTimezone });
  const statusText = humanReview ? 'Private Draft (Pending Human Review)' : `Scheduled for ${publishLocal}`;
  return sendOperationalEmail({
    subject: `${label}: ${title}`,
    html: `<div style="font-family:sans-serif;padding:24px;border:1px solid #e0e0e0;border-radius:10px;max-width:520px">
      <h2>${escapeHtml(label)}</h2>
      <p><strong>Title:</strong> ${escapeHtml(title)}</p>
      <p><strong>Status:</strong> ${escapeHtml(statusText)}</p>
      <p><strong>Watch link:</strong> <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
      <p style="font-size:12px;color:#777">Processed locally by DeedLamp Automation.</p>
    </div>`,
  });
}

export async function sendFailureNotification({ job, error }) {
  if (!job || !['blocked', 'failed', 'needs_review'].includes(job.state)) {
    return { status: 'not_required', attemptedAt: new Date().toISOString(), reason: 'retryable_or_nonterminal_state' };
  }
  const safe = safeErrorDetails(error);
  return sendOperationalEmail({
    subject: `DeedLamp ${job.state}: ${job.kind} job ${job.id}`,
    html: `<div style="font-family:sans-serif;padding:24px;border:1px solid #e0e0e0;border-radius:10px;max-width:520px">
      <h2>Manual attention may be required</h2>
      <p><strong>Job:</strong> ${escapeHtml(job.id)}</p>
      <p><strong>Agent:</strong> ${escapeHtml(job.kind === 'short' ? 'B — Shorts' : 'A — Long-form')}</p>
      <p><strong>State:</strong> ${escapeHtml(job.state)}</p>
      <p><strong>Reason:</strong> ${escapeHtml(`${safe.code}: ${safe.message}`)}</p>
      <p>No paid fallback or automatic upload retry was enabled.</p>
    </div>`,
  });
}
