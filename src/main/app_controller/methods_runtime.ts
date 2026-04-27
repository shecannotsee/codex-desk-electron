const { nowTs, newConversation, getConversation } = require('../conversation_service');
const { normalizeWorkdir } = require('../state_store');
const {
  inferStructuredEventKind,
  isCompletedPhase,
} = require('./runtime_helpers');
const { runtimeQueueMethods } = require('./methods_runtime_queue');
const { runtimeWorkflowMethods } = require('./methods_runtime_workflow');

const runtimeMethods = {
  _inferStructuredEventKind(level = '', message = '', metaKey = '') {
    return inferStructuredEventKind(level, message, metaKey);
  },

  _ensureMeta(conversationId) {
    if (!this.metaByConversation[conversationId]) {
      this.metaByConversation[conversationId] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': '-',
        '输入Tokens': '-',
        '缓存输入Tokens': '-',
        '输出Tokens': '-',
      };
    }
    return this.metaByConversation[conversationId];
  },

  ...runtimeQueueMethods,

  ...runtimeWorkflowMethods,

  _buildLocalPrompt(conversation) {
    const lines = ['请继续下面的中文对话，保持简洁准确。', ''];
    const history = Array.isArray(conversation.messages) ? conversation.messages.slice(-20) : [];
    for (const item of history) {
      const roleName = item.role === 'user' ? '用户' : '助手';
      lines.push(`${roleName}: ${item.text}`);
    }
    lines.push('\n请直接回复下一句助手内容。');
    return lines.join('\n');
  },

  switchConversation(conversationId) {
    const target = getConversation(this.conversations, conversationId);
    if (!target) {
      return this._conversationSwitchPayload(this.activeConversationId);
    }
    const runtime = this.runtimeStore.ensure(target.id);
    if (!this._isConversationRunning(target.id) && this._pendingQueueSize(target.id) <= 0 && isCompletedPhase(runtime.phase)) {
      runtime.phase = '空闲';
      this._emit({ type: 'runtime-phase', conversationId: target.id, phase: runtime.phase });
    }
    if (target.id !== this.activeConversationId) {
      this.activeConversationId = target.id;
      this._schedulePersist();
    }
    return this._conversationSwitchPayload(target.id);
  },

  createConversation(options: { workdir?: string } = {}) {
    const conv = newConversation(undefined, this.conversations);
    const selectedWorkdir = typeof options.workdir === 'string' ? options.workdir : '';
    conv.workdir = normalizeWorkdir(selectedWorkdir || this._defaultWorkdir());
    this.conversations.push(conv);
    this.runtimeStore.ensure(conv.id);
    this._ensureMeta(conv.id);

    this.activeConversationId = conv.id;
    this._appendStructuredEvent(conv.id, 'success', `已新建对话: ${conv.title}`);
    this._appendStructuredEvent(conv.id, 'hint', `工作目录: ${conv.workdir}`);
    this._persist();
    this._autoRefreshMetaForConversation(conv.id);
    return this.snapshot();
  },

  async _autoRefreshMetaForConversation(conversationId) {
    const id = String(conversationId || '').trim();
    if (!id) {
      return;
    }

    try {
      const versionResult = this.refreshCodexVersion(id);
      if (versionResult?.error) {
        this._appendStructuredEvent(id, 'warn', `自动获取 Codex 版本失败: ${versionResult.error}`);
      }
    } catch (error) {
      this._appendStructuredEvent(id, 'warn', `自动获取 Codex 版本异常: ${error?.message || String(error)}`);
    }

    try {
      const modelResult = await this.refreshModelInfo(id);
      if (modelResult?.error) {
        this._appendStructuredEvent(id, 'warn', `自动获取模型失败: ${modelResult.error}`);
      }
    } catch (error) {
      this._appendStructuredEvent(id, 'warn', `自动获取模型异常: ${error?.message || String(error)}`);
    }
  },

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
  },

  toggleConversationPin(conversationId) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }
    const nextPinned = !(Number(conv.pinnedAt || 0) > 0);
    conv.pinnedAt = nextPinned ? nowTs() : 0;
    this._syncConversationUpdated(conv);
    this._appendStructuredEvent(conv.id, 'hint', nextPinned ? '已置顶当前对话' : '已取消置顶当前对话');
    this._persist();
    return this.snapshot();
  },
};

module.exports = {
  runtimeMethods,
};
