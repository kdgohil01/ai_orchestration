import { execFileSync } from 'child_process';
import { PROCESS_TIMEOUT_MS, projectPath } from './config.js';

/** Burn Faster-Whisper captions and persist the transcript used by validation. */
export function burnCaptions({
  inputPath,
  outputPath,
  targetY = 1450,
  canvasW = 1080,
  canvasH = 1920,
  transcriptPath,
}) {
  if (!transcriptPath) throw new Error('transcriptPath is required for caption verification.');
  execFileSync(process.env.PYTHON_COMMAND || 'python', [
    projectPath('burn_captions.py'),
    '--input', inputPath,
    '--output', outputPath,
    '--target-y', String(targetY),
    '--canvas-w', String(canvasW),
    '--canvas-h', String(canvasH),
    '--transcript-output', transcriptPath,
  ], {
    cwd: projectPath(),
    stdio: 'inherit',
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  });
}
