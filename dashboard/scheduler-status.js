import { spawnSync } from 'child_process';

const TASKS = Object.freeze({
  agentC: 'DeedLamp-AgentC-Retry',
  agentB: 'DeedLamp-Shorts',
  agentA: 'DeedLamp-LongForm',
});

export function inspectSchedulerTasks({ platform = process.platform, run = spawnSync } = {}) {
  if (platform !== 'win32') {
    return Object.fromEntries(Object.entries(TASKS).map(([key, name]) => [key, {
      name,
      status: 'unsupported',
      detail: 'Windows Task Scheduler is available only on Windows.',
    }]));
  }

  return Object.fromEntries(Object.entries(TASKS).map(([key, name]) => {
    const result = run('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (result.status === 0) return [key, { name, status: 'installed', detail: 'Task Scheduler entry found.' }];
    if (/cannot find|not exist|system cannot find/i.test(output)) {
      return [key, { name, status: 'not_installed', detail: 'Task Scheduler entry was not found.' }];
    }
    return [key, {
      name,
      status: 'unavailable',
      detail: /access.*denied/i.test(output) ? 'Task Scheduler status access was denied.' : 'Task Scheduler status could not be read.',
    }];
  }));
}
