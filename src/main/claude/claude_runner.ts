const { EventEmitter } = require('node:events');
const readline = require('node:readline');

const { spawnCommand, spawnSyncCommand } = require('../child_process_helper');
const { getCodexChildEnv } = require('../shell_env');
const { stripAnsi, splitShellArgs } = require('../codex/codex_cli_gateway');
const { emitUsageMeta } = require('../codex/codex_runner_usage');
const { buildClaudeCommand } = require('./claude_runner_command');
const {
  claudeTodoPlanFromToolUse,
  extractClaudeMessageText,
  extractClaudeModel,
  extractClaudeResultText,
  extractClaudeUsage,
  extractToolInputPreview,
  extractToolName,
  extractToolResultText,
  normalizeClaudeUsage,
} = require('./claude_runner_output');

class ClaudeRunner extends EventEmitter {
  constructor({ commandText, prompt, attachments = [], workdir, sessionId = '', useNativeMemory = true, continuationMode = '' }) {
    super();
    this.commandText = commandText;
    this.prompt = prompt;
    this.attachments = Array.isArray(attachments) ? attachments : [];
    this.workdir = workdir;
    this.sessionId = sessionId;
    this.useNativeMemory = useNativeMemory;
    this.continuationMode = continuationMode;
    this.childEnv = getCodexChildEnv();

    this.proc = null;
    this.detectedSessionId = sessionId;
    this.stopped = false;
    this.lastUsage = null;
    this.lastModel = '';
    this.lastAssistantUpdateText = '';
    this.toolUseById = new Map();
  }

  stop() {
    this.stopped = true;
    if (this.proc && !this.proc.killed) {
      this.emit('status', '正在停止当前 Claude 任务...');
      this.proc.kill('SIGTERM');
    }
  }

  async run() {
    const startMs = Date.now();
    const rawLines = [];
    const assistantChunks = [];

    try {
      const baseCmd = splitShellArgs(this.commandText);
      if (!baseCmd.length) {
        this._finish(1, '', '命令为空，请先设置 Claude 命令。', startMs);
        return;
      }

      const prompt = this._buildPromptWithAttachments();
      const forceFork = String(this.continuationMode || '').trim() === 'fork';
      const cmd = buildClaudeCommand({
        baseCmd,
        prompt,
        sessionId: this.sessionId,
        useNativeMemory: this.useNativeMemory,
        forceFork,
      });

      this.emit('status', '正在启动 Claude...');
      this.emit('event', 'hint', `执行命令: ${cmd.slice(0, -1).join(' ')} '<PROMPT>'`);
      if (forceFork && this.sessionId) {
        this.emit('event', 'hint', '本次将使用 Claude --fork-session 分叉已有会话');
      } else if (this.useNativeMemory && this.sessionId) {
        this.emit('event', 'hint', `使用 Claude 原生会话续聊: ${this.sessionId}`);
      } else if (this.useNativeMemory) {
        this.emit('event', 'hint', '创建新的 Claude 原生会话');
      }
      if (this.attachments.length) {
        this.emit('event', 'warn', `Claude CLI 没有 codex exec --image 等价参数，已将 ${this.attachments.length} 个附件路径追加到提示词`);
      }
      this._emitRawRequest(cmd, prompt);
      this._emitClaudeVersionMeta(cmd);
      this._emitModelMetaFromCommand(cmd);

      const exitCode = await this._runSubprocess(cmd, rawLines, assistantChunks);
      const cleanOutput = rawLines.join('\n').trim();
      const assistantText = assistantChunks.join('').trim() || this._extractFinalTextFromRaw(cleanOutput);
      this._finish(exitCode, assistantText, cleanOutput, startMs);
    } catch (error) {
      const message = error && error.code === 'ENOENT'
        ? '未找到 claude 命令，请先确认 Claude Code 已安装并在 PATH 中。'
        : `执行失败: ${error?.message || String(error)}`;
      this._finish(1, '', message, startMs);
    }
  }

  _finish(exitCode, assistantText, rawOutput, startMs) {
    const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
    this.emit('finished', {
      exitCode,
      assistantText: String(assistantText || '').trim(),
      rawOutput: String(rawOutput || '').trim(),
      durationSeconds,
      sessionId: this.detectedSessionId,
      sessionResetSuggested: false,
      usage: this.lastUsage,
      model: this.lastModel,
    });
  }

  _runSubprocess(cmd, rawLines, assistantChunks) {
    return new Promise((resolve) => {
      this.proc = spawnCommand(cmd[0], cmd.slice(1), {
        cwd: this.workdir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.childEnv,
      });

      const onLine = (line) => {
        const cleanLine = stripAnsi(line.trimEnd());
        if (!cleanLine) {
          return;
        }
        rawLines.push(cleanLine);
        this.emit('raw_line', cleanLine);
        this._handleOutputLine(cleanLine, assistantChunks);
      };

      const bindStream = (stream) => {
        if (!stream) {
          return;
        }
        const rl = readline.createInterface({ input: stream });
        rl.on('line', onLine);
      };

      bindStream(this.proc.stdout);
      bindStream(this.proc.stderr);

      this.proc.on('close', (code) => {
        resolve(Number.isInteger(code) ? code : 1);
      });

      this.proc.on('error', (error) => {
        rawLines.push(`process error: ${error.message}`);
        resolve(1);
      });
    });
  }

