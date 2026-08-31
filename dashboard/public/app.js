const state = {
  snapshot: null,
  selectedAgent: 'master',
  filter: 'all',
  fallbackTimer: null,
};

const el = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function formatDate(value, fallback = 'Not scheduled') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function healthChip(element, health) {
  element.textContent = health || 'unknown';
  element.dataset.health = health || 'unknown';
}

function eventDescription(event) {
  const details = event?.details || {};
  if (details.reason) return String(details.reason).slice(0, 150);
  if (details.error?.code) return `${details.error.code}: ${details.error.message || 'Recorded failure'}`.slice(0, 150);
  if (details.status) return `Notification ${details.status}${details.reason ? ` · ${details.reason}` : ''}`;
  if (details.offsetMs !== undefined) return `YouTube verification at ${Math.round(details.offsetMs / 1000)} seconds`;
  return event.fromState ? `${event.fromState} → ${event.type}` : `Recorded ${event.type}`;
}

function renderMetrics(snapshot) {
  el('metric-health').textContent = snapshot.system.health;
  el('metric-health').dataset.health = snapshot.system.health;
  el('metric-database').textContent = `SQLite ${snapshot.system.database} · local only`;
  el('metric-jobs').textContent = snapshot.system.totalJobs;
  el('metric-active').textContent = `${snapshot.system.activeJobs} active now`;
  el('metric-attention').textContent = snapshot.system.needsAttention;
  el('metric-published').textContent = snapshot.system.published;
  el('metric-storage').textContent = `Output ${snapshot.system.diskUsage.durableOutput}`;
}

function renderHierarchy(snapshot) {
  for (const key of ['master', 'agentC', 'agentA', 'agentB']) {
    healthChip(el(`${key}-health`), snapshot.hierarchy[key].health);
  }
  document.querySelectorAll('.agent-node').forEach(node => {
    node.classList.toggle('is-selected', node.dataset.agent === state.selectedAgent);
  });
}

function renderAgentDetail(snapshot) {
  const agent = snapshot.hierarchy[state.selectedAgent] || snapshot.hierarchy.master;
  el('detail-title').textContent = `${agent.name} overview`;
  healthChip(el('detail-health'), agent.health);
  let html = '';
  if (agent.id === 'agentA' || agent.id === 'agentB') {
    const latest = agent.latestJob;
    const uploaded = agent.lastUploadedVideo;
    html = `<div class="detail-grid">
      <div class="detail-stat"><span>Total jobs</span><strong>${agent.totalJobs}</strong></div>
      <div class="detail-stat"><span>Active now</span><strong>${agent.activeJobs.length}</strong></div>
      <div class="detail-stat"><span>Latest email</span><strong>${escapeHtml(agent.latestNotification.status || 'not recorded')}</strong></div>
      <div class="detail-stat detail-wide"><span>Latest job</span><strong>${latest ? `${escapeHtml(latest.topic)} · ${escapeHtml(latest.state)}` : 'No jobs recorded'}</strong></div>
      <div class="detail-stat detail-wide"><span>Last uploaded video</span><strong>${uploaded ? `${escapeHtml(uploaded.topic)} · ${escapeHtml(uploaded.youtubeVideoId)}` : 'No YouTube upload recorded yet'}</strong></div>
    </div>`;
  } else if (agent.id === 'agentC') {
    const retryLabel = agent.dueRetries.length ? 'Oldest retry due' : 'Next future retry';
    const retryTime = agent.dueRetries.length ? agent.oldestDueAt : agent.nextRetryAt;
    html = `<div class="detail-grid">
      <div class="detail-stat"><span>Active locks</span><strong>${agent.activeLocks.length}</strong></div>
      <div class="detail-stat"><span>Due retries</span><strong>${agent.dueRetries.length}</strong></div>
      <div class="detail-stat"><span>${retryLabel}</span><strong>${escapeHtml(formatDate(retryTime, 'None queued'))}</strong></div>
      <div class="detail-stat detail-wide"><span>Latest analysis</span><strong>${agent.analyses[0] ? escapeHtml(eventDescription(agent.analyses[0])) : 'No events recorded'}</strong></div>
    </div>`;
  } else {
    html = `<div class="detail-grid">
      <div class="detail-stat"><span>Latest report</span><strong>${agent.latestReport ? escapeHtml(agent.latestReport.name) : 'No report artifact yet'}</strong></div>
      <div class="detail-stat"><span>Output storage</span><strong>${escapeHtml(agent.diskUsage.durableOutput)}</strong></div>
      <div class="detail-stat"><span>Repeated causes</span><strong>${agent.repeatedFailures.length}</strong></div>
      <div class="detail-stat detail-wide"><span>Top root cause</span><strong>${agent.repeatedFailures[0] ? escapeHtml(agent.repeatedFailures[0].reason) : 'No repeated failure found'}</strong></div>
    </div>`;
  }
  el('agent-detail').innerHTML = html;
}

