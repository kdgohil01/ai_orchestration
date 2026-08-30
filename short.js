// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Short-Form Agent (Upgraded & Hardened)
// Supports CLI flags: --dry-run, --review, --skip-upload, --help
// Features: Preflight checks, Quality Gates, Render Validation, Near-Duplicate Check
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';

import { selectVoice }                      from './core/identity.js';
import { getTopicsUsed, logPublished, checkNearDuplicate } from './core/memory.js';
import { generateJSON }                      from './core/gemini.js';
import { synthesize }                        from './core/tts.js';
import { fetchAndDownload }                  from './core/pexels.js';
import { compileShortVideo }                 from './core/ffmpeg-short.js';
import { burnCaptions }                      from './core/captions.js';
import { uploadToYouTube }                   from './core/youtube.js';
import { validateShortQuality }              from './core/quality-gate.js';
import { validateMediaIntegrity }            from './core/validator.js';
import { runPreflight }                      from './core/preflight.js';
import { recordAnalyticsEntry }              from './core/analytics.js';
import { startStage, endStage, logError }    from './core/logger.js';
import { buildShortPrompt, buildShortDescription } from './prompts/short-prompt.js';
import { PipelineRun, fingerprintFile, hashText } from './core/pipeline-run.js';
import { validateTranscriptMatch } from './core/transcript-validator.js';

// Parse CLI Flags
const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes('--dry-run');
const IS_REVIEW  = args.includes('--review');
const LIVE_PUBLISH = args.includes('--publish');
const explicitModes = [IS_DRY_RUN, IS_REVIEW, LIVE_PUBLISH, args.includes('--skip-upload')].filter(Boolean).length;
if (explicitModes > 1) throw new Error('Choose only one mode: --dry-run, --review, --publish, or --skip-upload.');
const SKIP_UPLOAD = args.includes('--skip-upload') || (!IS_DRY_RUN && !IS_REVIEW && !LIVE_PUBLISH);
const RUN_MODE = LIVE_PUBLISH ? 'publish' : IS_REVIEW ? 'review' : IS_DRY_RUN ? 'dry-run' : 'local-only';
const SHOW_HELP  = args.includes('--help');

if (SHOW_HELP) {
  console.log(`
DeedLamp Short-Form Agent
Usage: node short.js [options]

Options:
  --dry-run      Run full pipeline without uploading to YouTube (simulation)
  --review       Upload video as a Private Draft for manual review
  --publish      Explicitly allow a live scheduled YouTube upload
  --skip-upload  Generate and render video locally without uploading
                 This is also the safe default when no mode is supplied
  --help         Show this help message
`);
  process.exit(0);
}

const FALLBACK    = path.resolve('fallback_short.mp4');

