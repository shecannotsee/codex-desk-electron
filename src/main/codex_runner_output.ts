const HEADER_FIELD_RE = /^([\w ]+):\s*(.+)$/;

function normalizeAssistantCompareText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimForStep(text, limit = 320) {
  const value = String(text || '').trim().replace(/\r\n/g, '\n');
  if (!value) {
    return '';
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

function summarizeCommand(command, limit = 160) {
  const value = String(command || '').trim();
  if (!value) {
    return '';
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

function normalizePlanStatus(status = '') {
  const text = String(status || '').trim().toLowerCase();
  if (text === 'completed' || text === 'done' || text === 'success') {
    return 'completed';
  }
  if (text === 'in_progress' || text === 'inprogress' || text === 'running' || text === 'active') {
    return 'in_progress';
  }
  return 'pending';
}

function extractItemMessageText(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }

  const directText = String(item.text || item.message || item.output_text || item.outputText || '').trim();
  if (directText) {
    return directText;
  }

  const content = Array.isArray(item.content) ? item.content : [];
  const blocks = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const blockType = String(block.type || '').toLowerCase();
    if (blockType === 'output_text' || blockType === 'text') {
      const text = String(
        block.text
        || block.output_text
        || block.outputText
        || block.input_text
        || block.inputText
        || '',
      ).trim();
      if (text) {
        blocks.push(text);
      }
    }
  }
  if (blocks.length) {
    return blocks.join('\n').trim();
  }

  // New Codex CLI builds have shifted message text across several nested shapes; keep a scoped walker as fallback.
  return extractEventTexts({ item }).join('\n').trim();
}

function extractResponseMessageText(response) {
  if (!response || typeof response !== 'object') {
    return '';
  }
  const outputItems = Array.isArray(response.output) ? response.output : [];
  const chunks = [];
  for (const item of outputItems) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.type !== 'message') {
      continue;
    }
    const role = String(item.role || 'assistant').toLowerCase();
    if (role && role !== 'assistant') {
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue;
      }
      const blockType = String(block.type || '').toLowerCase();
      if (blockType === 'output_text' || blockType === 'text') {
        const text = String(block.text || '');
        if (text) {
          chunks.push(text);
        }
      }
    }
  }
  return chunks.join('').trim();
}

function extractEventTexts(event) {
  if (!event || typeof event !== 'object') {
    return [];
  }
  const eventType = String(event.type || '').toLowerCase();
  if (
    eventType.includes('error')
    || eventType.includes('thread.started')
    || eventType.includes('turn.started')
    || eventType.includes('turn.completed')
    || eventType.includes('turn.failed')
  ) {
    return [];
  }

  const candidates = [];

  const walk = (node, assistantScope = false) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, assistantScope);
      }
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    const nodeType = String(node.type || '').toLowerCase();
    const role = String(node.role || '').toLowerCase();
    // Only collect free-form text after the walk has entered assistant/output scope; this avoids surfacing tool logs as answers.
    const scoped = assistantScope
      || role === 'assistant'
      || ['output_text', 'text', 'message', 'agent_message', 'assistant_message', 'assistant'].includes(nodeType);

    if (nodeType === 'output_text' || nodeType === 'text') {
      const text = String(node.text || '').trim();
      if (text) {
        candidates.push(text);
      }
    }

    if (nodeType.includes('output_text')) {
      const delta = String(node.delta || '').trim();
      if (delta) {
        candidates.push(delta);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'error' || key === 'stack' || key === 'trace' || key === 'debug') {
        continue;
      }
      if (key === 'delta' && typeof value === 'string') {
        if (scoped && value.trim()) {
          candidates.push(value.trim());
        }
        continue;
      }
      if (key === 'text' && typeof value === 'string') {
        if (scoped && value.trim()) {
          candidates.push(value.trim());
        }
        continue;
      }
      walk(value, scoped);
    }
  };

  walk(event, false);

  const deduped = [];
  const seen = new Set();
  for (const text of candidates) {
    const normalized = String(text || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function extractJsonText(mixedText) {
  const chunks = [];
  const lines = String(mixedText || '').split(/\r?\n/);
  for (const line of lines) {
    const text = String(line || '').trim();
    if (!text.startsWith('{')) {
      continue;
    }

    let event = null;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }

    const eventType = String(event.type || '').toLowerCase();
    if (eventType === 'response.output_text.delta') {
      const delta = String(event.delta || '');
      if (delta) {
        chunks.push(delta);
      }
      continue;
    }

    if (eventType === 'response.completed') {
      // Some CLI versions emit only the completed response without deltas, so final text must be recovered here.
      const responseText = extractResponseMessageText(event.response || {});
      if (responseText) {
        chunks.push(responseText);
      }
      continue;
    }

    for (const item of extractEventTexts(event)) {
      chunks.push(item);
    }
  }

  if (!chunks.length) {
    return '';
  }

  return chunks.join('\n').trim();
}

function parseHeaderMeta(line) {
  const matched = HEADER_FIELD_RE.exec(String(line || ''));
  if (!matched) {
    return null;
  }
  const key = matched[1].trim().toLowerCase();
  const value = matched[2].trim();
  const aliasMap = {
    model: '模型',
    workdir: '工作目录',
    'session id': '会话ID',
    'reasoning effort': '推理强度',
  };
  return aliasMap[key] ? { label: aliasMap[key], value } : null;
}

module.exports = {
  extractEventTexts,
  extractItemMessageText,
  extractJsonText,
  extractResponseMessageText,
  normalizeAssistantCompareText,
  normalizePlanStatus,
  parseHeaderMeta,
  summarizeCommand,
  trimForStep,
};
