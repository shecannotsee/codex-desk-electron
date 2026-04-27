const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline');

const { getCodexChildEnv } = require('./shell_env');
const {
  stripAnsi,
  splitShellArgs,
  parseUsagePayload,
} = require('./codex_cli_gateway');
const { normalizeBaseOptions } = require('./codex_runner_command');
const {
  looksLikeResumeError,
  looksLikeServerOverload,
} = require('./codex_runner_errors');
const { emitUsageMeta } = require('./codex_runner_usage');
const {
  extractEventTexts,
  extractItemMessageText,
  extractJsonText,
  extractResponseMessageText,
  normalizeAssistantCompareText,
  normalizePlanStatus,
  parseHeaderMeta,
  summarizeCommand,
  trimForStep,
} = require('./codex_runner_output');

class CodexRunner extends EventEmitter {
  constructor({ commandText, prompt, attachments = [], workdir, sessionId = '', useNativeMemory = true }) {
    super();
    this.commandText = commandText;
    this.prompt = prompt;
    this.attachments = Array.isArray(attachments) ? attachments : [];
    this.workdir = workdir;
    this.sessionId = sessionId;
    this.useNativeMemory = useNativeMemory;
    this.childEnv = getCodexChildEnv();

    this.proc = null;
    this.gotStreamDelta = false;
    this.detectedSessionId = sessionId;
    this.lastAssistantUpdateText = '';
    this.stopped = false;
    this.lastUsage = null;
    this.lastModel = '';
  }

  stop() {
    this.stopped = true;
    if (this.proc && !this.proc.killed) {
      this.emit('status', '正在停止当前任务...');
      this.proc.kill('SIGTERM');
    }
  }

  async run() {
    const startMs = Date.now();
    const rawLines = [];
    const assistantChunks = [];
    let sessionResetSuggested = false;

    try {
      const baseCmd = splitShellArgs(this.commandText);
      if (!baseCmd.length) {
        this.emit('finished', {
          exitCode: 1,
          assistantText: '',
          rawOutput: '命令为空，请先设置 Codex 命令。',
          durationSeconds: 0,
          sessionId: this.sessionId,
          sessionResetSuggested: false,
        });
        return;
      }

      const cmd = this._buildCommand(baseCmd, false);
      this.emit('status', '正在启动 Codex...');
      this.emit('event', 'hint', `执行命令: ${cmd.slice(0, -1).join(' ')} '<PROMPT>'`);
      // Mirror the outbound request into raw logs so UI-side replay/debug does not depend on shell history.
      this._emitRawRequest(cmd);
      this._emitCodexVersion(cmd);
      this._emitModelFromCommand(cmd);

      let exitCode = await this._runSubprocess(cmd, rawLines, assistantChunks);
      let cleanOutput = rawLines.join('\n').trim();

      if (exitCode !== 0 && this.useNativeMemory && this.sessionId) {
        const resumeError = looksLikeResumeError(cleanOutput);
        const overloaded = looksLikeServerOverload(cleanOutput);
        if (resumeError || overloaded) {
          sessionResetSuggested = true;
          this.detectedSessionId = '';
          this.emit(
            'event',
            'warn',
            resumeError
              ? '会话恢复失败，请手动点击“重试上一条”'
              : '检测到服务端 503/内存过载，请手动点击“重试上一条”',
          );
        }
      }

      let assistantText = assistantChunks.join('').trim();
      if (!assistantText) {
        // Fallback for non-streaming CLI output; it must run after subprocess exit so all raw JSON lines are available.
        assistantText = extractJsonText(cleanOutput);
      }

      const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
        this.emit('finished', {
          exitCode,
          assistantText: assistantText.trim(),
          rawOutput: cleanOutput,
          durationSeconds,
          sessionId: this.detectedSessionId,
          sessionResetSuggested,
          usage: this.lastUsage,
          model: this.lastModel,
        });
    } catch (error) {
      const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      const message = error && error.code === 'ENOENT'
        ? '未找到 codex 命令，请先确认已安装并在 PATH 中。'
        : `执行失败: ${error?.message || String(error)}`;
      this.emit('finished', {
        exitCode: 1,
        assistantText: '',
        rawOutput: message,
        durationSeconds,
        sessionId: this.detectedSessionId,
        sessionResetSuggested,
        usage: this.lastUsage,
        model: this.lastModel,
      });
    }
  }

