// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Gemini API Wrapper
// Handles model init, retry with exponential backoff, and JSON extraction.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

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
export async function generateJSON(prompt, retries = 5) {
  const modelName = 'gemini-2.5-flash';
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
      console.warn(`⚠️ Gemini (${modelName}) attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      // Exponential backoff with jitter
      const delay = Math.min(10000, 2000 * Math.pow(2, attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
