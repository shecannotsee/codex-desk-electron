const fs = require('node:fs');

const { nowTs, newConversation, getConversation } = require('../conversation_service');
const { importSessionJsonl } = require('../session_importer');
const { buildExportFileName, exportConversationJsonl } = require('../session_exporter');
const { normalizeWorkdir } = require('../state_store');

const runtimeSessionFileMethods = {
  previewConversationImportFromSessionFile(filePath) {
    const imported = importSessionJsonl(filePath);
    const importedCwd = String(imported.cwd || '').trim();
    return {
      filePath: imported.filePath,
      title: imported.title,
      sessionId: imported.sessionId || '',
      source: imported.source,
      originator: imported.originator,
      cwd: importedCwd,
      hasImportedWorkdir: Boolean(importedCwd && fs.existsSync(importedCwd) && fs.statSync(importedCwd).isDirectory()),
      model: imported.model || '-',
      cliVersion: imported.cliVersion || '-',
    };
  },

  importConversationFromSessionFile(filePath, { continuationMode = 'resume', workdirMode = 'default', workdir = '' } = {}) {
    const imported = importSessionJsonl(filePath);
    const conv = newConversation(imported.title, this.conversations);
    const importedCwd = String(imported.cwd || '').trim();
    if (workdirMode === 'imported') {
      if (!importedCwd) {
        return { error: '导入文件未提供可用的原工作目录。', snapshot: this.snapshot() };
      }
      if (!fs.existsSync(importedCwd) || !fs.statSync(importedCwd).isDirectory()) {
        return { error: `导入文件中的原工作目录不可用:\n${importedCwd}`, snapshot: this.snapshot() };
      }
      conv.workdir = normalizeWorkdir(importedCwd);
    } else if (workdirMode === 'custom') {
      const customWorkdir = normalizeWorkdir(workdir);
      if (!customWorkdir) {
        return { error: '请选择导入后的新工作目录。', snapshot: this.snapshot() };
      }
      if (!fs.existsSync(customWorkdir) || !fs.statSync(customWorkdir).isDirectory()) {
        return { error: `手动选择的工作目录不可用:\n${customWorkdir}`, snapshot: this.snapshot() };
      }
      conv.workdir = customWorkdir;
    } else {
      conv.workdir = this._defaultWorkdir();
    }

    conv.sessionId = imported.sessionId || '';
    conv.sessionContinuationMode = conv.sessionId
      ? (continuationMode === 'fork' ? 'fork' : 'resume')
      : '';
    conv.messages = imported.messages;
    conv.createdAt = Number(imported.createdAt || nowTs());
    conv.updatedAt = Number(imported.updatedAt || conv.createdAt);

    this.conversations.push(conv);
    this.runtimeStore.ensure(conv.id);

    const meta = this._ensureMeta(conv.id);
    meta['Codex版本'] = imported.cliVersion || '-';
    meta['模型'] = imported.model || '-';
    meta['会话ID'] = conv.sessionId || '-';

    this.activeConversationId = conv.id;
    this._appendStructuredEvent(conv.id, 'success', `已导入会话: ${conv.title}`);
    this._appendStructuredEvent(conv.id, 'hint', `来源: ${imported.source} / ${imported.originator}`);
    this._appendStructuredEvent(conv.id, 'hint', `原工作目录: ${importedCwd || '-'}`);
    this._appendStructuredEvent(
      conv.id,
      'hint',
      workdirMode === 'imported'
        ? `导入工作目录: 使用导入文件目录 ${conv.workdir}`
        : workdirMode === 'custom'
          ? `导入工作目录: 使用手动选择的新目录 ${conv.workdir}`
          : `导入工作目录: 使用默认目录 ${conv.workdir}`,
    );
    this._appendStructuredEvent(conv.id, 'hint', `导入文件: ${imported.filePath}`);
    if (conv.sessionId) {
      this._appendStructuredEvent(
        conv.id,
        'hint',
        conv.sessionContinuationMode === 'fork'
          ? '导入后继续方式: 分叉为新会话（fork）'
          : '导入后继续方式: 继续原会话（resume）',
      );
    }
    this._persist();

    return {
      snapshot: this.snapshot(),
      imported: {
        conversationId: conv.id,
        title: conv.title,
        sessionId: conv.sessionId || '',
        continuationMode: conv.sessionContinuationMode || '',
      },
    };
  },

  previewConversationExport(conversationId) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      throw new Error('会话不存在');
    }
    const messages = Array.isArray(conv.messages)
      ? conv.messages.filter((item) => item && String(item.text || '').trim())
      : [];
    if (!messages.length) {
      throw new Error('当前会话没有可导出的消息');
    }
    return {
      conversationId: conv.id,
      title: conv.title,
      sessionId: String(conv.sessionId || '').trim(),
      suggestedFileName: buildExportFileName(conv),
      messageCount: messages.length,
    };
  },

  exportConversationToSessionFile(conversationId, filePath) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    try {
      const meta = this._ensureMeta(conv.id);
      const exported = exportConversationJsonl(
        filePath,
        conv,
        {
          model: meta['模型'],
          cliVersion: meta['Codex版本'],
        },
        {
          workdir: conv.workdir || this._defaultWorkdir(),
        },
      );
      return {
        snapshot: this.snapshot(),
        exported: {
          conversationId: conv.id,
          title: conv.title,
          filePath: exported.filePath,
          fileName: exported.fileName,
          messageCount: exported.messageCount,
          sessionId: exported.sessionId || '',
        },
      };
    } catch (error) {
      return {
        error: `导出会话失败: ${error?.message || String(error)}`,
        snapshot: this.snapshot(),
      };
    }
  },
};

module.exports = {
  runtimeSessionFileMethods,
};
