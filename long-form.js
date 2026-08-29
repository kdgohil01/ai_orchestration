import { GoogleGenerativeAI } from '@google/generative-ai';
import { EdgeTTS } from 'edge-tts-universal';
import { createClient } from 'pexels';
import { google } from 'googleapis';
import ffmpeg from 'fluent-ffmpeg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';
import nodemailer from 'nodemailer';

dotenv.config();

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pexels = createClient(process.env.PEXELS_API_KEY);

const AUDIO_PATH = path.resolve('long_voice.mp3');
const FINAL_VIDEO_PATH = path.resolve('long_output.mp4');
const LOG_PATH = path.resolve('history-log.txt');
const ERROR_LOG_PATH = path.resolve('error-log.txt');
const TEMP_DIR = path.resolve('long_temp');

function logError(stage, error) {
  const timestamp = new Date().toISOString();
  const entry = `\n[${timestamp}] ❌ [LONG] FAILED AT: ${stage}\n  Message : ${error.message}\n  Code    : ${error.code || 'N/A'}\n  Stack   : ${(error.stack || '').split('\n').slice(0, 3).join(' | ')}\n${'─'.repeat(60)}`;
  fs.appendFileSync(ERROR_LOG_PATH, entry, 'utf8');
  console.error(entry);
}

const TTS_VOICES = [
  'en-US-ChristopherNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-GB-RyanNeural',
  'en-US-AriaNeural',
  'en-US-EricNeural'
];