function scheduleCard(schedule, kind) {
  const exact = schedule.actual?.at;
  const displayed = exact || schedule.candidateRunAt || schedule.nextRetryAt || schedule.candidateCheckAt;
  const title = schedule.label || (kind === 'retry' ? 'Retry worker' : kind);
  const scheduler = schedule.scheduler || {};
  return `<article class="schedule-card">
    <div><h3>${escapeHtml(title)}</h3><time>${escapeHtml(formatDate(displayed, 'No retry queued'))}</time></div>
    <span class="scheduler-status">${escapeHtml(scheduler.status || 'unknown')}</span>
    <p>${escapeHtml(schedule.note || (schedule.dueCount ? `${schedule.dueCount} retries are already due; oldest due ${formatDate(schedule.oldestDueAt)}.` : schedule.nextRetryAt ? 'Exact next retry from SQLite.' : 'Candidate check in 15 minutes; actual Windows task timing is not confirmed.'))}</p>
  </article>`;
}

function renderSchedules(snapshot) {
  el('schedule-list').innerHTML = [
    scheduleCard(snapshot.schedules.short, 'short'),
    scheduleCard(snapshot.schedules.long, 'long'),
    scheduleCard({ ...snapshot.schedules.retryWorker, label: 'Agent C retry worker' }, 'retry'),
  ].join('');
}

function renderAnalysis(snapshot) {
  const analyses = snapshot.hierarchy.agentC.analyses;
  el('analysis-stream').innerHTML = analyses.length ? analyses.slice(0, 12).map(item => `
    <article class="analysis-item">
      <strong>${escapeHtml(item.type.replaceAll('_', ' '))}</strong>
      <span>${item.kind === 'short' ? 'Agent B' : 'Agent A'} · ${escapeHtml(item.jobId.slice(0, 8))}</span>
      <p>${escapeHtml(eventDescription(item))}</p>
      <time>${escapeHtml(formatDate(item.createdAt))}</time>
    </article>`).join('') : '<div class="empty-state">No Agent C events recorded.</div>';
}

function validationBadges(job) {
  const entries = [
    ['Sources', job.validation.citations?.valid],
    ['Speech', job.validation.transcript?.valid],
    ['Media', Boolean(job.validation.media)],
    ['Secrets', job.validation.security?.valid],
  ];
  return entries.map(([name, valid]) => `<span class="mini-check ${valid ? 'is-pass' : ''}">${escapeHtml(name)} ${valid ? '✓' : '—'}</span>`).join('');
}

function filteredJobs(snapshot) {
  if (state.filter === 'all') return snapshot.jobs;
  if (state.filter === 'attention') return snapshot.jobs.filter(job => ['blocked', 'failed', 'needs_review', 'retryable_failure'].includes(job.state));
  return snapshot.jobs.filter(job => job.kind === state.filter);
}

