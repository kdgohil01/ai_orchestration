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

// Initialize API Clients
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pexels = createClient(process.env.PEXELS_API_KEY);

// Define file processing paths
const AUDIO_PATH = path.resolve('voice.mp3');
const FINAL_VIDEO_PATH = path.resolve('output.mp4');
const LOG_PATH = path.resolve('history-log.txt'); // 💡 New Memory file
const TEMP_DIR = path.resolve('short_temp');

async function main() {
  try {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

    // 💡 Read previous topics from memory log to avoid duplication
    let pastTopics = "";
    if (fs.existsSync(LOG_PATH)) {
      pastTopics = fs.readFileSync(LOG_PATH, 'utf8').trim();
    }

    console.log('🤖 Stage 1: Asking Gemini for a UNIQUE trending Short script...');
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    // 💡 We inject the past topics list straight into the prompt dynamically
    const prompt = `Create a brief, highly engaging script for a 25-second YouTube Short focusing on "Historical Absurdities" (e.g., bizarre contrasts, People vs. Nature/Animals). 
    
    CRITICAL CONSTRAINTS:
    1. Do NOT write about these used topics: [${pastTopics || "None yet"}]
    2. Hook: Must start with either "Did you know..." or "Imagine if..." consistently.
    3. Loop Strategy: The final sentence must perfectly set up the beginning so the video loops seamlessly (e.g., ends with "Imagine..." if it starts with "Imagine if...").
    4. Length: Script must be around 40 words for a 25-second read.
    5. Pacing: Break the visual pacing into exactly 5 sequential parts (each ~5 seconds).
    6. Emojis: Do NOT use ANY emojis in the description or anywhere else.
    
    Return the response strictly as a raw JSON object (do not include any markdown formatting wrappers or backticks) following this exact structure:
    {
      "script": "The text to be read aloud (around 40 words)",
      "title": "A high-CTR title under 50 characters",
      "description": "First 2 lines MUST be a 'bonus fact' not in the video. Then add a specific question (CTA) for comments. Lastly, include 3rd-tier keywords (e.g., 'weird ancient laws').",
      "visualSegments": [
        { "part": 1, "keyword": "A portrait video search term for part 1" },
        { "part": 2, "keyword": "A portrait video search term for part 2" },
        { "part": 3, "keyword": "A portrait video search term for part 3" },
        { "part": 4, "keyword": "A portrait video search term for part 4" },
        { "part": 5, "keyword": "A portrait video search term for part 5" }
      ]
    }`;

    const aiResponse = await model.generateContent(prompt);
    
    // Clean up any potential markdown formatting wrapping the JSON string
    let responseText = aiResponse.response.text().trim();
    if (responseText.startsWith('```json')) {
      responseText = responseText.substring(7, responseText.length - 3).trim();
    } else if (responseText.startsWith('```')) {
      responseText = responseText.substring(3, responseText.length - 3).trim();
    }

    const data = JSON.parse(responseText);
    console.log(`✨ Gemini generated a new topic: "${data.title}"`);

    console.log('🎙️ Stage 2: Generating free AI voiceover via Edge-TTS...');
    const tts = new EdgeTTS(data.script, 'en-US-ChristopherNeural');
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
    await fs.promises.writeFile(AUDIO_PATH, audioBuffer);
    console.log('✅ Voiceover saved as voice.mp3');

    console.log('📹 Stage 3: Fetching multi-scene portrait footage from Pexels...');
    const localVideoPaths = [];
    
    for (const segment of data.visualSegments) {
      console.log(`🔍 Searching scene ${segment.part} for portrait keyword: "${segment.keyword}"`);
      let videoUrl = null;
      try {
        const pexelsRes = await pexels.videos.search({ query: segment.keyword, per_page: 3, orientation: 'portrait' });
        if (pexelsRes.videos && pexelsRes.videos.length > 0) {
          const randomIndex = Math.floor(Math.random() * pexelsRes.videos.length);
          const selectedVideo = pexelsRes.videos[randomIndex];
          videoUrl = selectedVideo.video_files.find(f => f.quality === 'hd')?.link || selectedVideo.video_files[0]?.link;
        }
      } catch (err) {
        console.log(`⚠️ Pexels fetch failed for scene ${segment.part}.`);
      }
      
      const destPath = path.join(TEMP_DIR, `scene_${segment.part}.mp4`);
      if (videoUrl) {
        await downloadFile(videoUrl, destPath);
        localVideoPaths.push(destPath);
      } else {
        console.log(`Using fallback_short.mp4 for scene ${segment.part}.`);
        fs.copyFileSync(path.resolve('fallback_short.mp4'), destPath);
        localVideoPaths.push(destPath);
      }
    }

    console.log('🎬 Stage 4: Sewing multi-clip timeline asset blocks with FFmpeg...');
    await compileShortVideo(localVideoPaths, AUDIO_PATH, FINAL_VIDEO_PATH);
    console.log('✅ Final render ready: output.mp4');

    console.log('🚀 Stage 5: Uploading directly to your YouTube channel...');
    await uploadToYouTube(FINAL_VIDEO_PATH, data);

    // 💡 SAVE TOPIC TO LOG FILE AFTER SUCCESSFUL UPLOAD
    fs.appendFileSync(LOG_PATH, `${data.title}, `);
    console.log(`💾 Saved "${data.title}" into history-log.txt memory stack.`);

    // Clean up temporary workspace items
    if (fs.existsSync(AUDIO_PATH)) fs.unlinkSync(AUDIO_PATH);
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('🏁 Daily Automation Finished Smoothly!');

  } catch (error) {
    console.error('❌ Automation sequence failed:', error);
  }
}

// Helper to handle background video streams
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

// Robust multi-clip stitching engine for shorts that standardizes resolutions and frame rates automatically
function compileShortVideo(videoArray, audioIn, videoOut) {
  return new Promise((resolve, reject) => {
    let proc = ffmpeg();
    
    // Feed each downloaded video block into the processing engine
    videoArray.forEach(vPath => {
      proc = proc.input(vPath);
    });
    
    proc = proc.input(audioIn);

    // This filter explicitly rescales every video to 1080x1920 (portrait), 
    // forces 30fps (fps=30), and standardizes sample aspect ratios (setsar=1) before joining them.
    let filterString = "";
    videoArray.forEach((_, index) => {
      filterString += `[${index}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${index}];`;
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

// YouTube Data API endpoint distribution handler with built-in instant telemetry alerts
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
  console.log(`🎉 Success! Upload completed. Video ID: ${videoId}`);

  // ✉️ TRANSMIT INSTANT TELEMETRY ALERT TO YOUR PHONE
  try {
    console.log('✉️ Sending upload confirmation alert...');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: `"DeedLamp Automation" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, 
      subject: `🎬 Upload Successful: ${metadata.title}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px;">
          <h2 style="color: #4CAF50; margin-top: 0;">🚀 Video Live on DeedLamp!</h2>
          <p><strong>Title:</strong> ${metadata.title}</p>
          <p><strong>Watch Link:</strong> <a href="${videoLink}" style="color: #1e88e5; text-decoration: none; font-weight: bold;">${videoLink}</a></p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #888; font-style: italic;">Processed and triggered completely hands-free by your background Windows Task Engine.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Telemetry confirmation email delivered successfully!');
    
  } catch (emailError) {
    console.error('⚠️ Video uploaded successfully, but confirmation email alert failed:', emailError.message);
  }
}

main();