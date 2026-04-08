const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { splitShellArgs, stripAnsi } = require('../codex_runner');
const { getConversation } = require('../conversation_service');
const { getCodexChildEnv } = require('../shell_env');

const metaMethods = {
  _resolveCodexCommandParts() {
    const parts = splitShellArgs(this.commandText);
    if (!parts.length) {
      return [];
    }
    return parts;
  },

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
  },

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
  },

  _extractModelFromConfigAssignment(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }
    const match = /^model\s*=\s*(.+)$/i.exec(text);
    if (!match) {
      return '';
    }
    return this._stripWrappedQuotes(match[1]);
  },

  _stripWrappedQuotes(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('\'') && raw.endsWith('\''))) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  },

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
  },

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
  },

  _extractModelFromJsonOutput(text) {
    const output = String(text || '');

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
  },

  _isUsableModel(model) {
    const value = String(model || '').trim();
    if (!value) {
      return false;
    }
    if (value === '-' || value === '(未知)' || value === '(命令中未指定)') {
      return false;
    }
    return true;
  },

  _extractModelFromRuntime(conversationId) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (Array.isArray(runtime.raw) && runtime.raw.length) {
      const fromRaw = this._extractModelFromJsonOutput(runtime.raw.join('\n'));
      if (this._isUsableModel(fromRaw)) {
        return fromRaw;
      }
    }
    return '';
  },

  _probeModelFromCodex(parts) {
    return new Promise((resolve) => {
      const base = this._normalizeExecOptionsForProbe(parts);
      const probePrompt = '请只回复: ok';
      const cmd = [...base, '--json', probePrompt];

      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: this.workdir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: getCodexChildEnv(),
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
  },

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
        env: getCodexChildEnv(),
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
  },

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

    let model = this._extractModelFromCommand(parts);

    if (!this._isUsableModel(model)) {
      model = this._extractModelFromConfigFile(parts);
    }

    if (!this._isUsableModel(model)) {
      model = this._extractModelFromRuntime(targetId);
    }

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
  },
};

module.exports = {
  metaMethods,
};
