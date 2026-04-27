const { resolveUsageTokenFields } = require('./codex_cli_gateway');

function emitUsageMeta(runner, usage) {
  const {
    inputTokensRaw,
    cachedInputTokensRaw,
    outputTokensRaw,
    totalTokensRaw,
  } = resolveUsageTokenFields(usage);

  runner.lastUsage = {
    inputTokens: Number(inputTokensRaw ?? 0) || 0,
    cachedInputTokens: Number(cachedInputTokensRaw ?? 0) || 0,
    outputTokens: Number(outputTokensRaw ?? 0) || 0,
    totalTokens: Number(totalTokensRaw ?? 0) || 0,
  };

  runner.emit('meta', '输入Tokens', inputTokensRaw !== undefined ? String(inputTokensRaw) : '-');
  runner.emit('meta', '缓存输入Tokens', cachedInputTokensRaw !== undefined ? String(cachedInputTokensRaw) : '-');
  runner.emit('meta', '输出Tokens', outputTokensRaw !== undefined ? String(outputTokensRaw) : '-');
  if (totalTokensRaw !== undefined) {
    runner.emit('meta', '总Tokens', String(totalTokensRaw));
  }
}

module.exports = {
  emitUsageMeta,
};
