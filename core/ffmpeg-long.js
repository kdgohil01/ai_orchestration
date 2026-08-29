import fs from 'fs';
import { PROCESS_TIMEOUT_MS, projectPath } from './config.js';
import { getMediaDuration, runCommand } from './process.js';

function findLogo() {
  const candidates = [projectPath('assets', 'logo.png'), projectPath('logo.png')];
  return candidates.find(item => fs.existsSync(item)) || null;
}

export async function compileLongVideo(videoPaths, audioPath, outputPath) {
  if (!videoPaths.length) throw new Error('No video inputs provided.');
  const audioDuration = await getMediaDuration(audioPath);
  const sceneDuration = (audioDuration / videoPaths.length).toFixed(3);
  const logoPath = findLogo();
  const args = ['-y'];
  videoPaths.forEach(video => args.push('-i', video));
  args.push('-i', audioPath);
  if (logoPath) args.push('-loop', '1', '-i', logoPath);
  let filter = '';
  videoPaths.forEach((_, i) => {
    filter += `[${i}:v]loop=loop=-1:size=300,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,settb=AVTB,trim=duration=${sceneDuration},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}];`;
  });
  videoPaths.forEach((_, i) => { filter += `[v${i}]`; });
  filter += `concat=n=${videoPaths.length}:v=1:a=0[vct]`;
  let videoMap = '[vct]';
  if (logoPath) {
    const logoIndex = videoPaths.length + 1;
    filter += `;[${logoIndex}:v]scale=160:-1[logo];[vct][logo]overlay=W-w-24:24:eof_action=repeat[vfinal]`;
    videoMap = '[vfinal]';
  }
  args.push(
    '-filter_complex', filter, '-map', videoMap, '-map', `${videoPaths.length}:a`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-t', String(audioDuration), '-pix_fmt', 'yuv420p',
    outputPath
  );
  await runCommand('ffmpeg', args, { timeoutMs: PROCESS_TIMEOUT_MS, inherit: true });
}
