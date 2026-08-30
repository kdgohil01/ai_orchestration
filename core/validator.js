// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Media Render Integrity Checker
// Verifies FFmpeg output resolution, audio stream, duration, and file size.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';

/**
 * Runs ffprobe on a media file to retrieve metadata.
 * @param {string} filePath
 * @returns {Promise<object>} ffprobe metadata
 */
function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

/**
 * Validates a final rendered video file before publication.
 *
 * @param {string} filePath - Absolute path to rendered MP4
 * @param {'short'|'long'} format - Content format
 * @returns {Promise<{valid: boolean, details: object}>}
 */
export async function validateMediaIntegrity(filePath, format = 'short') {
  console.log(`\n🔍 Verifying media render integrity: ${filePath}`);

  // 1. File existence check
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media validation failed: File does not exist at '${filePath}'`);
  }

  // 2. Non-zero size check (> 500 KB)
  const stats = fs.statSync(filePath);
  const sizeKb = Math.round(stats.size / 1024);
  if (sizeKb < 500) {
    throw new Error(`Media validation failed: Rendered file size is too small (${sizeKb} KB). Likely corrupted output.`);
  }

  // 3. ffprobe metadata verification
  let metadata;
  try {
    metadata = await probeMedia(filePath);
  } catch (err) {
    throw new Error(`Media validation failed: ffprobe could not parse video metadata — ${err.message}`);
  }

  const streams = metadata.streams || [];
  const videoStream = streams.find(s => s.codec_type === 'video');
  const audioStream = streams.find(s => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('Media validation failed: Output video stream missing.');
  }

  if (!audioStream) {
    throw new Error('Media validation failed: Output audio stream missing.');
  }

  const duration = parseFloat(metadata.format?.duration || videoStream.duration || 0);
  if (duration <= 0) {
    throw new Error(`Media validation failed: Invalid video duration (${duration}s).`);
  }

  const width = videoStream.width;
  const height = videoStream.height;

  // 4. Resolution check
  if (format === 'short') {
    if (width !== 1080 || height !== 1920) {
      throw new Error(`Media validation failed: Short resolution is ${width}x${height}; required 1080x1920.`);
    }
    if (duration > 60) throw new Error(`Media validation failed: Short duration is ${duration}s; configured maximum is 60s.`);
  } else if (format === 'long') {
    if (width !== 1920 || height !== 1080) {
      throw new Error(`Media validation failed: Long-form resolution is ${width}x${height}; required 1920x1080.`);
    }
    if (duration < 210 || duration > 270) {
      throw new Error(`Media validation failed: Long-form duration is ${duration}s; required range is 210–270s.`);
    }
  }

  const details = {
    filePath,
    sizeKb,
    duration: Math.round(duration * 10) / 10,
    width,
    height,
    hasAudio: true,
    codecVideo: videoStream.codec_name,
    codecAudio: audioStream.codec_name
  };

  console.log(`✅ Media Render Integrity Verified!`);
  console.log(`   Resolution: ${width}x${height} | Duration: ${details.duration}s | Size: ${sizeKb} KB`);
  return { valid: true, details };
}
