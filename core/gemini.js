import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { NETWORK_TIMEOUT_MS } from './config.js';
import { withTimeout } from './process.js';
dotenv.config();

function extractJson(text) {
  let clean = String(text).trim();
  if (clean.startsWith('\u0060\u0060\u0060json')) clean = clean.slice(7);
  else if (clean.startsWith('\u0060\u0060\u0060')) clean = clean.slice(3);
  if (clean.trimEnd().endsWith('\u0060\u0060\u0060')) clean = clean.trimEnd().slice(0, -3);
  return JSON.parse(clean.trim());
}

export async function generateJSON(prompt, retries = 5) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing.');
  const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const model = ai.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 }
  });
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(model.generateContent(prompt), NETWORK_TIMEOUT_MS * 2, 'Gemini request');
      return extractJson(result.response.text());
    } catch (err) {
      lastError = err;
      console.warn(`Gemini attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, Math.min(15_000, 1000 * 2 ** (attempt - 1) + Math.random() * 500)));
    }
  }
  throw lastError;
}
