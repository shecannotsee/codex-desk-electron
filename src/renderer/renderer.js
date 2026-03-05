/* global codexdesk */

const state = {
  settings: {
    commandText: '',
    workdir: '',
  },
  activeConversationId: '',
  conversations: [],
  runtimeByConversation: {},
  metaByConversation: {},
  runningConversationIds: new Set(),
  activeTab: 'structured',
};

const el = {
  conversationList: document.getElementById('conversation-list'),
  btnNewConv: document.getElementById('btn-new-conv'),
  btnRenameConv: document.getElementById('btn-rename-conv'),
  btnCloseConv: document.getElementById('btn-close-conv'),

  chatTitle: document.getElementById('chat-title'),
  sessionId: document.getElementById('session-id'),
  phase: document.getElementById('phase'),
  elapsed: document.getElementById('elapsed'),

  commandInput: document.getElementById('command-input'),
  workdirInput: document.getElementById('workdir-input'),
  modelMeta: document.getElementById('model-meta'),
  btnRefreshVersion: document.getElementById('btn-refresh-version'),
  btnRefreshModel: document.getElementById('btn-refresh-model'),

  btnClearChat: document.getElementById('btn-clear-chat'),
  btnClearRuntime: document.getElementById('btn-clear-runtime'),

  chatView: document.getElementById('chat-view'),
  tabStructured: document.getElementById('tab-structured'),
  tabWorkflow: document.getElementById('tab-workflow'),
  tabRaw: document.getElementById('tab-raw'),
  tabButtons: Array.from(document.querySelectorAll('.tab-btn')),

  inputBox: document.getElementById('input-box'),
  btnSend: document.getElementById('btn-send'),
  btnStop: document.getElementById('btn-stop'),

  renameModal: document.getElementById('rename-modal'),
  renameInput: document.getElementById('rename-input'),
  renameCancel: document.getElementById('rename-cancel'),
  renameConfirm: document.getElementById('rename-confirm'),
};

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInline(text) {
  const parts = String(text || '').split(/(`[^`]+`)/g);
  return parts.map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = escapeHtml(part.slice(1, -1));
      return `<code>${code}</code>`;
    }
    let escaped = escapeHtml(part);
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<a href='$2' target='_blank' rel='noreferrer'>$1</a>");
    escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    escaped = escaped.replace(/__([^_\n]+)__/g, '<b>$1</b>');
    escaped = escaped.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
    escaped = escaped.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<i>$1</i>');
    return escaped;
  }).join('');
}

function renderMarkdownFallback(text) {
  const lines = String(text || '').split(/\r?\n/);
  const result = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const stripped = String(line || '').trim();
    if (!stripped) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(stripped);
    if (heading) {
      const level = heading[1].length;
      result.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}$/.test(stripped)) {
      result.push('<hr/>');
      index += 1;
      continue;
    }

    if (stripped.startsWith('>')) {
      const quotes = [];
      while (index < lines.length && String(lines[index] || '').trim().startsWith('>')) {
        quotes.push(String(lines[index] || '').trim().slice(1).trim());
        index += 1;
      }
      result.push(`<blockquote>${quotes.map((item) => renderInline(item)).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*[-*+]\s+/, '').trim();
        items.push(`<li>${renderInline(item)}</li>`);
        index += 1;
      }
      result.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*\d+\.\s+/, '').trim();
        items.push(`<li>${renderInline(item)}</li>`);
        index += 1;
      }
      result.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const current = String(lines[index] || '');
      const currentStrip = current.trim();
      if (!currentStrip) {
        break;
      }
      if (/^(#{1,6})\s+/.test(currentStrip)) {
        break;
      }
      if (/^[-*_]{3,}$/.test(currentStrip)) {
        break;
      }
      if (currentStrip.startsWith('>')) {
        break;
      }
      if (/^\s*[-*+]\s+/.test(current)) {
        break;
      }
      if (/^\s*\d+\.\s+/.test(current)) {
        break;
      }
      paragraphLines.push(currentStrip);
      index += 1;
    }
    result.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
  }

  return result.join('');
}

