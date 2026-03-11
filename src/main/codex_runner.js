const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const os = require('node:os');
const readline = require('node:readline');

const { getCodexChildEnv } = require('./shell_env');

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const HEADER_FIELD_RE = /^([\w ]+):\s*(.+)$/;

function stripAnsi(text) {
  return String(text || '').replace(ANSI_PATTERN, '');
}

function splitShellArgs(commandText) {
  const input = String(commandText || '').trim();
  if (!input) {
    return [];
  }
  const result = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match = null;
  while ((match = re.exec(input)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    result.push(token.replace(/\\(["'\\])/g, '$1'));
  }
  return result;
}

class CodexRunner extends EventEmitter {
  constructor({ commandText, prompt, workdir, sessionId = '', useNativeMemory = true }) {
    super();
    this.commandText = commandText;
    this.prompt = prompt;
    this.workdir = workdir;
    this.sessionId = sessionId;
    this.useNativeMemory = useNativeMemory;
    this.childEnv = getCodexChildEnv();

    this.proc = null;
    this.gotStreamDelta = false;
    this.detectedSessionId = sessionId;
    this.stopped = false;
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
      this._emitCodexVersion(cmd);
      this._emitModelFromCommand(cmd);

      let exitCode = await this._runSubprocess(cmd, rawLines, assistantChunks);
      let cleanOutput = rawLines.join('\n').trim();

      if (exitCode !== 0 && this.useNativeMemory && this.sessionId) {
        const resumeError = this._looksLikeResumeError(cleanOutput);
        const overloaded = this._looksLikeServerOverload(cleanOutput);
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
        assistantText = this._extractJsonText(cleanOutput);
      }

      const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      this.emit('finished', {
        exitCode,
        assistantText: assistantText.trim(),
        rawOutput: cleanOutput,
        durationSeconds,
        sessionId: this.detectedSessionId,
        sessionResetSuggested,
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

  _buildCommand(baseCmd, forceNewSession = false) {
    const [normalized, isCodexExec] = this._normalizeBaseOptions(baseCmd);
    if (!isCodexExec) {
      this.emit('event', 'warn', '当前命令不是 `codex exec`，已退化为单次执行模式。');
      return [...normalized, this.prompt];
    }

    const codexBin = normalized[0];
    const execOpts = normalized.slice(2);

    if (this.useNativeMemory && this.sessionId && !forceNewSession) {
      this.emit('event', 'hint', `使用原生会话续聊: ${this.sessionId}`);
      return [codexBin, 'exec', ...execOpts, 'resume', this.sessionId, this.prompt];
    }

    if (this.useNativeMemory) {
      this.emit('event', 'hint', '创建新的 Codex 原生会话');
    } else {
      this.emit('event', 'hint', '当前为本地拼接上下文模式（非原生会话）');
    }

    return [codexBin, 'exec', ...execOpts, this.prompt];
  }

  _normalizeBaseOptions(baseCmd) {
    if (baseCmd.length >= 2 && baseCmd[0] === 'codex' && baseCmd[1] === 'exec') {
      const args = baseCmd.slice(2);
      const opts = [];
      let hasAddDir = false;
      let hasPermissionMode = false;
      const optionsWithValueKeep = new Set([
        '--config', '-c', '--model', '-m', '--profile', '-p', '--sandbox', '-s',
        '--cd', '-C', '--add-dir', '--output-schema', '--enable', '--disable',
      ]);

      for (let i = 0; i < args.length; i += 1) {
        const token = args[i];

        if (token === 'resume') {
          if (i + 1 < args.length && !String(args[i + 1]).startsWith('-')) {
            i += 1;
          }
          continue;
        }

        if (token === '--json' || token === '--last' || token === '--all') {
          continue;
        }

        if (token === '--color' || token === '--output-last-message' || token === '-o') {
          if (i + 1 < args.length) {
            i += 1;
          }
          continue;
        }

        if (token === '--add-dir' || String(token).startsWith('--add-dir=')) {
          hasAddDir = true;
        }

        if (
          token === '--dangerously-bypass-approvals-and-sandbox'
          || token === '--full-auto'
          || token === '--sandbox'
          || token === '-s'
          || String(token).startsWith('--sandbox=')
        ) {
          hasPermissionMode = true;
        }

        if (optionsWithValueKeep.has(token) && i + 1 < args.length) {
          opts.push(token, args[i + 1]);
          i += 1;
          continue;
        }

        opts.push(token);
      }

      if (!hasAddDir) {
        const homeDir = String(os.homedir() || '').trim();
        if (homeDir) {
          opts.push('--add-dir', homeDir);
        }
      }

      if (!hasPermissionMode) {
        opts.push('--dangerously-bypass-approvals-and-sandbox');
      }

      opts.push('--json');
      return [['codex', 'exec', ...opts], true];
    }

    return [[...baseCmd], false];
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
      this.emit('meta', '模型', model);
    }
  }

  _trimForStep(text, limit = 320) {
    const value = String(text || '').trim().replace(/\r\n/g, '\n');
    if (!value) {
      return '';
    }
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit).trimEnd()}...`;
  }

  _summarizeCommand(command, limit = 160) {
    const value = String(command || '').trim();
    if (!value) {
      return '';
    }
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit).trimEnd()}...`;
  }

  _emitItemStep(eventType, item) {
    const itemType = String(item.type || '').trim().toLowerCase();
    const itemText = String(item.text || '').trim();

    if (itemType === 'reasoning' && itemText) {
      this.emit('step', `思考: ${this._trimForStep(itemText)}`);
      return;
    }

    if (itemType !== 'command_execution') {
      return;
    }

    const command = String(item.command || '').trim();
    if (eventType === 'item.started') {
      const summarized = this._summarizeCommand(command);
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

      const summarized = this._summarizeCommand(command);
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

    const matched = HEADER_FIELD_RE.exec(line);
    if (matched) {
      const key = matched[1].trim().toLowerCase();
      const value = matched[2].trim();
      const aliasMap = {
        model: '模型',
        workdir: '工作目录',
        'session id': '会话ID',
        'reasoning effort': '推理强度',
      };
      if (aliasMap[key]) {
        this.emit('meta', aliasMap[key], value);
      }
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

    if (eventType === 'item.started' || eventType === 'item.completed') {
      if (event.item && typeof event.item === 'object') {
        this._emitItemStep(eventType, event.item);
      }
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
          this.emit('meta', '模型', model);
        }

        const usage = event.response.usage;
        if (usage && typeof usage === 'object') {
          this._emitUsageMeta(usage);
        }

        if (!this.gotStreamDelta) {
          const fallback = this._extractResponseMessageText(event.response);
          this._appendAssistantText(assistantChunks, fallback, true);
        }
      }
      return;
    }

    if (eventType === 'turn.completed') {
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
      const texts = this._extractEventTexts(event);
      for (const text of texts) {
        this.gotStreamDelta = true;
        this._appendAssistantText(assistantChunks, text, true);
        this.emit('status', '正在输出回复...');
      }
    }

    this.emit('event', 'muted', eventType);
  }

  _emitUsageMeta(usage) {
    if (usage.input_tokens !== undefined) {
      this.emit('meta', '输入Tokens', String(usage.input_tokens));
    }
    if (usage.output_tokens !== undefined) {
      this.emit('meta', '输出Tokens', String(usage.output_tokens));
    }
    if (usage.total_tokens !== undefined) {
      this.emit('meta', '总Tokens', String(usage.total_tokens));
    }
  }

  _extractResponseMessageText(response) {
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

  _extractEventTexts(event) {
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

  _extractJsonText(mixedText) {
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
        const responseText = this._extractResponseMessageText(event.response || {});
        if (responseText) {
          chunks.push(responseText);
        }
        continue;
      }

      for (const item of this._extractEventTexts(event)) {
        chunks.push(item);
      }
    }

    if (!chunks.length) {
      return '';
    }

    return chunks.join('\n').trim();
  }

  _looksLikeResumeError(output) {
    const lower = String(output || '').toLowerCase();
    const keywords = [
      'resume', 'session', 'thread', 'not found', 'no recorded session', 'invalid session', 'turn.failed',
    ];
    return (lower.includes('resume') || lower.includes('session'))
      && keywords.some((item) => lower.includes(item));
  }

  _looksLikeServerOverload(output) {
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
}

module.exports = {
  CodexRunner,
  stripAnsi,
  splitShellArgs,
};
