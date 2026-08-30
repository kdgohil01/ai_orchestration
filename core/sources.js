import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALLOWLIST_PATH = path.resolve(MODULE_DIR, '../config/approved-sources.json');
const DEFAULT_TOPICS_PATH = path.resolve(MODULE_DIR, '../config/approved-topics.json');
const MAX_SOURCE_BYTES = 750_000;
const MAX_EXCERPT_CHARS = 8_000;

export function loadSourceAllowlist(filePath = DEFAULT_ALLOWLIST_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed.authorities) || parsed.authorities.length === 0) {
    throw new Error('Approved source allowlist contains no authorities.');
  }
  return parsed;
}

export function approvedHosts(allowlist = loadSourceAllowlist()) {
  return [...new Set(allowlist.authorities.flatMap(entry => entry.hosts || []))].sort();
}

export function loadApprovedTopics(filePath = DEFAULT_TOPICS_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed.topics)) throw new Error('Approved topic catalog is invalid.');
  return parsed.topics;
}

export function isApprovedSourceUrl(rawUrl, allowlist = loadSourceAllowlist()) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return approvedHosts(allowlist).includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)));
}

export function extractReadableText(html) {
  return decodeEntities(String(html || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html, fallbackUrl) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? extractReadableText(match[1]).slice(0, 200) : new URL(fallbackUrl).hostname;
}

async function readLimitedBody(response, maxBytes = MAX_SOURCE_BYTES) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error(`Approved source exceeds ${maxBytes} bytes.`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Approved source exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

export async function fetchApprovedSource(rawUrl, {
  allowlist = loadSourceAllowlist(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  maxRedirects = 3,
} = {}) {
  if (!isApprovedSourceUrl(rawUrl, allowlist)) {
    const error = new Error(`Source URL is not approved: ${rawUrl}`);
    error.code = 'SOURCE_NOT_APPROVED';
    error.isQualityError = true;
    throw error;
  }

  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'DeedLampLocalFactChecker/1.0' },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectCount === maxRedirects) throw new Error(`Source redirect failed: ${currentUrl}`);
      currentUrl = new URL(location, currentUrl).toString();
      if (!isApprovedSourceUrl(currentUrl, allowlist)) {
        const error = new Error(`Source redirected outside the allowlist: ${currentUrl}`);
        error.code = 'SOURCE_REDIRECT_NOT_APPROVED';
        error.isQualityError = true;
        throw error;
      }
      continue;
    }

    if (!response.ok) throw new Error(`Approved source returned HTTP ${response.status}: ${currentUrl}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Approved source has unsupported content type '${contentType}': ${currentUrl}`);
    }
    const html = await readLimitedBody(response);
    const text = extractReadableText(html);
    if (text.length < 300) throw new Error(`Approved source contains too little readable text: ${currentUrl}`);
    return {
      requestedUrl: rawUrl,
      url: currentUrl,
      title: extractTitle(html, currentUrl),
      fetchedAt: new Date().toISOString(),
      contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
      excerpt: text.slice(0, MAX_EXCERPT_CHARS),
      text,
    };
  }
  throw new Error(`Source redirect limit exceeded: ${rawUrl}`);
}

export async function fetchApprovedSources(urls, options = {}) {
  const allowlist = options.allowlist || loadSourceAllowlist();
  const uniqueUrls = [...new Set((urls || []).map(value => String(value).trim()).filter(Boolean))];
  const minimum = allowlist.minimumSources ?? 2;
  const maximum = allowlist.maximumSources ?? 4;
  if (uniqueUrls.length < minimum || uniqueUrls.length > maximum) {
    const error = new Error(`Source validation requires ${minimum}-${maximum} unique approved URLs; received ${uniqueUrls.length}.`);
    error.code = 'SOURCE_COUNT_INVALID';
    error.isQualityError = true;
    throw error;
  }
  const sources = [];
  for (const url of uniqueUrls) sources.push(await fetchApprovedSource(url, { ...options, allowlist }));
  return sources;
}

