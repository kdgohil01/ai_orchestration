import { CHANNEL_NAME, PERSONA_NAME, TONE_DESCRIPTOR, BANNED_VOCAB, BANNED_OPENERS } from '../core/identity.js';

export function buildShortPrompt(topicsUsed = []) {
  const banned = topicsUsed.slice(-50).join(', ') || 'None yet';
  return `You write evidence-led 25-second YouTube Shorts for "${CHANNEL_NAME}", narrated by ${PERSONA_NAME}.
Tone: ${TONE_DESCRIPTOR}

Use four continuous beats: (1) open mid-event with a verifiable real name, date, number, or measurement; (2) give a sensory strange detail; (3) reframe it accurately; (4) end with an unresolved but honest loop. Do not invent quotations, certainty, causes, or supernatural explanations. Explicitly qualify disputed interpretations.

Rules:
- Script must contain exactly 38-45 words.
- Forbidden openers: ${BANNED_OPENERS.join(' / ')}
- Banned vocabulary: ${BANNED_VOCAB.join(', ')}
- No emoji.
- Title maximum 55 characters.
- Exactly five numbered portrait visual segments.
- Include 2-4 authoritative HTTPS sources. Prefer government, university, museum, scientific journal, archive, NASA, NOAA, NIH, WHO, UNESCO, Britannica, or Smithsonian pages. Do not use blogs, social media, forums, Wikipedia, URL shorteners, or invented URLs.
- Do not repeat: [${banned}]

Return only a JSON object:
{
  "topic_slug": "3-5 identifying words",
  "topic_category": "historical anomaly | biological extreme | psychological phenomenon | physics edge case | engineering disaster | lost civilization",
  "script": "38-45 word narration",
  "title": "specific title under 55 characters",
  "seo_hook": "searchable factual opening line",
  "comment_cta": "specific debatable question",
  "keywords": ["5-8 search keywords"],
  "visualSegments": [
    {"part":1,"keyword":"specific portrait search phrase"},
    {"part":2,"keyword":"specific portrait search phrase"},
    {"part":3,"keyword":"specific portrait search phrase"},
    {"part":4,"keyword":"specific portrait search phrase"},
    {"part":5,"keyword":"specific portrait search phrase"}
  ],
  "sources": [
    {"title":"authoritative source title","url":"https://authoritative.example/page"},
    {"title":"second independent source","url":"https://authoritative.example/page"}
  ]
}`;
}

export function buildShortDescription(data) {
  const sources = data.sources.map(source => `- ${source.title}: ${source.url}`).join('\n');
  return [
    data.seo_hook, '', data.comment_cta, '', 'Sources:', sources, '',
    '#shorts #history #psychology #science #facts #archive #education'
  ].join('\n');
}
