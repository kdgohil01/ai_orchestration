# DeedLamp AI Orchestration

DeedLamp is an evidence-led YouTube production pipeline for Shorts and 3.5-4.5 minute mini-documentaries narrated by **The Weird Archivist**. It generates scripts, verifies them against authoritative source pages, synthesizes narration, downloads B-roll, renders with FFmpeg, burns captions, validates the finished media, and uploads to YouTube.

The safe default is a **private YouTube review draft**. A run cannot schedule public publishing unless both the `--publish` flag and `ALLOW_AUTO_PUBLISH=true` are present.

## Pipeline

~~~mermaid
flowchart TD
    A[CLI or Task Scheduler] --> B[Preflight and single-run lock]
    B --> C[Gemini structured script]
    C --> D[Schema and quality gate]
    D --> E[Duplicate-topic check]
    E --> F[Authoritative source retrieval]
    F --> G[Evidence-based fact-check]
    G --> H[TTS and duration gate]
    H --> I[Pexels B-roll]
    I --> J[Native FFmpeg process]
    J --> K[Whisper captions]
    K --> L[Strict media validation]
    L --> M{Requested mode}
    M -->|Default| N[Private review draft]
    M -->|Explicit publish| O[Scheduled upload]
    M -->|Skip or dry run| P[Local/simulated result]
~~~

## Safety guarantees

- Running `node .` alone only prints help; it never generates or uploads content.
- Review upload is the default for both formats.
- Live scheduling requires `--publish` and `ALLOW_AUTO_PUBLISH=true`.
- Every script must provide two to four authoritative HTTPS sources.
- Source hosts are checked for trust, public DNS resolution, redirects, response type, and readable evidence.
- A separate Gemini critic compares every factual claim with downloaded source excerpts.
- Unsupported, disputed, sensationalized, or low-confidence scripts are rejected before TTS or rendering.
- Dry runs never enter publication memory or production analytics.
- A filesystem lock prevents Short and long-form jobs from changing state concurrently.
- Runtime JSON is written atomically to reduce corruption risk.

## Requirements

- Node.js 20.11 or newer
- Python 3.10-3.12 recommended
- FFmpeg and FFprobe available in `PATH`
- Google Gemini API key
- Pexels API key
- Google OAuth desktop client for YouTube uploads and Analytics

## Installation

~~~bash
git clone https://github.com/kdgohil01/ai_orchestration.git
cd ai_orchestration
npm ci
python -m venv .venv
~~~

Activate the virtual environment:

~~~powershell
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
~~~

Copy `.env.example` to `.env`, then fill in the required values. Never commit `.env`.

Place these optional local assets in `assets/`:

- `logo.png` — long-form watermark
- `arial.ttf` — bundled font asset
- `fallback_short.mp4` — used when a Short B-roll request fails
- `fallback_long.mp4` — used when a long-form B-roll request fails

Fallback videos are intentionally excluded from Git because media files are large and may have separate licensing requirements.

## OAuth setup

Create a Google OAuth desktop application with this redirect URI:

~~~text
http://127.0.0.1:3000/oauth2callback
~~~

Add `CLIENT_ID` and `CLIENT_SECRET` to `.env`, then run:

~~~bash
npm run auth
~~~

The authorization helper now:

- binds only to `127.0.0.1`;
- validates a cryptographically random OAuth state;
- closes after five minutes;
- requests YouTube upload, YouTube read-only, and YouTube Analytics read-only scopes.

Store the returned refresh token as `REFRESH_TOKEN`.

## Commands

~~~bash
# Show safe command help; performs no media or network work
node .

# Upload a private review draft (default)
npm run short
npm run long

# Generate locally without uploading
node short.js --skip-upload
node long.js --skip-upload

# Exercise the complete pipeline but simulate the YouTube action
node short.js --dry-run
node long.js --dry-run

# Explicitly schedule a live publication
node short.js --publish
node long.js --publish

# Update stored YouTube performance metrics
npm run analytics:sync

# Offline tests and static checks
npm test
npm run smoke
~~~

For live scheduling, set:

~~~dotenv
ALLOW_AUTO_PUBLISH=true
PUBLISH_TIMEZONE=Asia/Kolkata
PUBLISH_HOUR=18
~~~

The publishing calculation uses the configured IANA timezone instead of the computer's timezone. It schedules for the next valid 18:00 and keeps the upload private until YouTube publishes it.

## Windows Task Scheduler

The batch and VBS launchers derive the repository path from their own location, so the project can be moved to another drive or folder.

