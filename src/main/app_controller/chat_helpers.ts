const fs = require('node:fs');

const { splitShellArgs } = require('../codex');
const { normalizePreview } = require('./shared');

const ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS = 240;
const ASSISTANT_STREAM_PREVIEW_MIN_GROWTH = 32;
const REQUEST_WAIT_NOTICE_INTERVAL_MS = 10000;
const USAGE_META_KEYS = new Set(['输入Tokens', '缓存输入Tokens', '输出Tokens', '总Tokens']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff']);

function normalizeAssistantRuntimeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attachmentBasename(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    return '';
  }
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
}

function looksLikeImageAttachment(item) {
  const mimeType = String(item?.mimeType || '').trim().toLowerCase();
  if (mimeType.startsWith('image/')) {
    return true;
  }
  const filePath = String(item?.path || '').trim().toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function normalizeAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return list
    .map((item) => {
      const path = String(item?.path || '').trim();
      if (!path || seen.has(path) || !fs.existsSync(path)) {
        return null;
      }
      seen.add(path);
      return {
        path,
        name: String(item?.name || '').trim() || attachmentBasename(path),
        mimeType: String(item?.mimeType || '').trim(),
        size: Number(item?.size || 0) || 0,
        kind: looksLikeImageAttachment(item) ? 'image' : String(item?.kind || '').trim(),
      };
    })
    .filter((item) => item && item.kind === 'image');
}

function appendAttachmentPreview(text, attachments) {
  const preview = normalizePreview(text);
  const count = Array.isArray(attachments) ? attachments.length : 0;
  if (count <= 0) {
    return preview;
  }
  return `${preview} [附件 ${count}]`;
}

function normalizeMessageUsage(usage, fallbackModel = '') {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const inputTokens = Number(usage.inputTokens ?? 0) || 0;
  const cachedInputTokens = Number(usage.cachedInputTokens ?? 0) || 0;
  const outputTokens = Number(usage.outputTokens ?? 0) || 0;
  const totalTokens = Number(usage.totalTokens ?? 0) || 0;
  const model = String(usage.model || fallbackModel || '').trim();
  if (inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }
  return {
    ...(model ? { model } : {}),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    ...(totalTokens > 0 ? { totalTokens } : {}),
  };
}

function normalizeMessageUsageFromMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const inputTokens = Number(meta['输入Tokens'] ?? 0) || 0;
  const cachedInputTokens = Number(meta['缓存输入Tokens'] ?? 0) || 0;
  const outputTokens = Number(meta['输出Tokens'] ?? 0) || 0;
  const totalTokens = Number(meta['总Tokens'] ?? 0) || 0;
  const model = String(meta['模型'] || '').trim();
  if (inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }
  return {
    ...(model && model !== '-' ? { model } : {}),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    ...(totalTokens > 0 ? { totalTokens } : {}),
  };
}

function supportsAppServer(commandText) {
  const parts = splitShellArgs(commandText);
  return parts.length >= 2
    && /codex/i.test(String(parts[0] || ''))
    && String(parts[1] || '') === 'exec';
}

module.exports = {
  ASSISTANT_STREAM_PREVIEW_MIN_GROWTH,
  ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS,
  REQUEST_WAIT_NOTICE_INTERVAL_MS,
  USAGE_META_KEYS,
  appendAttachmentPreview,
  normalizeAssistantRuntimeText,
  normalizeAttachments,
  normalizeMessageUsage,
  normalizeMessageUsageFromMeta,
  supportsAppServer,
};
