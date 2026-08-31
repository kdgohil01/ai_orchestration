// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Long-Form Agent (Upgraded & Hardened)
// Supports CLI flags: --dry-run, --review, --skip-upload, --help
// Features: Preflight checks, Quality Gates, Render Validation, Near-Duplicate Check
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import { config } from './core/config.js';

import { selectVoice }                      from './core/identity.js';
import { getTopicsUsed, logPublished, checkNearDuplicate } from './core/memory.js';
import { generateJSON }                      from './core/gemini.js';
import { synthesize }                        from './core/tts.js';
import { fetchAndDownload }                  from './core/pexels.js';
import { compileLongVideo }                  from './core/ffmpeg-long.js';
import { burnCaptions }                      from './core/captions.js';
import { uploadToYouTube, verifyYouTubeUpload } from './core/youtube.js';
import { validateLongQuality }               from './core/quality-gate.js';
import { validateMediaIntegrity }            from './core/validator.js';
import { assertNoSecretLeaks }               from './core/security.js';
import { sendFailureNotification }           from './core/notifications.js';
import { runPreflight }                      from './core/preflight.js';
import { recordAnalyticsEntry }              from './core/analytics.js';
import { startStage, endStage, logError }    from './core/logger.js';
import { buildLongPrompt, buildLongDescription } from './prompts/long-prompt.js';
import { PipelineRun, fingerprintFile, hashText } from './core/pipeline-run.js';
import { validateTranscriptMatch } from './core/transcript-validator.js';
import { discoverApprovedResearch, formatSourceContext, validateFactualCitations, writeSourceManifest } from './core/sources.js';

// Parse CLI Flags
const args = process.argv.slice(2);
const RESUME_JOB_ID = args.find(arg => arg.startsWith('--job-id='))?.slice('--job-id='.length) || null;
const APPROVED_TOPIC_ID = args.find(arg => arg.startsWith('--topic='))?.slice('--topic='.length) || null;
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
DeedLamp Long-Form Documentary Agent
Usage: node long.js [options]

Options:
  --dry-run      Run full pipeline without uploading to YouTube (simulation)
  --review       Upload video as a Private Draft for manual review
  --publish      Explicitly allow a live scheduled YouTube upload
  --skip-upload  Generate and render video locally without uploading
                 This is also the safe default when no mode is supplied
  --topic=ID     Use one reviewed topic from config/approved-topics.json
  --help         Show this help message
