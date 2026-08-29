# 🎬 DeedLamp AI — Modular YouTube Channel Automation Platform

An upgraded, modular end-to-end AI publication engine built with Node.js ES Modules, Python, FFmpeg, and Faster-Whisper. It plans, scriptwrites, voice-synthesizes, gathers B-roll, edits, captions, and publishes YouTube Shorts and 4-ACT mini-documentaries hands-free under **The Weird Archivist** persona.

---

## 📌 Executive Summary & Brand Identity

**DeedLamp** is a story-driven educational YouTube channel hosted by **The Weird Archivist** — a persona that unearths strange historical anomalies, biological extremes, psychological phenomena, physics edge cases, and engineering disasters.

The system features a modular architecture:
1. **Short-Form Agent (`short.js`)**: Generates 25-second vertical (9:16) Shorts with mid-scene story openers, 4-beat narrative beats, dynamic Whisper captions, and SEO-first metadata.
2. **Long-Form Agent (`long.js`)**: Generates 4-minute 16:9 landscape mini-documentaries ("The Archive" series) featuring 4-ACT storytelling, 8 landscape B-roll scenes, channel logo watermark overlay, chapter markers, and a verbal subscribe CTA.
3. **Preflight & Production Safeguards**: Includes automated system preflight checks (`core/preflight.js`), content quality gates (`core/quality-gate.js`), media render integrity verification (`core/validator.js`), near-duplicate topic similarity protection (`core/memory.js`), structured stage timing logs (`core/logger.js`), analytics performance tracking (`core/analytics.js`), and dry-run simulation modes.
4. **Scheduled Uploads**: Uses YouTube's `publishAt` API to schedule publishing at peak engagement time (18:00 local time) in Category `27` (Education).

---

## 🛠️ Modular System Architecture

```mermaid
flowchart TD
    A[CLI / Scheduler Trigger: short.js | long.js] --> B[core/preflight.js]
    B -->|Passed| C[core/memory.js: Near-Duplicate Check]

    %% Memory & Prompts
    C --> F1[prompts/short-prompt.js]
    C --> F2[prompts/long-prompt.js]

    %% Gemini AI Brain & Quality Gate
    F1 & F2 --> G[core/gemini.js: Gemini 2.5 Flash]
    G --> H[core/quality-gate.js: Anti-AI Quality Gate]
    H -->|Passed| I[core/tts.js: EdgeTTS Christopher/Ryan/Guy]

    %% B-Roll & Editing
    H --> J[core/pexels.js: Pexels API HD Clips]
    J & I --> K1[core/ffmpeg-short.js]
    J & I --> K2[core/ffmpeg-long.js + Logo Overlay]
    K1 & K2 --> L[core/captions.js: burn_captions.py - Whisper]

    %% Validation & Distribution
    L --> M[core/validator.js: Media Render Integrity Check]
    M -->|Passed| N{Dry-Run / Human Review?}
    N -->|Live Schedule| O[core/youtube.js: Upload publishAt 18:00]
    N -->|Simulation| P[Log Dry-Run Report]
    O --> Q[core/analytics.js: Record Metrics Stub]
```

---

## 📂 Codebase & Directory Layout

