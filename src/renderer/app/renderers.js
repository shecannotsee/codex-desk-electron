function renderConversationList() {
  const activeId = state.activeConversationId;
  if (!state.conversations.length) {
    el.conversationList.innerHTML = [
      `<div class="tip" style="padding:16px;">${escapeHtml(t('noConversation'))}</div>`,
      `<div class="tip" style="padding:0 16px 16px 16px;">${escapeHtml(t('clickNewConversation'))}</div>`,
    ].join('');
    return;
  }
  const html = sortedConversations()
    .map((item) => {
      const active = item.id === activeId ? ' active' : '';
      const status = getConversationState(item.id);
      const queue = queuedCount(item.id);
      const queueBadge = queue > 0 ? ` <span class="queue-badge">${escapeHtml(t('queueBadge', { count: queue }))}</span>` : '';
      const titleText = String(item.title || '-').trim();
      const avatarChar = titleText ? Array.from(titleText)[0] : '•';
      return [
        `<div class="conversation-item${active}" data-id="${escapeHtml(item.id)}">`,
        `<div class="conversation-avatar">${escapeHtml(avatarChar)}</div>`,
        '<div class="conversation-main">',
        `<div class="conversation-title-row">${escapeHtml(item.title || '-')}</div>`,
        '<div class="conversation-meta-row">',
        `<span class="conv-state-pill state-${escapeHtml(status.key)}">${escapeHtml(status.label)}</span>`,
        queueBadge,
        '</div>',
        '</div>',
        '</div>',
      ].join('');
    })
    .join('');
  el.conversationList.innerHTML = html;

  Array.from(el.conversationList.querySelectorAll('.conversation-item')).forEach((node) => {
    node.addEventListener('click', async () => {
      const id = node.getAttribute('data-id') || '';
      const snapshot = await codexdesk.switchConversation(id);
      applySnapshot(snapshot);
      renderAll();
    });
  });
}

function renderHeader() {
  const conv = currentConversation();
  const runtime = conv ? ensureRuntime(state.activeConversationId) : { startedAt: null };
  const meta = conv ? ensureMeta(state.activeConversationId) : { Codex版本: '-', 模型: '-', 会话ID: '-' };

  el.chatTitle.textContent = conv ? conv.title : '-';
  const sid = String(meta['会话ID'] || conv?.sessionId || '-').trim() || '-';
  if (sid && sid !== '-' && sid.length > 16) {
    el.sessionId.textContent = `${sid.slice(0, 8)}...${sid.slice(-6)}`;
  } else {
    el.sessionId.textContent = sid || '-';
  }
  if (el.btnSessionId) {
    el.btnSessionId.disabled = !sid || sid === '-';
    el.btnSessionId.dataset.fullValue = sid;
    el.btnSessionId.title = sid && sid !== '-' ? sid : '';
  }

  const phaseRaw = effectivePhaseRaw();
  el.phase.textContent = phaseLabel(phaseRaw);
  updatePhaseClass(phaseRaw);

  const queue = conv ? queuedCount(state.activeConversationId) : 0;
  el.queueCount.textContent = String(queue);
  el.queueChip.classList.toggle('queue-chip-active', queue > 0);

  const runningCurrent = conv && isConversationRunning(state.activeConversationId);
  if (runningCurrent) {
    el.busyIndicator.classList.remove('hidden');
    el.busyIndicator.textContent = queue > 0
      ? t('busyGeneratingWithQueue', { count: queue })
      : t('busyGenerating');
  } else {
    el.busyIndicator.classList.add('hidden');
    el.busyIndicator.textContent = t('busyGenerating');
  }

  if (runtime.startedAt && isConversationRunning(state.activeConversationId)) {
    el.elapsed.textContent = formatElapsed(Date.now() - Number(runtime.startedAt));
  } else {
    el.elapsed.textContent = '00:00';
  }

  if (el.metaVersionValue) {
    el.metaVersionValue.textContent = meta['Codex版本'] || '-';
    el.metaVersionValue.title = meta['Codex版本'] || '-';
  }
  if (el.metaModelValue) {
    el.metaModelValue.textContent = meta['模型'] || '-';
    el.metaModelValue.title = meta['模型'] || '-';
  }
}