`);
  process.exit(0);
}

const FALLBACK    = path.resolve('fallback_long.mp4');

async function main() {
  let run = null;
  const startTime = new Date().toISOString();
  console.log(`\n🟢 [${startTime}] Long-Form Agent Started. Mode: ${RUN_MODE}`);
  if (IS_DRY_RUN) console.log('🧪 MODE: DRY-RUN SIMULATION (No live YouTube uploads)');
  if (IS_REVIEW)  console.log('📝 MODE: HUMAN REVIEW (Uploads as private draft)');
  if (SKIP_UPLOAD) console.log('🔒 MODE: LOCAL-ONLY (Live upload requires explicit --publish)');

  try {
    run = new PipelineRun('long', RUN_MODE, { jobId: RESUME_JOB_ID });
    const { tempDir: TEMP_DIR, audioPath: AUDIO_PATH, uncaptionedPath: UNCAP_PATH, finalPath: FINAL_PATH } = run;
    const TRANSCRIPT_PATH = path.join(TEMP_DIR, 'transcript.json');
    console.log(`   Job ID: ${run.job.id}`);

    const tPreflight = startStage('Preflight System Checks');
    runPreflight({ checkYoutube: LIVE_PUBLISH || IS_REVIEW });
    endStage(tPreflight, true, { jobId: run.job.id });

    // ── Stage 1: Documentary Script & Quality Gate ───────────────────────────
    const tScript = startStage('Stage 1: 4-ACT Script Generation & Quality Gate');
    let data = null;
    let citationStatus = null;
    let attempts = 0;
    let repairFeedback = '';
    const maxAttempts = 4;
    const topicsUsed = getTopicsUsed();
    const { discovery, sources } = await discoverApprovedResearch({ kind: 'long', topicsUsed, topicId: APPROVED_TOPIC_ID });
    const sourceManifest = writeSourceManifest(run.outputDir, discovery, sources);
    run.update({
      sourceUrls: sources.map(source => source.url),
      assetPaths: { ...run.job.asset_paths, sourceManifest },
      metadata: { ...run.job.metadata, research: discovery },
    });
    const researchContext = { sourceContext: formatSourceContext(discovery, sources) };

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`\n🤖 Script Generation Attempt ${attempts}/${maxAttempts}...`);
      const prompt     = `${buildLongPrompt(topicsUsed, researchContext)}${repairFeedback}`;
      const candidate  = await generateJSON(prompt);

      if (candidate.topic_slug !== discovery.topic_slug || candidate.topic_category !== discovery.topic_category) {
        console.warn('⚠️ Generated documentary changed the approved research topic. Retrying...');
        repairFeedback = `\n\nREPAIR REQUIRED: Keep topic_slug exactly "${discovery.topic_slug}" and topic_category exactly "${discovery.topic_category}". Correct this invalid JSON instead of choosing another topic:\n${JSON.stringify(candidate).slice(0, 20_000)}`;
        continue;
      }

      // Check near-duplicate memory
      const dupCheck = checkNearDuplicate(candidate.topic_slug || candidate.title);
      if (dupCheck.isDuplicate) {
        console.warn(`⚠️ Topic near-duplicate detected: "${candidate.title}" matches "${dupCheck.matchedTopic}" (${Math.round(dupCheck.similarity * 100)}% similarity). Retrying...`);
        continue;
      }

      // Content Quality Gate check
      try {
        validateLongQuality(candidate);
        citationStatus = validateFactualCitations(candidate, sources, { scriptField: 'fullScript', minimumClaims: 8 });
        data = candidate;
        break; // Quality gate passed!
      } catch (qErr) {
        console.warn(`⚠️ Quality gate failed on attempt ${attempts}: ${qErr.message}`);
        repairFeedback = `\n\nREPAIR REQUIRED: The previous response failed validation: ${qErr.message}\nCorrect this invalid JSON while preserving its approved topic:\n${JSON.stringify(candidate).slice(0, 20_000)}\nEvidence quotes must copy words directly from the supplied source excerpts.`;
        if (attempts === maxAttempts) throw qErr;
      }
    }

    if (!data) throw new Error('Failed to generate documentary script that meets Content Quality Gate.');
    const scriptHash = hashText(data.fullScript);
    const duplicateScript = run.store.findActiveByScriptHash(scriptHash, run.job.id);
    if (duplicateScript) {
      const error = new Error(`Duplicate script hash already belongs to active/published job ${duplicateScript.id}.`);
      error.code = 'DUPLICATE_SCRIPT_HASH';
      error.isBlocked = true;
      throw error;
    }
    run.update({
      scriptHash,
      metadata: { ...run.job.metadata, mode: RUN_MODE, title: data.title, topicSlug: data.topic_slug, category: data.topic_category },
    });
    run.transition('scripted');
    endStage(tScript, true, { title: data.title, topicSlug: data.topic_slug });

    console.log(`✨ Documentary Script Verified: "${data.title}"`);
    console.log(`   Topic Slug : ${data.topic_slug}`);
    console.log(`   Category   : ${data.topic_category}`);
    console.log(`   Word Count : ~${data.fullScript.split(/\s+/).length} words`);

    // ── Stage 2: Voiceover Synthesis ─────────────────────────────────────────
    const tTTS = startStage('Stage 2: Master Voiceover Synthesis');
    const voice = selectVoice();
    console.log(`   Selected Voice: ${voice}`);
    await synthesize(data.fullScript, voice, AUDIO_PATH);
    endStage(tTTS, true, { voice });

    // ── Stage 3: B-Roll Acquisition (8 Scenes) ──────────────────────────────
    const tPexels = startStage('Stage 3: 8 Landscape B-Roll Scenes Acquisition');
    const videoPaths = [];
    for (const seg of data.visualSegments) {
      const dest = path.join(TEMP_DIR, `scene_${seg.part}.mp4`);
      console.log(`   Scene ${seg.part}: "${seg.keyword}"`);
      const ok = await fetchAndDownload(seg.keyword, dest, 'landscape', FALLBACK);
      if (ok) videoPaths.push(dest);
    }
    if (videoPaths.length !== data.visualSegments.length || videoPaths.length < 8) {
      throw new Error(`B-roll validation failed: expected ${data.visualSegments.length} scenes and received ${videoPaths.length}.`);
    }
    endStage(tPexels, true, { scenesCount: videoPaths.length });

    // ── Stage 4a: FFmpeg Compile ──────────────────────────────────────────────
    run.transition('rendering', { scenesCount: videoPaths.length });
    const tCompile = startStage('Stage 4a: Multi-Scene Video Compilation');
    await compileLongVideo(videoPaths, AUDIO_PATH, UNCAP_PATH);
    endStage(tCompile, true);

    // ── Stage 4b: Burn Captions ───────────────────────────────────────────────
    const tCaptions = startStage('Stage 4b: Whisper Dynamic Subtitles');
    burnCaptions({
      inputPath:  UNCAP_PATH,
      outputPath: FINAL_PATH,
      targetY:    900,
      canvasW:    1920,
      canvasH:    1080,
      transcriptPath: TRANSCRIPT_PATH
    });
    endStage(tCaptions, true);

    // ── Stage 4c: Media Render Integrity Verification ───────────────────────
    run.transition('validating');
    const tValidate = startStage('Stage 4c: Media Render Integrity Check');
    const transcriptStatus = validateTranscriptMatch(data.fullScript, TRANSCRIPT_PATH);
    const mediaStatus = await validateMediaIntegrity(FINAL_PATH, 'long');
    const securityStatus = assertNoSecretLeaks([run.outputDir, config.logDir]);
    const videoFingerprint = fingerprintFile(FINAL_PATH);
    const duplicate = run.store.findByVideoFingerprint(videoFingerprint);
    if (duplicate && duplicate.id !== run.job.id) {
      const error = new Error(`Duplicate rendered video fingerprint already belongs to job ${duplicate.id}.`);
      error.code = 'DUPLICATE_VIDEO_FINGERPRINT';
      error.isBlocked = true;
      throw error;
    }
    run.update({ validationResult: { citations: citationStatus, media: mediaStatus, transcript: transcriptStatus, security: securityStatus }, videoFingerprint });
    run.transition('ready_to_publish');
    endStage(tValidate, true, mediaStatus.details);

    // ── Stage 5: Upload & Distribution ───────────────────────────────────────
    if (SKIP_UPLOAD) {
      console.log('\n⏩ [--skip-upload] Upload skipped. Video saved locally:', FINAL_PATH);
      return;
    }

    const tUpload = startStage('Stage 5: YouTube Upload & Scheduling');
    const description = buildLongDescription(data);
    const tags = ['documentary', 'education', 'archive', ...data.keywords].slice(0, 15);

    if (!IS_DRY_RUN) {
      run.update({
        metadata: {
          ...run.job.metadata,
          uploadIntent: {
            createdAt: new Date().toISOString(),
            jobId: run.job.id,
            videoFingerprint: run.job.video_fingerprint,
            title: data.title,
          },
        },
      });
      run.transition('uploading');
    }
    const uploadResult = await uploadToYouTube({
      videoPath:   FINAL_PATH,
      title:       data.title,
      description,
      tags,
      categoryId:  '27',
      chapters:    data.chapters,
      type:        'long',
      dryRun:      IS_DRY_RUN,
      humanReview: IS_REVIEW,
      jobId: run.job.id
    });
    run.store.recordEvent(run.job.id, 'email_notification', uploadResult.notification);
    if (IS_DRY_RUN) {
      run.update({ metadata: { ...run.job.metadata, dryRunSimulation: uploadResult } });
      endStage(tUpload, true, { simulated: true });
      console.log(`\n🧪 Dry run complete. Job remains ready_to_publish: ${run.job.id}`);
      return;
    }
    run.update({ youtubeVideoId: uploadResult.videoId, publishAt: uploadResult.publishAt });
    const uploadVerification = await verifyYouTubeUpload(uploadResult.videoId, {
      onCheck: check => run.store.recordEvent(run.job.id, 'upload_status_check', check),
    });
    run.update({
      validationResult: { ...run.job.validation_result, youtubeUpload: uploadVerification },
    });
    if (!uploadVerification.valid) {
      const error = new Error(`YouTube upload ${uploadResult.videoId} could not be verified after bounded checks.`);
      error.code = 'YOUTUBE_UPLOAD_VERIFICATION_FAILED';
      error.isUploadAmbiguous = true;
      throw error;
    }
    const finalState = IS_REVIEW || uploadVerification.needsReview ? 'needs_review' : 'published';
    run.transition(finalState);
    endStage(tUpload, true, { videoId: uploadResult.videoId, simulated: uploadResult.simulated });

    // ── Stage 6: Analytics & Memory Logging ──────────────────────────────────
    const tLogging = startStage('Stage 6: Memory & Analytics Logging');
    if (LIVE_PUBLISH && finalState === 'published') {
      logPublished({
        title:      data.title,
        topicSlug:  data.topic_slug,
        category:   data.topic_category,
        youtubeId:  uploadResult.videoId,
        type:       'long'
      });
    }

    recordAnalyticsEntry({
      youtubeId:   uploadResult.videoId,
      title:       data.title,
      topicSlug:   data.topic_slug,
      format:      'long',
      category:    data.topic_category,
      publishAt:   uploadResult.publishAt,
      wordCount:   data.fullScript.split(/\s+/).length,
      durationSec: mediaStatus.details.duration,
      sceneCount:  videoPaths.length
    });
    endStage(tLogging, true);

    console.log(`\n🎉 Long-Form Documentary Production Complete!`);
    console.log(`   Title      : ${data.title}`);
    console.log(`   Watch Link : ${uploadResult.link}`);

  } catch (error) {
    if (run) {
      const failedJob = run.fail(error);
      const notification = await sendFailureNotification({ job: failedJob, error });
      run.store.recordEvent(run.job.id, 'failure_notification', notification);
    }
    throw error;
  } finally {
    if (run) {
      try { run.cleanupTemp(); } catch (cleanupError) { logError('Long temp cleanup', cleanupError); }
      run.close();
    }
  }
}

main().catch(err => {
  logError('long.js main()', err);
  process.exit(1);
});