```
k:\1.Projects\youtube\
├── core/
│   ├── identity.js          # Channel persona, voice weights, banned words & openers
│   ├── memory.js            # JSON memory read/write & Jaccard near-duplicate topic detection
│   ├── gemini.js            # Gemini API wrapper with retry & JSON parsing
│   ├── pexels.js            # Pexels B-roll fetcher with fallback handling
│   ├── tts.js               # EdgeTTS synthesizer module
│   ├── ffmpeg-short.js      # Short-form 1080x1920 9:16 FFmpeg pipeline
│   ├── ffmpeg-long.js       # Long-form 1920x1080 16:9 FFmpeg pipeline (8 scenes + logo overlay)
│   ├── captions.js          # Whisper caption runner wrapper
│   ├── preflight.js         # System & env preflight validation suite
│   ├── quality-gate.js      # Script & content quality validator
│   ├── validator.js         # Media render integrity checker (ffprobe, resolution, audio)
│   ├── logger.js            # Structured execution & stage timing logger
│   ├── analytics.js        # Performance metrics tracker for data/analytics.json
│   └── youtube.js           # YouTube upload module (dry-run, human review, category 27, publishAt 18:00)
├── prompts/
│   ├── short-prompt.js      # Story-first 4-beat Short prompt & description builder
│   └── long-prompt.js       # 4-ACT documentary prompt with outro CTA & chapter generator
├── data/
│   ├── memory.json          # Structured database of published topics & slugs
│   └── analytics.json       # Performance analytics tracking database
├── logs/                    # Structured JSONL execution logs (execution.jsonl)
├── archive/                 # Rollback backup of original legacy scripts (.bak)
├── assets/
│   ├── logo.png             # Channel watermark logo
│   └── arial.ttf            # Subtitle font
├── short.js                 # Primary Short-Form Agent (supports --dry-run, --review, --skip-upload)
├── long.js                  # Primary Long-Form Agent (supports --dry-run, --review, --skip-upload)
├── smoke-test.js            # End-to-end automated smoke test suite
├── run-short.bat            # Windows batch runner for short.js
├── run-long.bat             # Windows batch runner for long.js
├── silent-short.vbs         # Hidden background VBScript runner for Shorts
├── silent-long.vbs          # Hidden background VBScript runner for Long-Form
├── burn_captions.py         # Faster-Whisper caption hardburner with canvas scaling
├── process_videos.py        # Standalone batch video processor
└── get-token.js             # OAuth2 refresh token setup helper
```

---

## 🎙️ Voice & Persona Identity

- **Persona**: **The Weird Archivist** — authoritative, curious, urgent, slightly conspiratorial.
- **Voice Weights**:
  - **Primary (60% weight)**: `en-US-ChristopherNeural` (Main voice of the Archivist)
  - **Alternates (20% weight each)**: `en-GB-RyanNeural` (Historical gravitas) & `en-US-GuyNeural` (Psychological/nature warmth)
- **Banned Vocabulary**: Words like *"fascinating"*, *"interesting"*, *"remarkable"*, *"mind-blowing"*, *"incredible"*, and AI openers like *"Did you know"* or *"Imagine if"* are strictly prohibited in prompt generation.

---

## 🎬 Narrative Structures

### Short-Form (4-Beat Structure)
- **Beat 1 — The Drop (0–4s)**: Open mid-scene with a specific name, date, or number. No preamble.
- **Beat 2 — The Strange Detail (5–12s)**: Sensory and paradoxical details.
- **Beat 3 — The Reframe (13–20s)**: Emotional payload or twist.
- **Beat 4 — The Loop (21–25s)**: Unresolved closing image inviting repeat watch.

### Long-Form (4-ACT Documentary Structure)
- **ACT 1 — The Inciting Detail (0:00–0:45)**: Specific real fact opening.
- **ACT 2 — The Context (0:45–1:45)**: Human element + sensory detail.
- **ACT 3 — The Escalation (1:45–3:00)**: Turn of events and escalation.
- **ACT 4 — The Echo (3:00–3:45)**: Lingering human takeaway.
- **Outro (3:45–4:00)**: Spoken subscribe CTA: *"If you want more from The Archive, subscribe. The next one is stranger than this."*
- **8 Scene B-Roll Clips**: 8 distinct landscape footage segments per video.

---

## 🚀 Execution & CLI Commands

### 1. Run Automated Smoke Test Suite
Validates preflight, prompt generation, quality gates, rendering, and dry-run uploads across both Shorts and Long-form:
```bash
node smoke-test.js
```

### 2. Run Short-Form Agent
```bash
node short.js [options]
```
**Available CLI Flags:**
- `--dry-run`: Full pipeline test without uploading to YouTube.
- `--review`: Uploads video as a Private Draft for manual review in YouTube Studio.
- `--skip-upload`: Generates and renders video locally without uploading.

### 3. Run Long-Form Agent
```bash
node long.js [options]
```
**Available CLI Flags:**
- `--dry-run`: Full pipeline test without uploading to YouTube.
- `--review`: Uploads video as a Private Draft for manual review in YouTube Studio.
- `--skip-upload`: Generates and renders video locally without uploading.

### 4. Windows Task Scheduler
Set Windows Task Scheduler to run `silent-short.vbs` and `silent-long.vbs` daily.
