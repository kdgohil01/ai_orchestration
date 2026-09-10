// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Long-Form FFmpeg Pipeline
// Target: 1920×1080 (16:9 landscape), 30fps, H.264, 8-scene concat + logo overlay
// ─────────────────────────────────────────────────────────────────────────────

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { configureFluentFfmpeg } from './media-tools.js';

configureFluentFfmpeg(ffmpeg);

// Logo is searched in both /assets/ and root for backward compatibility
function findLogo() {
  const candidates = [
    path.resolve('assets/logo.png'),
    path.resolve('logo.png')
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

/**
 * Compiles multiple landscape video clips and an audio track into a
 * single uncaptioned long-form video. Overlays the channel logo if present.
 *
 * @param {string[]} videoPaths - Ordered array of local scene video paths (8 recommended)
 * @param {string}   audioPath  - Path to the full voiceover MP3
 * @param {string}   outputPath - Path for the compiled output video
 * @returns {Promise<void>}
 */
/**
 * Gets exact duration of an audio file in seconds via ffprobe.
 * @param {string} audioPath
 * @returns {Promise<number>}
 */
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      const dur = parseFloat(metadata.format?.duration || 0);
      if (dur <= 0) return reject(new Error(`Invalid audio duration: ${dur}`));
      resolve(dur);
    });
  });
}

/**
 * Compiles multiple landscape video clips and an audio track into a
 * single uncaptioned long-form video. Overlays the channel logo if present.
 *
 * @param {string[]} videoPaths - Ordered array of local scene video paths (8 recommended)
 * @param {string}   audioPath  - Path to the full voiceover MP3
 * @param {string}   outputPath - Path for the compiled output video
 * @returns {Promise<void>}
 */
export async function compileLongVideo(videoPaths, audioPath, outputPath) {
  if (!videoPaths.length) throw new Error('No video inputs provided');

  const audioDuration = await getAudioDuration(audioPath);
  const sceneDuration = (audioDuration / videoPaths.length).toFixed(3);
  console.log(`⏱️ Long audio duration: ${audioDuration}s | Per-scene target duration: ${sceneDuration}s (${videoPaths.length} scenes)`);

  return new Promise((resolve, reject) => {
    const logoPath = findLogo();
    let proc = ffmpeg();
    videoPaths.forEach(v => { proc = proc.input(v); });
    proc = proc.input(audioPath);

    // Scale each clip to fit 1920×1080 with letterbox/pillarbox, force 30fps, trim to sceneDuration, reset PTS
    let filter = '';
    videoPaths.forEach((_, i) => {
      filter += `[${i}:v]loop=loop=-1:size=300,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,settb=AVTB,trim=duration=${sceneDuration},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}];`;
    });
    videoPaths.forEach((_, i) => { filter += `[v${i}]`; });
    filter += `concat=n=${videoPaths.length}:v=1:a=0[vct]`;

    let mapVideo = '[vct]';

    if (logoPath) {
      proc = proc.input(logoPath.replace(/\\/g, '/'));
      const logoIdx = videoPaths.length + 1;
      filter += `;[vct][${logoIdx}:v]overlay=W-w-20:20[vfinal]`;
      mapVideo = '[vfinal]';
      console.log(`🏷️ Logo overlay applied from: ${logoPath}`);
    }

    proc.outputOptions([
      '-filter_complex', filter,
      '-map', mapVideo,
      '-map', `${videoPaths.length}:a`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', String(audioDuration),
      '-pix_fmt', 'yuv420p'
    ])
    .save(outputPath)
    .on('stderr', line => { if (/error|invalid|failed/i.test(line)) console.error('FFmpeg stderr:', line); })
    .on('end', resolve)
    .on('error', err => {
      console.error('FFmpeg long compile failed:', err.message);
      reject(err);
    });
  });
}
