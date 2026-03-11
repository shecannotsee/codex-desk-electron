
function sleepMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function isDuplicateRuntimeEvent(runtime, item) {
  if (!runtime || !Array.isArray(runtime.events) || !item || typeof item !== 'object') {
    return false;
  }
  if (item.id) {
    return runtime.events.some((evt) => evt && evt.id === item.id);
  }
  const last = runtime.events[runtime.events.length - 1];
  if (!last) {
    return false;
  }
  return (
    String(last.timestamp || '') === String(item.timestamp || '')
    && String(last.level || '') === String(item.level || '')
    && String(last.message || '') === String(item.message || '')
  );
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }

  state.settings = {
    commandText: snapshot.settings?.commandText || '',
    workdir: snapshot.settings?.workdir || '',
  };
  state.activeConversationId = String(snapshot.activeConversationId || '');
  state.conversations = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
  state.runtimeByConversation = snapshot.runtimeByConversation || {};
  state.metaByConversation = snapshot.metaByConversation || {};
  state.runningConversationIds = new Set(Array.isArray(snapshot.runningConversationIds) ? snapshot.runningConversationIds : []);
  state.queuedCountByConversation = snapshot.queuedCountByConversation || {};
  state.queuedMessagesByConversation = snapshot.queuedMessagesByConversation || {};
  const validIds = new Set(state.conversations.map((item) => String(item.id || '')));
  Object.keys(state.collapsedByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.collapsedByConversation[id];
    }
  });
  Object.keys(state.workflowCollapsedByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.workflowCollapsedByConversation[id];
    }
  });
  Object.keys(state.queuedMessagesByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.queuedMessagesByConversation[id];
    }
  });
  pruneConversationDrafts([...validIds]);

  if (!state.activeConversationId && state.conversations.length) {
    state.activeConversationId = state.conversations[0].id;
  }
}

function applyEvent(event) {
  if (!event || typeof event !== 'object') {
    return;
  }

  const id = String(event.conversationId || '');
  switch (event.type) {
    case 'runtime-event-append': {
      const runtime = ensureRuntime(id);
      if (!isDuplicateRuntimeEvent(runtime, event.item)) {
        runtime.events.push(event.item);
      }
      break;
    }
    case 'runtime-workflow-append':
      ensureRuntime(id).workflow.push(event.item);
      break;
    case 'runtime-raw-append':
      ensureRuntime(id).raw.push(event.line);
      break;
    case 'runtime-phase':
      ensureRuntime(id).phase = event.phase;
      break;
    case 'runtime-started-at':
      ensureRuntime(id).startedAt = event.startedAt;
      break;
    case 'runtime-reset':
      state.runtimeByConversation[id] = {
        workflow: [],
        events: [],
        raw: [],
        phase: '空闲',
        startedAt: null,
      };
      break;
    case 'conversation-updated': {
      const conv = event.conversation;
      if (!conv || !conv.id) {
        break;
      }
      const idx = state.conversations.findIndex((item) => item.id === conv.id);
      if (idx >= 0) {
        state.conversations[idx] = conv;
      } else {
        state.conversations.push(conv);
      }
      break;
    }
    case 'conversation-removed':
      state.conversations = state.conversations.filter((item) => item.id !== id);
      delete state.runtimeByConversation[id];
      delete state.metaByConversation[id];
      delete state.queuedCountByConversation[id];
      delete state.queuedMessagesByConversation[id];
      delete state.collapsedByConversation[id];
      delete state.workflowCollapsedByConversation[id];
      setConversationDraft(id, '');
      state.runningConversationIds.delete(id);
      break;
    case 'meta-updated':
      ensureMeta(id)[event.key] = event.value;
      break;
    case 'runner-state':
      if (event.running) {
        state.runningConversationIds.add(id);
      } else {
        state.runningConversationIds.delete(id);
      }
      break;
    case 'queue-updated':
      state.queuedCountByConversation[id] = Number(event.count || 0);
      if (Array.isArray(event.items)) {
        state.queuedMessagesByConversation[id] = event.items;
      } else if (Number(event.count || 0) <= 0) {
        state.queuedMessagesByConversation[id] = [];
      }
      break;
    default:
      break;
  }

  renderAll();
}

