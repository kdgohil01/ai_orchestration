export const CHANNEL_NAME = 'DeedLamp';
export const PERSONA_NAME = 'The Weird Archivist';
export const SERIES_LONG = 'The Archive';

export const VOICE_PRIMARY = 'en-US-ChristopherNeural';
export const VOICE_ALTERNATES = ['en-GB-RyanNeural', 'en-US-GuyNeural'];

export const TONE_DESCRIPTOR = [
  'Urgent, specific, slightly conspiratorial in style, but strictly evidence-led.',
  'Sound like a careful documentary journalist examining an unusual archive.',
  'Clearly distinguish established facts, reasonable interpretations, disputed claims, and unknowns.',
  'Never condescend, sensationalize, or state a disputed claim as settled fact.'
].join(' ');

export const BANNED_VOCAB = [
  'fascinating', 'interesting', 'remarkable', 'mind-blowing', 'incredible',
  'amazing', 'unbelievable', 'astounding', 'astonishing', 'extraordinary',
  'captivating', 'intriguing', 'stunning'
];

export const BANNED_OPENERS = [
  'Did you know', 'Imagine if', "Here's why", 'This is how', 'The real reason',
  'What if I told you', "Today we're talking about", 'Today we will',
  'Welcome back', 'In this video'
];

export function selectVoice(random = Math.random) {
  const value = random();
  if (value < 0.60) return VOICE_PRIMARY;
  if (value < 0.80) return VOICE_ALTERNATES[0];
  return VOICE_ALTERNATES[1];
}