  _buildPromptWithAttachments() {
    const prompt = String(this.prompt || '').trim();
    const paths = this.attachments
      .map((item) => String(item?.path || '').trim())
      .filter(Boolean);
    if (!paths.length) {
      return prompt;
    }
    return [
      prompt,
      '',
      '附件文件路径如下，请按需读取：',
      ...paths.map((filePath) => `- ${filePath}`),
    ].join('\n');
  }

  _emitRawRequest(cmd, prompt) {
    const command = Array.isArray(cmd) ? cmd.map((item) => String(item || '')) : [];
    const payload = {
      type: 'request.sent',
      transport: 'claude-print',
      session_id: this.sessionId || '',
      use_native_memory: Boolean(this.useNativeMemory),
      workdir: this.workdir || process.cwd(),
      attachments: this.attachments.map((item) => String(item?.path || '').trim()).filter(Boolean),
      command: command.length > 1 ? command.slice(0, -1) : command,
      prompt,
    };
    this.emit('raw_line', {
      direction: 'sent',
      line: JSON.stringify(payload),
    });
  }

  _emitClaudeVersionMeta(cmd) {
    if (!Array.isArray(cmd) || !cmd.length) {
      return;
    }
    try {
      const result = spawnSyncCommand(cmd[0], ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 6000,
        env: this.childEnv,
      });
      const output = stripAnsi(String(result.stdout || result.stderr || '').trim());
      const firstLine = output.split(/\r?\n/)[0]?.trim() || '';
      if (firstLine) {
        this.emit('meta', 'Claude版本', firstLine);
      }
    } catch {
      // Diagnostic only.
    }
  }

  _emitModelMetaFromCommand(cmd) {
    let model = '';
    for (let index = 0; index < cmd.length; index += 1) {
      const token = cmd[index];
      if ((token === '--model' || token === '-m') && index + 1 < cmd.length) {
        model = String(cmd[index + 1]).trim();
      } else if (String(token).startsWith('--model=')) {
        model = String(token).split('=', 2)[1].trim();
      }
    }
    if (model) {
      this.lastModel = model;
      this.emit('meta', '模型', model);
    }
  }

  _handleOutputLine(line, assistantChunks) {
    if (line.startsWith('{')) {
      try {
        this._handleEvent(JSON.parse(line), assistantChunks);
      } catch {
        this.emit('event', 'info', line);
      }
      return;
    }

    const lower = line.toLowerCase();
    if (lower.includes('error')) {
      this.emit('event', 'error', line);
      return;
    }
    this.emit('event', 'info', line);
  }

  _appendAssistantText(assistantChunks, text, emitDelta = true) {
    const content = String(text || '');
    if (!content) {
      return;
    }
    assistantChunks.push(content);
    if (emitDelta) {
      this.emit('assistant_delta', content);
    }
  }

  _emitAssistantUpdate(text) {
    const normalized = String(text || '').trim();
    if (!normalized || normalized === this.lastAssistantUpdateText) {
      return;
    }
    this.lastAssistantUpdateText = normalized;
    this.emit('assistant_update', {
      eventType: 'assistant',
      itemType: 'assistant',
      text: normalized,
    });
  }

  _emitUsageAndModel(event) {
    const model = extractClaudeModel(event);
    if (model) {
      this.lastModel = model;
      this.emit('meta', '模型', model);
    }
    const usage = extractClaudeUsage(event);
    const normalized = normalizeClaudeUsage(usage);
    if (normalized) {
      emitUsageMeta(this, normalized);
      if (normalized.cacheCreationInputTokens > 0) {
        this.emit('meta', '缓存写入Tokens', String(normalized.cacheCreationInputTokens));
      }
    }
  }

  _handleStreamEvent(event, assistantChunks) {
    const inner = event?.event || {};
    const type = String(inner.type || '').trim();
    if (type === 'message_start') {
      this.emit('status', 'Claude 正在分析请求...');
      this._emitUsageAndModel(inner);
      return;
    }
    if (type === 'content_block_start') {
      const block = inner.content_block || {};
      if (String(block.type || '') === 'tool_use') {
        const id = String(block.id || '').trim();
        if (id) {
          this.toolUseById.set(id, block);
        }
        const name = extractToolName(block);
        const preview = extractToolInputPreview(block);
        this.emit('step', preview ? `调用工具 ${name}: ${preview}` : `调用工具 ${name || 'tool'}`);
        const plan = claudeTodoPlanFromToolUse(block);
        if (plan) {
          this.emit('plan_update', plan);
        }
      }
      return;
    }
    if (type === 'content_block_delta') {
      const delta = inner.delta || {};
      if (String(delta.type || '') === 'text_delta' && typeof delta.text === 'string') {
        this.emit('status', 'Claude 正在输出回复...');
        this._appendAssistantText(assistantChunks, delta.text, true);
      }
      return;
    }
    if (type === 'message_delta') {
      this._emitUsageAndModel(inner);
      return;
    }
    if (type === 'message_stop') {
      this.emit('status', 'Claude 回复生成完成');
    }
  }

  _handleAssistantMessage(event) {
    this._emitUsageAndModel(event);
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    for (const block of content) {
      const blockType = String(block?.type || '').trim().toLowerCase();
      if (blockType === 'tool_use') {
        const id = String(block.id || '').trim();
        if (id) {
          this.toolUseById.set(id, block);
        }
        const name = extractToolName(block);
        const preview = extractToolInputPreview(block);
        this.emit('step', preview ? `调用工具 ${name}: ${preview}` : `调用工具 ${name || 'tool'}`);
        const plan = claudeTodoPlanFromToolUse(block);
        if (plan) {
          this.emit('plan_update', plan);
        }
      }
    }
    const text = extractClaudeMessageText(event.message || {});
    if (text) {
      this._emitAssistantUpdate(text);
    }
  }

  _handleUserMessage(event) {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    for (const block of content) {
      const blockType = String(block?.type || '').trim().toLowerCase();
      if (blockType !== 'tool_result') {
        continue;
      }
      const toolId = String(block.tool_use_id || '').trim();
      const toolUse = this.toolUseById.get(toolId);
      const name = extractToolName(toolUse) || 'tool';
      const resultText = extractToolResultText(block);
      const prefix = block.is_error ? `工具 ${name} 执行失败` : `工具 ${name} 执行完成`;
      const preview = resultText ? `\n输出:\n\`\`\`\n${resultText.slice(0, 1200).replace(/\r\n/g, '\n')}\n\`\`\`` : '';
      this.emit('step', `${prefix}${preview}`);
    }
  }

  _handleEvent(event, assistantChunks) {
    const eventType = String(event.type || 'unknown');
    const sessionId = String(event.session_id || '').trim();
    if (sessionId && sessionId !== this.detectedSessionId) {
      this.detectedSessionId = sessionId;
      this.emit('meta', '会话ID', sessionId);
    }

    if (eventType === 'system' && event.subtype === 'init') {
      this.emit('status', 'Claude 会话已初始化');
      this.emit('event', 'success', `system.init session_id=${sessionId || '-'}`);
      const version = String(event.claude_code_version || '').trim();
      if (version) {
        this.emit('meta', 'Claude版本', version);
      }
      const model = String(event.model || '').trim();
      if (model) {
        this.lastModel = model;
        this.emit('meta', '模型', model);
      }
      const permissionMode = String(event.permissionMode || '').trim();
      if (permissionMode) {
        this.emit('meta', '权限模式', permissionMode);
      }
      return;
    }

    if (eventType === 'stream_event') {
      this._handleStreamEvent(event, assistantChunks);
      return;
    }

    if (eventType === 'assistant') {
      this._handleAssistantMessage(event);
      return;
    }

    if (eventType === 'user') {
      this._handleUserMessage(event);
      return;
    }

    if (eventType === 'result') {
      this._emitUsageAndModel(event);
      const resultText = extractClaudeResultText(event);
      if (resultText && !assistantChunks.join('').trim()) {
        this._appendAssistantText(assistantChunks, resultText, true);
      }
      this.emit('status', event.is_error ? 'Claude 任务失败' : 'Claude 任务完成');
      this.emit(event.is_error ? 'event' : 'event', event.is_error ? 'error' : 'success', `result.${event.subtype || 'done'}`);
      return;
    }

    if (eventType.toLowerCase().includes('error')) {
      this.emit('event', 'error', JSON.stringify(event));
      return;
    }

    this.emit('event', 'muted', eventType);
  }

  _extractFinalTextFromRaw(rawOutput) {
    const chunks = [];
    const lines = String(rawOutput || '').split(/\r?\n/);
    for (const line of lines) {
      const text = String(line || '').trim();
      if (!text.startsWith('{')) {
        continue;
      }
      try {
        const event = JSON.parse(text);
        if (event.type === 'assistant') {
          const messageText = extractClaudeMessageText(event.message || {});
          if (messageText) {
            chunks.push(messageText);
          }
        } else if (event.type === 'result') {
          const resultText = extractClaudeResultText(event);
          if (resultText) {
            chunks.push(resultText);
          }
        }
      } catch {
        // ignore malformed lines
      }
    }
    return chunks.length ? chunks[chunks.length - 1] : '';
  }
}

module.exports = {
  ClaudeRunner,
};
