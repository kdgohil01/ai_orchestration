// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — TTS Synthesizer Wrapper
// ─────────────────────────────────────────────────────────────────────────────

import { EdgeTTS } from 'edge-tts-universal';
import fs from 'fs';

/**
 * Synthesizes a text string to an MP3 file using Microsoft Edge TTS.
 *
 * @param {string} text       - Script text to synthesize
 * @param {string} voice      - Edge TTS voice name (e.g. 'en-US-ChristopherNeural')
 * @param {string} outputPath - Absolute path to write the MP3 output
 */
export async function synthesize(text, voice, outputPath) {
  const tts = new EdgeTTS(text, voice);
  const result = await tts.synthesize();
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  await fs.promises.writeFile(outputPath, buffer);
}
