import fs from 'fs';
import path from 'path';
import { runCommand } from './process.js';
import { envBool, projectPath, PUBLISH_TIMEZONE } from './config.js';

export async function runPreflight({ checkYoutube = true, publish = false } = {}) {
  const errors = [];
  const warnings = [];
  const required = ['GEMINI_API_KEY', 'PEXELS_API_KEY'];
  if (checkYoutube) required.push('CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN');
  required.forEach(name => { if (!process.env[name]?.trim()) errors.push(`Missing environment variable: ${name}`); });
  if (publish && !envBool('ALLOW_AUTO_PUBLISH', false)) {
    errors.push('Live scheduling requires ALLOW_AUTO_PUBLISH=true.');
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: PUBLISH_TIMEZONE }).format(); }
  catch { errors.push(`Invalid PUBLISH_TIMEZONE: ${PUBLISH_TIMEZONE}`); }

  for (const directory of ['temp', '.runtime', 'assets']) {
    const full = projectPath(directory);
    try {
      fs.mkdirSync(full, { recursive: true });
      const probe = path.join(full, `.write-test-${process.pid}`);
      fs.writeFileSync(probe, 'ok', { flag: 'wx' });
      fs.unlinkSync(probe);
    } catch (err) { errors.push(`Cannot write to ${directory}: ${err.message}`); }
  }
  for (const file of ['burn_captions.py', 'requirements.txt']) {
    if (!fs.existsSync(projectPath(file))) errors.push(`Required file missing: ${file}`);
  }
  if (!fs.existsSync(projectPath('assets', 'logo.png'))) warnings.push('assets/logo.png is missing; watermark will be skipped.');
  if (!fs.existsSync(projectPath('assets', 'arial.ttf'))) warnings.push('assets/arial.ttf is missing; captions will use the configured system font.');
  if (!fs.existsSync(projectPath('assets', 'fallback_short.mp4'))) warnings.push('No Short fallback media; a complete Pexels outage will stop the run.');
  if (!fs.existsSync(projectPath('assets', 'fallback_long.mp4'))) warnings.push('No long-form fallback media; a complete Pexels outage will stop the run.');

  for (const [command, args] of [['ffmpeg', ['-version']], ['ffprobe', ['-version']], [process.env.PYTHON_COMMAND || 'python', ['--version']]]) {
    try { await runCommand(command, args, { timeoutMs: 15_000 }); }
    catch { errors.push(`${command} is not available in PATH.`); }
  }
  warnings.forEach(message => console.warn(`Preflight warning: ${message}`));
  if (errors.length) throw new Error(`Preflight failed:\n- ${errors.join('\n- ')}`);
  return { status: 'OK', warnings };
}
