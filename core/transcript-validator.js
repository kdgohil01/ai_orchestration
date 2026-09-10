import fs from 'fs';

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(reference, observed) {
  const previous = Array.from({ length: observed.length + 1 }, (_, index) => index);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= observed.length; j++) {
      current[j] = reference[i - 1] === observed[j - 1]
        ? previous[j - 1]
        : Math.min(previous[j - 1], previous[j], current[j - 1]) + 1;
    }
    for (let j = 0; j < current.length; j++) previous[j] = current[j];
  }
  return previous[observed.length];
}

export function calculateWordErrorRate(intendedScript, transcript) {
  const reference = normalizeWords(intendedScript);
  const observed = normalizeWords(transcript);
  if (!reference.length) throw new Error('Transcript validation failed: intended script is empty.');
  return editDistance(reference, observed) / reference.length;
}

export function validateTranscriptMatch(intendedScript, transcriptPath, threshold = 0.25) {
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript validation failed: Faster-Whisper output missing at '${transcriptPath}'.`);
  }
  const payload = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const transcript = payload.text || '';
  if (!transcript.trim()) throw new Error('Transcript validation failed: Faster-Whisper detected no speech.');
  const wordErrorRate = calculateWordErrorRate(intendedScript, transcript);
  const result = {
    valid: wordErrorRate <= threshold,
    wordErrorRate: Math.round(wordErrorRate * 1000) / 1000,
    threshold,
    detectedLanguage: payload.language || null,
    languageProbability: payload.languageProbability ?? null,
    wordCount: normalizeWords(transcript).length,
  };
  if (!result.valid) {
    throw new Error(`Transcript validation failed: word error rate ${result.wordErrorRate} exceeds threshold ${threshold}.`);
  }
  return result;
}
