import { spawnSync } from 'child_process';

const commands = [
  [process.execPath, ['--test', 'test/core.test.js']],
  [process.execPath, ['--check', 'short.js']],
  [process.execPath, ['--check', 'long.js']],
  [process.env.PYTHON_COMMAND || 'python', ['-m', 'py_compile', 'burn_captions.py', 'process_videos.py']]
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Offline smoke checks passed. No APIs were called and nothing was uploaded.');
