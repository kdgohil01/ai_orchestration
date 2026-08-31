const [, , command, ...rest] = process.argv;
const usage = `
DeedLamp AI Orchestration

Safe commands:
  node . short [--dry-run|--skip-upload|--review|--publish]
  node . long  [--dry-run|--skip-upload|--review|--publish]
  node . analytics

Running "node ." without a command never creates or uploads media.
Local-only is the default. Live scheduling requires both --publish and
ALLOW_AUTO_PUBLISH=true; private review requires --review.
`;

if (!command || command === '--help' || command === '-h') {
  console.log(usage);
} else {
  process.argv = [process.argv[0], process.argv[1], ...rest];
  if (command === 'short') await import('./short.js');
  else if (command === 'long') await import('./long.js');
  else if (command === 'analytics') await import('./scripts/sync-analytics.js');
  else {
    console.error(`Unknown command: ${command}\n${usage}`);
    process.exitCode = 2;
  }
}
