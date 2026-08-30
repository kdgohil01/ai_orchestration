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
