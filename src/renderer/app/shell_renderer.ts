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
import { currentAgentTeamGroup } from './agent_team.js';

function renderHeader() {
  renderCurrentTimeDisplay();
  if (state.workspaceMode === 'team') {
    const group = currentAgentTeamGroup();
    el.chatTitle.textContent = group?.name || t('agentTeamLabel');
    el.sessionId.textContent = group ? `${group.id.slice(0, 8)}...${group.id.slice(-4)}` : '-';
    if (el.btnSessionId) {
      el.btnSessionId.disabled = !group;
      el.btnSessionId.dataset.fullValue = group?.id || '';
      el.btnSessionId.dataset.tooltip = group ? t('clickToCopy') : '';
      el.btnSessionId.setAttribute('aria-label', group ? `${t('clickToCopy')}: ${group.id}` : t('sessionId'));
    }
    el.phase.textContent = t('stateIdle');
    updatePhaseClass('空闲');
    el.queueCount.textContent = '0';
    el.queueChip.classList.add('hidden');
    if (el.metaModelValue) {
      el.metaModelValue.textContent = t('agentTeamLabel');
    }
    if (el.btnMetaModel) {
      el.btnMetaModel.disabled = true;
    }
    renderComposerWorkdir();
    return;
  }
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
  if (state.workspaceMode === 'team') {
    const hasGroup = Boolean(currentAgentTeamGroup());
    el.btnSend.disabled = !hasGroup;
    el.btnSend.textContent = t('send');
    el.btnInsertMessage.classList.add('hidden');
    el.btnRetryLast.classList.add('hidden');
    el.btnStop.classList.add('hidden');
    el.btnAddTeamRole.classList.remove('hidden');
    el.btnAddTeamRole.disabled = !hasGroup;
    el.btnAddTeamRole.textContent = t('agentTeamAddRole');
    el.btnImportSession.disabled = true;
    el.btnExportSession.disabled = true;
    el.btnRenameConv.disabled = true;
    el.btnCloseConv.disabled = true;
    el.btnClearChat.disabled = !hasGroup;
    el.btnClearRuntime.disabled = !hasGroup;
    el.btnMetaModel.disabled = true;
    if (el.btnAddAttachment) {
      el.btnAddAttachment.disabled = true;
      el.btnAddAttachment.title = '';
    }
    if (el.attachmentInput) {
      el.attachmentInput.disabled = true;
    }
    if (el.btnAddImageAttachment) {
      el.btnAddImageAttachment.disabled = true;
      el.btnAddImageAttachment.title = '';
    }
    if (el.attachmentKindMenu) {
      el.attachmentKindMenu.classList.add('hidden');
      el.btnAddAttachment?.setAttribute('aria-expanded', 'false');
    }
    el.inputBox.disabled = !hasGroup;
    el.inputBox.placeholder = hasGroup ? t('agentTeamInputPlaceholder') : t('agentTeamEmptyTitle');
    return;
  }
  const hasConv = hasActiveConversation();
  const conv = currentConversation();
  const isClaudeConversation = String(conv?.provider || state.settings.provider || '').trim().toLowerCase() === 'claude';
  const running = isConversationRunning(state.activeConversationId);
  const canInsert = running && hasConv && !isClaudeConversation;
  const canUseAttachments = hasConv && !isClaudeConversation;
  el.btnSend.disabled = !hasConv;
  el.btnSend.textContent = running ? t('queueSend') : t('send');
  el.btnInsertMessage.disabled = !canInsert;
  el.btnInsertMessage.textContent = t('insertMessage');
  el.btnInsertMessage.title = isClaudeConversation ? t('insertUnavailableClaude') : '';
  el.btnInsertMessage.classList.remove('hidden');
  el.btnRetryLast.classList.remove('hidden');
  el.btnStop.classList.remove('hidden');
  el.btnAddTeamRole.classList.add('hidden');
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
    el.btnAddAttachment.disabled = !canUseAttachments;
    el.btnAddAttachment.title = isClaudeConversation ? t('attachmentUnavailableClaude') : t('attachmentHint');
  }
  if (el.attachmentInput) {
    el.attachmentInput.disabled = !canUseAttachments;
  }
  if (el.btnAddImageAttachment) {
    el.btnAddImageAttachment.disabled = !canUseAttachments;
    el.btnAddImageAttachment.title = isClaudeConversation ? t('attachmentUnavailableClaude') : t('attachmentHint');
  }
  if (isClaudeConversation && el.attachmentKindMenu) {
    el.attachmentKindMenu.classList.add('hidden');
    el.btnAddAttachment?.setAttribute('aria-expanded', 'false');
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
  const teamMode = state.workspaceMode === 'team';
  el.tabButtons.forEach((btn) => {
    const tab = btn.getAttribute('data-tab');
    const teamTab = btn.getAttribute('data-team-tab');
    const active = teamMode
      ? (teamTab || tab) === state.activeAgentTeamTab
      : tab === state.activeTab;
    btn.classList.toggle('active', active);
  });

  el.tabBtnStructured.classList.toggle('hidden', teamMode);
  el.tabBtnRaw.classList.toggle('hidden', teamMode);
  el.tabBtnTeamAdd.classList.toggle('hidden', !teamMode);
  el.tabBtnTeamRoles.classList.toggle('hidden', !teamMode);
  el.tabBtnTeamStatus.classList.toggle('hidden', !teamMode);
  document.getElementById('tab-structured')?.classList.toggle('active', !teamMode && state.activeTab === 'structured');
  document.getElementById('tab-workflow')?.classList.toggle('active', teamMode ? state.activeAgentTeamTab === 'workflow' : state.activeTab === 'workflow');
  document.getElementById('tab-raw')?.classList.toggle('active', !teamMode && state.activeTab === 'raw');
  el.tabTeamAdd.classList.toggle('active', teamMode && state.activeAgentTeamTab === 'add-role');
  el.tabTeamRoles.classList.toggle('active', teamMode && state.activeAgentTeamTab === 'roles');
  el.tabTeamStatus.classList.toggle('active', teamMode && state.activeAgentTeamTab === 'status');
}

function renderLayout() {
  el.contentRow.classList.toggle('runtime-hidden', state.ui.runtimePanelHidden);
  el.runtimePanel.classList.toggle('hidden', state.ui.runtimePanelHidden);
  el.appRoot.classList.toggle('sidebar-hidden', state.ui.sidebarHidden);
  el.appRoot.classList.toggle('agent-team-mode', state.workspaceMode === 'team');
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
    const newTitle = state.workspaceMode === 'team' ? t('agentTeamCreate') : t('newConversation');
    el.btnSidebarNewConv.title = newTitle;
    el.btnSidebarNewConv.setAttribute('aria-label', newTitle);
  }
  if (el.btnSidebarNewTeam) {
    const teamSwitchTitle = state.workspaceMode === 'team' ? t('agentTeamSwitchToConversations') : t('agentTeamSwitchToGroups');
    el.btnSidebarNewTeam.title = teamSwitchTitle;
    el.btnSidebarNewTeam.setAttribute('aria-label', teamSwitchTitle);
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
  el.tabBtnTeamAdd.textContent = t('agentTeamAddTab');
  el.tabBtnTeamRoles.textContent = t('agentTeamRoles');
  el.tabBtnTeamStatus.textContent = t('status');
  if (el.btnAddAttachment) {
    el.btnAddAttachment.textContent = t('addAttachment');
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
