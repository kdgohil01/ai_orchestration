import fs from 'fs';
import path from 'path';
import { projectPath } from './config.js';

export function loadJson(primaryPath, fallbackPaths, defaultValue) {
  const candidates = [primaryPath, ...(fallbackPaths || [])];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (err) {
      console.warn(`Warning: could not parse ${candidate}: ${err.message}`);
    }
  }
  return structuredClone(defaultValue);
}

export function saveJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tempPath, filePath);
}

export function acquirePipelineLock({ staleAfterMs = 8 * 60 * 60_000 } = {}) {
  const lockPath = projectPath('.runtime', 'pipeline.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age > staleAfterMs) fs.unlinkSync(lockPath);
  }
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error('Another DeedLamp pipeline is already running.');
    throw err;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  };
}

