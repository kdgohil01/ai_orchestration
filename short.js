// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Short-Form Agent (Upgraded & Hardened)
// Supports CLI flags: --dry-run, --review, --skip-upload, --help
// Features: Preflight checks, Quality Gates, Render Validation, Near-Duplicate Check
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
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

// Parse CLI Flags
const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes('--dry-run');
const IS_REVIEW  = args.includes('--review');
const SKIP_UPLOAD = args.includes('--skip-upload');
const SHOW_HELP  = args.includes('--help');

if (SHOW_HELP) {
  console.log(`
DeedLamp Short-Form Agent
Usage: node short.js [options]

Options:
  --dry-run      Run full pipeline without uploading to YouTube (simulation)
  --review       Upload video as a Private Draft for manual review
  --skip-upload  Generate and render video locally without uploading
  --help         Show this help message
`);
  process.exit(0);
}

const RUN_ID      = Date.now();
const TEMP_DIR    = path.resolve(`temp/short_${RUN_ID}`);
const AUDIO_PATH  = path.join(TEMP_DIR, 'voice.mp3');
const UNCAP_PATH  = path.join(TEMP_DIR, 'uncaptioned.mp4');
const FINAL_PATH  = path.resolve('output_short.mp4');
const FALLBACK    = path.resolve('fallback_short.mp4');

async function main() {
  const startTime = new Date().toISOString();
  console.log(`\n🟢 [${startTime}] Short-Form Agent Started. Run ID: ${RUN_ID}`);
  if (IS_DRY_RUN) console.log('🧪 MODE: DRY-RUN SIMULATION (No live YouTube uploads)');
  if (IS_REVIEW)  console.log('📝 MODE: HUMAN REVIEW (Uploads as private draft)');

  // ── Preflight Checks ───────────────────────────────────────────────────────
  const tPreflight = startStage('Preflight System Checks');
  runPreflight({ checkYoutube: !SKIP_UPLOAD && !IS_DRY_RUN });
  endStage(tPreflight, true);

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  try {
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
    if (videoPaths.length === 0) throw new Error('All B-roll downloads failed.');
    endStage(tPexels, true, { scenesCount: videoPaths.length });

    // ── Stage 4a: FFmpeg Compile ──────────────────────────────────────────────
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
      canvasH:    1920
    });
    endStage(tCaptions, true);

    // ── Stage 4c: Media Render Integrity Verification ───────────────────────
    const tValidate = startStage('Stage 4c: Media Render Integrity Check');
    const mediaStatus = await validateMediaIntegrity(FINAL_PATH, 'short');
    endStage(tValidate, true, mediaStatus.details);

    // ── Stage 5: Upload & Distribution ───────────────────────────────────────
    if (SKIP_UPLOAD) {
      console.log('\n⏩ [--skip-upload] Upload skipped. Video saved locally:', FINAL_PATH);
      return;
    }

    const tUpload = startStage('Stage 5: YouTube Upload & Scheduling');
    const description = buildShortDescription(data);
    const tags = ['shorts', 'education', ...data.keywords].slice(0, 15);

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
    endStage(tUpload, true, { videoId: uploadResult.videoId, simulated: uploadResult.simulated });

    // ── Stage 6: Analytics & Memory Logging ──────────────────────────────────
    const tLogging = startStage('Stage 6: Memory & Analytics Logging');
    if (!IS_DRY_RUN) {
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

  } finally {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  logError('short.js main()', err);
  process.exit(1);
});
