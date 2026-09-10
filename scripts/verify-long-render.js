import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { config } from '../core/config.js';
import { resolveMediaTool } from '../core/media-tools.js';
import { compileLongVideo } from '../core/ffmpeg-long.js';
import { validateMediaIntegrity } from '../core/validator.js';

const verificationDir = path.join(config.rootDir, '.local', 'verification', 'long-render');
const scenePath = path.join(verificationDir, 'scene.mp4');
const audioPath = path.join(verificationDir, 'narration-fixture.mp3');
const outputPath = path.join(verificationDir, 'long-render-fixture.mp4');
const ffmpegPath = resolveMediaTool('ffmpeg');

if (!ffmpegPath) throw new Error('FFmpeg is unavailable. Run npm run preflight or configure FFMPEG_PATH.');
fs.mkdirSync(verificationDir, { recursive: true });

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    cwd: config.rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`Fixture FFmpeg process exited with status ${result.status}.`);
}

console.log('Creating deterministic local long-form render fixtures (no network and no upload)...');
runFfmpeg([
  '-f', 'lavfi', '-i', 'color=c=0x172033:s=1920x1080:r=30:d=1',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', scenePath,
]);
runFfmpeg([
  '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=212',
  '-filter:a', 'volume=0.04', '-c:a', 'libmp3lame', '-q:a', '9', audioPath,
]);

await compileLongVideo(Array(8).fill(scenePath), audioPath, outputPath);
const validation = await validateMediaIntegrity(outputPath, 'long');
console.log(JSON.stringify({ outputPath, validation }, null, 2));
