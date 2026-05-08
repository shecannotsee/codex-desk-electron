const fs = require('node:fs');
const path = require('node:path');

function toIsoTimestamp(input) {
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) {
    return new Date().toISOString();
  }
  const milliseconds = raw > 1e12 ? raw : raw * 1000;
  return new Date(milliseconds).toISOString();
}

function sanitizeFileSegment(input, fallback = 'conversation') {
  const normalized = String(input || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
  return normalized || fallback;
}

function buildExportFileName(conversation) {
  const title = sanitizeFileSegment(conversation?.title, 'conversation');
  const sessionId = String(conversation?.sessionId || '').trim();
  if (sessionId) {
    return `${title}__${sanitizeFileSegment(sessionId, 'session')}.jsonl`;
  }
  return `${title}.jsonl`;
}

function buildMessageRecord(message) {
  const role = String(message?.role || '').trim().toLowerCase() === 'assistant' ? 'assistant' : 'user';
  const text = String(message?.text || '').trim();
  const createdAt = Number(message?.createdAt || 0);
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
      .filter((item) => item && String(item.path || '').trim())
      .map((item) => ({
        path: String(item.path || '').trim(),
        name: String(item.name || '').trim(),
        mimeType: String(item.mimeType || '').trim(),
        size: Number(item.size || 0) || 0,
        kind: String(item.kind || '').trim(),
      }))
    : [];
  const usage = message?.usage && typeof message.usage === 'object'
    ? {
      model: String(message.usage.model || '').trim(),
      inputTokens: Number(message.usage.inputTokens || 0) || 0,
      cachedInputTokens: Number(message.usage.cachedInputTokens || 0) || 0,
      outputTokens: Number(message.usage.outputTokens || 0) || 0,
      totalTokens: Number(message.usage.totalTokens || 0) || 0,
    }
    : null;
  return {
    timestamp: toIsoTimestamp(createdAt),
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      text,
      ...(usage ? { usage } : {}),
      ...(attachments.length ? { attachments } : {}),
      content: [
        role === 'assistant'
          ? { type: 'output_text', text }
          : { type: 'input_text', text },
        ...attachments.map((item) => ({
          type: 'input_image',
          path: item.path,
          mime_type: item.mimeType,
          name: item.name,
        })),
      ],
    },
  };
}

function exportConversationJsonl(filePath, conversation, meta: any = {}, options: any = {}) {
  const rawPath = String(filePath || '').trim();
  const normalizedPath = rawPath && path.extname(rawPath) ? rawPath : `${rawPath}.jsonl`;
  const resolved = path.resolve(normalizedPath);
  if (!resolved) {
    throw new Error('导出文件路径不能为空');
  }
  if (!conversation || typeof conversation !== 'object') {
    throw new Error('会话不存在');
  }

  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.filter((item) => item && String(item.text || '').trim())
    : [];
  if (!messages.length) {
    throw new Error('当前会话没有可导出的消息');
  }

  const sessionId = String(conversation.sessionId || '').trim();
  const model = String(meta.model || '').trim();
  const cliVersion = String(meta.cliVersion || '').trim();
  const cwd = String(options.workdir || '').trim();

  const records: any[] = [
    {
      type: 'session_meta',
      payload: {
        id: sessionId,
        title: String(conversation.title || '').trim() || '导出会话',
        timestamp: toIsoTimestamp(conversation.createdAt),
        source: 'conductor',
        originator: 'conductor',
        cwd: cwd || '-',
        cli_version: cliVersion || '-',
        model: model || '',
      },
    },
  ];

  if (model) {
    records.push({
      timestamp: toIsoTimestamp(conversation.updatedAt || conversation.createdAt),
      type: 'turn_context',
      payload: {
        model,
      },
    });
  }

  records.push(...messages.map((item) => buildMessageRecord(item)));

  const text = records.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(resolved, `${text}\n`, 'utf-8');
  return {
    filePath: resolved,
    fileName: path.basename(resolved),
    messageCount: messages.length,
    sessionId,
  };
}

module.exports = {
  buildExportFileName,
  exportConversationJsonl,
};