async function main() {
  let run = null;
  const startTime = new Date().toISOString();
  console.log(`\n🟢 [${startTime}] Short-Form Agent Started. Mode: ${RUN_MODE}`);
  if (IS_DRY_RUN) console.log('🧪 MODE: DRY-RUN SIMULATION (No live YouTube uploads)');
  if (IS_REVIEW)  console.log('📝 MODE: HUMAN REVIEW (Uploads as private draft)');
  if (SKIP_UPLOAD) console.log('🔒 MODE: LOCAL-ONLY (Live upload requires explicit --publish)');

  try {
    run = new PipelineRun('short', RUN_MODE);
    const { tempDir: TEMP_DIR, audioPath: AUDIO_PATH, uncaptionedPath: UNCAP_PATH, finalPath: FINAL_PATH } = run;
    const TRANSCRIPT_PATH = path.join(TEMP_DIR, 'transcript.json');
    console.log(`   Job ID: ${run.job.id}`);

    const tPreflight = startStage('Preflight System Checks');
    runPreflight({ checkYoutube: LIVE_PUBLISH || IS_REVIEW });
    endStage(tPreflight, true, { jobId: run.job.id });

    // ── Stage 1: Story Generation & Quality Gate ─────────────────────────────
    const tScript = startStage('Stage 1: Script Generation & Quality Gate');
    let data = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`\n🤖 Script Generation Attempt ${attempts}/${maxAttempts}...`);
      const topicsUsed = getTopicsUsed();
      const prompt     = buildShortPrompt(topicsUsed);
      const candidate  = await generateJSON(prompt);

      // Check near-duplicate memory
      const dupCheck = checkNearDuplicate(candidate.topic_slug || candidate.title);
      if (dupCheck.isDuplicate) {
        console.warn(`⚠️ Topic near-duplicate detected: "${candidate.title}" matches "${dupCheck.matchedTopic}" (${Math.round(dupCheck.similarity * 100)}% similarity). Retrying...`);
        continue;
      }

      // Content Quality Gate check
      try {
        validateShortQuality(candidate);
        data = candidate;
        break; // Quality gate passed!
      } catch (qErr) {
        console.warn(`⚠️ Quality gate failed on attempt ${attempts}: ${qErr.message}`);
        if (attempts === maxAttempts) throw qErr;
      }
    }

    if (!data) throw new Error('Failed to generate script that meets Content Quality Gate.');
    const scriptHash = hashText(data.script);
    const duplicateScript = run.store.findActiveByScriptHash(scriptHash, run.job.id);
    if (duplicateScript) {
      const error = new Error(`Duplicate script hash already belongs to active/published job ${duplicateScript.id}.`);
      error.code = 'DUPLICATE_SCRIPT_HASH';
      error.isBlocked = true;
      throw error;
    }
    run.update({
      scriptHash,
      metadata: { mode: RUN_MODE, title: data.title, topicSlug: data.topic_slug, category: data.topic_category },
    });
    run.transition('scripted');
    endStage(tScript, true, { title: data.title, topicSlug: data.topic_slug });

    console.log(`✨ Script Verified: "${data.title}"`);
    console.log(`   Topic Slug : ${data.topic_slug}`);
    console.log(`   Category   : ${data.topic_category}`);
    console.log(`   Script     : ${data.script}`);

    // ── Stage 2: Voice Synthesis ─────────────────────────────────────────────
    const tTTS = startStage('Stage 2: Voiceover Synthesis');
    const voice = selectVoice();
    console.log(`   Selected Voice: ${voice}`);
    await synthesize(data.script, voice, AUDIO_PATH);
    endStage(tTTS, true, { voice });

    // ── Stage 3: B-Roll Acquisition ──────────────────────────────────────────
    const tPexels = startStage('Stage 3: Pexels B-Roll Acquisition');
    const videoPaths = [];
    for (const seg of data.visualSegments) {
      const dest = path.join(TEMP_DIR, `scene_${seg.part}.mp4`);
      console.log(`   Scene ${seg.part}: "${seg.keyword}"`);
      const ok = await fetchAndDownload(seg.keyword, dest, 'portrait', FALLBACK);
      if (ok) videoPaths.push(dest);
    }
    if (videoPaths.length !== data.visualSegments.length || videoPaths.length < 5) {
      throw new Error(`B-roll validation failed: expected ${data.visualSegments.length} scenes and received ${videoPaths.length}.`);
    }
    endStage(tPexels, true, { scenesCount: videoPaths.length });

    // ── Stage 4a: FFmpeg Compile ──────────────────────────────────────────────
    run.transition('rendering', { scenesCount: videoPaths.length });
    const tCompile = startStage('Stage 4a: Multi-Scene Video Compilation');
    await compileShortVideo(videoPaths, AUDIO_PATH, UNCAP_PATH);
    endStage(tCompile, true);

    // ── Stage 4b: Burn Captions ───────────────────────────────────────────────
    const tCaptions = startStage('Stage 4b: Whisper Dynamic Subtitles');
    burnCaptions({
      inputPath:  UNCAP_PATH,
      outputPath: FINAL_PATH,
      targetY:    1450,
      canvasW:    1080,
      canvasH:    1920,
      transcriptPath: TRANSCRIPT_PATH
    });
    endStage(tCaptions, true);

    // ── Stage 4c: Media Render Integrity Verification ───────────────────────
    run.transition('validating');
    const tValidate = startStage('Stage 4c: Media Render Integrity Check');
    const transcriptStatus = validateTranscriptMatch(data.script, TRANSCRIPT_PATH);
    const mediaStatus = await validateMediaIntegrity(FINAL_PATH, 'short');
    const videoFingerprint = fingerprintFile(FINAL_PATH);
    const duplicate = run.store.findByVideoFingerprint(videoFingerprint);
    if (duplicate && duplicate.id !== run.job.id) {
      const error = new Error(`Duplicate rendered video fingerprint already belongs to job ${duplicate.id}.`);
      error.code = 'DUPLICATE_VIDEO_FINGERPRINT';
      error.isBlocked = true;
      throw error;
    }
    run.update({ validationResult: { media: mediaStatus, transcript: transcriptStatus }, videoFingerprint });
    run.transition('ready_to_publish');
    endStage(tValidate, true, mediaStatus.details);

    // ── Stage 5: Upload & Distribution ───────────────────────────────────────
    if (SKIP_UPLOAD) {
      console.log('\n⏩ [--skip-upload] Upload skipped. Video saved locally:', FINAL_PATH);
      return;
    }

    const tUpload = startStage('Stage 5: YouTube Upload & Scheduling');
    const description = buildShortDescription(data);
    const tags = ['shorts', 'education', ...data.keywords].slice(0, 15);

    if (!IS_DRY_RUN) run.transition('uploading');
    const uploadResult = await uploadToYouTube({
      videoPath:   FINAL_PATH,
      title:       data.title,
      description,
      tags,
      categoryId:  '27',
      type:        'short',
      dryRun:      IS_DRY_RUN,
      humanReview: IS_REVIEW
    });
    if (IS_DRY_RUN) {
      run.update({ metadata: { ...run.job.metadata, dryRunSimulation: uploadResult } });
      endStage(tUpload, true, { simulated: true });
      console.log(`\n🧪 Dry run complete. Job remains ready_to_publish: ${run.job.id}`);
      return;
    }
    run.update({ youtubeVideoId: uploadResult.videoId, publishAt: uploadResult.publishAt });
    run.transition(IS_REVIEW ? 'needs_review' : 'published');
    endStage(tUpload, true, { videoId: uploadResult.videoId, simulated: uploadResult.simulated });

    // ── Stage 6: Analytics & Memory Logging ──────────────────────────────────
    const tLogging = startStage('Stage 6: Memory & Analytics Logging');
    if (LIVE_PUBLISH) {
      logPublished({
        title:      data.title,
        topicSlug:  data.topic_slug,
        category:   data.topic_category,
        youtubeId:  uploadResult.videoId,
        type:       'short'
      });
    }

    recordAnalyticsEntry({
      youtubeId:   uploadResult.videoId,
      title:       data.title,
      topicSlug:   data.topic_slug,
      format:      'short',
      category:    data.topic_category,
      publishAt:   uploadResult.publishAt,
      wordCount:   data.script.split(/\s+/).length,
      durationSec: mediaStatus.details.duration,
      sceneCount:  videoPaths.length
    });
    endStage(tLogging, true);

    console.log(`\n🎉 Short Production Pipeline Complete!`);
    console.log(`   Title      : ${data.title}`);
    console.log(`   Watch Link : ${uploadResult.link}`);

  } catch (error) {
    if (run) run.fail(error);
    throw error;
  } finally {
    if (run) {
      try { run.cleanupTemp(); } catch (cleanupError) { logError('Short temp cleanup', cleanupError); }
      run.close();
    }
  }
}

main().catch(err => {
  logError('short.js main()', err);
  process.exit(1);
});
