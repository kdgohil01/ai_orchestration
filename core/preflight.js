// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Preflight System Checker
// Validates environment variables, API keys, folders, binaries, and assets.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { config, validateConfig } from './config.js';
import { resolveMediaTool } from './media-tools.js';

/**
 * Runs preflight validation before any pipeline execution.
 * Throws an Error with detailed diagnostic messages if checks fail.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.checkYoutube=true] - Whether to validate YouTube API credentials
 * @returns {object} Preflight status summary
 */
export function runPreflight({ checkYoutube = true } = {}) {
  console.log('\n🔍 Running DeedLamp Preflight System Checks...');
  const errors = [];
  const warnings = [];

  // 1. Environment variables check
  const configStatus = validateConfig({ requireContentApis: true, requireYoutube: checkYoutube });
  errors.push(...configStatus.errors);
  warnings.push(...configStatus.warnings);

  // 2. Directory permissions check
  const requiredDirs = [config.tempDir, path.dirname(config.databasePath), config.outputDir, config.logDir];
  requiredDirs.forEach(dirPath => {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      // Test write permission
      const testFile = path.join(dirPath, `.write_test_${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (err) {
      errors.push(`Directory write test failed for '${dirPath}': ${err.message}`);
    }
  });

  // 3. Asset & Python script checks
  const requiredFiles = [
    { name: 'burn_captions.py', required: true },
    { name: 'data/memory.json', required: true },
    { name: 'logo.png', required: false, warning: 'Logo overlay will be skipped in long-form renders.' },
    { name: 'arial.ttf', required: false, warning: 'Subtitle font falls back to system Arial.' }
  ];

  requiredFiles.forEach(file => {
    const filePath = path.resolve(file.name);
    if (!fs.existsSync(filePath)) {
      if (file.required) {
        errors.push(`Required file missing: ${file.name}`);
      } else if (file.warning) {
        warnings.push(`${file.name} missing — ${file.warning}`);
      }
    }
  });

  // 4. Binary availability check (ffmpeg, python)
  try {
    const ffmpegPath = resolveMediaTool('ffmpeg');
    if (!ffmpegPath) throw new Error('not found');
    execFileSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
  } catch (err) {
    errors.push('FFmpeg binary is not accessible through FFMPEG_PATH, PATH, or tools/ffmpeg.');
  }

  try {
    const ffprobePath = resolveMediaTool('ffprobe');
    if (!ffprobePath) throw new Error('not found');
    execFileSync(ffprobePath, ['-version'], { stdio: 'ignore' });
  } catch (err) {
    errors.push('ffprobe binary is not accessible through FFPROBE_PATH, PATH, or tools/ffmpeg.');
  }

  try {
    execFileSync('python', ['--version'], { stdio: 'ignore' });
  } catch (err) {
    errors.push('Python binary is not accessible in PATH or system command line.');
  }

  // 5. Output warnings or throw on errors
  warnings.forEach(w => console.warn(`⚠️ PREFLIGHT WARNING: ${w}`));

  if (errors.length > 0) {
    console.error('\n❌ PREFLIGHT CHECKS FAILED:');
    errors.forEach(e => console.error(`  - ${e}`));
    throw new Error(`Preflight check failed with ${errors.length} error(s). Execution aborted.`);
  }

  console.log('✅ Preflight checks passed! All systems nominal.');
  return { status: 'OK', errorsCount: 0, warningsCount: warnings.length };
}
