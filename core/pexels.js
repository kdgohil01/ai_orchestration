// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Pexels B-roll Fetcher
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'pexels';
import fs from 'fs';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const client = createClient(process.env.PEXELS_API_KEY);

/**
 * Fetches an HD video URL from Pexels for a given keyword and orientation.
 * Returns null if nothing is found (caller handles fallback).
 *
 * @param {string} keyword
 * @param {'portrait'|'landscape'} orientation
 * @returns {Promise<string|null>} Video URL or null
 */
async function fetchVideoUrl(keyword, orientation) {
  const res = await client.videos.search({ query: keyword, per_page: 5, orientation });
  if (!res.videos || res.videos.length === 0) return null;

  // Pick randomly from results for visual variety
  const video = res.videos[Math.floor(Math.random() * res.videos.length)];
  return (
    video.video_files.find(f => f.quality === 'hd')?.link ||
    video.video_files[0]?.link ||
    null
  );
}

export function downloadFile(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects while downloading video'));
    }

    const req = https.get(url, response => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, dest, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP Download error: status code ${response.statusCode}`));
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          try {
            const stats = fs.statSync(dest);
            if (stats.size < 50000) { // < 50 KB is suspicious/corrupted for a video clip
              fs.unlinkSync(dest);
              return reject(new Error(`Downloaded file too small (${stats.size} bytes), likely corrupted.`));
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      file.on('error', err => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });

    req.on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * Fetches a video from Pexels for the given keyword and downloads it to destPath.
 * Falls back to the fallbackAsset file if Pexels fails or returns no results.
 *
 * @param {string} keyword
 * @param {string} destPath        - Absolute path to save the downloaded video
 * @param {'portrait'|'landscape'} orientation
 * @param {string|null} fallbackAsset - Path to local fallback video file
 * @returns {Promise<boolean>}     - True if a video was successfully placed at destPath
 */
export async function fetchAndDownload(keyword, destPath, orientation = 'landscape', fallbackAsset = null) {
  try {
    const url = await fetchVideoUrl(keyword, orientation);
    if (url) {
      await downloadFile(url, destPath);
      return true;
    }
  } catch (err) {
    console.warn(`⚠️ Pexels fetch failed for "${keyword}": ${err.message}`);
  }

  if (fallbackAsset && fs.existsSync(fallbackAsset)) {
    fs.copyFileSync(fallbackAsset, destPath);
    console.log(`📁 Fallback applied for: "${keyword}"`);
    return true;
  }

  console.error(`❌ No video available for "${keyword}" and no fallback found.`);
  return false;
}