function renderJobs(snapshot) {
  const jobs = filteredJobs(snapshot);
  el('jobs-body').innerHTML = jobs.length ? jobs.map(job => {
    const attention = ['blocked', 'failed', 'needs_review', 'retryable_failure'].includes(job.state);
    const email = job.notification?.status || 'not recorded';
    return `<tr data-job-id="${escapeHtml(job.id)}" tabindex="0">
      <td><div class="job-topic"><strong>${job.kind === 'short' ? 'B' : 'A'} · ${escapeHtml(job.topic)}</strong><span>${escapeHtml(job.id.slice(0, 12))}</span></div></td>
      <td><span class="state-pill ${attention ? 'is-attention' : ''}">${escapeHtml(job.state.replaceAll('_', ' '))}</span></td>
      <td><div class="validation-stack">${validationBadges(job)}</div></td>
      <td><span class="email-status is-${escapeHtml(email)}">${escapeHtml(email.replaceAll('_', ' '))}</span></td>
      <td>${escapeHtml(formatDate(job.updatedAt))}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5"><div class="empty-state">No jobs match this filter.</div></td></tr>';
}

function renderNotifications(snapshot) {
  const items = snapshot.notifications;
  el('notification-list').innerHTML = items.length ? items.map(item => `
    <article class="notification-item">
      <strong>${item.kind === 'short' ? 'Agent B' : 'Agent A'} · ${escapeHtml(item.status || 'unknown')}</strong>
      <span>${escapeHtml(item.type.replaceAll('_', ' '))} · ${escapeHtml(formatDate(item.createdAt))}</span>
    </article>`).join('') : '<div class="empty-state">No durable email audit event yet. Future upload and meaningful-failure notifications will appear here.</div>';
}

function render(snapshot) {
  state.snapshot = snapshot;
  renderMetrics(snapshot);
  renderHierarchy(snapshot);
  renderAgentDetail(snapshot);
  renderSchedules(snapshot);
  renderAnalysis(snapshot);
  renderJobs(snapshot);
  renderNotifications(snapshot);
  el('last-updated').textContent = `Updated ${formatDate(snapshot.generatedAt)}`;
  el('last-updated').dataset.timestamp = snapshot.generatedAt;
}

function setConnection(mode, label) {
  el('connection-label').textContent = label;
  el('live-dot').className = `live-dot ${mode === 'live' ? 'is-live' : mode === 'error' ? 'is-error' : ''}`;
}

async function fetchSnapshot() {
  const response = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
  render(await response.json());
}

function connectLive() {
  const stream = new EventSource('/api/events');
  stream.addEventListener('snapshot', event => {
    render(JSON.parse(event.data));
    setConnection('live', 'Live from SQLite');
    if (state.fallbackTimer) clearInterval(state.fallbackTimer);
    state.fallbackTimer = null;
  });
  stream.addEventListener('dashboard-error', () => setConnection('error', 'Local data error'));
  stream.onerror = () => {
    setConnection('error', 'Reconnecting');
    if (!state.fallbackTimer) state.fallbackTimer = setInterval(() => fetchSnapshot().catch(() => {}), 5000);
  };
}

async function openJob(jobId) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!response.ok) return;
  const detail = await response.json();
  const job = detail.job;
  el('drawer-title').textContent = `${job.kind === 'short' ? 'Agent B' : 'Agent A'} · ${job.topic}`;
  el('drawer-content').innerHTML = `<div class="forensic-grid">
    <div class="forensic-card"><span>State</span><strong>${escapeHtml(job.state)}</strong></div>
    <div class="forensic-card"><span>Attempts</span><strong>${job.attempts.current} / ${job.attempts.maximum}</strong></div>
    <div class="forensic-card"><span>YouTube</span><strong>${escapeHtml(job.youtubeVideoId || 'Not uploaded')}</strong></div>
    <div class="forensic-card"><span>Email</span><strong>${escapeHtml(job.notification.status || 'not recorded')}</strong></div>
    <div class="forensic-card"><span>Sources</span><strong>${job.sourceCount}</strong></div>
    <div class="forensic-card"><span>Validation</span><strong>${escapeHtml(job.validation.status)}</strong></div>
    <div class="forensic-card"><span>Publish at</span><strong>${escapeHtml(formatDate(job.publishAt))}</strong></div>
    <div class="forensic-card"><span>Next retry</span><strong>${escapeHtml(formatDate(job.nextAttemptAt, 'None'))}</strong></div>
  </div>
  ${job.error ? `<div class="forensic-card"><span>Latest error</span><strong>${escapeHtml(`${job.error.code}: ${job.error.message}`)}</strong></div>` : ''}
  <h3>Agent C timeline</h3>
  <div class="timeline">${detail.timeline.map(item => `<div class="timeline-item">
    <strong>${escapeHtml(item.to_state.replaceAll('_', ' '))}</strong>
    <time>${escapeHtml(formatDate(item.created_at))}</time>
    <pre>${escapeHtml(JSON.stringify(item.details, null, 2))}</pre>
  </div>`).join('')}</div>`;
  const drawer = el('job-drawer');
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  drawer.querySelector('.drawer-close').focus();
}

function closeDrawer() {
  const drawer = el('job-drawer');
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.querySelectorAll('.agent-node').forEach(node => {
  node.addEventListener('click', () => {
    state.selectedAgent = node.dataset.agent;
    if (state.snapshot) { renderHierarchy(state.snapshot); renderAgentDetail(state.snapshot); }
  });
  node.addEventListener('pointermove', event => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = node.getBoundingClientRect();
    const rx = ((event.clientY - rect.top) / rect.height - .5) * -7;
    const ry = ((event.clientX - rect.left) / rect.width - .5) * 9;
    const depth = node.classList.contains('master-node') ? 88 : node.classList.contains('manager-node') ? 56 : 22;
    node.style.transform = `translateZ(${depth}px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  });
  node.addEventListener('pointerleave', () => { node.style.transform = ''; });
});

