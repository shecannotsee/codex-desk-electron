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
      return [
        `<div class="conversation-item${active}" data-id="${escapeHtml(item.id)}">`,
        `<div class="conversation-title-row">${escapeHtml(item.title || '-')}</div>`,
        '<div class="conversation-meta-row">',
        `<span class="conv-state-pill state-${escapeHtml(status.key)}">${escapeHtml(status.label)}</span>`,
        queueBadge,
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

  el.chatTitle.textContent = `${t('chatTitlePrefix')}: ${conv ? conv.title : '-'}`;
  const sid = meta['会话ID'] || conv?.sessionId || '-';
  if (sid && sid !== '-' && sid.length > 16) {
    el.sessionId.textContent = `${sid.slice(0, 8)}...${sid.slice(-6)}`;
  } else {
    el.sessionId.textContent = sid || '-';
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

  el.modelMeta.textContent = t('modelMeta', {
    version: meta['Codex版本'] || '-',
    model: meta['模型'] || '-',
  });
}

function renderSettings() {
  el.commandInput.value = state.settings.commandText || '';
  el.workdirInput.value = state.settings.workdir || '';
  const perm = resolvePermissionSummary();
  el.permissionInput.value = perm.text;
  el.permissionInput.title = perm.title;
  el.languageSelect.value = currentLang();
  el.fontSizeRange.value = String(state.ui.chatFontSize);
  el.fontSizeValue.value = String(state.ui.chatFontSize);
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
    el.chatView.innerHTML = [
      `<div class="tip">${escapeHtml(t('noMessagesTip1'))}</div>`,
      `<div class="tip">${escapeHtml(t('noMessagesTip2'))}</div>`,
    ].join('');
    return;
  }

  cleanupCollapsed(state.activeConversationId, conv.messages.length);

  const blocks = conv.messages.map((item, index) => {
    const role = item.role === 'user' ? t('roleYou') : t('roleCodex');
    const bubbleClass = item.role === 'user' ? 'msg-user' : 'msg-assistant';
    const collapsed = isMessageCollapsed(state.activeConversationId, index);
    const toggleText = collapsed ? t('expandMessage') : t('collapseMessage');
    const preview = messagePreview(item.text);
    return [
      '<div class="msg-block">',
      '<div class="msg-head">',
      `<div class="msg-role">${escapeHtml(role)}</div>`,
      `<button type="button" class="msg-toggle-collapse" data-msg-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
      '</div>',
      `<div class="msg-bubble ${bubbleClass}${collapsed ? ' collapsed' : ''}" data-msg-index="${escapeHtml(index)}">`,
      `<div class="msg-expanded">${renderMarkdownLike(item.text)}</div>`,
      `<div class="msg-collapsed-line">${escapeHtml(preview)}</div>`,
      '</div>',
      '</div>',
    ].join('');
  });

  el.chatView.innerHTML = blocks.join('');
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

function renderWorkflowTab(runtime, stickToBottom = true) {
  cleanupWorkflowCollapsed(state.activeConversationId, runtime.workflow.length);
  const html = runtime.workflow.map((item, index) => {
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

  el.tabWorkflow.innerHTML = html;
  Array.from(el.tabWorkflow.querySelectorAll('.runtime-step-toggle')).forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const index = Number(btn.getAttribute('data-wf-index') || '-1');
      if (!Number.isInteger(index) || index < 0) {
        return;
      }
      const nextCollapsed = !isWorkflowStepCollapsed(state.activeConversationId, index);
      setWorkflowStepCollapsed(state.activeConversationId, index, nextCollapsed);
      renderWorkflowTab(runtime, false);
    });
  });
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
  el.btnRenameConv.textContent = t('renameConversation');
  el.btnCloseConv.textContent = t('closeCurrentConversation');
  el.btnRefreshVersion.textContent = t('refreshVersion');
  el.btnRefreshModel.textContent = t('refreshModel');
  el.btnClearChat.textContent = t('clearChat');
  el.btnClearRuntime.textContent = t('clearRuntime');
  el.btnToggleSettings.textContent = state.ui.settingsPanelHidden ? t('toggleSettingsShow') : t('toggleSettingsHide');
  el.btnToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  el.btnToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  el.btnStop.disabled = !hasConv || !running;
  el.btnRenameConv.disabled = !hasConv;
  el.btnCloseConv.disabled = !hasConv;
  el.btnClearChat.disabled = !hasConv;
  el.btnClearRuntime.disabled = !hasConv;
  el.btnRefreshVersion.disabled = !hasConv;
  el.btnRefreshModel.disabled = !hasConv;
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
  el.sidebarTitle.textContent = t('sidebarTitle');
  el.labelSessionId.textContent = t('sessionId');
  el.labelPhase.textContent = t('status');
  el.labelQueue.textContent = t('queue');
  el.labelElapsed.textContent = t('elapsed');
  el.labelCommand.textContent = `${t('command')}:`;
  el.labelWorkdir.textContent = `${t('workdir')}:`;
  el.labelPermission.textContent = `${t('permission')}:`;
  el.labelLanguage.textContent = `${t('language')}:`;
  el.labelFontSize.textContent = `${t('chatFontSize')}:`;
  el.tabBtnStructured.textContent = t('tabStructured');
  el.tabBtnWorkflow.textContent = t('tabWorkflow');
  el.tabBtnRaw.textContent = t('tabRaw');
  el.renameModalTitle.textContent = t('renameModalTitle');
  el.renameInput.placeholder = t('renameModalPlaceholder');
  el.renameCancel.textContent = t('cancel');
  el.renameConfirm.textContent = t('confirm');

  if (el.languageSelect.options.length >= 2) {
    el.languageSelect.options[0].text = currentLang() === 'zh-CN' ? '中文' : 'Chinese';
    el.languageSelect.options[1].text = currentLang() === 'zh-CN' ? '英文' : 'English';
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
  renderTabs();
}
