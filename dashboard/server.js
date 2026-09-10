import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { config } from '../core/config.js';
import { JobStore } from '../core/job-store.js';
import { safeErrorDetails } from '../core/security.js';
import { buildDashboardSnapshot, buildJobDetail } from './data.js';
import { inspectSchedulerTasks } from './scheduler-status.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(MODULE_DIR, 'public');
const STATIC_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
});

function commonHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, commonHeaders('application/json; charset=utf-8'));
  response.end(JSON.stringify(value));
}

export function createDashboardServer({
  host = '127.0.0.1',
  port = config.dashboardPort,
  databasePath = config.databasePath,
  refreshMs = config.dashboardRefreshMs,
  schedulerInspector = inspectSchedulerTasks,
} = {}) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Dashboard server may bind only to the local loopback interface.');
  }
  const store = new JobStore(databasePath);
  const clients = new Set();
  let schedulerStatus = schedulerInspector();
  let lastSchedulerRefresh = Date.now();

  function snapshot() {
    if (Date.now() - lastSchedulerRefresh > 60_000) {
      schedulerStatus = schedulerInspector();
      lastSchedulerRefresh = Date.now();
    }
    return buildDashboardSnapshot(store, { schedulerStatus });
  }

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${host}:${port}`);
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });

    if (requestUrl.pathname === '/api/health') {
      return sendJson(response, 200, { status: 'ok', localOnly: true, generatedAt: new Date().toISOString() });
    }
    if (requestUrl.pathname === '/api/dashboard') {
      try { return sendJson(response, 200, snapshot()); }
      catch (error) { return sendJson(response, 500, { error: safeErrorDetails(error) }); }
    }
    if (requestUrl.pathname.startsWith('/api/jobs/')) {
      const jobId = decodeURIComponent(requestUrl.pathname.slice('/api/jobs/'.length));
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(jobId)) return sendJson(response, 400, { error: 'invalid_job_id' });
      const detail = buildJobDetail(store, jobId);
      return detail ? sendJson(response, 200, detail) : sendJson(response, 404, { error: 'job_not_found' });
    }
    if (requestUrl.pathname === '/api/events') {
      response.writeHead(200, {
        ...commonHeaders('text/event-stream; charset=utf-8'),
        connection: 'keep-alive',
      });
      response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }

    const staticFile = STATIC_FILES[requestUrl.pathname];
    if (staticFile) {
      response.writeHead(200, commonHeaders(staticFile[1]));
      return fs.createReadStream(path.join(PUBLIC_DIR, staticFile[0])).pipe(response);
    }
    return sendJson(response, 404, { error: 'not_found' });
  });

  const liveTimer = setInterval(() => {
    if (!clients.size) return;
    let data;
    try { data = `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`; }
    catch (error) { data = `event: dashboard-error\ndata: ${JSON.stringify(safeErrorDetails(error))}\n\n`; }
    for (const client of clients) client.write(data);
  }, refreshMs);

  server.on('close', () => {
    clearInterval(liveTimer);
    for (const client of clients) client.end();
    clients.clear();
    store.close();
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dashboard = createDashboardServer();
  const address = await dashboard.listen();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`DeedLamp local dashboard: ${url}`);
  console.log('Live data: SQLite + local server-sent events. Press Ctrl+C to stop.');
  if (process.argv.includes('--open')) await open(url);
}