- Use `silent-short.vbs` for background Short runs.
- Use `silent-long.vbs` for background long-form runs.
- With no additional argument, scheduled jobs upload private review drafts.
- For automatic publication, configure the task to call `run-short.bat --publish` or `run-long.bat --publish` and explicitly enable `ALLOW_AUTO_PUBLISH`.

Do not allow overlapping task instances. The application lock also rejects a second concurrent run.

## State, logs, and migration

Mutable files are stored below `.runtime/` and are excluded from Git:

~~~text
.runtime/
├── analytics.json
├── memory.json
├── pipeline.lock
└── logs/
    ├── errors.log
    └── execution.jsonl
~~~

The previous tracked publication history is retained as:

- `data/memory.legacy.json`
- `data/analytics.legacy.json`

On the first upgraded run, the application reads those files as migration fallbacks and writes all future changes to `.runtime/`. Empty schemas are provided in `data/*.example.json`.

The analytics sync command replaces null placeholders with actual views, watch time, average view duration, calculated retention, and subscribers gained. YouTube may take time to expose metrics for a newly uploaded video.

## Content rules

### Shorts

- 38-45 spoken words
- Five portrait B-roll scenes
- 18-32 seconds after TTS and rendering
- Title at most 55 characters
- Concrete person, place, date, number, or measurement in the opening

### Mini-documentaries

- 780-880 spoken words
- Eight landscape B-roll scenes
- 210-270 seconds after TTS and rendering
- Four chapter markers calculated proportionally from measured duration
- Required spoken Archive subscribe CTA

Both formats reject banned AI-style openers, generic hype vocabulary, malformed JSON, wrong segment counts, duplicate source URLs, unsupported categories, vague B-roll keywords, and near-duplicate topics.

## Project structure

~~~text
.
├── .github/workflows/ci.yml
├── assets/
│   ├── logo.png
│   └── arial.ttf
├── core/
│   ├── analytics.js
│   ├── captions.js
│   ├── chapters.js
│   ├── config.js
│   ├── fact-check.js
│   ├── ffmpeg-long.js
│   ├── ffmpeg-short.js
│   ├── gemini.js
│   ├── identity.js
│   ├── logger.js
│   ├── memory.js
│   ├── pexels.js
│   ├── preflight.js
│   ├── process.js
│   ├── quality-gate.js
│   ├── schema.js
│   ├── state.js
│   ├── tts.js
│   ├── validator.js
│   └── youtube.js
├── data/
├── prompts/
├── scripts/
├── test/
├── burn_captions.py
├── get-token.js
├── index.js
├── short.js
└── long.js
~~~

## Production-hardening changes

Version 2.1 performs the following repository-wide corrections:

1. Replaces the unsafe legacy default entry with a non-publishing command dispatcher.
2. Makes private review the default and adds a two-part opt-in for scheduled publication.
3. Adds authoritative-source retrieval, SSRF protections, evidence extraction, and a second-pass factual verification gate.
4. Aligns prompt and validator constraints and adds strict response schema checks.
5. Fixes the false proper-noun detection used by the previous opener gate.
6. Strengthens duplicate detection with normalization, aliases, stemming, phrase similarity, and a lower threshold.
7. Expands long-form scripts and enforces measured narration/render duration.
8. Generates chapter timestamps from actual video length and removes duplicated chapters from descriptions.
9. Makes publication time explicitly timezone-aware.
10. Stops dry-run records from polluting analytics and adds YouTube Analytics synchronization.
11. Replaces non-atomic state writes and adds a single-instance pipeline lock.
12. Records failed stages in structured logs and moves all logs to ignored runtime storage.
13. Adds timeouts, bounded downloads, temporary-file writes, and strict render validation.
14. Replaces the deprecated `fluent-ffmpeg` package with direct argument-safe FFmpeg and FFprobe processes.
15. Secures the OAuth callback with localhost binding, state verification, expanded scopes, and timeout handling.
16. Makes all Windows launchers location-independent.
17. Moves reusable assets under `assets/` and checks optional fallbacks during preflight.
18. Adds `.env.example`, Python requirements, Node engine requirements, useful npm scripts, offline tests, and GitHub Actions CI.
19. Aligns the package license with the repository's MIT license.
20. Removes committed caches, old logs, backup scripts, generated runtime files, and conflicting legacy implementations.

## CI and testing

GitHub Actions runs on pushes and pull requests with Node.js 20 and Python 3.12. It installs locked Node dependencies, installs Python requirements, runs Node unit tests, checks agent syntax, and compiles the Python scripts.

Integration tests are deliberately separate because they consume API quota, download media, and render videos:

~~~bash
npm run test:integration:short
npm run test:integration:long
~~~

## License

MIT
