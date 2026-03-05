
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
      delete state.collapsedByConversation[id];
      delete state.workflowCollapsedByConversation[id];
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
  applyChatFontSize();

  const snapshot = await codexdesk.getSnapshot();
  applySnapshot(snapshot);
  renderAll();
  syncMenuLanguage();

  codexdesk.onEvent((event) => {
    applyEvent(event);
  });
  if (typeof codexdesk.onMenuAction === 'function') {
    codexdesk.onMenuAction((payload) => {
      const action = String(payload?.action || '').trim();
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
      const actionToButton = {
        'conversation:new': el.btnNewConv,
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
      const btn = actionToButton[action];
      if (btn) {
        btn.click();
      }
    });
  }

  el.btnNewConv.addEventListener('click', async () => {
    const next = await codexdesk.createConversation();
    applySnapshot(next);
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
    applySnapshot(result?.snapshot || result);
    renderAll();
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

  setInterval(() => {
    renderHeader();
    renderRunButtons();
  }, 200);
}

init();
