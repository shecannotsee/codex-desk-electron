
import { codexdesk } from './codexdesk.js';
import type {
  AppSnapshot,
  ConversationSwitchPayload,
} from './types.js';
import {
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  applyChatFontSize,
  applyRuntimePanelWidth,
  applySidebarWidth,
  applyTheme,
  clampAppZoom,
  currentLang,
  draftStorageKey,
  el,
  getComposerAttachments,
  increaseChatVisibleCount,
  loadDraftPrefs,
  loadUiPrefs,
  localizeKnownText,
  saveUiPrefs,
  setComposerAttachments,
  setChatFontSize,
  setConversationDraft,
  setRenderHooks,
  setTheme,
  state,
  syncMenuLanguage,
  t,
} from './state_i18n.js';
import {
  currentConversation,
  ensureMeta,
  ensureRuntime,
  findConversationById,
  hasActiveConversation,
  isConversationRunning,
  isMessageCollapsed,
  isWorkflowStepCollapsed,
  queuedMessages,
  resolveMessageMarkdownEnabled,
  setMessageCollapsed,
  setMessageMarkdownEnabled,
  setWorkflowStepCollapsed,
} from './conversation_runtime.js';
import {
  renderAll,
  renderChat,
  renderComposerDraft,
  renderCurrentTimeDisplay,
  renderHeader,
  renderConversationList,
  renderRunButtons,
  renderRuntime,
  renderSettings,
  renderTabs,
  updateConversationListActiveState,
  setRendererCallbacks,
} from './renderers.js';
import {
  bindZoomControls,
  runZoomAction,
  setAppZoomFactor,
  shouldKeepQuickSettingsOpen,
  showZoomHud,
} from './app_zoom_controller.js';
import { bindResizablePanels } from './resize_bindings.js';
import {
  bindQueuePopover,
  hideQueuePopover,
} from './queue_popover_controller.js';
import { createIntegrationSettingsController } from './integration_settings.js';
import { showAppNotice } from './app_notice.js';
import {
  applyConversationSwitchPayload as applyConversationSwitchPayloadToState,
  applySnapshot as applySnapshotToState,
} from './app_state_sync.js';
import {
  askConfirmDialog,
  askCreateConversationWorkdir,
  askImportSessionMode,
  askImportSessionWorkdirMode,
  askRenameTitle,
  resolveCloseGuardAction,
  resolvePreferredImportContinuationMode,
  showCloseGuardModal,
} from './app_dialogs.js';
import {
  addComposerAttachments,
  dragEventHasFiles,
  extractDroppedPaths,
  imageAttachmentsOnly,
  normalizeAttachmentFiles,
  removeComposerAttachment,
  setAttachmentMenuOpen,
} from './composer_attachments.js';
import { applyEvent } from './app_event_handler.js';

