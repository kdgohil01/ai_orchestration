import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createClient } from 'pexels';
import { NETWORK_TIMEOUT_MS } from './config.js';

function getClient() {
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY is missing.');
  return createClient(process.env.PEXELS_API_KEY);
}

async function fetchVideoUrl(keyword, orientation) {
  const result = await Promise.race([
    getClient().videos.search({ query: keyword, per_page: 5, orientation }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Pexels search timed out.')), NETWORK_TIMEOUT_MS))
  ]);
  if (!result.videos?.length) return null;
  const video = result.videos[Math.floor(Math.random() * result.videos.length)];
  const files = [...(video.video_files || [])].sort((a, b) => (b.width || 0) - (a.width || 0));
  return files.find(file => file.quality === 'hd')?.link || files[0]?.link || null;
}

export async function downloadFile(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Pexels download URL must use HTTPS.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(parsed, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS * 4) });
  if (!response.ok || !response.body) throw new Error(`Pexels download failed with HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 500 * 1024 * 1024) throw new Error('Pexels file exceeds the 500MB safety limit.');
  const temp = `${destination}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp, { flags: 'wx' }));
    const size = fs.statSync(temp).size;
    if (size < 50_000) throw new Error(`Downloaded media is too small (${size} bytes).`);
    fs.renameSync(temp, destination);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch {}
    throw err;
  }
}

export async function fetchAndDownload(keyword, destination, orientation, fallbackAsset = null) {
  try {
    const url = await fetchVideoUrl(keyword, orientation);
    if (url) {
      await downloadFile(url, destination);
      return true;
    }
  } catch (err) {
    console.warn(`Pexels failed for "${keyword}": ${err.message}`);
  }
  if (fallbackAsset && fs.existsSync(fallbackAsset)) {
    fs.copyFileSync(fallbackAsset, destination);
    return true;
  }
  return false;
}
