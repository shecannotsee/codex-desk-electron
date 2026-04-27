import {
  currentLang,
  el,
  state,
  t,
} from './state_i18n.js';
import {
  canRetryLastMessage,
  currentConversation,
  effectivePhaseRaw,
  ensureMeta,
  hasActiveConversation,
  isConversationRunning,
  phaseLabel,
  queuedCount,
  updatePhaseClass,
} from './conversation_runtime.js';
import { renderQueuePopover } from './runtime_renderer.js';
import { renderComposerWorkdir } from './composer_renderer.js';
import { renderCurrentTimeDisplay } from './time_display.js';

function renderHeader() {
  renderCurrentTimeDisplay();
  const conv = currentConversation();
  const meta = conv
    ? ensureMeta(state.activeConversationId)
    : {
      模型: '-',
      会话ID: '-',
    };
  const normalizeMetaValue = (value: unknown): string => {
    const text = String(value ?? '').trim();
    if (!text || text === '-') {
      return '';
    }
    return text;
  };

  el.chatTitle.textContent = conv ? conv.title : '-';
  const sid = normalizeMetaValue(meta['会话ID']) || normalizeMetaValue(conv?.sessionId) || '-';
  if (sid && sid !== '-' && sid.length > 16) {
    el.sessionId.textContent = `${sid.slice(0, 8)}...${sid.slice(-6)}`;
  } else {
    el.sessionId.textContent = sid || '-';
  }
  if (el.btnSessionId) {
    el.btnSessionId.disabled = !sid || sid === '-';
    el.btnSessionId.dataset.fullValue = sid;
    el.btnSessionId.dataset.tooltip = sid && sid !== '-' ? t('clickToCopy') : '';
    el.btnSessionId.setAttribute('aria-label', sid && sid !== '-' ? `${t('clickToCopy')}: ${sid}` : t('sessionId'));
  }

  const phaseRaw = effectivePhaseRaw();
  el.phase.textContent = phaseLabel(phaseRaw);
  updatePhaseClass(phaseRaw);

  const queue = conv ? queuedCount(state.activeConversationId) : 0;
  el.queueCount.textContent = String(queue);
  el.queueChip.classList.toggle('queue-chip-active', queue > 0);
  el.queueChip.classList.toggle('hidden', queue <= 0);
  if (el.queuePopoverTitle) {
    el.queuePopoverTitle.textContent = t('queuedRepliesTitle');
  }
  if (el.queuePopoverClear) {
    el.queuePopoverClear.textContent = t('queuedUndoAll');
    el.queuePopoverClear.disabled = queue <= 0;
    el.queuePopoverClear.classList.toggle('hidden', queue <= 0);
    el.queuePopoverClear.setAttribute('aria-label', t('queuedUndoAll'));
    el.queuePopoverClear.title = t('queuedUndoAll');
  }
  if (el.queuePopoverClose) {
    el.queuePopoverClose.textContent = '×';
    el.queuePopoverClose.setAttribute('aria-label', t('close'));
    el.queuePopoverClose.title = t('close');
  }
  if (el.queuePopover) {
    if (queue <= 0) {
      el.queuePopover.classList.add('hidden');
    }
    el.queueChip.setAttribute('aria-expanded', queue > 0 && !el.queuePopover.classList.contains('hidden') ? 'true' : 'false');
  }
  renderQueuePopover(state.activeConversationId);

  if (el.metaModelValue) {
    const modelText = normalizeMetaValue(meta['模型']);
    const fallbackText = t('clickToFetch');
    el.metaModelValue.textContent = modelText || fallbackText;
  }
  if (el.btnMetaModel) {
    const modelText = normalizeMetaValue(meta['模型']);
    el.btnMetaModel.dataset.tooltip = modelText || t('refreshModel');
    el.btnMetaModel.setAttribute('aria-label', modelText || t('refreshModel'));
  }
  renderComposerWorkdir();
}

