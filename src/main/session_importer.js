const fs = require('node:fs');
const path = require('node:path');

function toUnixSeconds(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    if (input > 1e12) {
      return Math.round(input / 1000);
    }
    if (input > 0) {
      return Math.round(input);
    }
  }

  const parsed = Date.parse(String(input || ''));
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed / 1000);
  }
  return 0;
}

function safeParseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractContentText(content) {
  if (!Array.isArray(content)) {
    return '';
  }
  const chunks = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (typeof item.text === 'string' && item.text.trim()) {
      chunks.push(item.text);
      continue;
    }
    if (typeof item.output_text === 'string' && item.output_text.trim()) {
      chunks.push(item.output_text);
      continue;
    }
    if (typeof item.input_text === 'string' && item.input_text.trim()) {
      chunks.push(item.input_text);
    }
  }
  return chunks.join('\n').trim();
}

function extractMessageText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim();
  }
  return extractContentText(payload.content);
}

function isEnvelopeUserMessage(role, text) {
  if (role !== 'user') {
    return false;
  }
  const raw = String(text || '').trim();
  if (!raw) {
    return true;
  }
  if (raw.startsWith('# AGENTS.md instructions')) {
    return true;
  }
  if (/^<environment_context>[\s\S]*<\/environment_context>$/.test(raw)) {
    return true;
  }
  return false;
}

function summarizeTitle(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!lines.length) {
    return '';
  }

  const markers = [
    'My request for Codex:',
    '## My request for Codex:',
    '我的请求：',
    '我的请求:',
  ];
  for (const marker of markers) {
    const index = lines.findIndex((item) => item.includes(marker));
    if (index >= 0) {
      const after = lines.slice(index + 1).find(Boolean);
      if (after) {
        return after;
      }
    }
  }

  const preferred = lines.find((item) => !item.startsWith('#') && !item.startsWith('##'));
  return preferred || lines[lines.length - 1] || '';
}

function fallbackTitle(sessionMeta, messages) {
  const firstUser = messages.find((item) => item && item.role === 'user' && item.text.trim());
  const summary = summarizeTitle(firstUser?.text || '');
  if (summary) {
    const compact = summary.replace(/\s+/g, ' ').trim();
    return compact.length > 40 ? `导入: ${compact.slice(0, 40).trimEnd()}...` : `导入: ${compact}`;
  }

  const createdAt = toUnixSeconds(sessionMeta?.timestamp);
  if (createdAt > 0) {
    const dt = new Date(createdAt * 1000);
    const yyyy = String(dt.getFullYear());
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    return `导入会话 ${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  return '导入会话';
}

function inferSessionId(filePath, sessionMeta) {
  const fromMeta = String(sessionMeta?.id || '').trim();
  if (fromMeta) {
    return fromMeta;
  }
  const base = path.basename(String(filePath || ''));
  const match = /([0-9a-f]{8,}-[0-9a-f-]{8,})/i.exec(base);
  return match ? match[1] : '';
}

function importSessionJsonl(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!resolved) {
    throw new Error('会话文件路径不能为空');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`会话文件不存在: ${resolved}`);
  }

  const text = fs.readFileSync(resolved, 'utf-8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const messages = [];
  let sessionMeta = null;
  let latestModel = '';

  for (const line of lines) {
    const record = safeParseLine(line);
    if (!record || typeof record !== 'object') {
      continue;
    }

    if (record.type === 'session_meta' && record.payload && typeof record.payload === 'object') {
      sessionMeta = record.payload;
      continue;
    }

    if (record.type === 'turn_context' && record.payload && typeof record.payload === 'object') {
      const candidate = String(record.payload.model || '').trim();
      if (candidate) {
        latestModel = candidate;
      }
      continue;
    }

    if (record.type !== 'response_item') {
      continue;
    }

    const payload = record.payload;
    if (!payload || payload.type !== 'message') {
      continue;
    }

    const role = String(payload.role || '').trim();
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const contentText = extractMessageText(payload);
    if (!contentText) {
      continue;
    }
    if (isEnvelopeUserMessage(role, contentText)) {
      continue;
    }

    const createdAt = toUnixSeconds(record.timestamp);
    messages.push({
      role,
      text: contentText,
      createdAt: createdAt || undefined,
    });
  }

  if (!messages.length) {
    throw new Error('未从会话文件中解析到可导入的用户/助手消息');
  }

  const createdAt = messages.find((item) => Number(item.createdAt || 0) > 0)?.createdAt
    || toUnixSeconds(sessionMeta?.timestamp)
    || Math.round(Date.now() / 1000);
  const updatedAt = [...messages].reverse().find((item) => Number(item.createdAt || 0) > 0)?.createdAt
    || createdAt;

  return {
    title: fallbackTitle(sessionMeta, messages),
    sessionId: inferSessionId(resolved, sessionMeta),
    messages,
    createdAt,
    updatedAt,
    source: String(sessionMeta?.source || '').trim() || '-',
    originator: String(sessionMeta?.originator || '').trim() || '-',
    cwd: String(sessionMeta?.cwd || '').trim() || '-',
    cliVersion: String(sessionMeta?.cli_version || '').trim() || '-',
    model: latestModel || String(sessionMeta?.model || '').trim() || '',
    filePath: resolved,
  };
}

module.exports = {
  importSessionJsonl,
};
