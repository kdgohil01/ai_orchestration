// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Gemini API Wrapper
// Handles model init, retry with exponential backoff, and JSON extraction.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';
import { redactSecrets } from './security.js';

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generates content from Gemini and parses the response as JSON.
 * Strips markdown code fences if present.
 * Retries up to `retries` times with exponential backoff.
 *
 * @param {string} prompt
 * @param {number} retries
 * @returns {Promise<object>} Parsed JSON object
 */
export async function generateJSON(prompt, retries = 3) {
  const modelName = config.geminiModel;
  if (!config.approvedGeminiModels.includes(modelName)) {
    throw new Error(`Gemini model '${modelName}' is not approved. Paid or automatic fallback models are disabled.`);
  }
  const model = ai.getGenerativeModel({ model: modelName });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text().trim();

      // Strip markdown fences if Gemini wraps the JSON
      if (text.startsWith('```json')) text = text.slice(7).trim();
      else if (text.startsWith('```')) text = text.slice(3).trim();
      if (text.endsWith('```')) text = text.slice(0, -3).trim();

      return JSON.parse(text);
    } catch (err) {
      const message = redactSecrets(err.message);
      if (/quota|resource[_ ]?exhausted|429/i.test(message)) {
        err.code = 'FREE_TIER_QUOTA_EXHAUSTED';
        err.isQuotaBlocked = true;
        throw err;
      }
      if (/api key|permission|unauthorized|forbidden|401|403/i.test(message)) {
        err.code = err.code || 'GEMINI_AUTH_FAILED';
        throw err;
      }
      console.warn(`⚠️ Gemini (${modelName}) attempt ${attempt}/${retries} failed: ${message}`);
      if (attempt === retries) throw err;
      // Exponential backoff with jitter
      const delay = Math.min(10000, 2000 * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
