const { EventEmitter } = require('node:events');
const readline = require('node:readline');

const { spawnCommand } = require('../child_process_helper');
const { getCodexChildEnv } = require('../shell_env');
const {
  stripAnsi,
  parseUsagePayload,
} = require('./codex_cli_gateway');
const {
  buildAppServerCommand,
  parseAppServerCommandSettings,
} = require('./codex_app_server_command');
const {
  extractItemMessageText,
  normalizeAssistantCompareText,
  normalizePlanStatus,
  summarizeCommand,
  toSnakeCase,
  trimForStep,
} = require('./codex_runner_output');
const { emitUsageMeta } = require('./codex_runner_usage');

class CodexAppServerRunner extends EventEmitter {
  constructor({ commandText, prompt, workdir, sessionId = '', mode = 'start' }) {
    super();
    this.commandText = commandText;
    this.prompt = prompt;
    this.workdir = workdir;
    this.sessionId = sessionId;
    this.mode = mode === 'resume' || mode === 'fork' ? mode : 'start';
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
    this.activeTurnId = '';
    this.rawLines = [];
    this.lastUsage = null;
    this.lastModel = '';
  }

  stop() {
    this.stopped = true;
    if (!this.proc || this.proc.killed) {
      return;
    }
    this.emit('status', '正在停止当前任务...');
    if (this.threadId && this.activeTurnId) {
      this._sendRequest('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.activeTurnId,
      }).catch(() => {
        if (this.proc && !this.proc.killed) {
          this.proc.kill('SIGTERM');
        }
      });
      return;
    }
    this.proc.kill('SIGTERM');
  }

  async steer(text) {
    const body = String(text || '').trim();
    if (!body) {
      throw new Error('插入内容不能为空');
    }
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error('当前运行实例不可用');
    }
    if (!this.threadId || !this.activeTurnId) {
      throw new Error('当前没有可插入的进行中任务');
    }
    this.emit('event', 'hint', `已插入新指令: ${trimForStep(body, 160)}`);
    const result = await this._sendRequest('turn/steer', {
      threadId: this.threadId,
      input: [{ type: 'text', text: body }],
      expectedTurnId: this.activeTurnId,
    }) as any;
    const acceptedTurnId = String(result?.turnId || result?.turn?.id || '').trim();
    if (acceptedTurnId && this.activeTurnId && acceptedTurnId !== this.activeTurnId) {
      throw new Error('服务器返回了不匹配的 turnId');
    }
    return {
      ok: true,
      turnId: acceptedTurnId || this.activeTurnId,
    };
  }

  async run() {
    const startMs = Date.now();

    try {
      const settings = parseAppServerCommandSettings(this.commandText, this.workdir);
      const cmd = buildAppServerCommand(settings);
      this.emit('status', '正在启动 Codex...');
      this.emit('event', 'hint', `启动 app-server: ${cmd.join(' ')}`);

      this._spawnServer(cmd);
      await this._sendRequest('initialize', {
        clientInfo: {
          name: 'codex_desk_electron',
          title: 'Conductor Electron',
          version: '0.1.0',
        },
      });
      this._sendNotification('initialized', {});

      let threadResponse = null;
      if (this.mode === 'fork') {
        threadResponse = await this._sendRequest('thread/fork', {
          threadId: this.sessionId,
        }) as any;
      } else if (this.mode === 'resume') {
        threadResponse = await this._sendRequest('thread/resume', {
          threadId: this.sessionId,
        }) as any;
      } else {
        threadResponse = await this._sendRequest('thread/start', {
          ...(settings.model ? { model: settings.model } : {}),
        }) as any;
      }

      const thread = threadResponse?.thread || {};
      const threadId = String(thread.id || threadResponse?.threadId || threadResponse?.id || '').trim();
      if (!threadId) {
        throw new Error('app-server 未返回新的会话 ID');
      }
      this.threadId = threadId;
      this.emit('meta', '会话ID', threadId);
      const resolvedModel = String(threadResponse?.model || settings.model || '').trim();
      if (resolvedModel) {
        this.lastModel = resolvedModel;
        this.emit('meta', '模型', resolvedModel);
      }
      if (this.mode === 'fork') {
        this.emit('event', 'hint', `已分叉原生会话: ${this.sessionId} -> ${threadId}`);
      } else if (this.mode === 'resume') {
        this.emit('event', 'hint', `已恢复原生会话: ${threadId}`);
      } else {
        this.emit('event', 'hint', `已创建原生会话: ${threadId}`);
      }

      const turnResponse = await this._sendRequest('turn/start', {
        threadId,
        input: [{ type: 'text', text: this.prompt }],
        cwd: this.workdir,
        approvalPolicy: settings.approvalPolicy,
        sandboxPolicy: settings.sandboxPolicy,
        ...(settings.model ? { model: settings.model } : {}),
      }) as any;

      const turnId = String(turnResponse?.turn?.id || turnResponse?.turnId || '').trim();
      if (!turnId) {
        throw new Error('app-server 未返回 turn id');
      }
      this.activeTurnId = turnId;

      const result = await this._waitForTurnCompleted(turnId) as any;
      const durationSeconds = Math.max(0, (Date.now() - startMs) / 1000);
      this._emitFinished({
        exitCode: result.exitCode,
        assistantText: this.assistantChunks.join('').trim(),
        rawOutput: this.rawLines.join('\n').trim(),
        durationSeconds,
        sessionId: this.threadId,
        sessionResetSuggested: false,
        usage: this.lastUsage,
        model: this.lastModel,
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
        usage: this.lastUsage,
        model: this.lastModel,
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
    this.proc = spawnCommand(cmd[0], cmd.slice(1), {
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
        this.emit('raw_line', { direction: 'received', line: cleanLine });
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
    if (method === 'codex/event/token_count' || method === 'thread/tokenUsage/updated') {
      const usage = this._extractUsagePayload(params);
      if (usage) {
        emitUsageMeta(this, usage);
      }
      return;
    }

    if (method === 'turn/started') {
      const turnId = String(params?.turn?.id || params?.turnId || '').trim();
      if (turnId) {
        this.activeTurnId = turnId;
      }
      this.emit('status', '正在分析请求...');
      this.emit('event', 'info', 'turn.started');
      return;
    }

    if (method === 'turn/plan/updated') {
      const rawPlan = Array.isArray(params?.plan) ? params.plan : [];
      const plan = rawPlan
        .map((entry) => ({
          step: String(entry?.step || '').trim(),
          status: normalizePlanStatus(entry?.status),
        }))
        .filter((entry) => entry.step);
      this.emit('plan_update', {
        explanation: String(params?.explanation || '').trim(),
        plan,
      });
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
      const turnId = String(params?.turn?.id || params?.turnId || '').trim();
      if (turnId && (!this.activeTurnId || turnId === this.activeTurnId)) {
        this.activeTurnId = '';
      }
      const usage = this._extractUsagePayload(params);
      if (usage) {
        emitUsageMeta(this, usage);
      }
      if (!this.pendingTurn) {
        return;
      }
      if (status === 'completed') {
        this.emit('status', '任务完成');
        this.emit('event', 'success', 'turn.completed');
        this.pendingTurn.resolve({ exitCode: 0 });
      } else if (status === 'interrupted') {
        this.emit('status', '任务已停止');
        this.emit('event', 'warn', 'turn.interrupted');
        this.pendingTurn.resolve({ exitCode: 130 });
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
    return parseUsagePayload(payload);
  }

  _writeJson(message) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error('app-server stdin 不可用');
    }
    const line = JSON.stringify(message);
    this.emit('raw_line', { direction: 'sent', line });
    this.proc.stdin.write(`${line}\n`);
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
      this.emit('step', `思考: ${trimForStep(itemText)}`);
      return;
    }

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
      this.emit('step', summarized ? `执行命令: \`${summarized}\`` : '开始执行命令');
      return;
    }

    const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
    let text = exitCode === null ? '命令执行完成' : `命令执行完成（退出码 ${exitCode}）`;
    const summarized = summarizeCommand(command);
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

    const text = extractItemMessageText(rawItem);
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
