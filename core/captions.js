// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Whisper Caption Runner
// Wraps burn_captions.py via execSync
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';

/**
 * Burns dynamic 2-4 word Whisper captions into a video using burn_captions.py.
 *
 * @param {object} opts
 * @param {string} opts.inputPath  - Path to the uncaptioned video
 * @param {string} opts.outputPath - Path for the captioned output video
 * @param {number} opts.targetY    - Vertical position of captions on canvas (px)
 * @param {number} opts.canvasW    - Canvas width in pixels (1080 for shorts, 1920 for long)
 * @param {number} opts.canvasH    - Canvas height in pixels (1920 for shorts, 1080 for long)
 * @param {string} opts.transcriptPath - JSON transcript used by the verification gate
 */
export function burnCaptions({ inputPath, outputPath, targetY = 1450, canvasW = 1080, canvasH = 1920, transcriptPath }) {
  if (!transcriptPath) throw new Error('transcriptPath is required for caption verification.');
  const cmd = [
    'python burn_captions.py',
    `--input "${inputPath}"`,
    `--output "${outputPath}"`,
    `--target-y ${targetY}`,
    `--canvas-w ${canvasW}`,
    `--canvas-h ${canvasH}`,
    `--transcript-output "${transcriptPath}"`
  ].join(' ');

  console.log(`🔥 Running caption burn: ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}