function sleepMs(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function getEventElementTarget(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function getEventNodeTarget(event: Event): Node | null {
  return event.target instanceof Node ? event.target : null;
}

const integrationSettings = createIntegrationSettingsController({
  applySnapshot,
  showNotice: showAppNotice,
});

function applySnapshot(snapshot: AppSnapshot | null | undefined) {
  applySnapshotToState(snapshot, () => {
    integrationSettings.refreshCredentialRuntimeLockNotice();
  });
}

function applyConversationSwitchPayload(payload: ConversationSwitchPayload | null | undefined) {
  applyConversationSwitchPayloadToState(payload, () => {
    integrationSettings.refreshCredentialRuntimeLockNotice();
  });
}

let lastInputBoxSelectionStart = 0;
let lastInputBoxSelectionEnd = 0;

function rememberInputBoxSelection() {
  if (!el.inputBox) {
    return;
  }
  const start = Number(el.inputBox.selectionStart);
  const end = Number(el.inputBox.selectionEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return;
  }
  lastInputBoxSelectionStart = Math.max(0, start);
  lastInputBoxSelectionEnd = Math.max(lastInputBoxSelectionStart, end);
}

function insertTextIntoInputBox(text: string) {
  if (!el.inputBox || !text) {
    return;
  }
  const input = el.inputBox;
  const focusedStart = Number(input.selectionStart);
  const focusedEnd = Number(input.selectionEnd);
  const hasLiveSelection = Number.isInteger(focusedStart) && Number.isInteger(focusedEnd);
  const start = hasLiveSelection
    ? Math.max(0, focusedStart)
    : Math.max(0, Math.min(input.value.length, lastInputBoxSelectionStart));
  const end = hasLiveSelection
    ? Math.max(start, focusedEnd)
    : Math.max(start, Math.min(input.value.length, lastInputBoxSelectionEnd));
  const nextValue = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  input.value = nextValue;
  const caret = start + text.length;
  input.focus();
  input.setSelectionRange(caret, caret);
  lastInputBoxSelectionStart = caret;
  lastInputBoxSelectionEnd = caret;
  setConversationDraft(state.activeConversationId, nextValue);
  state.inputBindingConversationId = draftStorageKey(state.activeConversationId);
}

async function init() {
  setRenderHooks({
    renderAll,
    renderSettings,
  });
  const switchConversationAndRender = async (id: string) => {
    const previousActiveId = state.activeConversationId;
    const payload = await codexdesk.switchConversation(id);
    applyConversationSwitchPayload(payload);
    if (!updateConversationListActiveState(previousActiveId, state.activeConversationId)) {
      renderConversationList();
    }
    renderSettings();
    renderHeader();
    renderChat(true);
    renderRuntime(true);
    renderRunButtons();
    renderComposerDraft();
    renderTabs();
  };
  setRendererCallbacks({
    onConversationSelected: switchConversationAndRender,
  });

  loadUiPrefs();
  loadDraftPrefs();
  applyTheme();
  applySidebarWidth();
  applyRuntimePanelWidth();
  applyChatFontSize();
  await setAppZoomFactor(state.ui.zoomFactor, { persist: false, rerenderControls: false }).catch(() => {});

  if (typeof codexdesk.getAppInfo === 'function') {
    const appInfo = await codexdesk.getAppInfo().catch(() => null);
    if (appInfo && typeof appInfo === 'object') {
      state.appInfo = {
        name: String(appInfo.name || 'Codex Desk').trim() || 'Codex Desk',
        version: String(appInfo.version || '').trim(),
      };
    }
  }

  const snapshot = await codexdesk.getSnapshot();
  applySnapshot(snapshot);
  renderAll();
  syncMenuLanguage();

  codexdesk.onEvent((event) => {
    applyEvent(event);
  });

  if (typeof codexdesk.onCloseGuard === 'function') {
    codexdesk.onCloseGuard((payload) => {
      showCloseGuardModal(payload || {});
    });
  }

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
    const targetConversation = findConversationById(contextMenuConversationId);
    if (el.ctxImportConv) {
      el.ctxImportConv.disabled = false;
    }
    if (el.ctxExportConv) {
      el.ctxExportConv.disabled = !hasTarget;
    }
    if (el.ctxRenameConv) {
      el.ctxRenameConv.disabled = !hasTarget;
    }
    if (el.ctxPinConv) {
      el.ctxPinConv.disabled = !hasTarget;
      el.ctxPinConv.textContent = hasTarget && Number(targetConversation?.pinnedAt || 0) > 0
        ? t('contextMenuUnpin')
        : t('contextMenuPin');
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

  let chatContextSelectionText = '';

  const currentSelectionText = () => {
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement
      || (active instanceof HTMLInputElement && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(String(active.type || '').toLowerCase()))
    ) {
      const start = Number(active.selectionStart);
      const end = Number(active.selectionEnd);
      if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
        return String(active.value || '').slice(start, end);
      }
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return '';
    }
    return selection.toString();
  };

  const hasSelectionText = () => String(currentSelectionText() || '').length > 0;

  const copyPlainText = async (text) => {
    const content = String(text || '');
    if (!content) {
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(content);
      return;
    }
    const helper = document.createElement('textarea');
    helper.value = content;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(helper);
    }
  };

  const showChatContextMenu = (x, y) => {
    if (!el.chatContextMenu) {
      return;
    }
    chatContextSelectionText = currentSelectionText();
    const showCopy = chatContextSelectionText.length > 0;
    if (el.ctxCopySelection) {
      el.ctxCopySelection.classList.toggle('hidden', !showCopy);
      el.ctxCopySelection.disabled = !showCopy;
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
    const payload = await codexdesk.switchConversation(targetId);
    applyConversationSwitchPayload(payload);
    renderAll({ stickChatToBottom: true });
  };

  el.conversationList.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const row = getEventElementTarget(event)?.closest('.conversation-item');
    const id = row ? String(row.getAttribute('data-id') || '').trim() : '';
    hideChatContextMenu();
    showConversationContextMenu(event.clientX, event.clientY, id);
  });

  if (el.chatView) {
    el.chatView.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const loadEarlierBtn = target.closest('.chat-load-more-button');
      if (loadEarlierBtn) {
        event.preventDefault();
        const conv = currentConversation();
        const total = Array.isArray(conv?.messages) ? conv.messages.length : 0;
        const beforeHeight = el.chatView.scrollHeight;
        const beforeTop = el.chatView.scrollTop;
        increaseChatVisibleCount(state.activeConversationId, total);
        renderChat(false);
        const delta = el.chatView.scrollHeight - beforeHeight;
        el.chatView.scrollTop = beforeTop + Math.max(0, delta);
        return;
      }

      const toggleBtn = target.closest('.msg-toggle-collapse');
      if (toggleBtn) {
        event.preventDefault();
        const index = Number(toggleBtn.getAttribute('data-msg-index') || '-1');
        if (!Number.isInteger(index) || index < 0) {
          return;
        }
        const nextCollapsed = !isMessageCollapsed(state.activeConversationId, index);
        setMessageCollapsed(state.activeConversationId, index, nextCollapsed);
        if (nextCollapsed) {
          setMessageMarkdownEnabled(state.activeConversationId, index, false);
        }
        renderChat(false);
        return;
      }

      const renderBtn = target.closest('.msg-toggle-render');
      if (!renderBtn) {
        return;
      }
      event.preventDefault();
      const index = Number(renderBtn.getAttribute('data-msg-index') || '-1');
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      const conversation = currentConversation();
      const message = Array.isArray(conversation?.messages) ? conversation.messages[index] : null;
      const defaultMarkdownEnabled = message?.role === 'assistant';
      const nextEnabled = !resolveMessageMarkdownEnabled(
        state.activeConversationId,
        index,
        defaultMarkdownEnabled,
      );
      setMessageMarkdownEnabled(state.activeConversationId, index, nextEnabled);
      renderChat(false);
    });

    el.chatView.addEventListener('contextmenu', (event) => {
      const target = getEventElementTarget(event);
      if (target?.closest('button')) {
        return;
      }
      const clickedMessage = target?.closest('.msg-block');
      if (!hasSelectionText() && clickedMessage) {
        return;
      }
      event.preventDefault();
      hideConversationContextMenu();
      showChatContextMenu(event.clientX, event.clientY);
    });
  }

  bindQueuePopover();

  if (el.runtimePanel) {
    el.runtimePanel.addEventListener('contextmenu', (event) => {
      if (getEventElementTarget(event)?.closest('button')) {
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
      if (getEventElementTarget(event)?.closest('button')) {
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
  if (el.ctxImportConv) {
    el.ctxImportConv.addEventListener('click', () => {
      hideConversationContextMenu();
      el.btnImportSession.click();
    });
  }
  if (el.ctxExportConv) {
    el.ctxExportConv.addEventListener('click', async () => {
      const id = contextMenuConversationId;
      hideConversationContextMenu();
      await switchConversationIfNeeded(id);
      if (!id) {
        return;
      }
      el.btnExportSession.click();
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
  if (el.ctxPinConv) {
    el.ctxPinConv.addEventListener('click', async () => {
      const id = contextMenuConversationId;
      hideConversationContextMenu();
      if (!id) {
        return;
      }
      const next = await codexdesk.toggleConversationPin(id);
      if (next?.error) {
        window.alert(localizeKnownText(next.error));
        return;
      }
      applySnapshot(next?.snapshot || next);
      renderAll();
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
  if (el.ctxCopySelection) {
    el.ctxCopySelection.addEventListener('click', async () => {
      const text = chatContextSelectionText;
      hideChatContextMenu();
      if (!text) {
        return;
      }
      await copyPlainText(text).catch(() => {});
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
    integration: 'menuNotification',
    'integration-security': 'securityPaneTitle',
    'integration-telegram': 'providerTelegram',
    view: 'menuInterface',
    window: 'menuWindow',
    help: 'menuHelp',
    'help-telegram-logs': 'helpTelegramLogs',
  };
  const resolveQuickSettingsParentPane = (paneName) => {
    const normalized = String(paneName || '').trim();
    if (!normalized || normalized === 'root' || !normalized.includes('-')) {
      return 'root';
    }
    return String(normalized.split('-')[0] || 'root').trim() || 'root';
  };
  let quickSettingsPane = 'root';
  const setQuickSettingsPane = (paneName) => {
    if (!el.quickSettingsMenu) {
      return;
    }
    const root = el.quickSettingsRoot;
    const detail = el.quickSettingsDetail;
    const detailTitle = el.qsDetailTitle;
    const categoryButtons = Array.from(el.quickSettingsMenu.querySelectorAll<HTMLElement>('.quick-settings-category[data-pane]'));
    const panes = Array.from(el.quickSettingsMenu.querySelectorAll<HTMLElement>('.quick-settings-pane[data-pane]'));
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
    const telegramLogsSnapshot = integrationSettings.getTelegramLogsSnapshot();
    if (target === 'help-telegram-logs' && !telegramLogsSnapshot.loaded && !telegramLogsSnapshot.loading) {
      integrationSettings.refreshTelegramLogs().catch(() => {});
    }
  };

  const hideQuickSettingsMenu = () => {
    if (!el.quickSettingsMenu || !el.btnQuickSettings) {
      return;
    }
    el.quickSettingsMenu.classList.add('hidden');
    if (el.quickSettingsScrim) {
      el.quickSettingsScrim.classList.add('hidden');
    }
    el.btnQuickSettings.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('quick-settings-open');
  };

  const showQuickSettingsMenu = () => {
    if (!el.quickSettingsMenu || !el.btnQuickSettings) {
      return;
    }
    setQuickSettingsPane('root');
    el.quickSettingsMenu.classList.remove('hidden');
    if (el.quickSettingsScrim) {
      el.quickSettingsScrim.classList.remove('hidden');
    }
    el.btnQuickSettings.setAttribute('aria-expanded', 'true');
    document.body.classList.add('quick-settings-open');
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
    'conversation:export-session': el.btnExportSession,
    'conversation:rename': el.btnRenameConv,
    'conversation:close-current': el.btnCloseConv,
    'conversation:clear-chat': el.btnClearChat,
    'conversation:clear-runtime': el.btnClearRuntime,
    'conversation:retry-last': el.btnRetryLast,
    'conversation:stop': el.btnStop,
    'meta:refresh-codex-version': el.btnRefreshVersion,
    'meta:refresh-model': el.btnRefreshModel,
    'ui:toggle-runtime': el.btnToggleRuntime,
    'ui:toggle-sidebar': el.btnToggleSidebar,
  };

  const dispatchAction = async (rawAction) => {
    const action = String(rawAction || '').trim();
    if (!action) {
      return;
    }

    if (action.startsWith('ui:language:')) {
      const nextLanguage = action.slice('ui:language:'.length).trim();
      if (!nextLanguage) {
        return;
      }
      if (state.ui.language !== nextLanguage && Array.from(el.languageSelect.options).some((option) => option.value === nextLanguage)) {
        el.languageSelect.value = nextLanguage;
        el.languageSelect.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (action.startsWith('ui:chat-font-size:')) {
      const nextAction = action.slice('ui:chat-font-size:'.length).trim();
      if (nextAction === 'decrease') {
        setChatFontSize(state.ui.chatFontSize - 1);
        return;
      }
      if (nextAction === 'increase') {
        setChatFontSize(state.ui.chatFontSize + 1);
        return;
      }
      if (nextAction === 'default') {
        setChatFontSize(CHAT_FONT_SIZE_DEFAULT);
        return;
      }
      const value = Number(nextAction);
      if (Number.isFinite(value)) {
        setChatFontSize(value);
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
    if (action === 'ui:theme:toggle') {
      setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
      return;
    }
    if (action === 'help:about') {
      showAboutModal();
      return;
    }
    if (await runZoomAction(action)) {
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
        return;
      }
      if (typeof result?.zoomFactor === 'number') {
        state.ui.zoomFactor = clampAppZoom(result.zoomFactor, state.ui.zoomFactor);
        saveUiPrefs();
        renderSettings();
        showZoomHud(Math.round(state.ui.zoomFactor * 100));
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
      const selection = window.getSelection();
      selection?.removeAllRanges();
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
        showChatContextMenu(rect.left + 16, rect.top + 16);
        await capture('screenshot-chat-copy-menu.png', 260);
        hideChatContextMenu();
        selection?.removeAllRanges();
      }

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

  if (el.quickSettingsScrim) {
    el.quickSettingsScrim.addEventListener('click', () => {
      hideQuickSettingsMenu();
    });
  }

  if (el.quickSettingsMenu) {
    el.quickSettingsMenu.addEventListener('click', (event) => {
      const target = getEventElementTarget(event);
      const category = target?.closest('.quick-settings-category[data-pane]');
      if (category) {
        event.preventDefault();
        event.stopPropagation();
        setQuickSettingsPane(category.getAttribute('data-pane'));
        return;
      }
      const backBtn = target?.closest('#qs-back');
      if (backBtn) {
        event.preventDefault();
        event.stopPropagation();
        setQuickSettingsPane(resolveQuickSettingsParentPane(quickSettingsPane));
        return;
      }
      const paneRoute = target?.closest<HTMLElement>('[data-pane-route]');
      if (paneRoute) {
        event.preventDefault();
        event.stopPropagation();
        setQuickSettingsPane(paneRoute.getAttribute('data-pane-route'));
        return;
      }
      const button = target?.closest('button[data-action]');
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const action = String(button.getAttribute('data-action') || '');
      const keepOpen = action.startsWith('ui:') || action.startsWith('view:');
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
    if (
      el.closeGuardModal
      && !el.closeGuardModal.classList.contains('hidden')
      && event.target === el.closeGuardModal
    ) {
      resolveCloseGuardAction('cancel');
      return;
    }
    const targetNode = getEventNodeTarget(event);
    if (el.chatContextMenu && !el.chatContextMenu.classList.contains('hidden') && (!targetNode || !el.chatContextMenu.contains(targetNode))) {
      hideChatContextMenu();
    }
    if (el.contextMenu && !el.contextMenu.classList.contains('hidden') && (!targetNode || !el.contextMenu.contains(targetNode))) {
      hideConversationContextMenu();
    }
    if (
      el.queuePopover
      && !el.queuePopover.classList.contains('hidden')
      && (!targetNode || (!el.queuePopover.contains(targetNode) && !el.queueChip.contains(targetNode)))
    ) {
      hideQueuePopover();
    }
    if (!el.quickSettingsMenu || el.quickSettingsMenu.classList.contains('hidden')) {
      return;
    }
    if (targetNode && el.quickSettingsMenu.contains(targetNode)) {
      return;
    }
    if (targetNode && el.btnQuickSettings && el.btnQuickSettings.contains(targetNode)) {
      return;
    }
  });

  window.addEventListener('blur', () => {
    hideChatContextMenu();
    hideConversationContextMenu();
    hideQueuePopover();
  });
  window.addEventListener('beforeunload', () => {
    setConversationDraft(state.activeConversationId, el.inputBox?.value || '');
  });
  window.addEventListener('resize', () => {
    hideChatContextMenu();
    hideConversationContextMenu();
    hideQueuePopover();
    if (!shouldKeepQuickSettingsOpen()) {
      hideQuickSettingsMenu();
    }
    hideAboutModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.code === 'Equal') {
        event.preventDefault();
        dispatchAction('view:zoom-in').catch(() => {});
        return;
      }
      if (!event.shiftKey && event.code === 'Minus') {
        event.preventDefault();
        dispatchAction('view:zoom-out').catch(() => {});
        return;
      }
      if (!event.shiftKey && event.code === 'Digit0') {
        event.preventDefault();
        dispatchAction('view:zoom-reset').catch(() => {});
        return;
      }
    }
    if (event.key === 'Escape') {
      if (el.closeGuardModal && !el.closeGuardModal.classList.contains('hidden')) {
        resolveCloseGuardAction('cancel');
        return;
      }
      hideQueuePopover();
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
  if (el.closeGuardCancel) {
    el.closeGuardCancel.addEventListener('click', () => {
      resolveCloseGuardAction('cancel');
    });
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.addEventListener('click', () => {
      resolveCloseGuardAction('stop-and-close');
    });
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.addEventListener('click', () => {
      resolveCloseGuardAction('force-close');
    });
  }

  bindResizablePanels();

  if (typeof codexdesk.onMenuAction === 'function') {
    codexdesk.onMenuAction((payload) => {
      const action = String(payload?.action || '').trim();
      if (!action) {
        return;
      }
      dispatchAction(action).catch(() => {});
    });
  }

  const runCreateConversationFlow = async () => {
    const workdir = await askCreateConversationWorkdir();
    if (workdir === null) {
      return;
    }
    const next = await codexdesk.createConversation({
      workdir: String(workdir || '').trim(),
    });
    applySnapshot(next);
    renderAll();
  };

  el.btnNewConv.addEventListener('click', async () => {
    await runCreateConversationFlow();
  });

  el.btnImportSession.addEventListener('click', () => {
    runImportSessionFlow().catch((error) => {
      window.alert(localizeKnownText(`导入会话失败: ${error?.message || String(error)}`));
    });
  });

  el.btnExportSession.addEventListener('click', async () => {
    const result = await codexdesk.exportSession(state.activeConversationId);
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
    const exportedPath = String(result?.exported?.filePath || '').trim();
    const exportedCount = Number(result?.exported?.messageCount || 0);
    if (exportedPath) {
      window.alert(localizeKnownText(`已导出会话到:\n${exportedPath}\n\n消息数: ${exportedCount}`));
    }
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
    const ok = await askConfirmDialog({
      title: t('closeConversationTitle'),
      message: t('confirmCloseConversation', { title }),
    });
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

  if (el.btnMetaModel) {
    el.btnMetaModel.addEventListener('click', () => {
      el.btnRefreshModel.click();
    });
  }

  if (el.qsTelegramSave) {
    el.qsTelegramSave.addEventListener('click', async () => {
      await integrationSettings.saveNotificationSettings();
    });
  }

  if (el.qsTelegramToggleTokenVisibility) {
    el.qsTelegramToggleTokenVisibility.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsTelegramBotTokenInput, el.qsTelegramToggleTokenVisibility);
    });
  }

  if (el.qsTelegramToggleRemoteTokenVisibility) {
    el.qsTelegramToggleRemoteTokenVisibility.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsTelegramRemoteBotTokenInput, el.qsTelegramToggleRemoteTokenVisibility);
    });
  }

  if (el.qsNotificationProviderTelegram) {
    el.qsNotificationProviderTelegram.addEventListener('click', () => {
      state.settings.notifications.activeProvider = 'telegram';
      renderSettings();
    });
  }

  const openCredentialVaultPane = () => {
    setQuickSettingsPane('integration-security');
    window.setTimeout(() => {
      if (el.qsSecurityUnlockInput && !el.qsSecurityUnlockInput.disabled && !el.qsSecurityUnlockCard.classList.contains('hidden')) {
        el.qsSecurityUnlockInput.focus();
        return;
      }
      if (el.qsSecurityNewPasswordInput && !el.qsSecurityNewPasswordInput.disabled && !el.qsSecurityPasswordCard.classList.contains('hidden')) {
        el.qsSecurityNewPasswordInput.focus();
      }
    }, 0);
  };

  if (el.qsSecurityRuntimeUnlock) {
    el.qsSecurityRuntimeUnlock.addEventListener('click', () => {
      openCredentialVaultPane();
    });
  }

  if (el.qsTelegramLockUnlock) {
    el.qsTelegramLockUnlock.addEventListener('click', () => {
      openCredentialVaultPane();
    });
  }

  if (el.qsTelegramTest) {
    el.qsTelegramTest.addEventListener('click', async () => {
      await integrationSettings.testTelegramSettings();
    });
  }
  if (el.qsTelegramLogsRefresh) {
    el.qsTelegramLogsRefresh.addEventListener('click', async () => {
      await integrationSettings.refreshTelegramLogs();
    });
  }
  if (el.qsTelegramLogsCopy) {
    el.qsTelegramLogsCopy.addEventListener('click', async () => {
      const telegramLogsSnapshot = integrationSettings.getTelegramLogsSnapshot();
      const text = String(telegramLogsSnapshot.text || '').trim();
      if (!text || Math.max(0, Number(telegramLogsSnapshot.count) || 0) <= 0) {
        return;
      }
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
        } else {
          const helper = document.createElement('textarea');
          helper.value = text;
          helper.setAttribute('readonly', 'readonly');
          helper.style.position = 'fixed';
          helper.style.opacity = '0';
          helper.style.pointerEvents = 'none';
          document.body.appendChild(helper);
          helper.focus();
          helper.select();
          try {
            document.execCommand('copy');
          } finally {
            document.body.removeChild(helper);
          }
        }
        showAppNotice(t('telegramLogsCopySuccess'), 'success');
      } catch (error) {
        showAppNotice(localizeKnownText(error instanceof Error ? error.message : String(error)), 'error');
      }
    });
  }

  if (el.qsSecurityUnlockToggle) {
    el.qsSecurityUnlockToggle.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsSecurityUnlockInput, el.qsSecurityUnlockToggle);
    });
  }

  if (el.qsSecurityNewPasswordToggle) {
    el.qsSecurityNewPasswordToggle.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsSecurityNewPasswordInput, el.qsSecurityNewPasswordToggle);
    });
  }

  if (el.qsSecurityConfirmPasswordToggle) {
    el.qsSecurityConfirmPasswordToggle.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsSecurityConfirmPasswordInput, el.qsSecurityConfirmPasswordToggle);
    });
  }

  if (el.qsSecurityUnlockAction) {
    el.qsSecurityUnlockAction.addEventListener('click', async () => {
      await integrationSettings.unlockMasterPassword();
    });
  }

  if (el.qsSecurityLockAction) {
    el.qsSecurityLockAction.addEventListener('click', async () => {
      await integrationSettings.lockMasterPassword();
    });
  }

  if (el.qsSecuritySetPasswordAction) {
    el.qsSecuritySetPasswordAction.addEventListener('click', async () => {
      await integrationSettings.submitMasterPasswordUpdate('set');
    });
  }

  if (el.qsSecurityChangePasswordAction) {
    el.qsSecurityChangePasswordAction.addEventListener('click', async () => {
      await integrationSettings.submitMasterPasswordUpdate('change');
    });
  }

  if (el.qsSecurityUnlockInput) {
    el.qsSecurityUnlockInput.addEventListener('input', () => {
      integrationSettings.clearUnlockError();
    });
    el.qsSecurityUnlockInput.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      await integrationSettings.unlockMasterPassword();
    });
  }

  const runMasterPasswordSubmitFromKeyboard = async (event: KeyboardEvent) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (state.settings.security?.hasMasterPassword) {
      await integrationSettings.submitMasterPasswordUpdate('change');
      return;
    }
    await integrationSettings.submitMasterPasswordUpdate('set');
  };

  if (el.qsSecurityNewPasswordInput) {
    el.qsSecurityNewPasswordInput.addEventListener('input', () => {
      integrationSettings.clearPasswordError();
    });
    el.qsSecurityNewPasswordInput.addEventListener('keydown', runMasterPasswordSubmitFromKeyboard);
  }

  if (el.qsSecurityConfirmPasswordInput) {
    el.qsSecurityConfirmPasswordInput.addEventListener('input', () => {
      integrationSettings.clearPasswordError();
    });
    el.qsSecurityConfirmPasswordInput.addEventListener('keydown', runMasterPasswordSubmitFromKeyboard);
  }

  if (el.btnSessionId) {
    el.btnSessionId.addEventListener('click', async () => {
      const fullValue = String(el.btnSessionId.dataset.fullValue || '').trim();
      if (!fullValue || fullValue === '-') {
        return;
      }
      const flashCopiedState = () => {
        el.btnSessionId.classList.remove('is-copied');
        window.requestAnimationFrame(() => {
          el.btnSessionId.classList.add('is-copied');
          window.setTimeout(() => {
            el.btnSessionId.classList.remove('is-copied');
          }, 900);
        });
        showAppNotice(t('copySuccess'), 'success');
      };
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(fullValue);
        } else {
          throw new Error('clipboard unavailable');
        }
        flashCopiedState();
      } catch {
        const range = document.createRange();
        range.selectNodeContents(el.sessionId);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        try {
          document.execCommand('copy');
          flashCopiedState();
        } finally {
          selection?.removeAllRanges();
        }
      }
    });
  }

  const runImportSessionFlow = async () => {
    const picked = await codexdesk.pickImportSession();
    if (picked?.canceled) {
      return;
    }
    if (picked?.error) {
      window.alert(localizeKnownText(picked.error));
      applySnapshot(picked?.snapshot || {});
      renderAll();
      return;
    }

    const preview = picked?.preview;
    const filePath = String(preview?.filePath || '').trim();
    if (!filePath) {
      window.alert(localizeKnownText('导入会话失败: 未获取到导入文件信息'));
      applySnapshot(picked?.snapshot || {});
      renderAll();
      return;
    }

    const workdirChoice = await askImportSessionWorkdirMode(preview);
    if (!workdirChoice) {
      return;
    }

    let continuationMode = 'resume';
    if (String(preview?.sessionId || '').trim()) {
      const selectedMode = await askImportSessionMode(
        preview,
        resolvePreferredImportContinuationMode(preview, workdirChoice),
      );
      if (!selectedMode) {
        return;
      }
      continuationMode = selectedMode;
    }

    const result = await codexdesk.importSessionFromFile(filePath, continuationMode, workdirChoice);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      applySnapshot(result?.snapshot || {});
      renderAll();
      return;
    }

    applySnapshot(result?.snapshot || result);
    renderAll();
  };

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

  el.btnAddAttachment.addEventListener('click', () => {
    if (el.attachmentInput.disabled) {
      return;
    }
    const willOpen = el.attachmentKindMenu.classList.contains('hidden');
    setAttachmentMenuOpen(willOpen);
  });

  el.btnAddImageAttachment.addEventListener('click', () => {
    if (el.attachmentInput.disabled) {
      return;
    }
    setAttachmentMenuOpen(false);
    el.attachmentInput.click();
  });

  el.attachmentInput.addEventListener('change', () => {
    const attachments = imageAttachmentsOnly(normalizeAttachmentFiles(Array.from(el.attachmentInput.files || [])));
    if (attachments.length) {
      addComposerAttachments(attachments);
    }
    el.attachmentInput.value = '';
  });

  el.btnSend.addEventListener('click', async () => {
    const text = el.inputBox.value.trim();
    const attachments = getComposerAttachments(state.activeConversationId);
    if (!text) {
      return;
    }
    const result = await codexdesk.sendMessage(state.activeConversationId, text, attachments);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      return;
    }
    el.inputBox.value = '';
    setConversationDraft(state.activeConversationId, '');
    setComposerAttachments(state.activeConversationId, []);
    state.inputBindingConversationId = draftStorageKey(state.activeConversationId);
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnInsertMessage.addEventListener('click', async () => {
    const text = el.inputBox.value.trim();
    if (!text) {
      return;
    }
    const result = await codexdesk.insertMessage(state.activeConversationId, text);
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
    rememberInputBoxSelection();
    setConversationDraft(state.activeConversationId, el.inputBox.value);
    state.inputBindingConversationId = draftStorageKey(state.activeConversationId);
  });

  ['click', 'keyup', 'select', 'focus'].forEach((eventName) => {
    el.inputBox.addEventListener(eventName, () => {
      rememberInputBoxSelection();
    });
  });

  el.inputBox.addEventListener('dragenter', (event) => {
    if (el.inputBox.disabled || !dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    rememberInputBoxSelection();
    el.inputBox.classList.add('is-dragover');
  });

  el.inputBox.addEventListener('dragover', (event) => {
    if (el.inputBox.disabled || !dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    rememberInputBoxSelection();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    el.inputBox.classList.add('is-dragover');
  });

  el.inputBox.addEventListener('dragleave', (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && el.inputBox.contains(nextTarget)) {
      return;
    }
    el.inputBox.classList.remove('is-dragover');
  });

  el.inputBox.addEventListener('drop', (event) => {
    el.inputBox.classList.remove('is-dragover');
    if (el.inputBox.disabled || !dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    const paths = extractDroppedPaths(event.dataTransfer);
    if (!paths.length) {
      return;
    }
    const text = paths.join('\n');
    insertTextIntoInputBox(text);
  });

  el.sidebarSearchInput.addEventListener('input', () => {
    renderConversationList();
  });

  el.conversationList.addEventListener('click', async (event) => {
    const target = getEventElementTarget(event);
    const item = target?.closest<HTMLElement>('.conversation-item[data-id]');
    if (!item) {
      return;
    }
    const id = String(item.getAttribute('data-id') || '').trim();
    if (!id) {
      return;
    }
    await switchConversationAndRender(id);
  });

  el.btnSidebarNewConv.addEventListener('click', () => {
    el.btnNewConv.click();
  });

  el.inputBox.addEventListener('keydown', async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      el.btnSend.click();
    }
  });

  el.tabButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextTab = btn.getAttribute('data-tab');
      state.activeTab = nextTab === 'workflow' || nextTab === 'raw' || nextTab === 'structured'
        ? nextTab
        : 'workflow';
      renderRuntime();
      renderTabs();
      window.requestAnimationFrame(() => {
        let pane = el.tabStructured;
        if (state.activeTab === 'workflow') {
          pane = el.tabWorkflow;
        } else if (state.activeTab === 'raw') {
          pane = el.tabRaw;
        }
        if (pane) {
          pane.scrollTop = pane.scrollHeight;
        }
      });
    });
  });

  el.composerAttachments.addEventListener('click', (event) => {
    const target = getEventElementTarget(event);
    const button = target?.closest('.composer-attachment-remove');
    if (!button) {
      return;
    }
    const index = Number(button.getAttribute('data-attachment-index') || '-1');
    removeComposerAttachment(index);
  });

  document.addEventListener('click', (event) => {
    const target = getEventElementTarget(event);
    const localLink = target?.closest<HTMLAnchorElement>('a[data-open-path]');
    if (localLink) {
      event.preventDefault();
      event.stopPropagation();
      const encodedPath = String(localLink.getAttribute('data-open-path') || '').trim();
      const targetPath = encodedPath ? decodeURIComponent(encodedPath) : '';
      if (!targetPath) {
        return;
      }
      codexdesk.openPath(targetPath).then((result) => {
        if (result?.error) {
          showAppNotice(localizeKnownText(result.error), 'error');
          return;
        }
        if (result?.warning) {
          showAppNotice(localizeKnownText(String(result.warning || '')), 'info');
        }
      }).catch(() => {});
      return;
    }
    if (!target) {
      setAttachmentMenuOpen(false);
      return;
    }
    if (target.closest('.attachment-picker')) {
      return;
    }
    setAttachmentMenuOpen(false);
  });

  el.languageSelect.addEventListener('change', () => {
    state.ui.language = el.languageSelect.value === 'en-US' ? 'en-US' : 'zh-CN';
    saveUiPrefs();
    renderAll();
    integrationSettings.renderLocalizedState();
    syncMenuLanguage();
  });

  bindZoomControls();

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
  integrationSettings.renderTelegramLogsPane();

  renderCurrentTimeDisplay();
  setInterval(() => {
    renderCurrentTimeDisplay();
  }, 1000);
}

init();
