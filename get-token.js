import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import open from 'open'; // You can install this using: npm install open
import dotenv from 'dotenv';

dotenv.config();

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Crucial: This tells Google to issue a REFRESH TOKEN
  prompt: 'consent',     // Forces Google to show the consent screen every time
  scope: ['https://www.googleapis.com/auth/youtube.upload']
});

// Start a temporary local server to catch the callback code from the browser
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/oauth2callback')) {
    const q = url.parse(req.url, true).query;

    if (!q.code) {
      res.end('❌ Authorization failed — no code returned. Please try again.');
      server.close();
      console.error('\n❌ No authorization code received. Did you deny access in the browser?');
      process.exit(1);
      return;
    }

    res.end('✅ Authentication successful! You can close this tab now. Copy the token from your terminal.');
    server.close();

    try {
      // Exchange the temporary code for your long-term tokens
      const { tokens } = await oauth2Client.getToken(q.code);
      console.log('\n================ SUCCESS! ================\n');
      console.log('Copy this REFRESH_TOKEN into your .env file:\n');
      console.log(tokens.refresh_token);
      console.log('\n==========================================\n');
      console.log('✅ Now paste the above token as REFRESH_TOKEN in your .env file and restart the automation.');
    } catch (err) {
      console.error('\n❌ Failed to exchange code for token:', err.message);
    }

    process.exit(0);
  }
}).listen(PORT, () => {
    console.log(`✅ Listening on http://localhost:${PORT}`);
    console.log('Opening your browser to authorize your YouTube account...');
    open(authUrl);
});