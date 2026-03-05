const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { StateStore } = require('./state_store');
const { CodexRunner, splitShellArgs, stripAnsi } = require('./codex_runner');
const { nowTs, newConversation, getConversation, sortedConversations } = require('./conversation_service');
const { RuntimeStore } = require('./runtime_store');

function tsLabel() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function normalizePreview(text, limit = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

class AppController {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.stateStore = new StateStore();

    const loaded = this.stateStore.load();
    this.commandText = loaded.commandText;
    this.workdir = loaded.workdir;
    // Electron track now always uses Codex native memory semantics.
    this.useNativeMemory = true;

    this.conversations = Array.isArray(loaded.conversations) ? loaded.conversations : [];

    let renamedFromTest = false;
    for (let index = 0; index < this.conversations.length; index += 1) {
      const conv = this.conversations[index];
      if (String(conv.title || '').trim() === '测试重命名') {
        conv.title = `会话 ${index + 1}`;
        conv.updatedAt = nowTs();
        renamedFromTest = true;
      }
    }

    this.activeConversationId = String(loaded.activeConversationId || '').trim();
    if (!this.conversations.some((item) => item.id === this.activeConversationId)) {
      this.activeConversationId = '';
    }

    this.runtimeStore = new RuntimeStore();
    this.metaByConversation = {};
    this.runners = new Map();
    this.assistantBufferByRunner = new Map();
    this.stepIndexByRunner = new Map();
    this.roundIndexByRunner = new Map();
    this.structuredEventSeq = 0;

    for (const conv of this.conversations) {
      this.runtimeStore.ensure(conv.id);
      this.metaByConversation[conv.id] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': conv.sessionId || '-',
      };
    }

    if (renamedFromTest) {
      this._persist();
    }
  }

  _emit(event) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send('app:event', event);
  }

  _persist() {
    this.stateStore.save({
      commandText: this.commandText,
      workdir: this.workdir,
      useNativeMemory: this.useNativeMemory,
      activeConversationId: this.activeConversationId,
      conversations: this.conversations,
    });
  }

  _ensureMeta(conversationId) {
    if (!this.metaByConversation[conversationId]) {
      this.metaByConversation[conversationId] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': '-',
      };
    }
    return this.metaByConversation[conversationId];
  }

  _isConversationRunning(conversationId) {
    if (!conversationId) {
      return false;
    }
    return this.runners.has(conversationId);
  }

  _anyConversationRunning() {
    return this.runners.size > 0;
  }

  _syncConversationUpdated(conversation) {
    this._emit({ type: 'conversation-updated', conversation });
  }

  _setPhase(conversationId, phase) {
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.phase = phase;
    this._emit({ type: 'runtime-phase', conversationId, phase });
  }

  _appendStructuredEvent(conversationId, level, message) {
    this.structuredEventSeq += 1;
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      id: `evt-${Date.now()}-${this.structuredEventSeq}`,
      level,
      message: String(message || ''),
      timestamp: tsLabel(),
    };
    runtime.events.push(item);
    this._emit({ type: 'runtime-event-append', conversationId, item });
  }

  _appendWorkflowRoundHeader(conversationId, roundIndex, userText) {
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'round',
      roundIndex,
      preview: normalizePreview(userText),
      timestamp: tsLabel(),
    };
    runtime.workflow.push(item);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  }

  _appendWorkflowStep(conversationId, stepText) {
    const text = String(stepText || '').trim();
    if (!text) {
      return;
    }

    let title = '步骤';
    let body = text;
    let roundIndex = 0;
    let stepIndex = 0;

    let match = /^R(\d+)-S(\d+)\.\s*([\s\S]+)$/.exec(text);
    if (match) {
      roundIndex = Number(match[1]);
      stepIndex = Number(match[2]);
      title = `R${roundIndex}-S${stepIndex}`;
      body = String(match[3]).trim();
    } else {
      match = /^(\d+)\.\s*([\s\S]+)$/.exec(text);
      if (match) {
        stepIndex = Number(match[1]);
        title = `步骤 ${stepIndex}`;
        body = String(match[2]).trim();
      }
    }

    let tag = 'INFO';
    if (body.startsWith('思考:')) {
      tag = 'THINK';
    } else if (body.includes('执行命令:')) {
      tag = 'RUN';
    } else if (body.includes('命令执行完成')) {
      tag = 'DONE';
    } else if (body.startsWith('请求')) {
      tag = 'ROUND';
    }

    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'step',
      roundIndex,
      stepIndex,
      title,
      tag,
      body,
      timestamp: tsLabel(),
    };
    runtime.workflow.push(item);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  }

  _appendRawJsonLine(conversationId, line) {
    if (!String(line || '').trimStart().startsWith('{')) {
      return;
    }
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.raw.push(line);
    this._emit({ type: 'runtime-raw-append', conversationId, line });
  }

  _setStartedAt(conversationId, startedAt) {
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.startedAt = startedAt;
    this._emit({ type: 'runtime-started-at', conversationId, startedAt });
  }

  _buildLocalPrompt(conversation) {
    const lines = ['请继续下面的中文对话，保持简洁准确。', ''];
    const history = Array.isArray(conversation.messages) ? conversation.messages.slice(-20) : [];
    for (const item of history) {
      const roleName = item.role === 'user' ? '用户' : '助手';
      lines.push(`${roleName}: ${item.text}`);
    }
    lines.push('\n请直接回复下一句助手内容。');
    return lines.join('\n');
  }

  _releaseRunner(conversationId, runner) {
    const mapped = this.runners.get(conversationId);
    if (mapped === runner) {
      this.runners.delete(conversationId);
      this._emit({ type: 'runner-state', conversationId, running: false });
    }

    this.assistantBufferByRunner.delete(runner);
    this.stepIndexByRunner.delete(runner);
    this.roundIndexByRunner.delete(runner);
  }

  snapshot() {
    return {
      settings: {
        commandText: this.commandText,
        workdir: this.workdir,
        useNativeMemory: this.useNativeMemory,
      },
      activeConversationId: this.activeConversationId,
      conversations: sortedConversations(this.conversations),
      runtimeByConversation: this.runtimeStore.toObject(),
      metaByConversation: this.metaByConversation,
      runningConversationIds: Array.from(this.runners.keys()),
    };
  }

  updateSettings(input) {
    if (typeof input.commandText === 'string') {
      this.commandText = input.commandText;
    }
    if (typeof input.workdir === 'string') {
      this.workdir = input.workdir;
    }
    this.useNativeMemory = true;
    this._persist();
    return this.snapshot();
  }

  switchConversation(conversationId) {
    const target = getConversation(this.conversations, conversationId);
    if (!target) {
      return this.snapshot();
    }
    if (target.id !== this.activeConversationId) {
      this.activeConversationId = target.id;
      this._appendStructuredEvent(target.id, 'hint', `已切换对话: ${target.title}`);
      this._persist();
    }
    return this.snapshot();
  }

  createConversation() {
    const conv = newConversation();
    this.conversations.push(conv);
    this.runtimeStore.ensure(conv.id);
    this._ensureMeta(conv.id);

    this.activeConversationId = conv.id;
    this._appendStructuredEvent(conv.id, 'success', `已新建对话: ${conv.title}`);
    this._persist();
    return this.snapshot();
  }

  renameConversation(conversationId, title) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }
    const nextTitle = String(title || '').trim();
    if (!nextTitle) {
      return { error: '会话名称不能为空', snapshot: this.snapshot() };
    }
    conv.title = nextTitle;
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);
    this._appendStructuredEvent(conv.id, 'hint', `已重命名对话: ${nextTitle}`);
    this._persist();
    return this.snapshot();
  }

  _resolveCodexCommandParts() {
    const parts = splitShellArgs(this.commandText);
    if (!parts.length) {
      return [];
    }
    return parts;
  }

  _extractModelFromCommand(parts) {
    let model = '';
    for (let i = 0; i < parts.length; i += 1) {
      const token = String(parts[i] || '');
      if ((token === '--model' || token === '-m') && i + 1 < parts.length) {
        model = String(parts[i + 1] || '').trim();
      } else if (token.startsWith('--model=')) {
        model = token.split('=', 2)[1].trim();
      } else if ((token === '--config' || token === '-c') && i + 1 < parts.length) {
        const fromConfigArg = this._extractModelFromConfigAssignment(parts[i + 1]);
        if (fromConfigArg) {
          model = fromConfigArg;
        }
      } else if (token.startsWith('--config=')) {
        const fromInlineConfig = this._extractModelFromConfigAssignment(token.split('=', 2)[1]);
        if (fromInlineConfig) {
          model = fromInlineConfig;
        }
      }
    }
    return this._stripWrappedQuotes(model);
  }

  _extractProfileFromCommand(parts) {
    let profile = '';
    for (let i = 0; i < parts.length; i += 1) {
      const token = String(parts[i] || '');
      if ((token === '--profile' || token === '-p') && i + 1 < parts.length) {
        profile = String(parts[i + 1] || '').trim();
      } else if (token.startsWith('--profile=')) {
        profile = token.split('=', 2)[1].trim();
      }
    }
    return this._stripWrappedQuotes(profile);
  }

  _extractModelFromConfigAssignment(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }
    // codex -c model=\"xxx\" or --config=model=\"xxx\"
    const match = /^model\s*=\s*(.+)$/i.exec(text);
    if (!match) {
      return '';
    }
    return this._stripWrappedQuotes(match[1]);
  }

  _stripWrappedQuotes(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('\'') && raw.endsWith('\''))) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  }

  _extractModelFromConfigFile(parts) {
    const codexHome = String(process.env.CODEX_HOME || '').trim() || path.join(os.homedir(), '.codex');
    const configPath = path.join(codexHome, 'config.toml');
    if (!fs.existsSync(configPath)) {
      return '';
    }

    let text = '';
    try {
      text = fs.readFileSync(configPath, 'utf-8');
    } catch {
      return '';
    }

    const profileName = this._extractProfileFromCommand(parts);
    if (profileName) {
      const lines = text.split(/\r?\n/);
      let currentSection = '';
      for (const line of lines) {
        const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        if (section) {
          currentSection = String(section[1] || '').trim();
          continue;
        }
        if (currentSection === `profiles.${profileName}`) {
          const profileModel = /^\s*model\s*=\s*"([^"]+)"\s*$/.exec(line);
          if (profileModel && profileModel[1]) {
            return profileModel[1].trim();
          }
        }
      }
    }

    const topLevel = /^\s*model\s*=\s*"([^"]+)"\s*$/m.exec(text);
    if (topLevel && topLevel[1]) {
      return topLevel[1].trim();
    }
    return '';
  }

  _normalizeExecOptionsForProbe(parts) {
    if (parts.length < 2 || parts[0] !== 'codex' || parts[1] !== 'exec') {
      return [parts[0] || 'codex', ...parts.slice(1)];
    }

    const args = parts.slice(2);
    const opts = [];
    const optionsWithValueKeep = new Set([
      '--config', '-c', '--model', '-m', '--profile', '-p', '--sandbox', '-s',
      '--cd', '-C', '--add-dir', '--output-schema', '--enable', '--disable',
    ]);

    for (let i = 0; i < args.length; i += 1) {
      const token = String(args[i] || '');

      if (token === 'resume') {
        if (i + 1 < args.length && !String(args[i + 1] || '').startsWith('-')) {
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

      if (optionsWithValueKeep.has(token) && i + 1 < args.length) {
        opts.push(token, String(args[i + 1] || ''));
        i += 1;
        continue;
      }

      opts.push(token);
    }

    return ['codex', 'exec', ...opts];
  }

  _extractModelFromJsonOutput(text) {
    const output = String(text || '');

    // Regex-first extraction from raw JSON lines.
    const regex = /"model"\s*:\s*"([^"]+)"/g;
    let match = null;
    let model = '';
    while ((match = regex.exec(output)) !== null) {
      const candidate = String(match[1] || '').trim();
      if (candidate) {
        model = candidate;
      }
    }
    if (model) {
      return model;
    }

    const fallback = /Model metadata for `([^`]+)`/i.exec(output);
    if (fallback && fallback[1]) {
      return fallback[1].trim();
    }

    // Fallback: parse JSON lines robustly.
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const raw = line.trim();
      if (!raw.startsWith('{')) {
        continue;
      }
      try {
        const event = JSON.parse(raw);
        if (event?.type === 'response.completed') {
          const m = String(event?.response?.model || '').trim();
          if (m) {
            return m;
          }
        }
      } catch {
        // ignore parse errors
      }
    }
    return '';
  }

  _isUsableModel(model) {
    const value = String(model || '').trim();
    if (!value) {
      return false;
    }
    if (value === '-' || value === '(未知)' || value === '(命令中未指定)') {
      return false;
    }
    return true;
  }

  _extractModelFromRuntime(conversationId) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (Array.isArray(runtime.raw) && runtime.raw.length) {
      const fromRaw = this._extractModelFromJsonOutput(runtime.raw.join('\n'));
      if (this._isUsableModel(fromRaw)) {
        return fromRaw;
      }
    }
    return '';
  }

  _probeModelFromCodex(parts) {
    return new Promise((resolve) => {
      const base = this._normalizeExecOptionsForProbe(parts);
      const probePrompt = '请只回复: ok';
      const cmd = [...base, '--json', probePrompt];

      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: this.workdir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const done = (payload) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(payload);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }, 3500);

      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          stdout += String(chunk || '');
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk || '');
        });
      }

      child.on('error', (error) => {
        clearTimeout(timer);
        done({
          timedOut,
          exitCode: 1,
          output: stripAnsi(`${stdout}\n${stderr}\n${error?.message || ''}`.trim()),
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        done({
          timedOut,
          exitCode: Number.isInteger(code) ? code : 1,
          output: stripAnsi(`${stdout}\n${stderr}`.trim()),
        });
      });
    });
  }

  refreshCodexVersion(conversationId) {
    const targetId = conversationId || this.activeConversationId;
    if (!targetId) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const conv = getConversation(this.conversations, targetId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    const parts = this._resolveCodexCommandParts();
    const bin = parts[0] || 'codex';
    if (!String(bin).toLowerCase().includes('codex')) {
      return { error: '当前命令不是 codex，无法获取版本。', snapshot: this.snapshot() };
    }

    try {
      const result = spawnSync(bin, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 6000,
      });
      const output = stripAnsi(String(result.stdout || result.stderr || '').trim());
      const firstLine = output.split(/\r?\n/)[0]?.trim() || '';
      if (!firstLine) {
        return { error: '未获取到 Codex 版本输出。', snapshot: this.snapshot() };
      }

      const meta = this._ensureMeta(targetId);
      meta['Codex版本'] = firstLine;
      this._emit({ type: 'meta-updated', conversationId: targetId, key: 'Codex版本', value: firstLine });
      this._appendStructuredEvent(targetId, 'hint', `Codex版本: ${firstLine}`);
      return this.snapshot();
    } catch (error) {
      return { error: `获取 Codex 版本失败: ${error?.message || String(error)}`, snapshot: this.snapshot() };
    }
  }

  async refreshModelInfo(conversationId) {
    const targetId = conversationId || this.activeConversationId;
    if (!targetId) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const conv = getConversation(this.conversations, targetId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    const parts = this._resolveCodexCommandParts();
    const bin = parts[0] || 'codex';
    if (!String(bin).toLowerCase().includes('codex')) {
      return { error: '当前命令不是 codex，无法获取模型。', snapshot: this.snapshot() };
    }

    // 1) Prefer explicit model from command args.
    let model = this._extractModelFromCommand(parts);

    // 2) Prefer configured default model from Codex config.
    if (!this._isUsableModel(model)) {
      model = this._extractModelFromConfigFile(parts);
    }

    // 3) Then try model from current conversation runtime JSON.
    if (!this._isUsableModel(model)) {
      model = this._extractModelFromRuntime(targetId);
    }

    // 4) Active probe only when still unknown.
    if (!this._isUsableModel(model)) {
      try {
        const probe = await this._probeModelFromCodex(parts);
        model = this._extractModelFromJsonOutput(probe.output);
        if (!this._isUsableModel(model)) {
          model = this._extractModelFromCommand(parts);
        }
        if (!this._isUsableModel(model)) {
          model = this._extractModelFromConfigFile(parts);
        }
        if (!this._isUsableModel(model)) {
          this._appendStructuredEvent(
            targetId,
            'hint',
            probe.timedOut
              ? '模型探测超时，未提取到模型信息。可在命令中添加 -m 或在 ~/.codex/config.toml 设置 model。'
              : '未从 Codex 返回事件中提取到模型信息。可在命令中添加 -m 或在 ~/.codex/config.toml 设置 model。',
          );
          return this.snapshot();
        }
      } catch (error) {
        this._appendStructuredEvent(targetId, 'warn', `模型探测失败: ${error?.message || String(error)}`);
        return this.snapshot();
      }
    }

    const meta = this._ensureMeta(targetId);
    meta['模型'] = model;
    this._emit({ type: 'meta-updated', conversationId: targetId, key: '模型', value: model });
    this._appendStructuredEvent(targetId, 'hint', `模型: ${model}`);
    return this.snapshot();
  }

  closeCurrentConversation() {
    if (!this.conversations.length) {
      return this.snapshot();
    }

    const closeId = this.activeConversationId;
    if (!closeId) {
      return this.snapshot();
    }
    const runningHere = this._isConversationRunning(closeId);

    if (runningHere) {
      let candidates = sortedConversations(this.conversations)
        .map((item) => item.id)
        .filter((item) => item !== closeId);
      if (!candidates.length) {
        this.activeConversationId = '';
        this._appendStructuredEvent(closeId, 'warn', '当前对话正在后台运行，暂无法关闭最后一个运行会话。');
        this._persist();
        return this.snapshot();
      }
      this.activeConversationId = candidates[0];
      this._appendStructuredEvent(this.activeConversationId, 'warn', '当前对话正在后台运行，已切换到其他对话。');
      this._persist();
      return this.snapshot();
    }

    let targets = sortedConversations(this.conversations)
      .map((item) => item.id)
      .filter((item) => item !== closeId);
    this.activeConversationId = targets.length ? targets[0] : '';
    this.conversations = this.conversations.filter((item) => item.id !== closeId);
    this.runtimeStore.remove(closeId);
    delete this.metaByConversation[closeId];
    this._emit({ type: 'conversation-removed', conversationId: closeId });
    if (this.activeConversationId) {
      this._appendStructuredEvent(this.activeConversationId, 'hint', '已关闭当前对话');
    }
    this._persist();
    return this.snapshot();
  }

  clearChat(conversationId) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    if (this._isConversationRunning(conv.id)) {
      return { error: '请先停止当前任务。', snapshot: this.snapshot() };
    }

    conv.messages = [];
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);
    this._appendStructuredEvent(conv.id, 'hint', '已清空当前对话内容');
    this._persist();
    return { snapshot: this.snapshot() };
  }

  clearRuntime(conversationId, { silent = false } = {}) {
    const id = conversationId || this.activeConversationId;
    if (!id) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    if (this._isConversationRunning(id) && !silent) {
      return { error: '请先停止当前任务。', snapshot: this.snapshot() };
    }

    const runtime = this.runtimeStore.ensure(id);
    runtime.workflow = [];
    runtime.events = [];
    runtime.raw = [];
    runtime.phase = '空闲';
    runtime.startedAt = null;

    this._emit({ type: 'runtime-reset', conversationId: id });
    if (!silent) {
      this._appendStructuredEvent(id, 'hint', '已清空右侧运行日志（结构化事件/运行步骤/事件原文）');
    }

    return { snapshot: this.snapshot() };
  }

  stopConversation(conversationId) {
    const id = conversationId || this.activeConversationId;
    if (!id) {
      return this.snapshot();
    }
    const runner = this.runners.get(id);
    if (runner) {
      runner.stop();
      this._appendStructuredEvent(id, 'warn', '已请求停止当前对话任务');
    }
    return this.snapshot();
  }

  async sendMessage({ conversationId, text }) {
    const targetId = conversationId || this.activeConversationId;
    if (!targetId) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const conv = getConversation(this.conversations, targetId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    const userText = String(text || '').trim();
    if (!userText) {
      return { error: '消息不能为空', snapshot: this.snapshot() };
    }

    if (this._isConversationRunning(targetId)) {
      return { error: '当前对话上一条消息还在处理中，请稍候。', snapshot: this.snapshot() };
    }

    if (!this.workdir || !fs.existsSync(this.workdir) || !fs.statSync(this.workdir).isDirectory()) {
      return { error: `目录不存在:\n${this.workdir}`, snapshot: this.snapshot() };
    }

    conv.messages.push({ role: 'user', text: userText });
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);

    const runtime = this.runtimeStore.ensure(targetId);
    const roundIndex = this.runtimeStore.nextRound(targetId);
    runtime.phase = '准备中...';
    runtime.startedAt = Number(process.hrtime.bigint() / 1000000n);

    this._appendWorkflowRoundHeader(targetId, roundIndex, userText);
    this._appendWorkflowStep(targetId, `R${roundIndex}-S0. 请求: ${userText}`);
    this._appendStructuredEvent(targetId, 'info', '收到新请求，准备执行...');
    this._setPhase(targetId, '准备中...');
    this._setStartedAt(targetId, Date.now());

    this._persist();

    const prompt = userText;
    const runner = new CodexRunner({
      commandText: this.commandText,
      prompt,
      workdir: this.workdir,
      sessionId: conv.sessionId || '',
      useNativeMemory: this.useNativeMemory,
    });

    this.runners.set(targetId, runner);
    this._emit({ type: 'runner-state', conversationId: targetId, running: true });

    this.assistantBufferByRunner.set(runner, '');
    this.stepIndexByRunner.set(runner, 0);
    this.roundIndexByRunner.set(runner, roundIndex);

    runner.on('status', (phase) => {
      this._setPhase(targetId, phase);
    });

    runner.on('event', (level, message) => {
      this._appendStructuredEvent(targetId, level, message);
    });

    runner.on('raw_line', (line) => {
      this._appendRawJsonLine(targetId, line);
    });

    runner.on('meta', (key, value) => {
      const meta = this._ensureMeta(targetId);
      meta[key] = value;

      if (key === '会话ID') {
        const targetConv = getConversation(this.conversations, targetId);
        if (targetConv) {
          targetConv.sessionId = value;
          targetConv.updatedAt = nowTs();
          this._syncConversationUpdated(targetConv);
        }
      }

      this._emit({ type: 'meta-updated', conversationId: targetId, key, value });
      this._appendStructuredEvent(targetId, 'hint', `${key}: ${value}`);
    });

    runner.on('assistant_delta', (delta) => {
      const current = this.assistantBufferByRunner.get(runner) || '';
      this.assistantBufferByRunner.set(runner, current + String(delta || ''));
    });

    runner.on('step', (step) => {
      const currentRound = Math.max(1, this.roundIndexByRunner.get(runner) || 1);
      const stepIndex = (this.stepIndexByRunner.get(runner) || 0) + 1;
      this.stepIndexByRunner.set(runner, stepIndex);

      const textStep = `R${currentRound}-S${stepIndex}. ${String(step || '').trim()}`;
      this._appendWorkflowStep(targetId, textStep);

      let summary = String(step || '').replace(/\s+/g, ' ').trim();
      if (summary.length > 160) {
        summary = `${summary.slice(0, 160).trimEnd()}...`;
      }
      this._appendStructuredEvent(targetId, 'info', `R${currentRound}-S${stepIndex}: ${summary}`);
    });

    runner.on('finished', (result) => {
      const targetConv = getConversation(this.conversations, targetId);
      const runtimeState = this.runtimeStore.ensure(targetId);

      if (result.sessionId && targetConv) {
        targetConv.sessionId = result.sessionId;
      }

      if (result.exitCode === 0) {
        runtimeState.phase = '已完成';
        this._appendStructuredEvent(targetId, 'success', `任务完成，用时 ${result.durationSeconds.toFixed(1)}s`);
      } else {
        runtimeState.phase = '失败';
        this._appendStructuredEvent(
          targetId,
          'error',
          `任务失败，退出码 ${result.exitCode}，用时 ${result.durationSeconds.toFixed(1)}s`,
        );
      }

      const finalText = (this.assistantBufferByRunner.get(runner) || '').trim() || String(result.assistantText || '').trim();
      if (finalText && targetConv) {
        targetConv.messages.push({ role: 'assistant', text: finalText });
      } else if (!finalText && targetConv && result.exitCode === 0) {
        this._appendStructuredEvent(targetId, 'warn', 'Codex 未返回可解析内容（请查看右侧运行步骤/事件原文）');
      }

      if (targetConv) {
        targetConv.updatedAt = nowTs();
        this._syncConversationUpdated(targetConv);
      }

      runtimeState.startedAt = null;
      this._emit({ type: 'runtime-started-at', conversationId: targetId, startedAt: null });
      this._setPhase(targetId, runtimeState.phase || '空闲');

      this._releaseRunner(targetId, runner);
      this._persist();
    });

    runner.run();
    return { snapshot: this.snapshot() };
  }
}

module.exports = {
  AppController,
};
