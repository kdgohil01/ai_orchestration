export function formatTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function buildProportionalChapters(durationSec, chapters) {
  if (!Number.isFinite(durationSec) || durationSec < 60) throw new Error('Video is too short for chapter generation.');
  if (!Array.isArray(chapters) || chapters.length !== 4) throw new Error('Exactly four chapter labels are required.');
  const ratios = [0, 0.19, 0.44, 0.75];
  return chapters.map((chapter, index) => ({
    label: chapter.label,
    timestamp: formatTimestamp(Math.min(durationSec - 1, Math.round(durationSec * ratios[index])))
  }));
}
