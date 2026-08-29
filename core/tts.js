import fs from 'fs';
import path from 'path';
import { EdgeTTS } from 'edge-tts-universal';
import { NETWORK_TIMEOUT_MS } from './config.js';
import { withTimeout } from './process.js';

export async function synthesize(text, voice, outputPath) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('TTS text is empty.');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tts = new EdgeTTS(text, voice);
  const result = await withTimeout(tts.synthesize(), NETWORK_TIMEOUT_MS * 4, 'Edge TTS');
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  if (buffer.length < 1_000) throw new Error('TTS returned an unexpectedly small audio file.');
  const temp = `${outputPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, buffer, { flag: 'wx' });
  await fs.promises.rename(temp, outputPath);
}
