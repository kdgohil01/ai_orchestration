import { spawn } from 'child_process';

export function runCommand(command, args, { cwd, timeoutMs = 30 * 60_000, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    if (!inherit) {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}. ${stderr.slice(-2000)}`));
    });
  });
}
export async function probeMedia(filePath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath
  ], { timeoutMs: 60_000 });
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`ffprobe returned invalid JSON: ${err.message}`);
  }
}

export async function getMediaDuration(filePath) {
  const metadata = await probeMedia(filePath);
  const duration = Number.parseFloat(metadata.format?.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid media duration for ${filePath}.`);
  return duration;
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
