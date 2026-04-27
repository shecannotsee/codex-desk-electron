
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
  increaseChatVisibleCount,
  loadDraftPrefs,
  loadUiPrefs,
  localizeKnownText,
  saveUiPrefs,
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
  hasActiveConversation,
  isConversationRunning,
  isMessageCollapsed,
  isWorkflowStepCollapsed,
  queuedMessages,
  resolveMessageMarkdownEnabled,
  setMessageCollapsed,
  setMessageMarkdownEnabled,
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
import { createContextMenuController } from './context_menu_controller.js';
import { createQuickSettingsController } from './quick_settings_controller.js';
import { runDocsCaptureSequence } from './docs_capture_sequence.js';
import { createIntegrationSettingsController } from './integration_settings.js';
import { showAppNotice } from './app_notice.js';
import {
  applyConversationSwitchPayload as applyConversationSwitchPayloadToState,
  applySnapshot as applySnapshotToState,
} from './app_state_sync.js';
import {
  resolveCloseGuardAction,
  showCloseGuardModal,
} from './app_dialogs.js';
import { setAttachmentMenuOpen } from './composer_attachments.js';
import { applyEvent } from './app_event_handler.js';
import { bindConversationActions } from './conversation_actions_controller.js';
import { bindComposerController } from './composer_controller.js';

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

  const switchConversationIfNeeded = async (conversationId) => {
    const targetId = String(conversationId || '').trim();
    if (!targetId || targetId === state.activeConversationId) {
      return;
    }
    const payload = await codexdesk.switchConversation(targetId);
    applyConversationSwitchPayload(payload);
    renderAll({ stickChatToBottom: true });
  };

  const contextMenus = createContextMenuController({
    applySnapshot,
    renderAll,
    switchConversationIfNeeded,
  });
  const {
    hideChatContextMenu,
    hideConversationContextMenu,
    showChatContextMenu,
    showConversationContextMenu,
  } = contextMenus;
  contextMenus.bind();

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
  }

  bindQueuePopover();

  const quickSettings = createQuickSettingsController(integrationSettings);
  const setQuickSettingsPane = quickSettings.setPane;
  const hideQuickSettingsMenu = quickSettings.hide;
  const showQuickSettingsMenu = quickSettings.show;

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

  quickSettings.bind(dispatchAction);

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

  bindConversationActions({
    applySnapshot,
    renderAll,
  });

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

  bindComposerController({
    applySnapshot,
    renderAll,
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

  runDocsCaptureSequence({
    applySnapshot,
    closeMenus: () => {
      hideChatContextMenu();
      hideConversationContextMenu();
      hideQuickSettingsMenu();
      hideAboutModal();
      window.getSelection()?.removeAllRanges();
    },
    hideChatContextMenu,
    hideQuickSettingsMenu,
    setQuickSettingsPane,
    showChatContextMenu,
    showConversationContextMenu,
    showQuickSettingsMenu,
  }).catch(() => {});
  integrationSettings.renderTelegramLogsPane();

  renderCurrentTimeDisplay();
  setInterval(() => {
    renderCurrentTimeDisplay();
  }, 1000);
}

init();
