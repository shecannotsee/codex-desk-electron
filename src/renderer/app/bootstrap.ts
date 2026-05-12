
import { codexdesk } from './codexdesk.js';
import type { AppSnapshot, ConversationSwitchPayload } from './types.js';
import {
  CHAT_FONT_SIZE_DEFAULT,
  clampAppZoom,
  el,
  increaseChatVisibleCount,
  localizeKnownText,
  saveUiPrefs,
  setChatFontSize,
  setComposerAttachments,
  setRenderHooks,
  setTheme,
  state,
  syncMenuLanguage,
} from './state_i18n.js';
import {
  renderAll,
  renderChat,
  renderCurrentTimeDisplay,
  renderRuntime,
  renderSettings,
} from './renderers.js';
import {
  runZoomAction,
  setAppZoomFactor,
  shouldKeepQuickSettingsOpen,
  showZoomHud,
} from './app_zoom_controller.js';
import { bindResizablePanels } from './resize_bindings.js';
import { bindQueuePopover } from './queue_popover_controller.js';
import { createContextMenuController } from './context_menu_controller.js';
import { createQuickSettingsController } from './quick_settings_controller.js';
import { runDocsCaptureSequence } from './docs_capture_sequence.js';
import { createIntegrationSettingsController } from './integration_settings.js';
import { showAppNotice } from './app_notice.js';
import {
  applyConversationSwitchPayload as applyConversationSwitchPayloadToState,
  applySnapshot as applySnapshotToState,
} from './app_state_sync.js';
import { showCloseGuardModal } from './app_dialogs.js';
import { setAttachmentMenuOpen } from './composer_attachments.js';
import { applyEvent } from './app_event_handler.js';
import { bindIntegrationSettingsBindings } from './integration_settings_bindings.js';
import { bindGlobalEventHandlers } from './global_event_bindings.js';
import {
  currentConversation,
  isMessageCollapsed,
  resolveMessageMarkdownEnabled,
  setMessageCollapsed,
  setMessageMarkdownEnabled,
} from './conversation_runtime.js';
import { syncAllAgentTeamRoleRuntimeStatus } from './agent_team.js';
import { bindUiInit } from './bootstrap_ui.js';
import { bindConversationInit } from './bootstrap_conversation.js';
import { bindComposerInit } from './bootstrap_composer.js';
import { bindAgentTeamInit } from './bootstrap_agent_team.js';

function getEventElementTarget(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
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
  const provider = String(payload?.conversation?.provider || payload?.settings?.provider || '').trim().toLowerCase();
  const conversationId = String(payload?.activeConversationId || payload?.conversation?.id || '').trim();
  if (provider === 'claude' && conversationId) {
    setComposerAttachments(conversationId, []);
  }
}

