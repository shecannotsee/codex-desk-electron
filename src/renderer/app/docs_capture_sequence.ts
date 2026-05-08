import { codexdesk } from './codexdesk.js';
import {
  applyChatFontSize,
  applySidebarWidth,
  applyTheme,
  el,
  state,
  syncMenuLanguage,
} from './state_i18n.js';
import {
  currentConversation,
  ensureRuntime,
  setWorkflowStepCollapsed,
} from './conversation_runtime.js';
import {
  renderAll,
  renderConversationList,
} from './renderers.js';

type DocsCaptureOptions = {
  applySnapshot: (snapshot: unknown) => void;
  closeMenus: () => void;
  hideChatContextMenu: () => void;
  hideQuickSettingsMenu: () => void;
  setQuickSettingsPane: (paneName: string) => void;
  showChatContextMenu: (x: number, y: number) => void;
  showConversationContextMenu: (x: number, y: number, conversationId: string) => void;
  showQuickSettingsMenu: () => void;
};

function sleepMs(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

export async function runDocsCaptureSequence(options: DocsCaptureOptions) {
  if (
    !codexdesk
    || typeof codexdesk.isDocsCaptureEnabled !== 'function'
    || typeof codexdesk.captureDocPage !== 'function'
    || typeof codexdesk.finishDocsCapture !== 'function'
  ) {
    return;
  }

  const enabled = await codexdesk.isDocsCaptureEnabled();
  if (!enabled) {
    return;
  }

  const capture = async (fileName, delayMs = 220) => {
    await sleepMs(delayMs);
    const result = await codexdesk.captureDocPage(fileName);
    if (!result?.ok) {
      throw new Error(result?.error || `capture failed: ${fileName}`);
    }
  };

  const ensureCaptureConversation = async () => {
    let snapshot = await codexdesk.getSnapshot();
    options.applySnapshot(snapshot);
    if (!state.conversations.length) {
      snapshot = await codexdesk.createConversation();
      options.applySnapshot(snapshot);
    }
    renderAll();
  };

  const applyCaptureMockData = () => {
    const conv = currentConversation();
    if (!conv) {
      return;
    }
    const now = Date.now();
    conv.title = String(conv.title || '').trim() || '文档截图示例';
    conv.messages = [
      {
        role: 'user',
        text: '请总结一下 Conductor 的核心能力。',
        createdAt: now - 4 * 60 * 1000,
      },
      {
        role: 'assistant',
        text: [
          '核心能力包括：',
          '1. 多会话管理',
          '2. 结构化运行日志',
          '3. 运行中排队发送',
          '4. Telegram 风格多级设置',
        ].join('\n'),
        createdAt: now - 3 * 60 * 1000,
      },
      {
        role: 'user',
        text: '再给一个 Ubuntu 22.04 的部署命令示例。',
        createdAt: now - 2 * 60 * 1000,
      },
    ];
    conv.updatedAt = now - 1200;

    const runtime = ensureRuntime(conv.id);
    runtime.phase = '正在输出回复...';
    runtime.startedAt = now - 35 * 1000;
    runtime.events = [
      { timestamp: '14:20:01', level: 'info', message: '准备中...' },
      { timestamp: '14:20:02', level: 'info', message: '正在分析请求...' },
      { timestamp: '14:20:06', level: 'info', message: '正在输出回复...' },
    ];
    runtime.workflow = [
      {
        type: 'round',
        roundIndex: 1,
        preview: '请总结一下 Conductor 的核心能力。',
        timestamp: '14:20:01',
      },
      {
        tag: 'INFO',
        title: '分析请求',
        body: '读取会话上下文并抽取需求：多会话、日志可观测、设置分层。',
        timestamp: '14:20:02',
      },
      {
        tag: 'INFO',
        title: '生成回复',
        body: '组合摘要并输出部署建议。',
        timestamp: '14:20:06',
      },
    ];
    runtime.raw = [
      '{"type":"phase","value":"正在分析请求..."}',
      '{"type":"phase","value":"正在输出回复..."}',
    ];

    state.runningConversationIds.add(conv.id);
    state.queuedCountByConversation[conv.id] = 1;
    state.queuedMessagesByConversation[conv.id] = [
      {
        text: '补充一个卸载命令示例。',
        preview: '补充一个卸载命令示例。',
        queuedAt: now - 8000,
        fromRetry: false,
      },
    ];
    setWorkflowStepCollapsed(conv.id, 0, true);
    setWorkflowStepCollapsed(conv.id, 1, false);
    setWorkflowStepCollapsed(conv.id, 2, false);
    renderAll();
  };

  try {
    state.ui.language = 'zh-CN';
    state.ui.theme = 'light';
    state.ui.runtimePanelHidden = false;
    state.ui.settingsPanelHidden = false;
    state.ui.sidebarHidden = false;
    applyTheme();
    applySidebarWidth();
    applyChatFontSize();
    syncMenuLanguage();
    renderAll();

    await ensureCaptureConversation();

    await capture('screenshot-main.png');

    options.showQuickSettingsMenu();
    await capture('screenshot-settings-menu.png');
    options.setQuickSettingsPane('view');
    await capture('screenshot-settings-nested.png');
    options.hideQuickSettingsMenu();

    applyCaptureMockData();

    el.inputBox.value = '请输出发布前的检查清单。';
    state.activeTab = 'workflow';
    renderAll();
    await capture('workflow-step-1-input.png');

    state.activeTab = 'workflow';
    renderAll();
    await capture('workflow-step-2-runtime.png');

    const conv = currentConversation();
    if (conv) {
      const now = Date.now();
      const runtime = ensureRuntime(conv.id);
      runtime.phase = '任务完成';
      runtime.startedAt = null;
      state.runningConversationIds.delete(conv.id);
      state.queuedCountByConversation[conv.id] = 0;
      state.queuedMessagesByConversation[conv.id] = [];
      conv.messages = [
        ...conv.messages,
        {
          role: 'assistant',
          text: 'Ubuntu 22.04 可用：`cd src && npm run dist:deb`',
          createdAt: now - 1000,
        },
      ];
      conv.updatedAt = now;
    }
    state.activeTab = 'workflow';
    renderAll();
    await capture('workflow-step-3-result.png');

    state.activeTab = 'workflow';
    renderAll();
    await capture('screenshot-runtime-tabs.png');

    const assistantTextNode = el.chatView.querySelector('.msg-assistant .msg-expanded');
    if (assistantTextNode) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(assistantTextNode);
      selection?.addRange(range);
      const rect = assistantTextNode.getBoundingClientRect();
      options.showChatContextMenu(rect.left + 16, rect.top + 16);
      await capture('screenshot-chat-copy-menu.png', 260);
      options.hideChatContextMenu();
      selection?.removeAllRanges();
    }

    renderConversationList();
    const firstItem = el.conversationList.querySelector('.conversation-item');
    if (firstItem) {
      const conversationId = String(firstItem.getAttribute('data-id') || '').trim();
      const rect = firstItem.getBoundingClientRect();
      options.showConversationContextMenu(rect.left + 12, rect.top + 12, conversationId);
      await capture('screenshot-conversation-context-menu.png', 260);
    }
  } catch (error) {
    console.error('[docs-capture] failed:', error);
  } finally {
    // Always release modal/menu state before signaling completion, otherwise screenshots can affect later app startup.
    options.closeMenus();
    await sleepMs(120);
    codexdesk.finishDocsCapture().catch(() => {});
  }
}