function renderRunButtons() {
  const hasConv = hasActiveConversation();
  const running = isConversationRunning(state.activeConversationId);
  const canInsert = running && hasConv;
  el.btnSend.disabled = !hasConv;
  el.btnSend.textContent = running ? t('queueSend') : t('send');
  el.btnInsertMessage.disabled = !canInsert;
  el.btnInsertMessage.textContent = t('insertMessage');
  el.btnInsertMessage.classList.remove('hidden');
  el.btnRetryLast.disabled = !canRetryLastMessage();
  el.btnRetryLast.textContent = t('retryLast');
  el.btnStop.textContent = t('stop');
  el.btnNewConv.textContent = t('newConversation');
  el.btnImportSession.textContent = t('importSession');
  el.btnExportSession.textContent = t('exportSession');
  el.btnRenameConv.textContent = t('renameConversation');
  el.btnCloseConv.textContent = t('closeCurrentConversation');
  el.btnClearChat.textContent = t('clearChat');
  el.btnClearRuntime.textContent = t('clearRuntime');
  el.btnToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  el.btnToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  if (el.qsToggleRuntime) {
    el.qsToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  }
  if (el.qsToggleSidebar) {
    el.qsToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  }
  el.qsLanguageOptions.forEach((node) => {
    const value = String(node.getAttribute('data-language-option') || '').trim();
    node.classList.toggle('active', value === currentLang());
  });
  if (el.qsRootThemeToggle && el.qsRootThemeSwitch) {
    const isDark = state.ui.theme === 'dark';
    el.qsRootThemeToggle.classList.toggle('active', isDark);
    el.qsRootThemeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    el.qsRootThemeToggle.setAttribute('aria-label', t('themeDark'));
    el.qsRootThemeSwitch.classList.toggle('active', isDark);
  }
  if (el.quickSettingsMenu) {
    const scopedActions = new Set([
      'conversation:rename',
      'conversation:close-current',
      'conversation:clear-chat',
      'conversation:clear-runtime',
      'conversation:export-session',
      'meta:refresh-codex-version',
      'meta:refresh-model',
    ]);
    Array.from(el.quickSettingsMenu.querySelectorAll<HTMLButtonElement>('button[data-action]')).forEach((node) => {
      const action = String(node.getAttribute('data-action') || '');
      if (action === 'conversation:retry-last') {
        node.disabled = !canRetryLastMessage();
        return;
      }
      if (action === 'conversation:stop') {
        node.disabled = !hasConv || !running;
        return;
      }
      if (scopedActions.has(action)) {
        node.disabled = !hasConv;
        return;
      }
      node.disabled = false;
    });
  }
  el.btnStop.disabled = !hasConv || !running;
  el.btnRenameConv.disabled = !hasConv;
  el.btnCloseConv.disabled = !hasConv;
  el.btnExportSession.disabled = !hasConv;
  el.btnClearChat.disabled = !hasConv;
  el.btnClearRuntime.disabled = !hasConv;
  if (el.btnMetaModel) {
    el.btnMetaModel.disabled = !hasConv;
  }
  if (el.btnAddAttachment) {
    el.btnAddAttachment.disabled = !hasConv;
  }
  if (el.attachmentInput) {
    el.attachmentInput.disabled = !hasConv;
  }
  el.inputBox.disabled = !hasConv;
  if (!hasConv) {
    el.inputBox.placeholder = t('inputPlaceholderNoConversation');
  } else if (running) {
    el.inputBox.placeholder = t('inputPlaceholderRunning');
  } else {
    el.inputBox.placeholder = t('inputPlaceholderIdle');
  }
}

function renderTabs() {
  el.tabButtons.forEach((btn) => {
    const tab = btn.getAttribute('data-tab');
    const active = tab === state.activeTab;
    btn.classList.toggle('active', active);
  });

  document.getElementById('tab-structured')?.classList.toggle('active', state.activeTab === 'structured');
  document.getElementById('tab-workflow')?.classList.toggle('active', state.activeTab === 'workflow');
  document.getElementById('tab-raw')?.classList.toggle('active', state.activeTab === 'raw');
}