function renderSettings() {
  if (el.commandInput) {
    el.commandInput.value = state.settings.commandText || '';
    el.commandInput.title = state.settings.commandText || '-';
  }
  if (el.workdirInput) {
    el.workdirInput.value = state.settings.workdir || '';
    el.workdirInput.title = state.settings.workdir || '-';
  }
  const perm = resolvePermissionSummary();
  if (el.permissionInput) {
    el.permissionInput.value = perm.text;
    el.permissionInput.title = perm.title;
  }
  el.languageSelect.value = currentLang();
  el.fontSizeRange.value = String(state.ui.chatFontSize);
  el.fontSizeValue.value = String(state.ui.chatFontSize);
}

function renderComposerDraft(options = {}) {
  if (!el.inputBox) {
    return;
  }
  const force = options.force === true;
  const draftKey = draftStorageKey(state.activeConversationId);
  const nextValue = getConversationDraft(state.activeConversationId);
  const bindingChanged = state.inputBindingConversationId !== draftKey;
  if (bindingChanged || force) {
    el.inputBox.value = nextValue;
  }
  state.inputBindingConversationId = draftKey;
}

function toMessageTimeMs(input) {
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  if (raw < 1e12) {
    return Math.round(raw * 1000);
  }
  return Math.round(raw);
}