  _runSubprocess(cmd, rawLines, assistantChunks) {
    return new Promise((resolve) => {
      this.proc = spawn(cmd[0], cmd.slice(1), {
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

  _emitRawRequest(cmd) {
    const command = Array.isArray(cmd) ? cmd.map((item) => String(item || '')) : [];
    const prompt = String(this.prompt || '');
    const payload = {
      type: 'request.sent',
      transport: 'codex-exec',
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

  _buildCommand(baseCmd, forceNewSession = false) {
    const [normalized, isCodexExec] = normalizeBaseOptions(baseCmd);
    if (!isCodexExec) {
      this.emit('event', 'warn', '当前命令不是 `codex exec`，已退化为单次执行模式。');
      if (this.attachments.length) {
        this.emit('event', 'warn', '当前命令不支持真实附件，已忽略附件参数。');
      }
      return [...normalized, this.prompt];
    }

    const codexBin = normalized[0];
    const execOpts = normalized.slice(2);
    const imageArgs = this.attachments
      .map((item) => String(item?.path || '').trim())
      .filter(Boolean)
      .flatMap((filePath) => ['--image', filePath]);

    if (this.useNativeMemory && this.sessionId && !forceNewSession) {
      this.emit('event', 'hint', `使用原生会话续聊: ${this.sessionId}`);
      return [codexBin, 'exec', ...execOpts, ...imageArgs, 'resume', this.sessionId, '--', this.prompt];
    }

    if (this.useNativeMemory) {
      this.emit('event', 'hint', '创建新的 Codex 原生会话');
    } else {
      this.emit('event', 'hint', '当前为本地拼接上下文模式（非原生会话）');
    }

    return [codexBin, 'exec', ...execOpts, ...imageArgs, '--', this.prompt];
  }

  _emitCodexVersion(cmd) {
    if (!cmd.length) {
      return;
    }
    const binName = cmd[0].toLowerCase();
    if (!binName.includes('codex')) {
      return;
    }

    try {
      const result = spawnSync(cmd[0], ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 6000,
        env: this.childEnv,
      });
      const output = stripAnsi(String(result.stdout || result.stderr || '').trim());
      const firstLine = output.split(/\r?\n/)[0]?.trim() || '';
      if (firstLine) {
        this.emit('meta', 'Codex版本', firstLine);
      }
    } catch {
      // ignore
    }
  }

  _emitModelFromCommand(cmd) {
    let model = '';
    for (let i = 0; i < cmd.length; i += 1) {
      const token = cmd[i];
      if ((token === '--model' || token === '-m') && i + 1 < cmd.length) {
        model = String(cmd[i + 1]).trim();
      } else if (String(token).startsWith('--model=')) {
        model = String(token).split('=', 2)[1].trim();
      }
    }
    if (model) {
      this.lastModel = model;
      this.emit('meta', '模型', model);
    }
  }

  _emitPlanUpdateFromItem(eventType, item) {
    const itemType = String(item?.type || '').trim().toLowerCase();
    if (itemType !== 'todo_list') {
      return false;
    }

    const todoItems = Array.isArray(item?.items) ? item.items : [];
    let firstPendingIndex = -1;
    const plan = todoItems
      .map((entry, index) => {
        const step = String(entry?.text || '').trim();
        if (!step) {
          return null;
        }
        if (entry?.completed) {
          return {
            step,
            status: 'completed',
          };
        }
        if (firstPendingIndex < 0) {
          firstPendingIndex = index;
        }
        return {
          step,
          status: 'pending',
        };
      })
      .filter(Boolean);

    if (firstPendingIndex >= 0 && eventType !== 'item.completed') {
      const firstPending = plan.find((entry) => entry?.status === 'pending');
      if (firstPending) {
        firstPending.status = 'in_progress';
      }
    }

    this.emit('plan_update', {
      explanation: '',
      plan: plan.map((entry) => ({
        step: String(entry?.step || '').trim(),
        status: normalizePlanStatus(entry?.status),
      })),
    });
    return true;
  }

  _emitItemStep(eventType, item) {
    const itemType = String(item.type || '').trim().toLowerCase();
    const itemText = String(item.text || '').trim();

    if (itemType === 'reasoning' && itemText) {
      this.emit('step', `思考: ${trimForStep(itemText)}`);
      return;
    }

    const role = String(item.role || '').trim().toLowerCase();
    const isAssistantMessage = itemType === 'agent_message'
      || itemType === 'assistant_message'
      || itemType === 'assistant'
      || (itemType === 'message' && role === 'assistant');
    if (isAssistantMessage) {
      return;
    }

    if (itemType !== 'command_execution') {
      const itemLabel = itemType || 'unknown_item';
      const detail = extractItemMessageText(item)
        || String(item.title || item.name || item.label || item.command || '').trim();
      const detailPreview = trimForStep(detail, 220);
      if (eventType === 'item.started') {
        this.emit('step', detailPreview ? `开始处理 ${itemLabel}: ${detailPreview}` : `开始处理 ${itemLabel}`);
      } else if (eventType === 'item.completed') {
        this.emit('step', detailPreview ? `处理完成 ${itemLabel}: ${detailPreview}` : `处理完成 ${itemLabel}`);
      }
      return;
    }

    const command = String(item.command || '').trim();
    if (eventType === 'item.started') {
      const summarized = summarizeCommand(command);
      if (summarized) {
        this.emit('step', `执行命令: \`${summarized}\``);
      } else {
        this.emit('step', '开始执行命令');
      }
      return;
    }

    if (eventType === 'item.completed') {
      const exitCode = Number.isInteger(item.exit_code) ? item.exit_code : null;
      let text = exitCode === null
        ? '命令执行完成'
        : `命令执行完成（退出码 ${exitCode}）`;

      const summarized = summarizeCommand(command);
      if (summarized) {
        text += `: \`${summarized}\``;
      }

      const aggregated = String(item.aggregated_output || '').trim();
      if (aggregated) {
        text += `\n输出:\n\`\`\`\n${aggregated.replace(/\r\n/g, '\n')}\n\`\`\``;
      }

      this.emit('step', text);
    }
  }

  _emitAssistantUpdate(eventType, item) {
    if (eventType !== 'item.completed' || !item || typeof item !== 'object') {
      return;
    }

    const itemType = String(item.type || '').trim().toLowerCase();
    const role = String(item.role || '').trim().toLowerCase();
    const isAssistantMessage = itemType === 'agent_message'
      || itemType === 'assistant_message'
      || itemType === 'assistant'
      || (itemType === 'message' && role === 'assistant');

    if (!isAssistantMessage) {
      return;
    }

    const text = extractItemMessageText(item);
    const normalizedText = normalizeAssistantCompareText(text);
    if (!normalizedText || normalizedText === this.lastAssistantUpdateText) {
      return;
    }

    this.lastAssistantUpdateText = normalizedText;
    this.emit('assistant_update', {
      eventType,
      itemType,
      text,
    });
  }

  _handleOutputLine(line, assistantChunks) {
    if (line.startsWith('{')) {
      try {
        const event = JSON.parse(line);
        this._handleEvent(event, assistantChunks);
      } catch {
        this.emit('event', 'info', line);
      }
      return;
    }

    const headerMeta = parseHeaderMeta(line);
    if (headerMeta) {
      this.emit('meta', headerMeta.label, headerMeta.value);
    }

    const lower = line.toLowerCase();
    if (lower.includes('error')) {
      this.emit('event', 'error', line);
      if (lower.includes('reconnecting') || lower.includes('network')) {
        this.emit('status', '网络异常，正在重连...');
      }
      return;
    }

    if (lower.startsWith('reconnecting')) {
      this.emit('event', 'warn', line);
      this.emit('status', '网络异常，正在重连...');
      return;
    }

    this.emit('event', 'info', line);
  }

  _appendAssistantText(assistantChunks, text, emitDelta = true) {
    const content = String(text || '').trim();
    if (!content) {
      return;
    }
    if (assistantChunks.length && assistantChunks[assistantChunks.length - 1] === content) {
      return;
    }
    assistantChunks.push(content);
    if (emitDelta) {
      this.emit('assistant_delta', content);
    }
  }

  _handleEvent(event, assistantChunks) {
    const eventType = String(event.type || 'unknown');

    if (eventType === 'thread.started') {
      const threadId = String(event.thread_id || '-');
      this.detectedSessionId = threadId;
      this.emit('meta', '会话ID', threadId);
      this.emit('status', '会话已创建');
      this.emit('event', 'success', `thread.started  thread_id=${threadId}`);
      return;
    }

    if (eventType === 'turn.started') {
      this.emit('status', '正在分析请求...');
      this.emit('event', 'info', 'turn.started');
      return;
    }

    if (eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') {
      if (event.item && typeof event.item === 'object') {
        if (this._emitPlanUpdateFromItem(eventType, event.item)) {
          return;
        }
        this._emitItemStep(eventType, event.item);
        this._emitAssistantUpdate(eventType, event.item);
      }
      return;
    }

    if (eventType === 'response.output_text.delta') {
      if (typeof event.delta === 'string' && event.delta) {
        this.gotStreamDelta = true;
        this._appendAssistantText(assistantChunks, event.delta, true);
        this.emit('status', '正在输出回复...');
      }
      return;
    }

    if (eventType === 'response.completed') {
      this.emit('status', '回复生成完成');
      this.emit('event', 'success', 'response.completed');
      if (event.response && typeof event.response === 'object') {
        const model = String(event.response.model || '').trim();
        if (model) {
          this.lastModel = model;
          this.emit('meta', '模型', model);
        }

        const usage = parseUsagePayload(event.response);
        if (usage && typeof usage === 'object') {
          emitUsageMeta(this, usage);
        }

        if (!this.gotStreamDelta) {
          const fallback = extractResponseMessageText(event.response);
          this._appendAssistantText(assistantChunks, fallback, true);
        }
      }
      return;
    }

    if (eventType === 'turn.completed') {
      const usage = parseUsagePayload(event);
      if (usage && typeof usage === 'object') {
        emitUsageMeta(this, usage);
      }
      this.emit('status', '任务完成');
      this.emit('event', 'success', 'turn.completed');
      return;
    }

    if (eventType === 'turn.failed') {
      this.emit('status', '任务失败');
      let errorMsg = event.error || {};
      if (errorMsg && typeof errorMsg === 'object') {
        errorMsg = errorMsg.message || JSON.stringify(errorMsg);
      }
      this.emit('event', 'error', `turn.failed ${String(errorMsg || '')}`.trim());
      return;
    }

    if (eventType === 'error') {
      const message = String(event.message || 'unknown error');
      this.emit('event', 'error', message);
      if (message.toLowerCase().includes('reconnect') || message.toLowerCase().includes('network')) {
        this.emit('status', '网络异常，正在重连...');
      }
      return;
    }

    if (eventType.toLowerCase().includes('reasoning')) {
      const summary = event.summary || event.text || event.delta || event.message || '(无可显示内容)';
      this.emit('status', '模型思考中...');
      this.emit('event', 'hint', `${eventType} ${String(summary)}`);
      return;
    }

    if (!eventType.toLowerCase().includes('error')) {
      const texts = extractEventTexts(event);
      for (const text of texts) {
        this.gotStreamDelta = true;
        this._appendAssistantText(assistantChunks, text, true);
        this.emit('status', '正在输出回复...');
      }
    }

    this.emit('event', 'muted', eventType);
  }

}

module.exports = {
  CodexRunner,
  stripAnsi,
  splitShellArgs,
};