function renderLayout() {
  el.contentRow.classList.toggle('runtime-hidden', state.ui.runtimePanelHidden);
  el.runtimePanel.classList.toggle('hidden', state.ui.runtimePanelHidden);
  el.appRoot.classList.toggle('sidebar-hidden', state.ui.sidebarHidden);
}

function applyLocalizedAttribute(attrName: string, keyAttrName: string) {
  Array.from(document.querySelectorAll<HTMLElement>(`[${keyAttrName}]`)).forEach((node) => {
    const key = node.getAttribute(keyAttrName);
    if (!key) {
      return;
    }
    node.setAttribute(attrName, t(key));
  });
}

function renderLocaleTexts() {
  document.documentElement.lang = currentLang();
  applyLocalizedAttribute('placeholder', 'data-i18n-placeholder-key');
  applyLocalizedAttribute('title', 'data-i18n-title-key');
  applyLocalizedAttribute('aria-label', 'data-i18n-aria-label-key');
  if (el.sidebarTitle) {
    el.sidebarTitle.textContent = t('sidebarTitle');
  }
  if (el.sidebarSearchInput) {
    el.sidebarSearchInput.placeholder = t('sidebarSearchPlaceholder');
    el.sidebarSearchInput.setAttribute('aria-label', t('sidebarSearchPlaceholder'));
  }
  if (el.btnSidebarNewConv) {
    el.btnSidebarNewConv.title = t('newConversation');
    el.btnSidebarNewConv.setAttribute('aria-label', t('newConversation'));
  }
  el.labelSessionId.textContent = t('sessionId');
  if (el.btnSessionId) {
    el.btnSessionId.dataset.copiedLabel = t('copySuccess');
  }
  el.labelPhase.textContent = t('status');
  el.labelQueue.textContent = t('queue');
  if (el.labelMetaModel) {
    el.labelMetaModel.textContent = t('modelShort');
  }
  if (el.labelQuickSettings) {
    el.labelQuickSettings.textContent = t('quickSettings');
  }
  if (el.labelRootThemeToggle) {
    el.labelRootThemeToggle.textContent = t('themeDark');
  }
  if (el.qsDeviceIdentityInput) {
    el.qsDeviceIdentityInput.placeholder = t('deviceIdentityPlaceholder');
  }
  if (el.qsTelegramBotTokenInput) {
    el.qsTelegramBotTokenInput.placeholder = state.settings.security?.hasMasterPassword && !state.settings.security?.unlocked
      ? t('securityLockedHint')
      : t('telegramBotTokenPlaceholder');
  }
  if (el.qsTelegramRemoteBotTokenInput) {
    el.qsTelegramRemoteBotTokenInput.placeholder = state.settings.security?.hasMasterPassword && !state.settings.security?.unlocked
      ? t('securityLockedHint')
      : t('telegramRemoteBotTokenPlaceholder');
  }
  if (el.qsTelegramChatIdInput) {
    el.qsTelegramChatIdInput.placeholder = t('telegramChatIdPlaceholder');
  }
  if (el.qsTelegramAllowedChatIdInput) {
    el.qsTelegramAllowedChatIdInput.placeholder = t('telegramAllowedChatIdPlaceholder');
  }
  if (el.qsSecurityUnlockInput) {
    el.qsSecurityUnlockInput.placeholder = t('securityUnlockPasswordPlaceholder');
  }
  if (el.qsSecurityNewPasswordInput) {
    el.qsSecurityNewPasswordInput.placeholder = t('securityNewPasswordPlaceholder');
  }
  if (el.qsSecurityConfirmPasswordInput) {
    el.qsSecurityConfirmPasswordInput.placeholder = t('securityConfirmPasswordPlaceholder');
  }
  if (el.labelCommand) {
    el.labelCommand.textContent = `${t('command')}:`;
  }
  if (el.labelWorkdir) {
    el.labelWorkdir.textContent = `${t('workdir')}:`;
  }
  if (el.labelComposerWorkdir) {
    el.labelComposerWorkdir.textContent = `${t('composerWorkdir')}:`;
  }
  if (el.labelPermission) {
    el.labelPermission.textContent = `${t('permission')}:`;
  }
  if (el.labelLanguage) {
    el.labelLanguage.textContent = `${t('language')}:`;
  }
  if (el.labelZoomFactor) {
    el.labelZoomFactor.textContent = t('appZoom');
  }
  el.labelFontSize.textContent = t('chatFontSize');
  el.tabBtnStructured.textContent = t('tabStructured');
  el.tabBtnWorkflow.textContent = t('tabWorkflow');
  el.tabBtnRaw.textContent = t('tabRaw');
  if (el.btnAddAttachment) {
    el.btnAddAttachment.textContent = t('addAttachment');
    el.btnAddAttachment.title = t('attachmentHint');
  }
  if (el.btnAddImageAttachment) {
    el.btnAddImageAttachment.textContent = t('attachmentTypeImage');
    el.btnAddImageAttachment.title = t('attachmentHint');
  }
  el.renameModalTitle.textContent = t('renameModalTitle');
  el.renameInput.placeholder = t('renameModalPlaceholder');
  el.renameCancel.textContent = t('cancel');
  el.renameConfirm.textContent = t('confirm');
  if (el.importModeTitle) {
    el.importModeTitle.textContent = t('importModeTitle');
  }
  if (el.importModeMessage) {
    el.importModeMessage.textContent = t('importModeMessage');
  }
  if (el.importModeResumeTitle) {
    el.importModeResumeTitle.textContent = t('importModeResumeTitle');
  }
  if (el.importModeResumeDesc) {
    el.importModeResumeDesc.textContent = t('importModeResumeDesc');
  }
  if (el.importModeForkTitle) {
    el.importModeForkTitle.textContent = t('importModeForkTitle');
  }
  if (el.importModeForkDesc) {
    el.importModeForkDesc.textContent = t('importModeForkDesc');
  }
  if (el.importModeCancel) {
    el.importModeCancel.textContent = t('cancel');
  }
  if (el.importModeConfirm) {
    el.importModeConfirm.textContent = t('importModeConfirm');
  }
  if (el.confirmCancel) {
    el.confirmCancel.textContent = t('cancel');
  }
  if (el.confirmAccept) {
    el.confirmAccept.textContent = t('close');
  }
  if (el.ctxNewConv) {
    el.ctxNewConv.textContent = t('contextMenuNew');
  }
  if (el.ctxImportConv) {
    el.ctxImportConv.textContent = t('contextMenuImport');
  }
  if (el.ctxExportConv) {
    el.ctxExportConv.textContent = t('contextMenuExport');
  }
  if (el.ctxRenameConv) {
    el.ctxRenameConv.textContent = t('contextMenuRename');
  }
  if (el.ctxPinConv) {
    el.ctxPinConv.textContent = t('contextMenuPin');
  }
  if (el.ctxCloseConv) {
    el.ctxCloseConv.textContent = t('contextMenuClose');
  }
  if (el.ctxCopySelection) {
    el.ctxCopySelection.textContent = t('copy');
  }
  if (Array.isArray(el.i18nNodes) && el.i18nNodes.length) {
    el.i18nNodes.forEach((node) => {
      const key = node.getAttribute('data-i18n-key');
      if (!key) {
        return;
      }
      node.textContent = t(key);
    });
  }
  if (el.labelAboutCodexVersion) {
    el.labelAboutCodexVersion.textContent = `${t('codexVersionShort')}:`;
  }
  if (el.qsDetailTitle) {
    const detailKey = el.qsDetailTitle.getAttribute('data-i18n-key');
    if (detailKey) {
      el.qsDetailTitle.textContent = t(detailKey);
    }
  }
  if (el.languageSelect.options.length >= 2) {
    el.languageSelect.options[0].text = t('languageZh');
    el.languageSelect.options[1].text = t('languageEn');
  }
}

export {
  renderCurrentTimeDisplay,
  renderHeader,
  renderRunButtons,
  renderTabs,
  renderLayout,
  renderLocaleTexts,
};
