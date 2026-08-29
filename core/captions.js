import { PROCESS_TIMEOUT_MS, projectPath } from './config.js';
import { runCommand } from './process.js';

export async function burnCaptions({ inputPath, outputPath, targetY = 1450, canvasW = 1080, canvasH = 1920 }) {
  await runCommand(process.env.PYTHON_COMMAND || 'python', [
    projectPath('burn_captions.py'), '--input', inputPath, '--output', outputPath,
    '--target-y', String(targetY), '--canvas-w', String(canvasW), '--canvas-h', String(canvasH)
  ], { timeoutMs: PROCESS_TIMEOUT_MS, inherit: true, cwd: projectPath() });
}