document.querySelectorAll('.filter-button').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('.filter-button').forEach(item => item.classList.toggle('is-active', item === button));
  if (state.snapshot) renderJobs(state.snapshot);
}));

el('jobs-body').addEventListener('click', event => {
  const row = event.target.closest('[data-job-id]');
  if (row) openJob(row.dataset.jobId);
});
el('jobs-body').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    const row = event.target.closest('[data-job-id]');
    if (row) { event.preventDefault(); openJob(row.dataset.jobId); }
  }
});
document.querySelectorAll('[data-close-drawer]').forEach(item => item.addEventListener('click', closeDrawer));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });

function startDepthField() {
  const canvas = el('depth-field');
  const context = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let stars = [];
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    stars = Array.from({ length: Math.min(170, Math.floor(width * height / 8000)) }, () => ({
      x: (Math.random() - .5) * width,
      y: (Math.random() - .5) * height,
      z: Math.random() * .9 + .1,
      speed: Math.random() * .0014 + .0005,
    }));
  }
  function frame() {
    context.clearRect(0, 0, width, height);
    for (const star of stars) {
      if (!reduced) star.z -= star.speed;
      if (star.z < .08) star.z = 1;
      const scale = 1 / star.z;
      const x = width / 2 + star.x * scale * .45;
      const y = height / 2 + star.y * scale * .45;
      if (x < 0 || x > width || y < 0 || y > height) { star.z = 1; continue; }
      const size = Math.min(2.2, scale * .55);
      context.beginPath();
      context.fillStyle = `rgba(100, 220, 191, ${Math.min(.42, scale * .08)})`;
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();
    }
    if (!reduced) requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  resize();
  frame();
}

startDepthField();
fetchSnapshot().then(() => setConnection('live', 'Live from SQLite')).catch(() => setConnection('error', 'Local API unavailable'));
connectLive();
