import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';
import { google } from 'googleapis';
import open from 'open';
import dotenv from 'dotenv';
dotenv.config();

const host = '127.0.0.1';
const port = 3000;
const redirectUri = `http://${host}:${port}/oauth2callback`;
const state = crypto.randomBytes(32).toString('hex');
if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
  throw new Error('CLIENT_ID and CLIENT_SECRET are required in .env.');
}
const oauth = new google.auth.OAuth2(process.env.CLIENT_ID, process.env.CLIENT_SECRET, redirectUri);
const authUrl = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  state,
  scope: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly'
  ]
});

const server = http.createServer(async (request, response) => {
  const callback = new URL(request.url, redirectUri);
  if (callback.pathname !== '/oauth2callback') {
    response.writeHead(404).end('Not found');
    return;
  }
  if (callback.searchParams.get('state') !== state) {
    response.writeHead(403).end('Invalid OAuth state.');
    server.close();
    return;
  }
  const code = callback.searchParams.get('code');
  if (!code) {
    response.writeHead(400).end('Authorization failed.');
    server.close();
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    response.end('Authentication successful. Return to the terminal.');
    console.log('\nStore this value as REFRESH_TOKEN in .env. Do not commit or share it:\n');
    console.log(tokens.refresh_token || '(Google did not return a new refresh token; revoke access and retry.)');
  } catch (err) {
    response.writeHead(500).end('Token exchange failed.');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.on('error', err => {
  console.error(`OAuth callback server failed: ${err.message}`);
  process.exitCode = 1;
});
server.listen(port, host, async () => {
  console.log(`Listening securely on ${redirectUri}`);
  await open(authUrl);
});
setTimeout(() => {
  if (server.listening) {
    console.error('OAuth setup timed out after five minutes.');
    server.close();
    process.exitCode = 1;
  }
}, 5 * 60_000).unref();
