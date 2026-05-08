const { parseUsagePayload } = require('../codex/codex_cli_gateway');
const {
  normalizePlanStatus,
  summarizeCommand,
  trimForStep,
} = require('../codex/codex_runner_output');

function extractClaudeTextBlock(block) {
  if (!block || typeof block !== 'object') {
    return '';
  }
  const type = String(block.type || '').trim().toLowerCase();
  if (type === 'text') {
    return String(block.text || '').trim();
  }
  return '';
}

function extractClaudeMessageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.map(extractClaudeTextBlock).filter(Boolean).join('\n').trim();
}

function extractClaudeResultText(event) {
  return String(event?.result || event?.message?.result || '').trim();
}

function extractClaudeModel(event) {
  return String(
    event?.model
    || event?.message?.model
    || event?.event?.message?.model
    || '',
  ).trim();
}

function extractClaudeUsage(event) {
  return parseUsagePayload(event);
}

function normalizeClaudeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
  const cacheReadInputTokens = Number(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0) || 0;
  const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
  return {
    inputTokens,
    cachedInputTokens: cacheReadInputTokens,
    outputTokens,
    totalTokens: inputTokens + cacheReadInputTokens + cacheCreationInputTokens + outputTokens,
    cacheCreationInputTokens,
  };
}

function extractToolName(toolUse) {
  return String(toolUse?.name || toolUse?.tool_name || toolUse?.type || '').trim();
}

function extractToolInputPreview(toolUse) {
  const input = toolUse?.input;
  if (!input || typeof input !== 'object') {
    return '';
  }
  if (input.command) {
    return summarizeCommand(input.command, 180);
  }
  if (input.file_path) {
    return String(input.file_path || '').trim();
  }
  if (input.pattern) {
    return String(input.pattern || '').trim();
  }
  try {
    return trimForStep(JSON.stringify(input), 220);
  } catch {
    return '';
  }
}

function extractToolResultText(toolResult) {
  if (!toolResult || typeof toolResult !== 'object') {
    return '';
  }
  const content = toolResult.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      return String(item.text || item.content || '').trim();
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function claudeTodoPlanFromToolUse(toolUse) {
  const name = extractToolName(toolUse);
  if (name !== 'TodoWrite') {
    return null;
  }
  const todos = Array.isArray(toolUse?.input?.todos) ? toolUse.input.todos : [];
  const plan = todos
    .map((todo) => {
      const step = String(todo?.content || todo?.text || '').trim();
      if (!step) {
        return null;
      }
      return {
        step,
        status: normalizePlanStatus(todo?.status || ''),
      };
    })
    .filter(Boolean);
  return plan.length ? { explanation: '', plan } : null;
}

module.exports = {
  claudeTodoPlanFromToolUse,
  extractClaudeMessageText,
  extractClaudeModel,
  extractClaudeResultText,
  extractClaudeUsage,
  extractToolInputPreview,
  extractToolName,
  extractToolResultText,
  normalizeClaudeUsage,
};
