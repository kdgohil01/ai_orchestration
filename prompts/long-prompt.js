// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Long-Form Documentary Prompt
// 4-ACT narrative structure with verbal subscribe CTA. The Archive series.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CHANNEL_NAME, PERSONA_NAME, SERIES_LONG, TONE_DESCRIPTOR,
  BANNED_VOCAB, BANNED_OPENERS
} from '../core/identity.js';

/**
 * Builds the Gemini prompt for a 4-minute story-driven mini-documentary.
 *
 * @param {string[]} topicsUsed - Array of topic slugs already published
 * @returns {string}
 */
export function buildLongPrompt(topicsUsed = []) {
  const bannedList = topicsUsed.slice(-40).join(', ') || 'None yet';

  return `You are the writer for "${CHANNEL_NAME}'s" "${SERIES_LONG}" — a long-form documentary series narrated by ${PERSONA_NAME}.
Tone: ${TONE_DESCRIPTOR}

Produce a 4-minute documentary script (approximately 580 to 650 words) following this EXACT 4-act narrative structure.
The script is continuous spoken narration — no scene headings, no stage directions, no labels.

ACT 1 — THE INCITING DETAIL (0:00–0:45, ~90 words):
  One fact that should not exist. Open mid-event, not with background.
  Name a real person, place, date, or specific measurement in the first sentence.
  This should feel like the viewer arrived late to something already happening.

ACT 2 — THE CONTEXT (0:45–1:45, ~150 words):
  What made this moment possible? Humanise the actors involved.
  Include at least one sensory detail — what it smelled like, sounded like, or felt like physically.
  Avoid being encyclopedic. Stay close to the human story.

ACT 3 — THE ESCALATION (1:45–3:00, ~195 words):
  What happened next that made it worse, stranger, or more significant?
  Include the specific moment everything changed — name it precisely.
  The viewer should feel a shift in tone here.

ACT 4 — THE ECHO (3:00–3:45, ~90 words):
  What does this event reveal about human nature or the world today?
  One closing observation that lingers. Do not resolve neatly.
  Leave the viewer with a question they will carry with them.

OUTRO (3:45–4:00, ~30 words):
  End with exactly this sentence, spoken naturally:
  "If you want more from The Archive, subscribe. The next one is stranger than this."

CONTENT RULES:
  - Total script: 580 to 650 words including outro
  - BANNED vocabulary: ${BANNED_VOCAB.join(', ')}
  - FORBIDDEN openers: ${BANNED_OPENERS.join(' / ')}
  - No emojis anywhere
  - At least two specific real names, dates, or measurements across the full script
  - At least one sensory detail in ACT 2
  - 8 visual segments (landscape orientation search terms)
  - DO NOT write about any of these topics: [${bannedList}]

Return ONLY a raw JSON object. No markdown. No backticks. No explanation.
{
  "topic_slug": "3-5 word slug (e.g. 'london beer flood 1814')",
  "topic_category": "one of: historical anomaly | biological extreme | psychological phenomenon | physics edge case | engineering disaster | lost civilization",
  "title": "Clickable landscape title under 65 characters — specific and intriguing, no generic clickbait",
  "seo_hook": "First line of description — keyword-rich searchable statement about the topic",
  "comment_cta": "Specific, debatable question — not generic",
  "keywords": ["6 to 10 relevant keywords as array strings"],
  "fullScript": "The complete continuous narration — all 4 acts and outro combined",
  "chapters": [
    { "label": "The Inciting Detail", "timestamp": "0:00" },
    { "label": "The Context",         "timestamp": "0:45" },
    { "label": "The Escalation",      "timestamp": "1:45" },
    { "label": "The Echo",            "timestamp": "3:00" }
  ],
  "visualSegments": [
    { "part": 1, "keyword": "landscape search term — act 1 opening image" },
    { "part": 2, "keyword": "landscape search term — act 1 second beat" },
    { "part": 3, "keyword": "landscape search term — act 2 context scene 1" },
    { "part": 4, "keyword": "landscape search term — act 2 context scene 2" },
    { "part": 5, "keyword": "landscape search term — act 3 escalation scene 1" },
    { "part": 6, "keyword": "landscape search term — act 3 escalation scene 2" },
    { "part": 7, "keyword": "landscape search term — act 4 echo scene" },
    { "part": 8, "keyword": "landscape search term — act 4 closing image" }
  ]
}`;
}

/**
 * Builds the final YouTube description for a long-form video.
 * First line is the SEO hook. Chapters are appended as a block.
 *
 * @param {object} data - Parsed Gemini response
 * @returns {string}
 */
export function buildLongDescription(data) {
  const hashtags = '#documentary #history #education #archive #facts #mystery #psychology';

  const chaptersText = data.chapters
    .map(c => `${c.timestamp} ${c.label}`)
    .join('\n');

  return [
    data.seo_hook,
    '',
    data.comment_cta,
    '',
    chaptersText,
    '',
    hashtags
  ].join('\n');
}