function formatMessageTime(input) {
  const timeMs = toMessageTimeMs(input);
  if (!timeMs) {
    return '';
  }
  const dt = new Date(timeMs);
  if (Number.isNaN(dt.getTime())) {
    return '';
  }

  const now = new Date();
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');

  const isSameYear = yyyy === now.getFullYear();
  const isSameDay = isSameYear
    && dt.getMonth() === now.getMonth()
    && dt.getDate() === now.getDate();

  if (isSameDay) {
    return `${hh}:${mi}`;
  }
  if (isSameYear) {
    return `${mm}-${dd} ${hh}:${mi}`;
  }
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function resolveMessageTime(item, conversation, index) {
  const messageTs = toMessageTimeMs(item?.createdAt ?? item?.timestamp ?? item?.time);
  if (messageTs) {
    return formatMessageTime(messageTs);
  }
  const lastIndex = Math.max(0, Number(conversation?.messages?.length || 0) - 1);
  if (index >= lastIndex) {
    return formatMessageTime(conversation?.updatedAt);
  }
  return formatMessageTime(conversation?.createdAt);
}

function renderRunningHintBlock(conversationId) {
  if (!isConversationRunning(conversationId)) {
    return '';
  }
  return [
    '<div class="msg-block msg-assistant-row msg-running-row">',
    '<div class="msg-bubble msg-assistant msg-running-bubble">',
    '<div class="msg-running-dots" aria-hidden="true"><span></span><span></span><span></span></div>',
    '</div>',
    '</div>',
  ].join('');
}

function renderQueuedQuestionBlocks(conversationId) {
  const items = queuedMessages(conversationId);
  if (!items.length) {
    return '';
  }
  const blocks = items.map((item, index) => {
    const title = t('queuedQuestionItem', { index: index + 1 });
    const queuedAt = formatQueuedAt(item?.queuedAt);
    const text = String(item?.text || item?.preview || '').trim();
    return [
      '<div class="msg-block msg-user-row msg-queued-row">',
      '<div class="msg-head">',
      `<div class="msg-role">${escapeHtml(t('roleYou'))}</div>`,
      `<div class="msg-queued-tag">${escapeHtml(t('stateQueued'))}</div>`,
      '</div>',
      '<div class="msg-bubble msg-user msg-queued-bubble">',
      `<div class="msg-queued-title">${escapeHtml(title)} · ${escapeHtml(queuedAt)}</div>`,
      `<div class="msg-queued-text">${escapeHtml(text)}</div>`,
      '</div>',
      '</div>',
    ].join('');
  }).join('');

  return [
    '<div class="msg-queued-panel">',
    `<div class="msg-queued-panel-title">${escapeHtml(t('queuedQuestionsTitle'))}</div>`,
    `<div class="msg-queued-panel-hint">${escapeHtml(t('queuedQuestionsHint'))}</div>`,
    blocks,
    '</div>',
  ].join('');
}

function renderChat(stickToBottom = true) {
  const conv = currentConversation();
  if (!conv) {
    el.chatView.innerHTML = [
      `<div class="tip" style="margin-top:28px;">${escapeHtml(t('emptyChatTip1'))}</div>`,
      `<div class="tip">${escapeHtml(t('emptyChatTip2'))}</div>`,
      `<div class="tip">${escapeHtml(t('emptyChatTip3'))}</div>`,
    ].join('');
    return;
  }
  if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
    const queuedQuestionsHtml = renderQueuedQuestionBlocks(state.activeConversationId);
    const runningHintHtml = renderRunningHintBlock(state.activeConversationId);
    el.chatView.innerHTML = [
      `<div class="tip">${escapeHtml(t('noMessagesTip1'))}</div>`,
      `<div class="tip">${escapeHtml(t('noMessagesTip2'))}</div>`,
      queuedQuestionsHtml,
      runningHintHtml,
    ].join('');
    if (stickToBottom) {
      el.chatView.scrollTop = el.chatView.scrollHeight;
    }
    return;
  }

  cleanupCollapsed(state.activeConversationId, conv.messages.length);

  const blocks = conv.messages.map((item, index) => {
    const role = item.role === 'user' ? t('roleYou') : t('roleCodex');
    const bubbleClass = item.role === 'user'
      ? `msg-user${item?.interrupted ? ' msg-user-interrupted' : ''}`
      : 'msg-assistant';
    const collapsed = isMessageCollapsed(state.activeConversationId, index);
    const toggleText = collapsed ? t('expandMessage') : t('collapseMessage');
    const preview = messagePreview(item.text);
    const rowClass = item.role === 'user' ? 'msg-user-row' : 'msg-assistant-row';
    const timeText = resolveMessageTime(item, conv, index);
    return [
      `<div class="msg-block ${rowClass}">`,
      '<div class="msg-head">',
      `<div class="msg-role">${escapeHtml(role)}</div>`,
      `<button type="button" class="msg-toggle-collapse" data-msg-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
      '</div>',
      `<div class="msg-bubble ${bubbleClass}${collapsed ? ' collapsed' : ''}" data-msg-index="${escapeHtml(index)}">`,
      `<div class="msg-expanded">${renderMarkdownLike(item.text)}</div>`,
      `<div class="msg-collapsed-line">${escapeHtml(preview)}</div>`,
      `<div class="msg-time">${escapeHtml(timeText)}</div>`,
      '</div>',
      '</div>',
    ].join('');
  });

  const queuedQuestionsHtml = renderQueuedQuestionBlocks(state.activeConversationId);
  const runningHintHtml = renderRunningHintBlock(state.activeConversationId);
  el.chatView.innerHTML = `${blocks.join('')}${queuedQuestionsHtml}${runningHintHtml}`;
  Array.from(el.chatView.querySelectorAll('.msg-toggle-collapse')).forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const index = Number(btn.getAttribute('data-msg-index') || '-1');
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      const nextCollapsed = !isMessageCollapsed(state.activeConversationId, index);
      setMessageCollapsed(state.activeConversationId, index, nextCollapsed);
      renderChat(false);
    });
  });
  if (stickToBottom) {
    el.chatView.scrollTop = el.chatView.scrollHeight;
  }
}

function renderStructuredTab(runtime) {
  const html = runtime.events.map((item) => {
    const level = escapeHtml(item.level || 'info');
    const message = escapeHtml(localizeKnownText(item.message || ''));
    return [
      `<div class="runtime-event level-${level}">`,
      `<span class="ts">[${escapeHtml(item.timestamp || '--:--:--')}]</span> `,
      `<b>${escapeHtml(String(item.level || 'INFO').toUpperCase())}</b> `,
      `<span>${message}</span>`,
      '</div>',
    ].join('');
  }).join('');

  el.tabStructured.innerHTML = html;
  el.tabStructured.scrollTop = el.tabStructured.scrollHeight;
}

function formatQueuedAt(input) {
  const ts = Number(input);
  if (!Number.isFinite(ts) || ts <= 0) {
    return '--:--:--';
  }
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) {
    return '--:--:--';
  }
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function renderQueuedMessagesPanel(conversationId) {
  const items = queuedMessages(conversationId);
  if (!items.length) {
    return '';
  }
  const blocks = items.map((item, index) => {
    const title = t('queuedReplyItem', { index: index + 1 });
    const source = item?.fromRetry ? t('queuedFromRetry') : t('queuedFromInput');
    const queuedAt = formatQueuedAt(item?.queuedAt);
    const body = String(item?.text || item?.preview || '').trim();
    return [
      '<div class="queued-preview-item">',
      '<div class="queued-preview-item-head">',
      `<span class="title">${escapeHtml(title)}</span>`,
      `<span class="meta">${escapeHtml(source)} | ${escapeHtml(t('queuedAt'))} ${escapeHtml(queuedAt)}</span>`,
      '</div>',
      `<div class="queued-preview-item-body">${escapeHtml(body)}</div>`,
      '</div>',
    ].join('');
  }).join('');
  return [
    '<div class="queued-preview-panel">',
    `<div class="queued-preview-title">${escapeHtml(t('queuedRepliesTitle'))}</div>`,
    `<div class="queued-preview-hint">${escapeHtml(t('queuedRepliesHint'))}</div>`,
    blocks,
    '</div>',
  ].join('');
}

function renderWorkflowTab(runtime, stickToBottom = true) {
  const toggleWorkflowItem = (index) => {
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    const nextCollapsed = !isWorkflowStepCollapsed(state.activeConversationId, index);
    setWorkflowStepCollapsed(state.activeConversationId, index, nextCollapsed);
    renderWorkflowTab(runtime, false);
  };

  cleanupWorkflowCollapsed(state.activeConversationId, runtime.workflow.length);
  const workflowHtml = runtime.workflow.map((item, index) => {
    const collapsed = isWorkflowStepCollapsed(state.activeConversationId, index);
    const toggleText = collapsed ? t('expandMessage') : t('collapseMessage');
    if (item.type === 'round') {
      const previewText = String(item.preview || '').trim();
      const collapsedLine = `${t('question')} #${item.roundIndex} | ${messagePreview(previewText)}`;
      return [
        `<div class="runtime-step-round${collapsed ? ' collapsed' : ''}" data-wf-index="${escapeHtml(index)}">`,
        '<div class="runtime-step-round-head">',
        `<div class="title">${escapeHtml(t('question'))} #${escapeHtml(item.roundIndex)}</div>`,
        `<button type="button" class="runtime-step-toggle" data-wf-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
        '</div>',
        `<div class="preview">${escapeHtml(item.preview || '')}</div>`,
        `<div class="time">${escapeHtml(t('startTime'))} ${escapeHtml(item.timestamp || '--:--:--')}</div>`,
        `<div class="runtime-step-collapsed-line">${escapeHtml(collapsedLine)}</div>`,
        '</div>',
      ].join('');
    }

    const collapsedLine = messagePreview(localizeKnownText(item.body || ''));
    return [
      `<div class="runtime-step tag-${escapeHtml(item.tag || 'INFO')}${collapsed ? ' collapsed' : ''}" data-wf-index="${escapeHtml(index)}">`,
      '<div class="runtime-step-head">',
      `<span class="left">${escapeHtml(item.tag || 'INFO')} | ${escapeHtml(item.title || '')}</span>`,
      '<span class="right-group">',
      `<span class="right">${escapeHtml(item.timestamp || '--:--:--')}</span>`,
      `<button type="button" class="runtime-step-toggle" data-wf-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
      '</span>',
      '</div>',
      `<div class="runtime-step-body">${renderMarkdownLike(localizeKnownText(item.body || ''))}</div>`,
      `<div class="runtime-step-collapsed-line">${escapeHtml(collapsedLine)}</div>`,
      '</div>',
    ].join('');
  }).join('');
  const queueHtml = renderQueuedMessagesPanel(state.activeConversationId);
  const html = `${queueHtml}${workflowHtml}`;

  el.tabWorkflow.innerHTML = html;
  el.tabWorkflow.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const toggleBtn = target.closest('.runtime-step-toggle');
    if (toggleBtn) {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(toggleBtn.getAttribute('data-wf-index') || '-1');
      toggleWorkflowItem(index);
      return;
    }

    const clickable = target.closest('.runtime-step-head, .runtime-step-round-head, .runtime-step-collapsed-line, .runtime-step-round');
    if (!clickable) {
      return;
    }
    const container = clickable.closest('[data-wf-index]');
    if (!container) {
      return;
    }
    const index = Number(container.getAttribute('data-wf-index') || '-1');
    toggleWorkflowItem(index);
  };
  if (stickToBottom) {
    el.tabWorkflow.scrollTop = el.tabWorkflow.scrollHeight;
  }
}

