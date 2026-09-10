import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyUploadAtIntervals } from '../core/youtube-verification.js';

test('checks YouTube only at the three bounded offsets', async () => {
  const requested = [];
  const statuses = [
    { status: { uploadStatus: 'uploaded', privacyStatus: 'private' }, processingDetails: { processingStatus: 'processing' } },
    { status: { uploadStatus: 'uploaded', privacyStatus: 'private' }, processingDetails: { processingStatus: 'processing' } },
    { status: { uploadStatus: 'processed', privacyStatus: 'private' }, processingDetails: { processingStatus: 'succeeded' } },
  ];
  const result = await verifyUploadAtIntervals({
    videoId: 'video-1',
    offsetsMs: [30_000, 120_000, 300_000],
    nowFn: () => 1_000_000,
    sleepFn: async offset => requested.push(offset),
    fetchStatus: async () => statuses.shift(),
  });
  assert.deepEqual(requested, [30_000, 120_000, 300_000]);
  assert.equal(result.checks.length, 3);
  assert.equal(result.valid, true);
  assert.equal(result.needsReview, false);
});

test('stops bounded verification early on terminal rejection', async () => {
  let calls = 0;
  const result = await verifyUploadAtIntervals({
    videoId: 'video-2',
    offsetsMs: [0, 0, 0],
    sleepFn: async () => {},
    fetchStatus: async () => {
      calls++;
      return { status: { uploadStatus: 'rejected', rejectionReason: 'copyright' } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.valid, false);
  assert.equal(result.needsReview, true);
});

test('treats a missing video as unverified without continuous polling', async () => {
  let calls = 0;
  const result = await verifyUploadAtIntervals({
    videoId: 'video-3',
    offsetsMs: [0, 0, 0],
    sleepFn: async () => {},
    fetchStatus: async () => { calls++; return null; },
  });
  assert.equal(calls, 3);
  assert.equal(result.valid, false);
});

test('requires review when processing is still incomplete after the last bounded check', async () => {
  const result = await verifyUploadAtIntervals({
    videoId: 'video-4',
    offsetsMs: [0, 0, 0],
    sleepFn: async () => {},
    fetchStatus: async () => ({
      status: { uploadStatus: 'uploaded', privacyStatus: 'private' },
      processingDetails: { processingStatus: 'processing' },
    }),
  });
  assert.equal(result.valid, true);
  assert.equal(result.needsReview, true);
  assert.equal(result.checks.length, 3);
});
