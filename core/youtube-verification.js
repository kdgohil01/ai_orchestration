const DEFAULT_OFFSETS_MS = Object.freeze([30_000, 120_000, 300_000]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function verifyUploadAtIntervals({
  videoId,
  fetchStatus,
  offsetsMs = DEFAULT_OFFSETS_MS,
  sleepFn = sleep,
  onCheck = async () => {},
  nowFn = Date.now,
}) {
  if (!videoId) throw new Error('YouTube verification requires a video ID.');
  if (typeof fetchStatus !== 'function') throw new Error('YouTube verification requires fetchStatus.');
  const startedAt = nowFn();
  const checks = [];

  for (const offsetMs of offsetsMs) {
    const remaining = Math.max(0, startedAt + offsetMs - nowFn());
    if (remaining > 0) await sleepFn(remaining);
    const status = await fetchStatus(videoId);
    const check = {
      checkedAt: new Date().toISOString(),
      offsetMs,
      exists: Boolean(status),
      privacyStatus: status?.status?.privacyStatus || null,
      uploadStatus: status?.status?.uploadStatus || null,
      processingStatus: status?.processingDetails?.processingStatus || null,
      rejectionReason: status?.status?.rejectionReason || null,
      failureReason: status?.processingDetails?.processingFailureReason || null,
    };
    checks.push(check);
    await onCheck(check);
    if (check.rejectionReason || check.failureReason || ['rejected', 'failed', 'deleted'].includes(check.uploadStatus)) break;
  }

  const final = checks.at(-1) || null;
  const terminalFailure = Boolean(
    final?.rejectionReason || final?.failureReason || ['rejected', 'failed', 'deleted'].includes(final?.uploadStatus)
  );
  const valid = Boolean(final?.exists && !terminalFailure);
  const processingComplete = Boolean(
    final?.uploadStatus === 'processed' || final?.processingStatus === 'succeeded'
  );
  return {
    valid,
    needsReview: !valid || !processingComplete,
    checks,
    final,
  };
}
