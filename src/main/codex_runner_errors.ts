function looksLikeResumeError(output) {
  const lower = String(output || '').toLowerCase();
  const keywords = [
    'resume', 'session', 'thread', 'not found', 'no recorded session', 'invalid session', 'turn.failed',
  ];
  return (lower.includes('resume') || lower.includes('session'))
    && keywords.some((item) => lower.includes(item));
}

function looksLikeServerOverload(output) {
  const lower = String(output || '').toLowerCase();
  const markers = [
    '503 service unavailable',
    'unexpected status 503',
    'status 503',
    'system memory overloaded',
    'server overloaded',
  ];
  return markers.some((item) => lower.includes(item));
}

module.exports = {
  looksLikeResumeError,
  looksLikeServerOverload,
};