function renderMarkdownLike(text) {
  const raw = String(text || '');
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let start = 0;
  let html = '';
  let match = null;

  while ((match = fencePattern.exec(raw)) !== null) {
    const normalPart = raw.slice(start, match.index);
    if (normalPart.trim()) {
      html += renderMarkdownFallback(normalPart);
    }

    const language = String(match[1] || '').trim() || 'code';
    const codeText = escapeHtml(String(match[2] || '').replace(/\n$/, ''));
    html += [
      '<div class="md-code-wrap">',
      `<div class="md-code-lang">${escapeHtml(language)}</div>`,
      `<pre><code>${codeText}</code></pre>`,
      '</div>',
    ].join('');
    start = fencePattern.lastIndex;
  }

  const tail = raw.slice(start);
  if (tail.trim() || !html) {
    html += renderMarkdownFallback(tail);
  }
  return html;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function sortedConversations() {
  return [...state.conversations].sort((a, b) => {
    const bu = Number(b.updatedAt || 0);
    const au = Number(a.updatedAt || 0);
    if (bu !== au) {
      return bu - au;
    }
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function currentConversation() {
  return state.conversations.find((item) => item.id === state.activeConversationId) || null;
}

function hasActiveConversation() {
  return Boolean(currentConversation());
}

function ensureRuntime(conversationId) {
  if (!state.runtimeByConversation[conversationId]) {
    state.runtimeByConversation[conversationId] = {
      workflow: [],
      events: [],
      raw: [],
      phase: '空闲',
      startedAt: null,
    };
  }
  return state.runtimeByConversation[conversationId];
}

function ensureMeta(conversationId) {
  if (!state.metaByConversation[conversationId]) {
    state.metaByConversation[conversationId] = {
      Codex版本: '-',
      模型: '-',
      会话ID: '-',
    };
  }
  return state.metaByConversation[conversationId];
}

function isConversationRunning(conversationId) {
  return state.runningConversationIds.has(conversationId);
}

function anyConversationRunning() {
  return state.runningConversationIds.size > 0;
}

function effectivePhase() {
  if (!hasActiveConversation()) {
    return anyConversationRunning() ? '后台运行中' : '空闲';
  }
  const runtime = ensureRuntime(state.activeConversationId);
  if (isConversationRunning(state.activeConversationId)) {
    return runtime.phase || '运行中';
  }
  if (anyConversationRunning()) {
    return '后台运行中';
  }
  return runtime.phase || '空闲';
}

function updatePhaseClass(phaseText) {
  el.phase.classList.remove('phase-idle', 'phase-running', 'phase-success', 'phase-error');
  if (phaseText.includes('失败')) {
    el.phase.classList.add('phase-error');
    return;
  }
  if (phaseText.includes('完成')) {
    el.phase.classList.add('phase-success');
    return;
  }
  if (['准备', '分析', '输出', '思考', '启动', '会话', '重连', '后台', '运行'].some((item) => phaseText.includes(item))) {
    el.phase.classList.add('phase-running');
    return;
  }
  el.phase.classList.add('phase-idle');
}

function renderConversationList() {
  const activeId = state.activeConversationId;
  if (!state.conversations.length) {
    el.conversationList.innerHTML = [
      '<div class="tip" style="padding:16px;">暂无会话</div>',
      '<div class="tip" style="padding:0 16px 16px 16px;">点一下上面的「新建对话」吧</div>',
    ].join('');
    return;
  }
  const html = sortedConversations()
    .map((item) => {
      const active = item.id === activeId ? ' active' : '';
      const runningBadge = isConversationRunning(item.id) ? ' <span style="color:#93c5fd;">●</span>' : '';
      return `<div class="conversation-item${active}" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title || '未命名对话')}${runningBadge}</div>`;
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

  el.chatTitle.textContent = `当前对话（活跃）: ${conv ? conv.title : '-'}`;
  const sid = meta['会话ID'] || conv?.sessionId || '-';
  if (sid && sid !== '-' && sid.length > 16) {
    el.sessionId.textContent = `${sid.slice(0, 8)}...${sid.slice(-6)}`;
  } else {
    el.sessionId.textContent = sid || '-';
  }

  const phase = effectivePhase();
  el.phase.textContent = phase;
  updatePhaseClass(phase);

  if (runtime.startedAt && isConversationRunning(state.activeConversationId)) {
    el.elapsed.textContent = formatElapsed(Date.now() - Number(runtime.startedAt));
  } else {
    el.elapsed.textContent = '00:00';
  }

  el.modelMeta.textContent = `Codex版本: ${meta['Codex版本'] || '-'} | 模型: ${meta['模型'] || '-'}`;
}

function renderSettings() {
  el.commandInput.value = state.settings.commandText || '';
  el.workdirInput.value = state.settings.workdir || '';
}

function renderChat() {
  const conv = currentConversation();
  if (!conv) {
    el.chatView.innerHTML = [
      '<div class="tip" style="margin-top:28px;">右侧安静了下来 ( •̀ ω •́ )✧</div>',
      '<div class="tip">还没有会话，快去左边点「新建对话」召唤我吧</div>',
      '<div class="tip">我已经把键盘和光标都准备好了</div>',
    ].join('');
    return;
  }
  if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
    el.chatView.innerHTML = [
      '<div class="tip">当前对话暂无消息</div>',
      '<div class="tip">可在左侧新建/切换会话，右侧标签查看运行细节</div>',
    ].join('');
    return;
  }

  const blocks = conv.messages.map((item) => {
    const role = item.role === 'user' ? 'You' : 'Codex';
    const bubbleClass = item.role === 'user' ? 'msg-user' : 'msg-assistant';
    return [
      '<div class="msg-block">',
      `<div class="msg-role">${escapeHtml(role)}</div>`,
      `<div class="msg-bubble ${bubbleClass}">${renderMarkdownLike(item.text)}</div>`,
      '</div>',
    ].join('');
  });

  el.chatView.innerHTML = blocks.join('');
  el.chatView.scrollTop = el.chatView.scrollHeight;
}

function renderStructuredTab(runtime) {
  const html = runtime.events.map((item) => {
    const level = escapeHtml(item.level || 'info');
    return [
      `<div class="runtime-event level-${level}">`,
      `<span class="ts">[${escapeHtml(item.timestamp || '--:--:--')}]</span> `,
      `<b>${escapeHtml(String(item.level || 'INFO').toUpperCase())}</b> `,
      `<span>${escapeHtml(item.message || '')}</span>`,
      '</div>',
    ].join('');
  }).join('');

  el.tabStructured.innerHTML = html;
  el.tabStructured.scrollTop = el.tabStructured.scrollHeight;
}

function renderWorkflowTab(runtime) {
  const html = runtime.workflow.map((item) => {
    if (item.type === 'round') {
      return [
        '<div class="runtime-step-round">',
        `<div class="title">问题 #${escapeHtml(item.roundIndex)}</div>`,
        `<div class="preview">${escapeHtml(item.preview || '')}</div>`,
        `<div class="time">开始时间 ${escapeHtml(item.timestamp || '--:--:--')}</div>`,
        '</div>',
      ].join('');
    }

    return [
      `<div class="runtime-step tag-${escapeHtml(item.tag || 'INFO')}">`,
      '<div class="runtime-step-head">',
      `<span class="left">${escapeHtml(item.tag || 'INFO')} | ${escapeHtml(item.title || '')}</span>`,
      `<span class="right">${escapeHtml(item.timestamp || '--:--:--')}</span>`,
      '</div>',
      `<div class="runtime-step-body">${renderMarkdownLike(item.body || '')}</div>`,
      '</div>',
    ].join('');
  }).join('');

  el.tabWorkflow.innerHTML = html;
  el.tabWorkflow.scrollTop = el.tabWorkflow.scrollHeight;
}

function renderRawTab(runtime) {
  el.tabRaw.textContent = (runtime.raw || []).join('\n');
  el.tabRaw.scrollTop = el.tabRaw.scrollHeight;
}

function renderRuntime() {
  if (!hasActiveConversation()) {
    el.tabStructured.innerHTML = '<div class="tip">这里会显示结构化事件，现在先休息一下</div>';
    el.tabWorkflow.innerHTML = '<div class="tip">这里会显示运行步骤，等你新建会话后马上开工</div>';
    el.tabRaw.textContent = '等待中：暂无会话';
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
  el.btnSend.disabled = !hasConv || running;
  el.btnStop.disabled = !hasConv || !running;
  el.btnRenameConv.disabled = !hasConv;
  el.btnCloseConv.disabled = !hasConv;
  el.btnClearChat.disabled = !hasConv;
  el.btnClearRuntime.disabled = !hasConv;
  el.btnRefreshVersion.disabled = !hasConv;
  el.btnRefreshModel.disabled = !hasConv;
  el.inputBox.disabled = !hasConv;
  if (!hasConv) {
    el.inputBox.placeholder = '先新建一个会话，然后开始聊天';
  } else {
    el.inputBox.placeholder = '输入消息，Ctrl+Enter 发送';
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

function renderAll() {
  renderConversationList();
  renderHeader();
  renderChat();
  renderRuntime();
  renderRunButtons();
  renderTabs();
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

async function syncSettings() {
  const snapshot = await codexdesk.updateSettings({
    commandText: el.commandInput.value,
    workdir: el.workdirInput.value,
  });
  applySnapshot(snapshot);
  renderAll();
}

async function init() {
  const snapshot = await codexdesk.getSnapshot();
  applySnapshot(snapshot);
  renderSettings();
  renderAll();

  codexdesk.onEvent((event) => {
    applyEvent(event);
  });

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
      window.alert('会话名称不能为空');
      return;
    }
    const next = await codexdesk.renameConversation(state.activeConversationId, title);
    if (next?.error) {
      window.alert(next.error);
      return;
    }
    applySnapshot(next);
    renderAll();
  });

  el.btnCloseConv.addEventListener('click', async () => {
    const conv = currentConversation();
    const title = String(conv?.title || '当前对话');
    const ok = window.confirm(`确认关闭对话「${title}」吗？`);
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
      window.alert(next.error);
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
      window.alert(next.error);
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
      window.alert(result.error);
    }
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnClearRuntime.addEventListener('click', async () => {
    const result = await codexdesk.clearRuntime(state.activeConversationId, false);
    if (result?.error) {
      window.alert(result.error);
    }
    applySnapshot(result?.snapshot || result);
    renderAll();
  });

  el.btnStop.addEventListener('click', async () => {
    const next = await codexdesk.stopConversation(state.activeConversationId);
    applySnapshot(next);
    renderAll();
  });

  el.btnSend.addEventListener('click', async () => {
    const text = el.inputBox.value.trim();
    if (!text) {
      return;
    }
    const result = await codexdesk.sendMessage(state.activeConversationId, text);
    if (result?.error) {
      window.alert(result.error);
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

  el.commandInput.addEventListener('blur', syncSettings);
  el.workdirInput.addEventListener('blur', syncSettings);

  setInterval(() => {
    renderHeader();
    renderRunButtons();
  }, 200);
}

init();
