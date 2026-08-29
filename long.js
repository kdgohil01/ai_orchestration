import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { selectVoice } from './core/identity.js';
import { getTopicsUsed, logPublished, checkNearDuplicate } from './core/memory.js';
import { generateJSON } from './core/gemini.js';
import { verifyFacts } from './core/fact-check.js';
import { synthesize } from './core/tts.js';
import { fetchAndDownload } from './core/pexels.js';
import { compileLongVideo } from './core/ffmpeg-long.js';
import { burnCaptions } from './core/captions.js';
import { uploadToYouTube } from './core/youtube.js';
import { validateLongQuality } from './core/quality-gate.js';
import { validateMediaIntegrity, validateNarrationDuration } from './core/validator.js';
import { buildProportionalChapters } from './core/chapters.js';
import { runPreflight } from './core/preflight.js';
import { recordAnalyticsEntry } from './core/analytics.js';
import { startStage, endStage, failOpenStages, logError } from './core/logger.js';
import { acquirePipelineLock } from './core/state.js';
import { projectPath } from './core/config.js';
import { buildLongPrompt, buildLongDescription } from './prompts/long-prompt.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_UPLOAD = args.includes('--skip-upload');
const PUBLISH = args.includes('--publish');
const REVIEW = args.includes('--review') || !PUBLISH;
if (PUBLISH && args.includes('--review')) throw new Error('Choose either --publish or --review, not both.');
if (args.includes('--help')) {
  console.log('Usage: node long.js [--review|--publish] [--dry-run|--skip-upload]\nDefault: upload as a private review draft. Live scheduling requires --publish and ALLOW_AUTO_PUBLISH=true.');
  process.exit(0);
}

const runId = `${Date.now()}-${process.pid}`;
const tempDir = projectPath('temp', `long-${runId}`);
const outputDir = projectPath('output');
const audioPath = path.join(tempDir, 'voice.mp3');
const uncaptionedPath = path.join(tempDir, 'uncaptioned.mp4');
const finalPath = path.join(outputDir, `long-${runId}.mp4`);
const fallback = projectPath('assets', 'fallback_long.mp4');

async function main() {
  const releaseLock = acquirePipelineLock();
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    let timer = startStage('Preflight');
    await runPreflight({ checkYoutube: !SKIP_UPLOAD && !DRY_RUN, publish: PUBLISH && !DRY_RUN });
    endStage(timer);

    timer = startStage('Script generation, validation, and fact-check');
    let data;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const candidate = await generateJSON(buildLongPrompt(getTopicsUsed()));
        validateLongQuality(candidate);
        const duplicate = checkNearDuplicate(candidate.topic_slug || candidate.title);
        if (duplicate.isDuplicate) throw new Error(`Near-duplicate of "${duplicate.matchedTopic}" (${Math.round(duplicate.similarity * 100)}%).`);
        candidate.factCheck = await verifyFacts(candidate, 'long');
        data = candidate;
        break;
      } catch (err) {
        console.warn(`Candidate ${attempt}/4 rejected: ${err.message}`);
        if (attempt === 4) throw err;
      }
    }
    endStage(timer, true, { title: data.title, factConfidence: data.factCheck.confidence });

    timer = startStage('Voice synthesis');
    const voice = selectVoice();
    await synthesize(data.fullScript, voice, audioPath);
    const narrationDuration = await validateNarrationDuration(audioPath, 'long');
    endStage(timer, true, { voice, narrationDuration });

    timer = startStage('B-roll acquisition');
    const videoPaths = [];
    for (const segment of data.visualSegments) {
      const destination = path.join(tempDir, `scene-${segment.part}.mp4`);
      if (await fetchAndDownload(segment.keyword, destination, 'landscape', fallback)) videoPaths.push(destination);
    }
    if (videoPaths.length !== data.visualSegments.length) throw new Error(`Only ${videoPaths.length}/${data.visualSegments.length} B-roll scenes were available.`);
    endStage(timer, true, { scenesCount: videoPaths.length });

    timer = startStage('Video compilation and captions');
    await compileLongVideo(videoPaths, audioPath, uncaptionedPath);
    await burnCaptions({ inputPath: uncaptionedPath, outputPath: finalPath, targetY: 900, canvasW: 1920, canvasH: 1080 });
    endStage(timer);

    timer = startStage('Media integrity validation');
    const media = await validateMediaIntegrity(finalPath, 'long');
    const chapters = buildProportionalChapters(media.details.duration, data.chapters);
    endStage(timer, true, { ...media.details, chapters });

    if (SKIP_UPLOAD) {
      console.log(`Upload skipped. Output: ${finalPath}`);
      return;
    }

    timer = startStage('YouTube distribution');
    const upload = await uploadToYouTube({
      videoPath: finalPath, title: data.title, description: buildLongDescription(data),
      tags: ['documentary', 'education', 'archive', ...data.keywords].slice(0, 15),
      categoryId: '27', chapters, type: 'long', dryRun: DRY_RUN, humanReview: REVIEW
    });
    endStage(timer, true, { videoId: upload.videoId, status: upload.status });

    if (!DRY_RUN) {
      timer = startStage('Persistent memory and analytics');
      logPublished({
        title: data.title, topicSlug: data.topic_slug, category: data.topic_category,
        youtubeId: upload.videoId, type: 'long', status: upload.status
      });
      recordAnalyticsEntry({
        youtubeId: upload.videoId, title: data.title, topicSlug: data.topic_slug,
        format: 'long', category: data.topic_category, publishAt: upload.publishAt,
        wordCount: data.fullScript.trim().split(/\s+/).length, durationSec: media.details.duration,
        sceneCount: videoPaths.length
      });
      endStage(timer);
    }
    console.log(`Long-form pipeline complete: ${upload.link || finalPath}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    releaseLock();
  }
}

main().catch(err => {
  failOpenStages(err);
  logError('long.js', err);
  process.exitCode = 1;
});
