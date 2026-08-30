import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchApprovedSource, isApprovedSourceUrl, validateFactualCitations } from '../core/sources.js';

const allowlist = {
  minimumSources: 1,
  maximumSources: 2,
  authorities: [{ name: 'Example Authority', hosts: ['research.example'] }],
};

test('accepts only HTTPS URLs from explicitly approved hosts', () => {
  assert.equal(isApprovedSourceUrl('https://research.example/article', allowlist), true);
  assert.equal(isApprovedSourceUrl('http://research.example/article', allowlist), false);
  assert.equal(isApprovedSourceUrl('https://evil.example/article', allowlist), false);
  assert.equal(isApprovedSourceUrl('https://research.example.evil.test/article', allowlist), false);
});

test('fetches and extracts text from an approved source', async () => {
  const body = `<html><head><title>Archive Record</title></head><body><main>${'Verified historical evidence '.repeat(30)}</main></body></html>`;
  const source = await fetchApprovedSource('https://research.example/article', {
    allowlist,
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(source.title, 'Archive Record');
  assert.match(source.text, /Verified historical evidence/);
  assert.equal(source.contentHash.length, 64);
});

test('rejects redirects outside the approved allowlist', async () => {
  await assert.rejects(
    fetchApprovedSource('https://research.example/article', {
      allowlist,
      fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://evil.example/page' } }),
    }),
    /redirected outside the allowlist/
  );
});

test('requires claim evidence to exist in fetched source text', () => {
  const sourceText = 'The official record states that in 1942 the archive recorded a strange event for officials during the night.';
  const sources = [
    { url: 'https://research.example/one', requestedUrl: 'https://research.example/one', text: sourceText },
    { url: 'https://research.example/two', requestedUrl: 'https://research.example/two', text: 'A second independent official archive confirms the documented event and its date.' },
  ];
  const result = validateFactualCitations({
    script: 'In 1942 the archive recorded a strange event.',
    source_urls: sources.map(source => source.url),
    claims: [{
      statement: 'In 1942 the archive recorded a strange event.',
      source_url: sources[0].url,
      evidence_quote: 'in 1942 the archive recorded a strange event for officials',
    }],
  }, sources, { scriptField: 'script', minimumClaims: 1 });
  assert.equal(result.valid, true);
});

test('rejects claims that have no matching source sentence', () => {
  const sources = [
    { url: 'https://research.example/one', requestedUrl: 'https://research.example/one', text: 'The real source says something else entirely about this event.' },
    { url: 'https://research.example/two', requestedUrl: 'https://research.example/two', text: 'A second official source exists for comparison and verification.' },
  ];
  assert.throws(() => validateFactualCitations({
    script: 'In 1942 an event happened.',
    source_urls: sources.map(source => source.url),
    claims: [{
      statement: 'In 1942 an event happened.',
      source_url: sources[0].url,
      evidence_quote: 'this quotation does not exist in the approved source page',
    }],
  }, sources, { scriptField: 'script', minimumClaims: 1 }), /no sufficiently matching source sentence/);
});
