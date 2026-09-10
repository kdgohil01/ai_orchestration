import fs from 'fs';
import path from 'path';
import { config } from './config.js';

function findInPath(executableName) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executableName}${extension}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function findRecursively(root, fileName) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.name.toLowerCase() === fileName.toLowerCase()) return candidate;
    }
  }
  return null;
}

export function resolveMediaTool(name) {
  const envName = name === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
  const configured = process.env[envName]?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (!fs.existsSync(resolved)) throw new Error(`${envName} does not exist: ${resolved}`);
    return resolved;
  }
  const fromPath = findInPath(name);
  if (fromPath) return fromPath;
  const localFileName = process.platform === 'win32' ? `${name}.exe` : name;
  return findRecursively(path.join(config.rootDir, 'tools', 'ffmpeg'), localFileName);
}

export function configureFluentFfmpeg(ffmpeg) {
  const ffmpegPath = resolveMediaTool('ffmpeg');
  const ffprobePath = resolveMediaTool('ffprobe');
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
  return { ffmpegPath, ffprobePath };
}