function askRenameTitle(initialValue) {
  return new Promise((resolve) => {
    const modal = el.renameModal;
    const input = el.renameInput;
    const cancelBtn = el.renameCancel;
    const confirmBtn = el.renameConfirm;

    input.value = initialValue || '';
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      input.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      const next = String(input.value || '').trim();
      cleanup();
      resolve(next);
    };

    const onBackdrop = (event) => {
      if (event.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    input.addEventListener('keydown', onKeyDown);
  });
}

async function init() {
  loadUiPrefs();
  loadDraftPrefs();
  applyTheme();
  applySidebarWidth();
  applyChatFontSize();

  const snapshot = await codexdesk.getSnapshot();
  applySnapshot(snapshot);
  renderAll();
  syncMenuLanguage();

  codexdesk.onEvent((event) => {
    applyEvent(event);
  });

  let contextMenuConversationId = '';
  const hideConversationContextMenu = () => {
    if (!el.contextMenu) {
      return;
    }
    el.contextMenu.classList.add('hidden');
    contextMenuConversationId = '';
  };

  const showConversationContextMenu = (x, y, conversationId = '') => {
    if (!el.contextMenu) {
      return;
    }
    contextMenuConversationId = String(conversationId || '');
    const hasTarget = Boolean(contextMenuConversationId);
    if (el.ctxRenameConv) {
      el.ctxRenameConv.disabled = !hasTarget;
    }
    if (el.ctxCloseConv) {
      el.ctxCloseConv.disabled = !hasTarget;
    }
    el.contextMenu.classList.remove('hidden');
    el.contextMenu.style.left = '0px';
    el.contextMenu.style.top = '0px';
    const rect = el.contextMenu.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.max(margin, Math.min(x, maxLeft));
    const top = Math.max(margin, Math.min(y, maxTop));
    el.contextMenu.style.left = `${left}px`;
    el.contextMenu.style.top = `${top}px`;
  };

  const hideChatContextMenu = () => {
    if (!el.chatContextMenu) {
      return;
    }
    el.chatContextMenu.classList.add('hidden');
  };

  const showChatContextMenu = (x, y) => {
    if (!el.chatContextMenu) {
      return;
    }
    if (el.ctxToggleRuntime) {
      el.ctxToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
    }
    if (el.ctxToggleSidebar) {
      el.ctxToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
    }
    el.chatContextMenu.classList.remove('hidden');
    el.chatContextMenu.style.left = '0px';
    el.chatContextMenu.style.top = '0px';
    const rect = el.chatContextMenu.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.max(margin, Math.min(x, maxLeft));
    const top = Math.max(margin, Math.min(y, maxTop));
    el.chatContextMenu.style.left = `${left}px`;
    el.chatContextMenu.style.top = `${top}px`;
  };

  const switchConversationIfNeeded = async (conversationId) => {
    const targetId = String(conversationId || '').trim();
    if (!targetId || targetId === state.activeConversationId) {
      return;
    }
    const snapshot = await codexdesk.switchConversation(targetId);
    applySnapshot(snapshot);
    renderAll();
  };

  el.conversationList.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const row = event.target.closest('.conversation-item');
    const id = row ? String(row.getAttribute('data-id') || '').trim() : '';
    hideChatContextMenu();
    showConversationContextMenu(event.clientX, event.clientY, id);
  });

  if (el.chatView) {
    el.chatView.addEventListener('contextmenu', (event) => {
      const clickedMessage = event.target.closest('.msg-block');
      if (clickedMessage) {
        return;
      }
      event.preventDefault();
      hideConversationContextMenu();
      showChatContextMenu(event.clientX, event.clientY);
    });
  }

  if (el.focusRow) {
    el.focusRow.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      hideConversationContextMenu();
      showChatContextMenu(event.clientX, event.clientY);
    });
  }

  if (el.sendRow) {
    el.sendRow.addEventListener('contextmenu', (event) => {
      if (event.target.closest('button')) {
        return;
      }
      event.preventDefault();
      hideConversationContextMenu();
      showChatContextMenu(event.clientX, event.clientY);
    });
  }

  if (el.ctxNewConv) {
    el.ctxNewConv.addEventListener('click', async () => {
      hideConversationContextMenu();
      el.btnNewConv.click();
    });
  }
  if (el.ctxRenameConv) {
    el.ctxRenameConv.addEventListener('click', async () => {
      const id = contextMenuConversationId;
      hideConversationContextMenu();
      await switchConversationIfNeeded(id);
      el.btnRenameConv.click();
    });
  }
  if (el.ctxCloseConv) {
    el.ctxCloseConv.addEventListener('click', async () => {
      const id = contextMenuConversationId;
      hideConversationContextMenu();
      await switchConversationIfNeeded(id);
      el.btnCloseConv.click();
    });
  }
  if (el.ctxToggleRuntime) {
    el.ctxToggleRuntime.addEventListener('click', () => {
      hideChatContextMenu();
      el.btnToggleRuntime.click();
    });
  }
  if (el.ctxToggleSidebar) {
    el.ctxToggleSidebar.addEventListener('click', () => {
      hideChatContextMenu();
      el.btnToggleSidebar.click();
    });
  }

  const quickSettingsPaneTitleKey = {
    conversation: 'menuConversation',
    runtime: 'menuRuntime',
    view: 'menuInterface',
    window: 'menuWindow',
    help: 'menuHelp',
  };
  let quickSettingsPane = 'root';
  const setQuickSettingsPane = (paneName) => {
    if (!el.quickSettingsMenu) {
      return;
    }
    const root = el.quickSettingsRoot;
    const detail = el.quickSettingsDetail;
    const detailTitle = el.qsDetailTitle;
    const categoryButtons = Array.from(el.quickSettingsMenu.querySelectorAll('.quick-settings-category[data-pane]'));
    const panes = Array.from(el.quickSettingsMenu.querySelectorAll('.quick-settings-pane[data-pane]'));
    if (!panes.length) {
      return;
    }

    const candidate = String(paneName || '').trim() || 'root';
    const validPane = panes.some((pane) => pane.getAttribute('data-pane') === candidate);
    const target = candidate === 'root'
      ? 'root'
      : (validPane ? candidate : String(panes[0].getAttribute('data-pane') || 'conversation'));
    quickSettingsPane = target;

    if (root) {
      root.classList.toggle('hidden', target !== 'root');
    }
    if (detail) {
      detail.classList.toggle('hidden', target === 'root');
    }

    categoryButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-pane') === target);
    });
    panes.forEach((pane) => {
      const active = pane.getAttribute('data-pane') === target;
      pane.classList.toggle('active', active);
    });

    if (detailTitle && target !== 'root') {
      const key = quickSettingsPaneTitleKey[target] || 'quickSettings';
      detailTitle.setAttribute('data-i18n-key', key);
      detailTitle.textContent = t(key);
    }
  };

  const hideQuickSettingsMenu = () => {
    if (!el.quickSettingsMenu || !el.btnQuickSettings) {
      return;
    }
    el.quickSettingsMenu.classList.add('hidden');
    el.btnQuickSettings.setAttribute('aria-expanded', 'false');
  };

  const showQuickSettingsMenu = () => {
    if (!el.quickSettingsMenu || !el.btnQuickSettings) {
      return;
    }
    setQuickSettingsPane('root');
    el.quickSettingsMenu.classList.remove('hidden');
    el.btnQuickSettings.setAttribute('aria-expanded', 'true');
  };

  const toggleQuickSettingsMenu = () => {
    if (!el.quickSettingsMenu || el.quickSettingsMenu.classList.contains('hidden')) {
      showQuickSettingsMenu();
      return;
    }
    hideQuickSettingsMenu();
  };

  const hideAboutModal = () => {
    if (!el.aboutModal) {
      return;
    }
    el.aboutModal.classList.add('hidden');
  };

  const showAboutModal = () => {
    if (!el.aboutModal) {
      return;
    }
    hideQuickSettingsMenu();
    el.aboutModal.classList.remove('hidden');
    if (el.aboutClose) {
      el.aboutClose.focus();
    }
  };

  const actionToButton = {
    'conversation:new': el.btnNewConv,
    'conversation:import-session': el.btnImportSession,
    'conversation:rename': el.btnRenameConv,
    'conversation:close-current': el.btnCloseConv,
    'conversation:clear-chat': el.btnClearChat,
    'conversation:clear-runtime': el.btnClearRuntime,
    'conversation:retry-last': el.btnRetryLast,
    'conversation:stop': el.btnStop,
    'meta:refresh-codex-version': el.btnRefreshVersion,
    'meta:refresh-model': el.btnRefreshModel,
    'ui:toggle-settings': el.btnToggleSettings,
    'ui:toggle-runtime': el.btnToggleRuntime,
    'ui:toggle-sidebar': el.btnToggleSidebar,
  };

  const dispatchAction = async (rawAction) => {
    const action = String(rawAction || '').trim();
    if (!action) {
      return;
    }

    if (action === 'ui:language:zh-CN') {
      if (state.ui.language !== 'zh-CN') {
        el.languageSelect.value = 'zh-CN';
        el.languageSelect.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (action === 'ui:language:en-US') {
      if (state.ui.language !== 'en-US') {
        el.languageSelect.value = 'en-US';
        el.languageSelect.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (action === 'ui:theme:light') {
      if (state.ui.theme !== 'light') {
        setTheme('light');
      }
      return;
    }
    if (action === 'ui:theme:dark') {
      if (state.ui.theme !== 'dark') {
        setTheme('dark');
      }
      return;
    }
    if (action === 'help:about') {
      showAboutModal();
      return;
    }

    const btn = actionToButton[action];
    if (btn) {
      btn.click();
      return;
    }

    if (typeof codexdesk.invokeUiAction === 'function') {
      const result = await codexdesk.invokeUiAction(action);
      if (result?.error) {
        window.alert(localizeKnownText(result.error));
      }
    }
  };

  const runDocsCaptureSequence = async () => {
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

    const closeAllMenus = () => {
      hideChatContextMenu();
      hideConversationContextMenu();
      hideQuickSettingsMenu();
      hideAboutModal();
    };

    const capture = async (fileName, delayMs = 220) => {
      await sleepMs(delayMs);
      const result = await codexdesk.captureDocPage(fileName);
      if (!result?.ok) {
        throw new Error(result?.error || `capture failed: ${fileName}`);
      }
    };

    const ensureCaptureConversation = async () => {
      let snapshot = await codexdesk.getSnapshot();
      applySnapshot(snapshot);
      if (!state.conversations.length) {
        snapshot = await codexdesk.createConversation();
        applySnapshot(snapshot);
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
          text: '请总结一下 Codex Desk 的核心能力。',
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
          preview: '请总结一下 Codex Desk 的核心能力。',
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

      showQuickSettingsMenu();
      await capture('screenshot-settings-menu.png');
      setQuickSettingsPane('view');
      await capture('screenshot-settings-nested.png');
      hideQuickSettingsMenu();

      applyCaptureMockData();

      el.inputBox.value = '请输出发布前的检查清单。';
      state.activeTab = 'structured';
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
      state.activeTab = 'structured';
      renderAll();
      await capture('workflow-step-3-result.png');

      state.activeTab = 'workflow';
      renderAll();
      await capture('screenshot-runtime-tabs.png');

      renderConversationList();
      const firstItem = el.conversationList.querySelector('.conversation-item');
      if (firstItem) {
        const conversationId = String(firstItem.getAttribute('data-id') || '').trim();
        const rect = firstItem.getBoundingClientRect();
        showConversationContextMenu(rect.left + 12, rect.top + 12, conversationId);
        await capture('screenshot-conversation-context-menu.png', 260);
      }
    } catch (error) {
      console.error('[docs-capture] failed:', error);
    } finally {
      closeAllMenus();
      await sleepMs(120);
      codexdesk.finishDocsCapture().catch(() => {});
    }
  };

  if (el.btnQuickSettings) {
    el.btnQuickSettings.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleQuickSettingsMenu();
    });
  }

  if (el.quickSettingsMenu) {
    el.quickSettingsMenu.addEventListener('click', (event) => {
      const category = event.target.closest('.quick-settings-category[data-pane]');
      if (category) {
        event.preventDefault();
        event.stopPropagation();
        setQuickSettingsPane(category.getAttribute('data-pane'));
        return;
      }
      const backBtn = event.target.closest('#qs-back');
      if (backBtn) {
        event.preventDefault();
        event.stopPropagation();
        setQuickSettingsPane('root');
        return;
      }
      const button = event.target.closest('button[data-action]');
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = String(button.getAttribute('data-action') || '');
      const keepOpen = action.startsWith('ui:language:') || action.startsWith('ui:theme:');
      dispatchAction(action).catch(() => {});
      if (!keepOpen) {
        hideQuickSettingsMenu();
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (
      el.aboutModal
      && !el.aboutModal.classList.contains('hidden')
      && event.target === el.aboutModal
    ) {
      hideAboutModal();
      return;
    }
    if (el.chatContextMenu && !el.chatContextMenu.classList.contains('hidden') && !el.chatContextMenu.contains(event.target)) {
      hideChatContextMenu();
    }
    if (el.contextMenu && !el.contextMenu.classList.contains('hidden') && !el.contextMenu.contains(event.target)) {
      hideConversationContextMenu();
    }
    if (!el.quickSettingsMenu || el.quickSettingsMenu.classList.contains('hidden')) {
      return;
    }
    if (el.quickSettingsMenu.contains(event.target)) {
      return;
    }
    if (el.btnQuickSettings && el.btnQuickSettings.contains(event.target)) {
      return;
    }
    hideQuickSettingsMenu();
  });

  window.addEventListener('blur', () => {
    hideChatContextMenu();
    hideConversationContextMenu();
    hideQuickSettingsMenu();
  });
  window.addEventListener('beforeunload', () => {
    setConversationDraft(state.activeConversationId, el.inputBox?.value || '');
  });
  window.addEventListener('resize', () => {
    hideChatContextMenu();
    hideConversationContextMenu();
    hideQuickSettingsMenu();
    hideAboutModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideChatContextMenu();
      hideConversationContextMenu();
      hideQuickSettingsMenu();
      hideAboutModal();
    }
  });

  if (el.aboutClose) {
    el.aboutClose.addEventListener('click', () => {
      hideAboutModal();
    });
  }

  let resizingSidebar = false;
  let sidebarResizeStartX = 0;
  let sidebarResizeStartWidth = state.ui.sidebarWidth;
  const onSidebarPointerMove = (event) => {
    if (!resizingSidebar || state.ui.sidebarHidden) {
      return;
    }
    const delta = Number(event.clientX || 0) - sidebarResizeStartX;
    setSidebarWidth(sidebarResizeStartWidth + delta, { persist: false });
  };
  const stopSidebarResize = () => {
    if (!resizingSidebar) {
      return;
    }
    resizingSidebar = false;
    document.body.classList.remove('sidebar-resizing');
    saveUiPrefs();
    window.removeEventListener('pointermove', onSidebarPointerMove);
    window.removeEventListener('pointerup', stopSidebarResize);
    window.removeEventListener('pointercancel', stopSidebarResize);
  };
  if (el.sidebarResizer) {
    el.sidebarResizer.addEventListener('pointerdown', (event) => {
      if (state.ui.sidebarHidden) {
        return;
      }
      event.preventDefault();
      resizingSidebar = true;
      sidebarResizeStartX = Number(event.clientX || 0);
      sidebarResizeStartWidth = state.ui.sidebarWidth;
      document.body.classList.add('sidebar-resizing');
      if (typeof el.sidebarResizer.setPointerCapture === 'function') {
        try {
          el.sidebarResizer.setPointerCapture(event.pointerId);
        } catch {
          // ignore capture failures
        }
      }
      window.addEventListener('pointermove', onSidebarPointerMove);
      window.addEventListener('pointerup', stopSidebarResize);
      window.addEventListener('pointercancel', stopSidebarResize);
    });
  }

  if (typeof codexdesk.onMenuAction === 'function') {
    codexdesk.onMenuAction((payload) => {
      const action = String(payload?.action || '').trim();
      if (!action) {
        return;
      }
      dispatchAction(action).catch(() => {});
    });
  }

  el.btnNewConv.addEventListener('click', async () => {
    const next = await codexdesk.createConversation();
    applySnapshot(next);
    renderAll();
  });

  el.btnImportSession.addEventListener('click', async () => {
    const result = await codexdesk.importSession();
    if (result?.canceled) {
      return;
    }
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      applySnapshot(result?.snapshot || {});
      renderAll();
      return;
    }
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnRenameConv.addEventListener('click', async () => {
    const conv = currentConversation();
    const title = await askRenameTitle(conv?.title || '');
    if (title === null) {
      return;
    }
    if (!title.trim()) {
      window.alert(t('alertConversationNameEmpty'));
      return;
    }
    const next = await codexdesk.renameConversation(state.activeConversationId, title);
    if (next?.error) {
      window.alert(localizeKnownText(next.error));
      return;
    }
    applySnapshot(next);
    renderAll();
  });

  el.btnCloseConv.addEventListener('click', async () => {
    const conv = currentConversation();
    const title = String(conv?.title || t('chatTitlePrefix'));
    const ok = window.confirm(t('confirmCloseConversation', { title }));
    if (!ok) {
      return;
    }
    const next = await codexdesk.closeCurrentConversation();
    applySnapshot(next);
    renderAll();
  });

  el.btnRefreshVersion.addEventListener('click', async () => {
    const next = await codexdesk.refreshCodexVersion(state.activeConversationId);
    if (next?.error) {
      window.alert(localizeKnownText(next.error));
      applySnapshot(next.snapshot || {});
      renderAll();
      return;
    }
    applySnapshot(next);
    renderAll();
  });

  el.btnRefreshModel.addEventListener('click', async () => {
    const next = await codexdesk.refreshModelInfo(state.activeConversationId);
    if (next?.error) {
      window.alert(localizeKnownText(next.error));
      applySnapshot(next.snapshot || {});
      renderAll();
      return;
    }
    applySnapshot(next);
    renderAll();
  });

  if (el.btnMetaVersion) {
    el.btnMetaVersion.addEventListener('click', () => {
      el.btnRefreshVersion.click();
    });
  }

  if (el.btnMetaModel) {
    el.btnMetaModel.addEventListener('click', () => {
      el.btnRefreshModel.click();
    });
  }

  if (el.btnSessionId) {
    el.btnSessionId.addEventListener('click', async () => {
      const fullValue = String(el.btnSessionId.dataset.fullValue || '').trim();
      if (!fullValue || fullValue === '-') {
        return;
      }
      const flashCopiedState = () => {
        el.btnSessionId.classList.remove('is-copied');
        window.setTimeout(() => {
          el.btnSessionId.classList.add('is-copied');
          window.setTimeout(() => {
            el.btnSessionId.classList.remove('is-copied');
          }, 1200);
        }, 0);
      };
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(fullValue);
        } else {
          throw new Error('clipboard unavailable');
        }
        el.btnSessionId.title = fullValue;
        flashCopiedState();
      } catch {
        const range = document.createRange();
        range.selectNodeContents(el.sessionId);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        try {
          document.execCommand('copy');
          el.btnSessionId.title = fullValue;
          flashCopiedState();
        } finally {
          selection?.removeAllRanges();
        }
      }
    });
  }

  el.btnClearChat.addEventListener('click', async () => {
    const result = await codexdesk.clearChat(state.activeConversationId);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
    }
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnClearRuntime.addEventListener('click', async () => {
    const result = await codexdesk.clearRuntime(state.activeConversationId, false);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
    }
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnToggleSettings.addEventListener('click', () => {
    state.ui.settingsPanelHidden = !state.ui.settingsPanelHidden;
    saveUiPrefs();
    renderAll();
  });

  el.btnToggleRuntime.addEventListener('click', () => {
    state.ui.runtimePanelHidden = !state.ui.runtimePanelHidden;
    saveUiPrefs();
    renderAll();
  });

  el.btnToggleSidebar.addEventListener('click', () => {
    state.ui.sidebarHidden = !state.ui.sidebarHidden;
    saveUiPrefs();
    renderAll();
  });

  el.btnStop.addEventListener('click', async () => {
    const next = await codexdesk.stopConversation(state.activeConversationId);
    applySnapshot(next);
    renderAll();
  });

  el.btnRetryLast.addEventListener('click', async () => {
    const result = await codexdesk.retryLastMessage(state.activeConversationId);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      applySnapshot(result?.snapshot || {});
      renderAll();
      return;
    }
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnSend.addEventListener('click', async () => {
    const text = el.inputBox.value.trim();
    if (!text) {
      return;
    }
    const result = await codexdesk.sendMessage(state.activeConversationId, text);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      return;
    }
    el.inputBox.value = '';
    setConversationDraft(state.activeConversationId, '');
    state.inputBindingConversationId = draftStorageKey(state.activeConversationId);
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.inputBox.addEventListener('input', () => {
    setConversationDraft(state.activeConversationId, el.inputBox.value);
    state.inputBindingConversationId = draftStorageKey(state.activeConversationId);
  });

  el.inputBox.addEventListener('keydown', async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      el.btnSend.click();
    }
  });

  el.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.getAttribute('data-tab') || 'structured';
      renderTabs();
    });
  });

  el.languageSelect.addEventListener('change', () => {
    state.ui.language = el.languageSelect.value === 'en-US' ? 'en-US' : 'zh-CN';
    saveUiPrefs();
    renderAll();
    syncMenuLanguage();
  });

  el.fontSizeRange.addEventListener('input', () => {
    setChatFontSize(el.fontSizeRange.value);
  });

  el.fontSizeValue.addEventListener('input', () => {
    const raw = String(el.fontSizeValue.value || '').trim();
    if (!raw) {
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return;
    }
    if (value < CHAT_FONT_SIZE_MIN || value > CHAT_FONT_SIZE_MAX) {
      return;
    }
    setChatFontSize(value, { rerenderControls: false });
    el.fontSizeRange.value = String(state.ui.chatFontSize);
  });

  const commitFontSizeInput = () => {
    setChatFontSize(el.fontSizeValue.value);
  };
  el.fontSizeValue.addEventListener('focus', () => {
    el.fontSizeValue.select();
  });
  el.fontSizeValue.addEventListener('change', commitFontSizeInput);
  el.fontSizeValue.addEventListener('blur', commitFontSizeInput);
  el.fontSizeValue.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitFontSizeInput();
    }
  });

  runDocsCaptureSequence().catch(() => {});

  setInterval(() => {
    renderHeader();
    renderRunButtons();
  }, 200);
}

init();