async function init() {
  setRenderHooks({ renderAll, renderSettings });

  bindUiInit({ integrationSettings });
  await setAppZoomFactor(state.ui.zoomFactor, { persist: false, rerenderControls: false }).catch(() => {});

  if (typeof codexdesk.getAppInfo === 'function') {
    const appInfo = await codexdesk.getAppInfo().catch(() => null);
    if (appInfo && typeof appInfo === 'object') {
      state.appInfo = {
        name: String(appInfo.name || 'Conductor').trim() || 'Conductor',
        version: String(appInfo.version || '').trim(),
        resourceBaseUrl: String(appInfo.resourceBaseUrl || '').trim(),
      };
    }
  }

  const snapshot = await codexdesk.getSnapshot();
  applySnapshot(snapshot);
  renderAll();
  syncMenuLanguage();

  codexdesk.onEvent((event) => { applyEvent(event); });

  if (typeof codexdesk.onCloseGuard === 'function') {
    codexdesk.onCloseGuard((payload) => { showCloseGuardModal(payload || {}); });
  }

  const switchConversationIfNeeded = async (conversationId) => {
    const targetId = String(conversationId || '').trim();
    if (!targetId || targetId === state.activeConversationId) return;
    const payload = await codexdesk.switchConversation(targetId);
    applyConversationSwitchPayload(payload);
    renderAll({ stickChatToBottom: true });
  };

  const contextMenus = createContextMenuController({ applySnapshot, renderAll, switchConversationIfNeeded });
  const { hideChatContextMenu, hideConversationContextMenu, showChatContextMenu, showConversationContextMenu } = contextMenus;
  contextMenus.bind();

  if (el.chatView) {
    el.chatView.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

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
        if (!Number.isInteger(index) || index < 0) return;
        const nextCollapsed = !isMessageCollapsed(state.activeConversationId, index);
        setMessageCollapsed(state.activeConversationId, index, nextCollapsed);
        if (nextCollapsed) setMessageMarkdownEnabled(state.activeConversationId, index, false);
        renderChat(false);
        return;
      }

      const renderBtn = target.closest('.msg-toggle-render');
      if (!renderBtn) return;
      event.preventDefault();
      const index = Number(renderBtn.getAttribute('data-msg-index') || '-1');
      if (!Number.isInteger(index) || index < 0) return;
      const conversation = currentConversation();
      const message = Array.isArray(conversation?.messages) ? conversation.messages[index] : null;
      const defaultMarkdownEnabled = message?.role === 'assistant';
      const nextEnabled = !resolveMessageMarkdownEnabled(state.activeConversationId, index, defaultMarkdownEnabled);
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
    if (!el.aboutModal) return;
    el.aboutModal.classList.add('hidden');
  };

  const showAboutModal = () => {
    if (!el.aboutModal) return;
    hideQuickSettingsMenu();
    el.aboutModal.classList.remove('hidden');
    if (el.aboutClose) el.aboutClose.focus();
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
    if (!action) return;

    if (action.startsWith('ui:language:')) {
      const nextLanguage = action.slice('ui:language:'.length).trim();
      if (!nextLanguage) return;
      if (state.ui.language !== nextLanguage && Array.from(el.languageSelect.options).some((option) => option.value === nextLanguage)) {
        el.languageSelect.value = nextLanguage;
        el.languageSelect.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (action.startsWith('ui:chat-font-size:')) {
      const nextAction = action.slice('ui:chat-font-size:'.length).trim();
      if (nextAction === 'decrease') { setChatFontSize(state.ui.chatFontSize - 1); return; }
      if (nextAction === 'increase') { setChatFontSize(state.ui.chatFontSize + 1); return; }
      if (nextAction === 'default') { setChatFontSize(CHAT_FONT_SIZE_DEFAULT); return; }
      const value = Number(nextAction);
      if (Number.isFinite(value)) setChatFontSize(value);
      return;
    }
    if (action === 'ui:theme:light') { if (state.ui.theme !== 'light') setTheme('light'); return; }
    if (action === 'ui:theme:dark') { if (state.ui.theme !== 'dark') setTheme('dark'); return; }
    if (action === 'ui:theme:toggle') { setTheme(state.ui.theme === 'dark' ? 'light' : 'dark'); return; }
    if (action === 'help:about') { showAboutModal(); return; }
    if (await runZoomAction(action)) return;

    const btn = actionToButton[action];
    if (btn) { btn.click(); return; }

    if (typeof codexdesk.invokeUiAction === 'function') {
      const result = await codexdesk.invokeUiAction(action);
      if (result?.error) { window.alert(localizeKnownText(result.error)); return; }
      if (typeof result?.zoomFactor === 'number') {
        state.ui.zoomFactor = clampAppZoom(result.zoomFactor, state.ui.zoomFactor);
        saveUiPrefs();
        renderSettings();
        showZoomHud(Math.round(state.ui.zoomFactor * 100));
      }
    }
  };

  quickSettings.bind(dispatchAction);

  bindGlobalEventHandlers({
    dispatchAction,
    hideAboutModal,
    hideChatContextMenu,
    hideConversationContextMenu,
    hideQuickSettingsMenu,
    shouldKeepQuickSettingsOpen,
  });

  bindResizablePanels();
  bindConversationInit({ applySnapshot, applyConversationSwitchPayload });
  bindIntegrationSettingsBindings(integrationSettings, { setQuickSettingsPane });
  bindComposerInit({ applySnapshot });
  bindAgentTeamInit({ renderAll });

  document.addEventListener('click', (event) => {
    const target = getEventElementTarget(event);
    const localPathTrigger = target?.closest<HTMLElement>('[data-open-path]');
    if (localPathTrigger) {
      event.preventDefault();
      event.stopPropagation();
      const encodedPath = String(localPathTrigger.getAttribute('data-open-path') || '').trim();
      const targetPath = encodedPath ? decodeURIComponent(encodedPath) : '';
      if (!targetPath) return;
      codexdesk.openPath(targetPath).then((result) => {
        if (result?.error) { showAppNotice(localizeKnownText(result.error), 'error'); return; }
        if (result?.warning) showAppNotice(localizeKnownText(String(result.warning || '')), 'info');
      }).catch(() => {});
      return;
    }
    if (!target) { setAttachmentMenuOpen(false); return; }
    if (target.closest('.attachment-picker')) return;
    setAttachmentMenuOpen(false);
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
  setInterval(() => { renderCurrentTimeDisplay(); }, 1000);
  setInterval(() => {
    const hasRunningRole = state.agentTeamGroups.some((group) => group.roles.some((role) => role.status === 'running'));
    if (!hasRunningRole) return;
    if (!syncAllAgentTeamRoleRuntimeStatus()) return;
    if (state.workspaceMode === 'team') renderRuntime();
  }, 2000);
}

init();