function renderRawTab(runtime) {
  el.tabRaw.textContent = (runtime.raw || []).join('\n');
  el.tabRaw.scrollTop = el.tabRaw.scrollHeight;
}

function renderRuntime() {
  if (!hasActiveConversation()) {
    el.tabStructured.innerHTML = `<div class="tip">${escapeHtml(t('runtimeTipStructured'))}</div>`;
    el.tabWorkflow.innerHTML = `<div class="tip">${escapeHtml(t('runtimeTipWorkflow'))}</div>`;
    el.tabRaw.textContent = t('runtimeTipRaw');
    return;
  }
  const runtime = ensureRuntime(state.activeConversationId);
  renderStructuredTab(runtime);
  renderWorkflowTab(runtime);
  renderRawTab(runtime);
}

function renderRunButtons() {
  const hasConv = hasActiveConversation();
  const running = isConversationRunning(state.activeConversationId);
  el.btnSend.disabled = !hasConv;
  el.btnSend.textContent = running ? t('queueSend') : t('send');
  el.btnRetryLast.disabled = !canRetryLastMessage();
  el.btnRetryLast.textContent = t('retryLast');
  el.btnStop.textContent = t('stop');
  el.btnNewConv.textContent = t('newConversation');
  el.btnImportSession.textContent = t('importSession');
  el.btnRenameConv.textContent = t('renameConversation');
  el.btnCloseConv.textContent = t('closeCurrentConversation');
  el.btnClearChat.textContent = t('clearChat');
  el.btnClearRuntime.textContent = t('clearRuntime');
  el.btnToggleSettings.textContent = state.ui.settingsPanelHidden ? t('toggleSettingsShow') : t('toggleSettingsHide');
  el.btnToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  el.btnToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  if (el.qsToggleSettings) {
    el.qsToggleSettings.textContent = state.ui.settingsPanelHidden ? t('toggleSettingsShow') : t('toggleSettingsHide');
  }
  if (el.qsToggleRuntime) {
    el.qsToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  }
  if (el.qsToggleSidebar) {
    el.qsToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  }
  if (el.qsLangZh && el.qsLangEn) {
    const isZh = currentLang() === 'zh-CN';
    el.qsLangZh.classList.toggle('active', isZh);
    el.qsLangEn.classList.toggle('active', !isZh);
  }
  if (el.qsThemeLight && el.qsThemeDark) {
    const isDark = state.ui.theme === 'dark';
    el.qsThemeLight.classList.toggle('active', !isDark);
    el.qsThemeDark.classList.toggle('active', isDark);
  }
  if (el.quickSettingsMenu) {
    const scopedActions = new Set([
      'conversation:rename',
      'conversation:close-current',
      'conversation:clear-chat',
      'conversation:clear-runtime',
      'meta:refresh-codex-version',
      'meta:refresh-model',
    ]);
    Array.from(el.quickSettingsMenu.querySelectorAll('button[data-action]')).forEach((node) => {
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
  el.btnClearChat.disabled = !hasConv;
  el.btnClearRuntime.disabled = !hasConv;
  if (el.btnMetaVersion) {
    el.btnMetaVersion.disabled = !hasConv;
  }
  if (el.btnMetaModel) {
    el.btnMetaModel.disabled = !hasConv;
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

  document.getElementById('tab-structured').classList.toggle('active', state.activeTab === 'structured');
  document.getElementById('tab-workflow').classList.toggle('active', state.activeTab === 'workflow');
  document.getElementById('tab-raw').classList.toggle('active', state.activeTab === 'raw');
}

function renderLayout() {
  el.contentRow.classList.toggle('runtime-hidden', state.ui.runtimePanelHidden);
  el.runtimePanel.classList.toggle('hidden', state.ui.runtimePanelHidden);
  el.workspace.classList.toggle('settings-hidden', state.ui.settingsPanelHidden);
  el.appRoot.classList.toggle('sidebar-hidden', state.ui.sidebarHidden);
}

function renderLocaleTexts() {
  document.documentElement.lang = currentLang();
  if (el.sidebarTitle) {
    el.sidebarTitle.textContent = t('sidebarTitle');
  }
  el.labelSessionId.textContent = t('sessionId');
  el.labelPhase.textContent = t('status');
  el.labelQueue.textContent = t('queue');
  el.labelElapsed.textContent = t('elapsed');
  if (el.labelMetaVersion) {
    el.labelMetaVersion.textContent = t('codexVersionShort');
  }
  if (el.labelMetaModel) {
    el.labelMetaModel.textContent = t('modelShort');
  }
  if (el.labelQuickSettings) {
    el.labelQuickSettings.textContent = t('quickSettings');
  }
  if (el.labelCommand) {
    el.labelCommand.textContent = `${t('command')}:`;
  }
  if (el.labelWorkdir) {
    el.labelWorkdir.textContent = `${t('workdir')}:`;
  }
  if (el.labelPermission) {
    el.labelPermission.textContent = `${t('permission')}:`;
  }
  if (el.labelLanguage) {
    el.labelLanguage.textContent = `${t('language')}:`;
  }
  el.labelFontSize.textContent = `${t('chatFontSize')}:`;
  el.tabBtnStructured.textContent = t('tabStructured');
  el.tabBtnWorkflow.textContent = t('tabWorkflow');
  el.tabBtnRaw.textContent = t('tabRaw');
  el.renameModalTitle.textContent = t('renameModalTitle');
  el.renameInput.placeholder = t('renameModalPlaceholder');
  el.renameCancel.textContent = t('cancel');
  el.renameConfirm.textContent = t('confirm');
  if (el.ctxNewConv) {
    el.ctxNewConv.textContent = t('contextMenuNew');
  }
  if (el.ctxRenameConv) {
    el.ctxRenameConv.textContent = t('contextMenuRename');
  }
  if (el.ctxCloseConv) {
    el.ctxCloseConv.textContent = t('contextMenuClose');
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

function renderAll() {
  renderLocaleTexts();
  renderLayout();
  renderConversationList();
  renderSettings();
  renderHeader();
  renderChat();
  renderRuntime();
  renderRunButtons();
  renderComposerDraft();
  renderTabs();
}
