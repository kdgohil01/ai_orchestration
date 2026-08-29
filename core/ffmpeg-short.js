import { PROCESS_TIMEOUT_MS } from './config.js';
import { getMediaDuration, runCommand } from './process.js';

export async function compileShortVideo(videoPaths, audioPath, outputPath) {
  if (!videoPaths.length) throw new Error('No video inputs provided.');
  const audioDuration = await getMediaDuration(audioPath);
  const sceneDuration = (audioDuration / videoPaths.length).toFixed(3);
  const args = ['-y'];
  videoPaths.forEach(video => args.push('-i', video));
  args.push('-i', audioPath);
  let filter = '';
  videoPaths.forEach((_, i) => {
    filter += `[${i}:v]loop=loop=-1:size=300,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,settb=AVTB,trim=duration=${sceneDuration},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}];`;
  });
  videoPaths.forEach((_, i) => { filter += `[v${i}]`; });
  filter += `concat=n=${videoPaths.length}:v=1:a=0[vout]`;
  args.push(
    '-filter_complex', filter, '-map', '[vout]', '-map', `${videoPaths.length}:a`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-t', String(audioDuration), '-pix_fmt', 'yuv420p',
    outputPath
  );
  await runCommand('ffmpeg', args, { timeoutMs: PROCESS_TIMEOUT_MS, inherit: true });
}
