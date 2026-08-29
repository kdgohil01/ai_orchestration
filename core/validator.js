import fs from 'fs';
import { getMediaDuration, probeMedia } from './process.js';

const TARGETS = {
  short: { width: 1080, height: 1920, minDuration: 18, maxDuration: 32 },
  long: { width: 1920, height: 1080, minDuration: 210, maxDuration: 270 }
};

export async function validateNarrationDuration(filePath, format) {
  const target = TARGETS[format];
  if (!target) throw new Error(`Unknown format: ${format}`);
  const duration = await getMediaDuration(filePath);
  if (duration < target.minDuration || duration > target.maxDuration) {
    throw new Error(`${format} narration duration ${duration.toFixed(1)}s is outside ${target.minDuration}-${target.maxDuration}s.`);
  }
  return duration;
}

export async function validateMediaIntegrity(filePath, format = 'short') {
  if (!fs.existsSync(filePath)) throw new Error(`Rendered file does not exist: ${filePath}`);
  const sizeKb = Math.round(fs.statSync(filePath).size / 1024);
  if (sizeKb < 500) throw new Error(`Rendered file is suspiciously small: ${sizeKb}KB.`);
  const metadata = await probeMedia(filePath);
  const video = (metadata.streams || []).find(stream => stream.codec_type === 'video');
  const audio = (metadata.streams || []).find(stream => stream.codec_type === 'audio');
  if (!video || !audio) throw new Error('Rendered file must contain both video and audio streams.');
  const duration = Number.parseFloat(metadata.format?.duration || video.duration || 0);
  const target = TARGETS[format];
  if (video.width !== target.width || video.height !== target.height) {
    throw new Error(`Invalid ${format} resolution ${video.width}x${video.height}; expected ${target.width}x${target.height}.`);
  }
  if (duration < target.minDuration || duration > target.maxDuration) {
    throw new Error(`Rendered ${format} duration ${duration.toFixed(1)}s is outside ${target.minDuration}-${target.maxDuration}s.`);
  }
  return {
    valid: true,
    details: {
      filePath, sizeKb, duration: Math.round(duration * 10) / 10,
      width: video.width, height: video.height, hasAudio: true,
      codecVideo: video.codec_name, codecAudio: audio.codec_name
    }
  };
}
