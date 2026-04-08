const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const os = require('node:os');

const { getCodexChildEnv } = require('./shell_env');
const { splitShellArgs, stripAnsi } = require('./codex_runner');

function toSnakeCase(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
    .trim();
}

function normalizeAssistantCompareText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

class CodexAppServerRunner extends EventEmitter {
  constructor({ commandText, prompt, workdir, sessionId = '', mode = 'fork' }) {
    super();
    this.commandText = commandText;
    this.prompt = prompt;
    this.workdir = workdir;
    this.sessionId = sessionId;
    this.mode = mode === 'resume' ? 'resume' : 'fork';
    this.childEnv = getCodexChildEnv();

    this.proc = null;
    this.stopped = false;
    this.requestSeq = 0;
    this.pendingRequests = new Map();
    this.pendingTurn = null;
    this.finishedEmitted = false;
    this.assistantChunks = [];
    this.lastAssistantUpdateText = '';
    this.threadId = sessionId;
    this.rawLines = [];
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

    try {
      const settings = this._parseCommandSettings();
      const cmd = this._buildAppServerCommand(settings);
      this.emit('status', '正在启动 Codex...');
      this.emit('event', 'hint', `启动 app-server: ${cmd.join(' ')}`);

      this._spawnServer(cmd);
      await this._sendRequest('initialize', {
        clientInfo: {
          name: 'codex_desk_electron',
          title: 'Codex Desk Electron',
          version: '0.1.0',
        },
      });
      this._sendNotification('initialized', {});

      const threadResponse = await this._sendRequest(
        this.mode === 'fork' ? 'thread/fork' : 'thread/resume',
        { threadId: this.sessionId },
      ) as any;

      const thread = threadResponse?.thread || {};
      const threadId = String(thread.id || '').trim();
      if (!threadId) {
        throw new Error('app-server 未返回新的会话 ID');
      }
      this.threadId = threadId;
      this.emit('meta', '会话ID', threadId);
      if (threadResponse?.model) {
        this.emit('meta', '模型', String(threadResponse.model));
      }
      if (this.mode === 'fork') {
        this.emit('event', 'hint', `已分叉原生会话: ${this.sessionId} -> ${threadId}`);
      } else {
        this.emit('event', 'hint', `已恢复原生会话: ${threadId}`);
      }

      const turnResponse = await this._sendRequest('turn/start', {
        threadId,
        input: [{ type: 'text', text: this.prompt }],
        cwd: this.workdir,
        approvalPolicy: settings.approvalPolicy,
        sandboxPolicy: settings.sandboxPolicy,
        ...(settings.model ? { model: settings.model } : {}),
      }) as any;

      const turnId = String(turnResponse?.turn?.id || '').trim();
      if (!turnId) {
        throw new Error('app-server 未返回 turn id');
      }

      const result = await this._waitForTurnCompleted(turnId) as any;
      const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      this._emitFinished({
        exitCode: result.exitCode,
        assistantText: this.assistantChunks.join('').trim(),
        rawOutput: this.rawLines.join('\n').trim(),
        durationSeconds,
        sessionId: this.threadId,
        sessionResetSuggested: false,
      });
    } catch (error) {
      const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      this._emitFinished({
        exitCode: 1,
        assistantText: this.assistantChunks.join('').trim(),
        rawOutput: [this.rawLines.join('\n').trim(), `执行失败: ${error?.message || String(error)}`].filter(Boolean).join('\n'),
        durationSeconds,
        sessionId: this.threadId,
        sessionResetSuggested: false,
      });
    } finally {
      this._shutdownProcess();
    }
  }

  _emitFinished(result) {
    if (this.finishedEmitted) {
      return;
    }
    this.finishedEmitted = true;
    this.emit('finished', result);
  }

