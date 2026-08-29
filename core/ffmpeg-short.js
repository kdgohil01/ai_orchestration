// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Short-Form FFmpeg Pipeline
// Target: 1080×1920 (9:16 vertical), 30fps, H.264, multi-scene concat
// ─────────────────────────────────────────────────────────────────────────────

import ffmpeg from 'fluent-ffmpeg';

/**
 * Compiles multiple portrait video clips and an audio track into a
 * single uncaptioned short-form video.
 *
 * @param {string[]} videoPaths - Ordered array of local scene video paths
 * @param {string}   audioPath  - Path to the voiceover MP3
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
 * Compiles multiple portrait video clips and an audio track into a
 * single uncaptioned short-form video.
 *
 * @param {string[]} videoPaths - Ordered array of local scene video paths
 * @param {string}   audioPath  - Path to the voiceover MP3
 * @param {string}   outputPath - Path for the compiled output video
 * @returns {Promise<void>}
 */
export async function compileShortVideo(videoPaths, audioPath, outputPath) {
  if (!videoPaths.length) throw new Error('No video inputs provided');

  const audioDuration = await getAudioDuration(audioPath);
  const sceneDuration = (audioDuration / videoPaths.length).toFixed(3);
  console.log(`⏱️ Audio duration: ${audioDuration}s | Per-scene target duration: ${sceneDuration}s (${videoPaths.length} scenes)`);

  return new Promise((resolve, reject) => {
    let proc = ffmpeg();
    videoPaths.forEach(v => { proc = proc.input(v); });
    proc = proc.input(audioPath);

    // Filter pipeline: loop short clips, scale/crop to 1080x1920, force 30fps, trim to exact sceneDuration, reset PTS
    let filter = '';
    videoPaths.forEach((_, i) => {
      filter += `[${i}:v]loop=loop=-1:size=300,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,settb=AVTB,trim=duration=${sceneDuration},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}];`;
    });
    videoPaths.forEach((_, i) => { filter += `[v${i}]`; });
    filter += `concat=n=${videoPaths.length}:v=1:a=0[vout]`;

    proc.outputOptions([
      '-filter_complex', filter,
      '-map', '[vout]',
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
      console.error('FFmpeg short compile failed:', err.message);
      reject(err);
    });
  });
}
