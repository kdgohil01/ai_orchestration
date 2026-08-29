import { CHANNEL_NAME, PERSONA_NAME, SERIES_LONG, TONE_DESCRIPTOR, BANNED_VOCAB, BANNED_OPENERS } from '../core/identity.js';

export function buildLongPrompt(topicsUsed = []) {
  const banned = topicsUsed.slice(-50).join(', ') || 'None yet';
  return `You write evidence-led mini-documentaries for "${CHANNEL_NAME}'s" "${SERIES_LONG}", narrated by ${PERSONA_NAME}.
Tone: ${TONE_DESCRIPTOR}

Write continuous narration using four acts:
1. Inciting detail (~150 words): enter a real event already in progress.
2. Context (~210 words): human context and at least one sensory detail.
3. Escalation (~300 words): the precisely identified turning point and evidence.
4. Echo plus outro (~180 words): present significance without a false neat conclusion.

The complete narration must be 780-880 words so normal TTS produces approximately 3.5-4.5 minutes. End naturally with: "If you want more from The Archive, subscribe. The next one is stranger than this."

Rules:
- Forbidden openers: ${BANNED_OPENERS.join(' / ')}
- Banned vocabulary: ${BANNED_VOCAB.join(', ')}
- No emoji, invented quotations, invented certainty, or unsupported causal claims.
- Mark disputed explanations as disputed.
- Exactly eight numbered landscape visual segments.
- Exactly four chapter labels; timestamps are calculated later from the rendered duration.
- Include 2-4 authoritative HTTPS sources. Prefer primary institutions, government, universities, museums, archives, scientific journals, NASA, NOAA, NIH, WHO, UNESCO, Britannica, or Smithsonian. No blogs, forums, social media, Wikipedia, or invented URLs.
- Do not repeat: [${banned}]

Return only JSON:
{
  "topic_slug": "3-5 identifying words",
  "topic_category": "historical anomaly | biological extreme | psychological phenomenon | physics edge case | engineering disaster | lost civilization",
  "title": "specific title under 65 characters",
  "seo_hook": "searchable factual opening line",
  "comment_cta": "specific debatable question",
  "keywords": ["6-10 search keywords"],
  "fullScript": "780-880 word continuous narration",
  "chapters": [
    {"label":"The Inciting Detail"},{"label":"The Context"},{"label":"The Escalation"},{"label":"The Echo"}
  ],
  "visualSegments": [
    {"part":1,"keyword":"specific landscape search phrase"},
    {"part":2,"keyword":"specific landscape search phrase"},
    {"part":3,"keyword":"specific landscape search phrase"},
    {"part":4,"keyword":"specific landscape search phrase"},
    {"part":5,"keyword":"specific landscape search phrase"},
    {"part":6,"keyword":"specific landscape search phrase"},
    {"part":7,"keyword":"specific landscape search phrase"},
    {"part":8,"keyword":"specific landscape search phrase"}
  ],
  "sources": [
    {"title":"authoritative source title","url":"https://authoritative.example/page"},
    {"title":"second independent source","url":"https://authoritative.example/page"}
  ]
}`;
}

export function buildLongDescription(data) {
  const sources = data.sources.map(source => `- ${source.title}: ${source.url}`).join('\n');
  return [
    data.seo_hook, '', data.comment_cta, '', 'Sources:', sources, '',
    '#documentary #history #education #archive #facts #mystery #psychology'
  ].join('\n');
}
