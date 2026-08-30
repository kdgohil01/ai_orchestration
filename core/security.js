import fs from 'fs';
import path from 'path';

const SECRET_ENV_NAMES = [
  'GEMINI_API_KEY',
  'PEXELS_API_KEY',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REFRESH_TOKEN',
  'EMAIL_PASS',
];

const STATIC_SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_GOOGLE_KEY]'],
  [/gh[pousr]_[0-9A-Za-z]{20,}/g, '[REDACTED_GITHUB_TOKEN]'],
  [/ya29\.[0-9A-Za-z_-]+/g, '[REDACTED_OAUTH_TOKEN]'],
  [/(client_secret|refresh_token|api_key|password)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[REDACTED]'],
];

export function redactSecrets(value) {
  let text = String(value ?? '');

  for (const name of SECRET_ENV_NAMES) {
    const secret = process.env[name];
    if (secret && secret.length >= 4) text = text.split(secret).join('[REDACTED]');
  }

  for (const [pattern, replacement] of STATIC_SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

export function safeErrorDetails(error) {
  return {
    name: redactSecrets(error?.name || 'Error'),
    message: redactSecrets(error?.message || String(error)),
    code: redactSecrets(error?.code || 'N/A'),
    stack: redactSecrets((error?.stack || '').split('\n').slice(0, 6).join(' | ')),
  };
}

const SCANNABLE_EXTENSIONS = new Set(['.json', '.jsonl', '.txt', '.log', '.md', '.srt', '.vtt', '.ass', '.csv']);
const DETECTION_PATTERNS = [
  ['google_api_key', /AIza[0-9A-Za-z_-]{20,}/],
  ['github_token', /gh[pousr]_[0-9A-Za-z]{20,}/],
  ['oauth_token', /ya29\.[0-9A-Za-z_-]+/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

function listScannableFiles(roots) {
  const files = [];
  const pending = roots.map(root => path.resolve(root)).filter(root => fs.existsSync(root));
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      if (SCANNABLE_EXTENSIONS.has(path.extname(current).toLowerCase()) && stat.size <= 2_000_000) files.push(current);
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      pending.push(path.join(current, entry.name));
    }
  }
  return files;
}

export function scanForSecretLeaks(roots) {
  const files = listScannableFiles(roots);
  const leaks = [];
  const configuredSecrets = SECRET_ENV_NAMES
    .map(name => [name, process.env[name]])
    .filter(([, value]) => value && value.length >= 8);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const [name, secret] of configuredSecrets) {
      if (content.includes(secret)) leaks.push({ file, category: `configured_${name.toLowerCase()}` });
    }
    for (const [category, pattern] of DETECTION_PATTERNS) {
      if (pattern.test(content)) leaks.push({ file, category });
    }
  }
  return { valid: leaks.length === 0, scannedFiles: files.length, leaks };
}

export function assertNoSecretLeaks(roots) {
  const result = scanForSecretLeaks(roots);
  if (!result.valid) {
    const locations = result.leaks.map(leak => `${leak.category} in ${leak.file}`).join('; ');
    const error = new Error(`Secret-safety validation found sensitive material: ${locations}`);
    error.code = 'SECRET_EXPOSURE_DETECTED';
    error.isQualityError = true;
    throw error;
  }
  return result;
}