  _shutdownProcess() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
    for (const { reject } of this.pendingRequests.values()) {
      reject(new Error('app-server 已结束'));
    }
    this.pendingRequests.clear();
  }

  _spawnServer(cmd) {
    this.proc = spawn(cmd[0], cmd.slice(1), {
      cwd: this.workdir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.childEnv,
    });

    const bindJsonStream = (stream) => {
      const rl = readline.createInterface({ input: stream });
      rl.on('line', (line) => {
        const cleanLine = stripAnsi(String(line || '').trim());
        if (!cleanLine) {
          return;
        }
        this.rawLines.push(cleanLine);
        this.emit('raw_line', cleanLine);
        this._handleJsonRpcMessage(cleanLine);
      });
    };

    bindJsonStream(this.proc.stdout);

    const stderrRl = readline.createInterface({ input: this.proc.stderr });
    stderrRl.on('line', (line) => {
      const cleanLine = stripAnsi(String(line || '').trim());
      if (!cleanLine) {
        return;
      }
      this.rawLines.push(cleanLine);
      this.emit('event', cleanLine.toLowerCase().includes('error') ? 'error' : 'info', cleanLine);
    });

    this.proc.on('error', (error) => {
      if (!this.finishedEmitted) {
        this._emitFinished({
          exitCode: 1,
          assistantText: this.assistantChunks.join('').trim(),
          rawOutput: [this.rawLines.join('\n').trim(), `process error: ${error?.message || String(error)}`].filter(Boolean).join('\n'),
          durationSeconds: 0,
          sessionId: this.threadId,
          sessionResetSuggested: false,
        });
      }
    });

    this.proc.on('close', (code) => {
      const statusText = `app-server exited: ${Number.isInteger(code) ? code : 1}`;
      for (const { reject } of this.pendingRequests.values()) {
        reject(new Error(statusText));
      }
      this.pendingRequests.clear();
      if (this.pendingTurn && !this.finishedEmitted) {
        this.pendingTurn.resolve({ exitCode: Number.isInteger(code) ? code : 1 });
        this.pendingTurn = null;
      }
    });
  }

  _handleJsonRpcMessage(line) {
    let message = null;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit('event', 'info', line);
      return;
    }

    if (message && typeof message.method === 'string' && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this._handleServerRequest(message);
      return;
    }

    if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      const key = String(message.id);
      const pending = this.pendingRequests.get(key);
      if (pending) {
        this.pendingRequests.delete(key);
        if (message.error) {
          pending.reject(new Error(String(message.error?.message || 'unknown app-server error')));
        } else {
          pending.resolve(message.result || message.response || {});
        }
      }
      return;
    }

    if (message && typeof message.method === 'string') {
      this._handleNotification(String(message.method || ''), message.params || {});
    }
  }

  _handleServerRequest(message) {
    const method = String(message.method || '');
    const id = message.id;
    if (method.includes('requestApproval')) {
      this.emit('event', 'warn', `app-server 请求审批，已自动拒绝: ${method}`);
      this._writeJson({
        id,
        result: { decision: 'decline' },
      });
      return;
    }
    this._writeJson({
      id,
      error: { message: `unsupported server request: ${method}` },
    });
  }

  _handleNotification(method, params) {
    if (method === 'turn/started') {
      this.emit('status', '正在分析请求...');
      this.emit('event', 'info', 'turn.started');
      return;
    }

    if (method === 'item/agentMessage/delta') {
      const delta = String(params?.delta || '');
      if (delta) {
        this.assistantChunks.push(delta);
        this.emit('assistant_delta', delta);
        this.emit('status', '正在输出回复...');
      }
      return;
    }

    if (method === 'item/started' || method === 'item/completed') {
      const item = params?.item;
      if (item && typeof item === 'object') {
        const eventType = method === 'item/started' ? 'item.started' : 'item.completed';
        this._emitItemStep(eventType, item);
        this._emitAssistantUpdate(eventType, item);
      }
      return;
    }

    if (method === 'turn/completed') {
      const status = String(params?.turn?.status || '').toLowerCase();
      const usage = this._extractUsagePayload(params);
      if (usage) {
        this._emitUsageMeta(usage);
      }
      if (!this.pendingTurn) {
        return;
      }
      if (status === 'completed') {
        this.emit('status', '任务完成');
        this.emit('event', 'success', 'turn.completed');
        this.pendingTurn.resolve({ exitCode: 0 });
      } else {
        const message = String(params?.turn?.error?.message || status || 'turn failed');
        this.emit('status', '任务失败');
        this.emit('event', 'error', `turn.failed ${message}`.trim());
        this.pendingTurn.resolve({ exitCode: 1 });
      }
      this.pendingTurn = null;
      return;
    }

    if (method === 'thread/started') {
      const threadId = String(params?.thread?.id || '').trim();
      if (threadId) {
        this.emit('event', 'success', `thread.started  thread_id=${threadId}`);
      }
      return;
    }
  }

  _waitForTurnCompleted(turnId) {
    return new Promise((resolve) => {
      this.pendingTurn = { turnId, resolve };
    });
  }

  _extractUsagePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    if (payload.usage && typeof payload.usage === 'object') {
      return payload.usage;
    }
    if (payload.turn && typeof payload.turn === 'object' && payload.turn.usage && typeof payload.turn.usage === 'object') {
      return payload.turn.usage;
    }
    return null;
  }

  _emitUsageMeta(usage) {
    const cachedInputTokens = usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cached_tokens;

    this.emit('meta', '输入Tokens', usage.input_tokens !== undefined ? String(usage.input_tokens) : '-');
    this.emit('meta', '缓存输入Tokens', cachedInputTokens !== undefined ? String(cachedInputTokens) : '-');
    this.emit('meta', '输出Tokens', usage.output_tokens !== undefined ? String(usage.output_tokens) : '-');
    if (usage.total_tokens !== undefined) {
      this.emit('meta', '总Tokens', String(usage.total_tokens));
    }
  }

  _writeJson(message) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error('app-server stdin 不可用');
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _sendNotification(method, params) {
    this._writeJson({ method, params });
  }

  _sendRequest(method, params) {
    this.requestSeq += 1;
    const id = this.requestSeq;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(String(id), { resolve, reject });
      this._writeJson({ method, id, params });
    });
  }

  _parseCommandSettings() {
    const parts = splitShellArgs(this.commandText);
    if (parts.length < 2 || String(parts[1] || '') !== 'exec') {
      throw new Error('当前命令不是 `codex exec`，无法使用 fork 导入模式');
    }

    const args = parts.slice(2);
    const rootArgs = [];
    const addDirs = new Set();
    let model = '';
    let approvalPolicy = '';
    let sandboxMode = '';
    let dangerousBypass = false;
    let fullAuto = false;

    const keepWithValue = new Set(['--config', '-c', '--enable', '--disable']);
    for (let index = 0; index < args.length; index += 1) {
      const token = String(args[index] || '');
      if (keepWithValue.has(token) && index + 1 < args.length) {
        rootArgs.push(token, String(args[index + 1] || ''));
        index += 1;
        continue;
      }
      if (token.startsWith('--config=')) {
        rootArgs.push(token);
        const match = /^--config=(.+)$/.exec(token);
        const configValue = String(match?.[1] || '').trim();
        const modelFromConfig = /^model\s*=\s*(.+)$/i.exec(configValue);
        if (modelFromConfig?.[1]) {
          model = String(modelFromConfig[1] || '').replace(/^['"]|['"]$/g, '').trim();
        }
        continue;
      }
      if ((token === '--model' || token === '-m') && index + 1 < args.length) {
        model = String(args[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token.startsWith('--model=')) {
        model = token.split('=', 2)[1].trim();
        continue;
      }
      if ((token === '--ask-for-approval' || token === '-a') && index + 1 < args.length) {
        approvalPolicy = String(args[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token.startsWith('--ask-for-approval=')) {
        approvalPolicy = token.split('=', 2)[1].trim();
        continue;
      }
      if ((token === '--sandbox' || token === '-s') && index + 1 < args.length) {
        sandboxMode = String(args[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token.startsWith('--sandbox=')) {
        sandboxMode = token.split('=', 2)[1].trim();
        continue;
      }
      if (token === '--add-dir' && index + 1 < args.length) {
        addDirs.add(String(args[index + 1] || '').trim());
        index += 1;
        continue;
      }
      if (token.startsWith('--add-dir=')) {
        addDirs.add(token.split('=', 2)[1].trim());
        continue;
      }
      if (token === '--dangerously-bypass-approvals-and-sandbox') {
        dangerousBypass = true;
        continue;
      }
      if (token === '--full-auto') {
        fullAuto = true;
      }
    }

    const writableRoots = Array.from(new Set([
      String(this.workdir || '').trim(),
      String(os.homedir() || '').trim(),
      ...Array.from(addDirs),
    ].filter(Boolean)));

    let resolvedApproval = approvalPolicy;
    let resolvedSandbox = sandboxMode;
    if (dangerousBypass) {
      resolvedApproval = 'never';
      resolvedSandbox = 'danger-full-access';
    } else if (fullAuto) {
      resolvedApproval = resolvedApproval || 'on-request';
      resolvedSandbox = resolvedSandbox || 'workspace-write';
    } else {
      resolvedApproval = resolvedApproval || 'never';
      resolvedSandbox = resolvedSandbox || 'danger-full-access';
    }

    let sandboxPolicy: any = { type: 'dangerFullAccess' };
    if (resolvedSandbox === 'read-only') {
      sandboxPolicy = { type: 'readOnly', networkAccess: false };
    } else if (resolvedSandbox === 'workspace-write') {
      sandboxPolicy = {
        type: 'workspaceWrite',
        writableRoots,
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    }

    const normalizedApproval = {
      untrusted: 'untrusted',
      'on-failure': 'on-failure',
      'on-request': 'on-request',
      never: 'never',
    }[String(resolvedApproval || '').trim()] || 'never';

    return {
      codexBin: String(parts[0] || 'codex'),
      rootArgs,
      model,
      approvalPolicy: normalizedApproval,
      sandboxPolicy,
    };
  }

  _buildAppServerCommand(settings) {
    return [settings.codexBin, 'app-server', ...settings.rootArgs];
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

  _extractItemMessageText(item) {
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
      const blockType = toSnakeCase(block.type || '');
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
    return blocks.join('\n').trim();
  }

  _emitItemStep(eventType, rawItem) {
    const item = rawItem || {};
    const itemType = toSnakeCase(item.type || '');
    const itemText = String(item.text || item.message || '').trim();
    const role = String(item.role || '').trim().toLowerCase();
    const isAssistantMessage = itemType === 'agent_message'
      || itemType === 'assistant_message'
      || itemType === 'assistant'
      || (itemType === 'message' && role === 'assistant');

    if (itemType === 'reasoning' && itemText) {
      this.emit('step', `思考: ${this._trimForStep(itemText)}`);
      return;
    }

    if (isAssistantMessage) {
      return;
    }

    if (itemType !== 'command_execution') {
      const itemLabel = itemType || 'unknown_item';
      const detail = this._extractItemMessageText(item)
        || String(item.title || item.name || item.label || item.command || '').trim();
      const detailPreview = this._trimForStep(detail, 220);
      if (eventType === 'item.started') {
        this.emit('step', detailPreview ? `开始处理 ${itemLabel}: ${detailPreview}` : `开始处理 ${itemLabel}`);
      } else if (eventType === 'item.completed') {
        this.emit('step', detailPreview ? `处理完成 ${itemLabel}: ${detailPreview}` : `处理完成 ${itemLabel}`);
      }
      return;
    }

    const command = String(item.command || '').trim();
    if (eventType === 'item.started') {
      const summarized = this._summarizeCommand(command);
      this.emit('step', summarized ? `执行命令: \`${summarized}\`` : '开始执行命令');
      return;
    }

    const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
    let text = exitCode === null ? '命令执行完成' : `命令执行完成（退出码 ${exitCode}）`;
    const summarized = this._summarizeCommand(command);
    if (summarized) {
      text += `: \`${summarized}\``;
    }
    const aggregated = String(item.aggregatedOutput || '').trim();
    if (aggregated) {
      text += `\n输出:\n\`\`\`\n${aggregated.replace(/\r\n/g, '\n')}\n\`\`\``;
    }
    this.emit('step', text);
  }

  _emitAssistantUpdate(eventType, rawItem) {
    if (eventType !== 'item.completed' || !rawItem || typeof rawItem !== 'object') {
      return;
    }

    const itemType = toSnakeCase(rawItem.type || '');
    const role = String(rawItem.role || '').trim().toLowerCase();
    const isAssistantMessage = itemType === 'agent_message'
      || itemType === 'assistant_message'
      || itemType === 'assistant'
      || (itemType === 'message' && role === 'assistant');
    if (!isAssistantMessage) {
      return;
    }

    const text = this._extractItemMessageText(rawItem);
    const normalizedText = normalizeAssistantCompareText(text);
    if (!normalizedText || normalizedText === this.lastAssistantUpdateText) {
      return;
    }
    const currentAssistantText = this.assistantChunks.join('').trim();
    if (!currentAssistantText || text.length >= currentAssistantText.length) {
      this.assistantChunks = [text];
    }
    this.lastAssistantUpdateText = normalizedText;
    this.emit('assistant_update', {
      eventType,
      itemType,
      text,
    });
  }
}

module.exports = {
  CodexAppServerRunner,
};
