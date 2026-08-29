// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Channel Identity
// Single source of truth for persona, voices, tone, and quality rules.
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNEL_NAME = 'DeedLamp';
export const PERSONA_NAME = 'The Weird Archivist';
export const SERIES_LONG  = 'The Archive';

// Voice selection: 1 primary (60% usage) + 2 alternates (20% each)
// Christopher: authoritative, slightly conspiratorial — the Archivist's main voice
// Ryan (British): lends gravitas to historical topics
// Guy: warmer tone, good for psychological/nature content
export const VOICE_PRIMARY    = 'en-US-ChristopherNeural';
export const VOICE_ALTERNATES = ['en-GB-RyanNeural', 'en-US-GuyNeural'];

export const TONE_DESCRIPTOR = [
  'Urgent, specific, slightly conspiratorial, always factual.',
  'Sounds like a BBC World Service journalist who just found something incredible in a locked archive.',
  'Never condescending. Never sensationalist. Always specific.',
].join(' ');

// Words banned from all AI scripts — they signal low-quality AI generation
export const BANNED_VOCAB = [
  'fascinating', 'interesting', 'remarkable', 'mind-blowing', 'incredible',
  'amazing', 'unbelievable', 'astounding', 'astonishing', 'extraordinary',
  'captivating', 'intriguing', 'stunning'
];

// Opening phrases banned — overused and algorithmically recognised as AI
export const BANNED_OPENERS = [
  'Did you know', 'Imagine if', "Here's why", 'This is how',
  'The real reason', 'What if I told you', "Today we're talking about",
  'Today we will', 'Welcome back', 'In this video'
];

/**
 * Selects a voice using weighted probability:
 * 60% primary, 20% each alternate.
 */
export function selectVoice() {
  const rand = Math.random();
  if (rand < 0.60) return VOICE_PRIMARY;
  if (rand < 0.80) return VOICE_ALTERNATES[0];
  return VOICE_ALTERNATES[1];
}
