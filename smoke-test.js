// ─────────────────────────────────────────────────────────────────────────────
// DeedLamp — Automated End-to-End Smoke Test Suite
// Executes fast end-to-end dry-run validation for both Short and Long pipelines.
// ─────────────────────────────────────────────────────────────────────────────

import { runPreflight } from './core/preflight.js';
import { execSync } from 'child_process';
import path from 'path';

console.log('===========================================================');
console.log('🧪 DEEDLAMP AUTOMATED SMOKE TEST SUITE');
console.log('===========================================================\n');

let passedShort = false;
let passedLong = false;

// 1. Run Preflight Checks
try {
  runPreflight({ checkYoutube: false });
  console.log('✅ System Preflight: PASSED\n');
} catch (err) {
  console.error('❌ System Preflight: FAILED —', err.message);
  process.exit(1);
}

// 2. Test Short-Form Pipeline (Dry-Run Mode)
console.log('───────────────────────────────────────────────────────────');
console.log('🧪 SMOKE TEST 1: Short-Form Agent (--dry-run)');
console.log('───────────────────────────────────────────────────────────');
try {
  execSync('node short.js --dry-run', { stdio: 'inherit', cwd: path.resolve('.') });
  passedShort = true;
  console.log('\n✅ Short-Form Pipeline Smoke Test: PASSED!\n');
} catch (err) {
  console.error('\n❌ Short-Form Pipeline Smoke Test: FAILED!');
}

// 3. Test Long-Form Pipeline (Dry-Run Mode)
console.log('───────────────────────────────────────────────────────────');
console.log('🧪 SMOKE TEST 2: Long-Form Agent (--dry-run)');
console.log('───────────────────────────────────────────────────────────');
try {
  execSync('node long.js --dry-run', { stdio: 'inherit', cwd: path.resolve('.') });
  passedLong = true;
  console.log('\n✅ Long-Form Pipeline Smoke Test: PASSED!\n');
} catch (err) {
  console.error('\n❌ Long-Form Pipeline Smoke Test: FAILED!');
}

console.log('===========================================================');
console.log('📊 SMOKE TEST SUMMARY RESULTS');
console.log('===========================================================');
console.log(`  Short-Form Pipeline : ${passedShort ? '✅ PASSED' : '❌ FAILED'}`);
console.log(`  Long-Form Pipeline  : ${passedLong  ? '✅ PASSED' : '❌ FAILED'}`);
console.log('===========================================================\n');

if (passedShort && passedLong) {
  console.log('🎉 ALL DRY-RUN SMOKE TESTS PASSED. This is not approval for live publishing.');
  process.exit(0);
} else {
  console.error('❌ ONE OR MORE SMOKE TESTS FAILED. Check logs above.');
  process.exit(1);
}
