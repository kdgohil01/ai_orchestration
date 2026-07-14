import { GoogleGenerativeAI } from '@google/generative-ai';
import { EdgeTTS } from 'edge-tts-universal';
import { createClient } from 'pexels';
import { google } from 'googleapis';
import ffmpeg from 'fluent-ffmpeg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import https from 'https';
import nodemailer from 'nodemailer';

dotenv.config();

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pexels = createClient(process.env.PEXELS_API_KEY);

// 💡 UNIQUE PATHS: Using "long_" prefix so it never clashes with your short agent paths
const AUDIO_PATH = path.resolve('long_voice.mp3');
const FINAL_VIDEO_PATH = path.resolve('long_output.mp4');
const LOG_PATH = path.resolve('history-log.txt'); // Shares the same memory log to avoid matching topic overlap!
const TEMP_DIR = path.resolve('long_temp');

async function main() {
  try {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

    let pastTopics = "";
    if (fs.existsSync(LOG_PATH)) {
      pastTopics = fs.readFileSync(LOG_PATH, 'utf8').trim();
    }

    console.log('🤖 Long Agent Stage 1: Asking Gemini for a deep mini-documentary script...');
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `Create an engaging, highly detailed historical mini-documentary script (about 3 to 5 minutes long when spoken, approx 450-750 words). 
    The topic must focus on a "Deep Dive" into a Historical Absurdity or bizarre event (e.g., People vs. Nature/Animals), providing the evidence and the "why" behind it.
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

    const aiResponse = await model.generateContent(prompt);
    let responseText = aiResponse.response.text().trim();
    if (responseText.startsWith('```json')) {
      responseText = responseText.substring(7, responseText.length - 3).trim();
    } else if (responseText.startsWith('```')) {
      responseText = responseText.substring(3, responseText.length - 3).trim();
    }

    const data = JSON.parse(responseText);
    console.log(`✨ Long Gemini generated: "${data.title}"`);

    console.log('🎙️ Long Agent Stage 2: Compiling continuous master voiceover track...');
    const tts = new EdgeTTS(data.fullScript, 'en-US-ChristopherNeural');
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
    await fs.promises.writeFile(AUDIO_PATH, audioBuffer);
    console.log('✅ Master voiceover saved.');

    console.log('📹 Long Agent Stage 3: Fetching multi-scene landscape footage from Pexels...');
    const localVideoPaths = [];
    
    for (const segment of data.visualSegments) {
      console.log(`🔍 Searching scene ${segment.part} for landscape keyword: "${segment.keyword}"`);
      // 💡 NOTICE: Locked to landscape orientation for wide desktop viewing
      const pexelsRes = await pexels.videos.search({ query: segment.keyword, per_page: 3, orientation: 'landscape' });
      let videoUrl = pexelsRes.videos?.[Math.floor(Math.random() * (pexelsRes.videos?.length || 1))]?.video_files.find(f => f.quality === 'hd')?.link;
      
      const destPath = path.join(TEMP_DIR, `scene_${segment.part}.mp4`);
      if (videoUrl) {
        await downloadFile(videoUrl, destPath);
        localVideoPaths.push(destPath);
      } else {
        console.log(`Fallback applied for scene ${segment.part}`);
        fs.copyFileSync(path.resolve('fallback_long.mp4'), destPath); // Ensure you have a landscape fallback_long.mp4 ready
        localVideoPaths.push(destPath);
      }
    }

    console.log('🎬 Long Agent Stage 4: Sewing multi-clip timeline asset blocks with FFmpeg...');
    await compileLongVideo(localVideoPaths, AUDIO_PATH, FINAL_VIDEO_PATH);
    console.log('✅ Final cinematic render ready: long_output.mp4');

    console.log('🚀 Long Agent Stage 5: Uploading landscape video to your YouTube channel...');
    await uploadToYouTube(FINAL_VIDEO_PATH, data);

    // Save topic to mutual memory log so your agents never repeat each other
    fs.appendFileSync(LOG_PATH, `${data.title}, `);

    // Clean up local temp segments
    if (fs.existsSync(AUDIO_PATH)) fs.unlinkSync(AUDIO_PATH);
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('🏁 Long-Form Production Finished Smoothly!');

    // 1️⃣ PASTE HERE (Right before the catch block)
    process.exit(0); 

  }
  catch (error) {
    console.error('❌ Long-Form automation sequence failed:', error);
    
    // 2️⃣ PASTE HERE (Inside the catch block)
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

// Robust multi-clip stitching engine that standardizes resolutions and frame rates automatically
function compileLongVideo(videoArray, audioIn, videoOut) {
  return new Promise((resolve, reject) => {
    let proc = ffmpeg();
    
    // Feed each downloaded video block into the processing engine
    videoArray.forEach(vPath => {
      proc = proc.input(vPath);
    });
    
    proc = proc.input(audioIn);

    // 💡 THE FIX: This filter explicitly rescales every video to 1920x1080, 
    // forces 30fps (fps=30), and standardizes sample aspect ratios (setsar=1) before joining them.
    let filterString = "";
    videoArray.forEach((_, index) => {
      filterString += `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${index}];`;
    });
    
    // Concatenate the perfectly standardized video tracks
    videoArray.forEach((_, index) => {
      filterString += `[v${index}]`;
    });
    filterString += `concat=n=${videoArray.length}:v=1:a=0[vct]`;

    proc.outputOptions([
      '-filter_complex', filterString,
      '-map', '[vct]',
      '-map', `${videoArray.length}:a`, // Maps the final audio track input seamlessly
      '-c:v libx264',
      '-c:a aac',
      '-shortest', // Automatically truncates the video track once the audio track finishes
      '-pix_fmt yuv420p'
    ])
    .save(videoOut)
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

  const fullyCompliantDescription = metadata.description;

  const response = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: metadata.title,
        description: fullyCompliantDescription,
        categoryId: '22' 
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

  // Send unique telemetry notification for your long videos
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    await transporter.sendMail({
      from: `"DeedLamp Long Automation" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
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
  } catch (err) {
    console.error('Email telemetry failed:', err.message);
  }
}

main();