async function generateWithRetry(model, prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      console.warn(`⚠️ Gemini API attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

async function main() {
  const startTime = new Date().toISOString();
  console.log(`\n🟢 [${startTime}] Long-form agent started.`);
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    let pastTopics = "";
    if (fs.existsSync(LOG_PATH)) {
      pastTopics = fs.readFileSync(LOG_PATH, 'utf8').trim();
    }

    const selectedVoice = TTS_VOICES[Math.floor(Math.random() * TTS_VOICES.length)];

    console.log('🤖 Long Agent Stage 1: Asking Gemini for a deep mini-documentary script...');
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Create an engaging, highly detailed mini-documentary script (about 3 to 5 minutes long when spoken, approx 450-750 words).
    Choose a topic from ANY of these categories randomly: historical absurdities, scientific paradoxes, psychological quirks, nature's strangest adaptations, unsolved mysteries, or everyday phenomena explained.
    The topic must focus on a "Deep Dive" into the subject, providing the evidence and the "why" behind it.
    Break the story arc down into exactly 4 sequential parts so we can match it to multiple video clips.

    CRITICAL CONSTRAINT: Do not write about these topics: [${pastTopics || "None yet"}]
    ALSO CRITICAL: Do NOT include ANY emojis in the description or anywhere else.

    Return the response strictly as a raw JSON object (no markdown formatting, no backticks) following this exact structure:
    {
      "title": "A compelling, clickable landscape title under 60 characters",
      "description": "First 2 lines MUST be a 'bonus fact' not in the video. Then add a specific question (CTA) about the topic. Finally, include 3rd-tier keywords.",
      "fullScript": "The complete, continuous script combining all parts seamlessly for the voice engine",
      "visualSegments": [
        { "part": 1, "keyword": "A landscape video search term for the intro scene" },
        { "part": 2, "keyword": "A landscape video search term for the rising action scene" },
        { "part": 3, "keyword": "A landscape video search term for the climax scene" },
        { "part": 4, "keyword": "A landscape video search term for the conclusion scene" }
      ]
    }`;

    let aiResponse;
    try {
      aiResponse = await generateWithRetry(model, prompt);
    } catch (err) {
      logError('Stage 1 - Gemini generateContent', err);
      throw err;
    }
    let responseText = aiResponse.response.text().trim();
    if (responseText.startsWith('```json')) {
      responseText = responseText.substring(7, responseText.length - 3).trim();
    } else if (responseText.startsWith('```')) {
      responseText = responseText.substring(3, responseText.length - 3).trim();
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      logError('Stage 1 - JSON Parse (Gemini response)', err);
      throw err;
    }
    console.log(`✨ Long Gemini generated: "${data.title}" (voice: ${selectedVoice})`);

    console.log('🎙️ Long Agent Stage 2: Compiling continuous master voiceover track...');
    try {
      const tts = new EdgeTTS(data.fullScript, selectedVoice);
      const result = await tts.synthesize();
      const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
      await fs.promises.writeFile(AUDIO_PATH, audioBuffer);
    } catch (err) {
      logError('Stage 2 - Edge-TTS voiceover', err);
      throw err;
    }
    console.log('✅ Master voiceover saved.');

    console.log('📹 Long Agent Stage 3: Fetching multi-scene landscape footage from Pexels...');
    const localVideoPaths = [];

    for (const segment of data.visualSegments) {
      console.log(`🔍 Searching scene ${segment.part} for landscape keyword: "${segment.keyword}"`);
      let videoUrl = null;
      try {
        const pexelsRes = await pexels.videos.search({ query: segment.keyword, per_page: 3, orientation: 'landscape' });
        if (pexelsRes.videos && pexelsRes.videos.length > 0) {
          const randomIndex = Math.floor(Math.random() * pexelsRes.videos.length);
          const selectedVideo = pexelsRes.videos[randomIndex];
          videoUrl = selectedVideo.video_files.find(f => f.quality === 'hd')?.link || selectedVideo.video_files[0]?.link;
        }
      } catch (err) {
        console.log(`⚠️ Pexels fetch failed for scene ${segment.part}: ${err.message}`);
      }

      const destPath = path.join(TEMP_DIR, `scene_${segment.part}.mp4`);
      if (videoUrl) {
        await downloadFile(videoUrl, destPath);
        localVideoPaths.push(destPath);
      } else {
        console.log(`Fallback applied for scene ${segment.part}`);
        fs.copyFileSync(path.resolve('fallback_long.mp4'), destPath);
        localVideoPaths.push(destPath);
      }
    }

    console.log('🎬 Long Agent Stage 4: Sewing multi-clip timeline with branding and captions...');
    const tempUncaptionedPath = path.join(TEMP_DIR, 'uncaptioned_long.mp4');
    try {
      await compileLongVideo(localVideoPaths, AUDIO_PATH, tempUncaptionedPath);
      console.log('🎙️ Long Agent Stage 4b: Hardburning dynamic Whisper captions...');
      execSync(`python burn_captions.py --input "${tempUncaptionedPath}" --output "${FINAL_VIDEO_PATH}" --target-y 900 --canvas-w 1920 --canvas-h 1080`, { stdio: 'inherit' });
    } catch (err) {
      logError('Stage 4 - FFmpeg compilation', err);
      throw err;
    }
    console.log('✅ Final cinematic render ready with burnt-in captions: long_output.mp4');

    console.log('🚀 Long Agent Stage 5: Uploading landscape video to your YouTube channel...');
    try {
      await uploadToYouTube(FINAL_VIDEO_PATH, data);
    } catch (err) {
      logError('Stage 5 - YouTube Upload', err);
      throw err;
    }

    fs.appendFileSync(LOG_PATH, `${data.title}, `);

    if (fs.existsSync(AUDIO_PATH)) fs.unlinkSync(AUDIO_PATH);
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('🏁 Long-Form Production Finished Smoothly!');

    process.exit(0);

  }
  catch (error) {
    logError('main() top-level catch', error);
    console.error('❌ Long-Form automation sequence failed. See error-log.txt for details.');
    process.exit(1);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function compileLongVideo(videoArray, audioIn, videoOut) {
  return new Promise((resolve, reject) => {
    if (videoArray.length === 0) return reject(new Error('No video inputs provided'));

    let proc = ffmpeg();

    videoArray.forEach(vPath => {
      proc = proc.input(vPath);
    });
    proc = proc.input(audioIn);

    const hasLogo = fs.existsSync(path.resolve('logo.png'));

    let filterString = "";
    videoArray.forEach((_, index) => {
      filterString += `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${index}];`;
    });

    videoArray.forEach((_, index) => {
      filterString += `[v${index}]`;
    });
    filterString += `concat=n=${videoArray.length}:v=1:a=0[vct]`;

    let outputOptions = [
      '-filter_complex', filterString,
      '-map', '[vct]',
      '-map', `${videoArray.length}:a`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-shortest',
      '-pix_fmt', 'yuv420p'
    ];

    if (hasLogo) {
      const logoPath = path.resolve('logo.png').replace(/\\/g, '/');
      proc = proc.input(logoPath);
      const logoIndex = videoArray.length + 1;
      // NOTE: semicolon before overlay is REQUIRED to start a new filterchain
      outputOptions = [
        '-filter_complex', `${filterString};[vct][${logoIndex}:v]overlay=W-w-20:20[final]`,
        '-map', '[final]',
        '-map', `${videoArray.length}:a`,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-shortest',
        '-pix_fmt', 'yuv420p'
      ];
    }

    proc.outputOptions(outputOptions)
      .save(videoOut)
      .on('stderr', (stderrLine) => {
        if (/error|invalid|failed|cannot|no such/i.test(stderrLine)) {
          console.error('FFmpeg STDERR:', stderrLine);
        }
      })
      .on('end', resolve)
      .on('error', (err) => {
        console.error('FFmpeg compilation failed details:', err.message);
        reject(err);
      });
  });
}

async function uploadToYouTube(videoPath, metadata) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const hashtags = '#documentary #history #education #didyouknow #mindblown #deeplore';
  const descriptionWithHashtags = `${metadata.description}\n\n${hashtags}`;

  const words = metadata.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2);
  const tags = ['documentary', 'history', 'education', ...words.slice(0, 5)];

  const response = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: metadata.title,
        description: descriptionWithHashtags,
        categoryId: '22',
        tags
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    },
    media: { body: fs.createReadStream(videoPath) }
  });

  const videoId = response.data.id;
  const videoLink = `https://youtu.be/${videoId}`;
  console.log(`🎉 Success! Long-Form Upload completed. Video ID: ${videoId}`);

  try {
    const emailUser = process.env.EMAIL_USER ? process.env.EMAIL_USER.trim() : '';
    const emailPass = process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s+/g, '') : '';

    if (!emailUser || !emailPass) {
      console.warn('⚠️ Email alert skipped: EMAIL_USER or EMAIL_PASS missing in .env');
    } else {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailUser, pass: emailPass }
      });

      await transporter.sendMail({
        from: `"DeedLamp Long Automation" <${emailUser}>`,
        to: emailUser,
        subject: `🎬 Long Video Live: ${metadata.title}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px;">
            <h2 style="color: #1e88e5; margin-top: 0;">🎥 Deep Mini-Doc Live on DeedLamp!</h2>
            <p><strong>Title:</strong> ${metadata.title}</p>
            <p><strong>Watch Link:</strong> <a href="${videoLink}" style="color: #1e88e5; text-decoration: none; font-weight: bold;">${videoLink}</a></p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #888; font-style: italic;">Processed by your long-form multi-clip rendering engine.</p>
          </div>
        `
      });
      console.log('✅ Confirmation email delivered!');
    }
  } catch (err) {
    console.error('Email telemetry failed:', err.message);
  }
}

main();