export async function discoverApprovedResearch({ kind, topicsUsed = [], topicId = null }) {
  const allowlist = loadSourceAllowlist();
  const used = new Set((topicsUsed || []).map(topic => String(topic).toLowerCase().trim()));
  const available = loadApprovedTopics().filter(topic =>
    topic.approved === true && topic.formats?.includes(kind) && !used.has(topic.topic_slug.toLowerCase().trim())
  );
  const discovery = topicId
    ? available.find(topic => topic.id === topicId)
    : available[0];
  if (!discovery) {
    const error = new Error(topicId
      ? `Approved topic '${topicId}' is unavailable, already used, or not enabled for ${kind}.`
      : `No unused approved topics remain for ${kind}. Add and review exact source URLs in config/approved-topics.json.`);
    error.code = 'APPROVED_TOPIC_CATALOG_EXHAUSTED';
    error.isQualityError = true;
    throw error;
  }
  const sources = await fetchApprovedSources(discovery.source_urls, { allowlist });
  return { discovery, sources };
}

export function formatSourceContext(discovery, sources) {
  return [
    `APPROVED TOPIC: ${discovery.topic_slug}`,
    `RESEARCH QUESTION: ${discovery.research_question}`,
    ...sources.map((source, index) => `SOURCE ${index + 1}\nURL: ${source.url}\nTITLE: ${source.title}\nEXCERPT: ${source.excerpt}`),
  ].join('\n\n');
}

function normalizedEvidence(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function numberTokens(value) {
  return normalizedEvidence(value).match(/\b\d+(?:\.\d+)?\b/g) || [];
}

function findBestSourceEvidence(statement, sourceText) {
  const sentences = String(sourceText || '')
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.split(/\s+/).length >= 5 && sentence.split(/\s+/).length <= 100);
  let best = { sentence: '', score: 0 };
  const requiredNumbers = numberTokens(statement);
  for (const sentence of sentences) {
    const sentenceNumbers = new Set(numberTokens(sentence));
    if (requiredNumbers.some(number => !sentenceNumbers.has(number))) continue;
    const score = overlapRatio(statement, sentence);
    if (score > best.score) best = { sentence, score };
  }
  return best;
}

function wordSet(value) {
  return new Set(normalizedEvidence(value).split(' ').filter(word => word.length > 2));
}

function overlapRatio(left, right) {
  const a = wordSet(left);
  const b = wordSet(right);
  if (!a.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap++;
  return overlap / a.size;
}

function citationFailure(message) {
  const error = new Error(message);
  error.code = 'CITATION_VALIDATION_FAILED';
  error.isQualityError = true;
  return error;
}

export function validateFactualCitations(data, sources, { scriptField, minimumClaims }) {
  const sourceByUrl = new Map(sources.flatMap(source => [[source.url, source], [source.requestedUrl, source]]));
  const citations = [...new Set(data.source_urls || [])];
  if (citations.length < 2 || citations.some(url => !sourceByUrl.has(url))) {
    throw citationFailure('Citation validation failed: script source_urls must reference at least two fetched approved sources.');
  }
  if (!Array.isArray(data.claims) || data.claims.length < minimumClaims) {
    throw citationFailure(`Citation validation failed: at least ${minimumClaims} factual claims are required.`);
  }

  const verifiedClaims = [];
  for (const [index, claim] of data.claims.entries()) {
    const source = sourceByUrl.get(claim.source_url);
    if (!source) throw citationFailure(`Citation validation failed: claim ${index + 1} uses an unfetched source.`);
    const evidence = findBestSourceEvidence(claim.statement, source.text);
    if (!claim.statement || evidence.score < 0.22) {
      throw citationFailure(`Citation validation failed: claim ${index + 1} has no sufficiently matching source sentence.`);
    }
    verifiedClaims.push({
      statement: claim.statement,
      sourceUrl: source.url,
      evidenceQuote: evidence.sentence,
      matchScore: Math.round(evidence.score * 1000) / 1000,
    });
  }

  const script = String(data[scriptField] || '');
  const highRiskSentences = script.split(/(?<=[.!?])\s+/).filter(sentence =>
    /\d|percent|million|billion|thousand|century|measured|recorded|according to/i.test(sentence)
  );
  for (const sentence of highRiskSentences) {
    if (!data.claims.some(claim => overlapRatio(sentence, claim.statement) >= 0.2)) {
      throw citationFailure(`Citation validation failed: unsupported high-risk factual sentence: "${sentence.slice(0, 140)}"`);
    }
  }

  return {
    valid: true,
    sourceCount: citations.length,
    claimCount: data.claims.length,
    sourceUrls: citations,
    verifiedClaims,
  };
}

export function writeSourceManifest(outputDir, discovery, sources) {
  const manifestPath = path.join(outputDir, 'sources.json');
  const manifest = {
    topic: discovery,
    sources: sources.map(({ text, ...source }) => ({ ...source, excerpt: source.excerpt.slice(0, 1_500) })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}
