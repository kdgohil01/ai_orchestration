// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Short-Form Script Prompt
// Story-first 4-beat structure. The Weird Archivist persona.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CHANNEL_NAME, PERSONA_NAME, TONE_DESCRIPTOR,
  BANNED_VOCAB, BANNED_OPENERS
} from '../core/identity.js';

/**
 * Builds the Gemini prompt for a story-driven 25-second YouTube Short.
 *
 * @param {string[]} topicsUsed - Array of topic slugs already published
 * @returns {string}
 */
export function buildShortPrompt(topicsUsed = []) {
  // Cap at 40 slugs to keep prompt size reasonable
  const bannedList = topicsUsed.slice(-40).join(', ') || 'None yet';

  return `You are writing for "${CHANNEL_NAME}" — a YouTube channel narrated by ${PERSONA_NAME}.
Tone: ${TONE_DESCRIPTOR}

Write a 25-second YouTube Short script following this EXACT 4-beat structure.
Each beat must flow naturally into the next as continuous spoken narration.

BEAT 1 — THE DROP (0–4s):
  Open MID-SCENE inside a specific real moment. No preamble.
  MUST contain one specific number, date, name, or measurement.
  FORBIDDEN openers: ${BANNED_OPENERS.join(' / ')}
  Example: "In July 1518, a woman named Frau Troffea walked into a square and began dancing. She did not stop."

BEAT 2 — THE STRANGE DETAIL (5–12s):
  Reveal the one thing that makes this impossible to explain simply.
  Include at least one sensory detail — what it looked like, sounded like, or felt like.

BEAT 3 — THE REFRAME (13–20s):
  The single sentence that changes everything the viewer thought they understood.
  This is the emotional payload. Do not soften it.

BEAT 4 — THE LOOP (21–25s):
  End on an unresolved image or open question — not a clean conclusion.
  This line must make the viewer want to watch again from the start.

CONTENT RULES:
  - Total script: 38 to 45 words. Absolutely no more.
  - BANNED vocabulary: ${BANNED_VOCAB.join(', ')}
  - No emojis anywhere in the response.
  - At least one specific real name, date, or number in beat 1.
  - Choose from: historical anomalies, biological extremes, psychological phenomena,
    physics edge cases, engineering disasters, lost civilizations.
  - DO NOT write about any of these topics: [${bannedList}]

Return ONLY a raw JSON object. No markdown. No backticks. No explanation.
{
  "topic_slug": "3-5 word slug identifying the core story (e.g. 'dancing plague strasbourg 1518')",
  "topic_category": "one of: historical anomaly | biological extreme | psychological phenomenon | physics edge case | engineering disaster | lost civilization",
  "script": "The complete voiceover script — 38 to 45 words, all 4 beats combined",
  "title": "High-CTR YouTube title under 55 characters — specific and intriguing, no generic clickbait",
  "seo_hook": "First line of description — a keyword-rich searchable statement about the topic (not a bonus fact)",
  "comment_cta": "A specific, debatable question for the comments — not generic, not 'drop it below'",
  "keywords": ["5 to 8 relevant search keywords as array strings"],
  "visualSegments": [
    { "part": 1, "keyword": "specific portrait video search term for beat 1" },
    { "part": 2, "keyword": "specific portrait video search term for beat 2" },
    { "part": 3, "keyword": "specific portrait video search term for beat 3" },
    { "part": 4, "keyword": "specific portrait video search term for beat 3 continuation" },
    { "part": 5, "keyword": "specific portrait video search term for beat 4 loop" }
  ]
}`;
}

/**
 * Builds the final YouTube description for a Short.
 *
 * @param {object} data             - Parsed Gemini response
 * @param {string|null} longFormUrl - Link to a related long-form video in The Archive
 * @returns {string}
 */
export function buildShortDescription(data, longFormUrl = null) {
  const hashtags = '#shorts #history #psychology #science #facts #archive #education';
  let desc = `${data.seo_hook}\n\n${data.comment_cta}`;

  if (longFormUrl) {
    desc += `\n\nFull story in The Archive:\n${longFormUrl}`;
  }

  desc += `\n\n${hashtags}`;
  return desc;
}
