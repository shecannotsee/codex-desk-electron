
import { codexdesk } from './codexdesk.js';
import type {
  AppEvent,
  AppSnapshot,
  CloseGuardPayload,
  ConfirmDialogOptions,
  ImportSessionPreview,
  MessageAttachment,
  ImportWorkdirChoice,
  RawEventEntry,
  RenderJobs,
  RuntimeEventItem,
  RuntimeState,
  ScheduleRenderOptions,
  WorkflowItem,
  ZoomOptions,
} from './types.js';
import {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_STEP,
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
  ensureChatVisibleCount,
  getComposerAttachments,
  increaseChatVisibleCount,
  loadDraftPrefs,
  loadUiPrefs,
  localizeKnownText,
  pruneComposerAttachments,
  pruneRuntimeVisibleCounts,
  syncChatVisibleCount,
  saveUiPrefs,
  setComposerAttachments,
  setChatFontSize,
  setConversationDraft,
  setRenderHooks,
  setRuntimePanelWidth,
  setSidebarWidth,
  setTheme,
  state,
  syncMenuLanguage,
  t,
  pruneChatVisibleCounts,
  pruneConversationDrafts,
} from './state_i18n.js';
import {
  currentConversation,
  ensureMeta,
  ensureRuntime,
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
  isChatViewNearBottom,
  renderAll,
  renderChat,
  renderComposerDraft,
  renderChatTransientPanels,
  renderHeader,
  renderLayout,
  renderLocaleTexts,
  renderConversationList,
  renderRawTab,
  renderRunButtons,
  renderRuntime,
  renderSettings,
  renderStructuredTab,
  renderTabs,
  renderQueuePopover,
  renderWorkflowTab,
  setRendererCallbacks,
} from './renderers.js';

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

function dragEventHasFiles(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes('Files');
}

function extractDroppedPaths(dataTransfer: DataTransfer | null | undefined): string[] {
  const seen = new Set<string>();
  const files = Array.from(dataTransfer?.files || []);
  files.forEach((file) => {
    const path = String(codexdesk.getPathForFile(file) || '').trim();
    if (path) {
      seen.add(path);
    }
  });
  return [...seen];
}

function normalizeAttachmentFiles(files: File[] = []): MessageAttachment[] {
  const seen = new Set<string>();
  return files.map((file): MessageAttachment | null => {
    const path = String(codexdesk.getPathForFile(file) || '').trim();
    if (!path || seen.has(path)) {
      return null;
    }
    seen.add(path);
    return {
      path,
      name: String(file.name || '').trim(),
      mimeType: String(file.type || '').trim(),
      size: Number(file.size || 0) || 0,
      kind: String(file.type || '').startsWith('image/') ? 'image' : '',
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function imageAttachmentsOnly(items: MessageAttachment[] = []): MessageAttachment[] {
  return items.filter((item) => {
    const mimeType = String(item?.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('image/')) {
      return true;
    }
    const path = String(item?.path || item?.name || '').trim().toLowerCase();
    return /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/.test(path);
  });
}

function addComposerAttachments(items: MessageAttachment[] = []) {
  const current = getComposerAttachments(state.activeConversationId);
  const merged = [...current];
  const seen = new Set(current.map((item) => String(item?.path || '').trim()).filter(Boolean));
  items.forEach((item) => {
    const path = String(item?.path || '').trim();
    if (!path || seen.has(path)) {
      return;
    }
    seen.add(path);
    merged.push(item);
  });
  setComposerAttachments(state.activeConversationId, merged);
  renderComposerDraft();
}

function removeComposerAttachment(index: number) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }
  const current = getComposerAttachments(state.activeConversationId);
  current.splice(index, 1);
  setComposerAttachments(state.activeConversationId, current);
  renderComposerDraft();
}

function setAttachmentMenuOpen(open: boolean) {
  if (!el.attachmentKindMenu || !el.btnAddAttachment) {
    return;
  }
  const expanded = Boolean(open);
  el.attachmentKindMenu.classList.toggle('hidden', !expanded);
  el.btnAddAttachment.setAttribute('aria-expanded', expanded ? 'true' : 'false');
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

function composerHeightBounds() {
  if (!el.inputBox) {
    return { min: 100, max: 420 };
  }
  const styles = window.getComputedStyle(el.inputBox);
  const min = Math.max(72, parseFloat(styles.minHeight) || el.inputBox.clientHeight || 100);
  const max = Math.max(min, parseFloat(styles.maxHeight) || Math.max(min, 420));
  return { min, max };
}

function clampComposerHeight(input: number) {
  const { min, max } = composerHeightBounds();
  const value = Number(input) || min;
  return Math.min(max, Math.max(min, value));
}

function isDuplicateRuntimeEvent(runtime: RuntimeState | null | undefined, item: RuntimeEventItem | null | undefined) {
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

function applySnapshot(snapshot: AppSnapshot | null | undefined) {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }

  state.settings = {
    commandText: snapshot.settings?.commandText || '',
    workdir: snapshot.settings?.workdir || '',
    defaultWorkdir: snapshot.settings?.defaultWorkdir || snapshot.settings?.workdir || '',
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
  Object.keys(state.messageMarkdownByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.messageMarkdownByConversation[id];
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
  pruneChatVisibleCounts([...validIds]);
  pruneRuntimeVisibleCounts([...validIds]);
  pruneConversationDrafts([...validIds]);
  pruneComposerAttachments([...validIds]);

  if (!state.activeConversationId && state.conversations.length) {
    state.activeConversationId = state.conversations[0].id;
  }
  state.conversations.forEach((conv) => {
    const total = Array.isArray(conv?.messages) ? conv.messages.length : 0;
    ensureChatVisibleCount(conv.id, total);
  });
}

function createRenderJobs(): RenderJobs {
  return {
    full: false,
    locale: false,
    layout: false,
    conversationList: false,
    settings: false,
    header: false,
    chat: false,
    chatTransient: false,
    runtime: false,
    runtimeStructured: false,
    runtimeWorkflow: false,
    runtimeRaw: false,
    runButtons: false,
    composer: false,
    tabs: false,
  };
}

let pendingRenderJobs = createRenderJobs();
let renderFlushScheduled = false;
let pendingStickChatToBottom = false;

function mergeRenderJobs(target: RenderJobs, source?: Partial<RenderJobs>) {
  if (!target || !source) {
    return;
  }
  (Object.keys(target) as Array<keyof RenderJobs>).forEach((key) => {
    if (source[key]) {
      target[key] = true;
    }
  });
}

function flushScheduledRender() {
  renderFlushScheduled = false;
  const jobs = pendingRenderJobs;
  const stickChatToBottom = pendingStickChatToBottom;
  pendingRenderJobs = createRenderJobs();
  pendingStickChatToBottom = false;

  if (jobs.full) {
    renderAll({ stickChatToBottom });
    return;
  }
  if (jobs.locale) {
    renderLocaleTexts();
  }
  if (jobs.layout) {
    renderLayout();
  }
  if (jobs.conversationList) {
    renderConversationList();
  }
  if (jobs.settings) {
    renderSettings();
  }
  if (jobs.header) {
    renderHeader();
  }
  if (jobs.chat) {
    renderChat(stickChatToBottom);
  } else if (jobs.chatTransient) {
    renderChatTransientPanels({ stickToBottom: stickChatToBottom });
  }
  if (jobs.runtime) {
    renderRuntime(stickChatToBottom);
  } else {
    if (!hasActiveConversation() && (jobs.runtimeStructured || jobs.runtimeWorkflow || jobs.runtimeRaw)) {
      renderRuntime(stickChatToBottom);
    } else {
      const runtime = hasActiveConversation() ? ensureRuntime(state.activeConversationId) : null;
      if (jobs.runtimeStructured && runtime && state.activeTab === 'structured') {
        renderStructuredTab(runtime);
      }
      if (jobs.runtimeWorkflow && runtime && state.activeTab === 'workflow') {
        renderWorkflowTab(runtime, stickChatToBottom);
      }
      if (jobs.runtimeRaw && runtime && state.activeTab === 'raw') {
        renderRawTab(runtime);
      }
    }
  }
  if (jobs.runButtons) {
    renderRunButtons();
  }
  if (jobs.composer) {
    renderComposerDraft();
  }
  if (jobs.tabs) {
    renderTabs();
  }
}

function scheduleRender(jobs: Partial<RenderJobs>, options: ScheduleRenderOptions = {}) {
  mergeRenderJobs(pendingRenderJobs, jobs);
  if (options.stickChatToBottom) {
    pendingStickChatToBottom = true;
  }
  if (renderFlushScheduled) {
    return;
  }
  renderFlushScheduled = true;
  window.requestAnimationFrame(flushScheduledRender);
}

function applyEvent(event: AppEvent | null | undefined) {
  if (!event || typeof event !== 'object') {
    return;
  }
  const stickChatToBottom = typeof isChatViewNearBottom === 'function'
    ? isChatViewNearBottom()
    : true;

  const id = String(event.conversationId || '');
  const isActiveConversation = Boolean(id) && id === state.activeConversationId;
  let renderJobs = createRenderJobs();
  switch (event.type) {
    case 'runtime-event-append': {
      const runtime = ensureRuntime(id);
      const runtimeItem = (event.item || {}) as RuntimeEventItem;
      if (!isDuplicateRuntimeEvent(runtime, runtimeItem)) {
        runtime.events.push(runtimeItem);
      }
      if (isActiveConversation && state.activeTab === 'structured') {
        renderJobs.runtimeStructured = true;
      }
      break;
    }
    case 'runtime-event-pop': {
      const runtime = ensureRuntime(id);
      const index = Number(event.index);
      if (Number.isInteger(index) && index >= 0 && index < runtime.events.length) {
        runtime.events.splice(index, 1);
      } else if (runtime.events.length) {
        runtime.events.pop();
      }
      if (isActiveConversation && state.activeTab === 'structured') {
        renderJobs.runtimeStructured = true;
      }
      break;
    }
    case 'runtime-workflow-append':
      ensureRuntime(id).workflow.push((event.item || {}) as WorkflowItem);
      if (isActiveConversation) {
        renderJobs.chatTransient = true;
        if (state.activeTab === 'workflow') {
          renderJobs.runtimeWorkflow = true;
        }
      }
      break;
    case 'runtime-workflow-pop': {
      const runtime = ensureRuntime(id);
      const index = Number(event.index);
      if (Number.isInteger(index) && index >= 0 && index < runtime.workflow.length) {
        runtime.workflow.splice(index, 1);
      } else if (runtime.workflow.length) {
        runtime.workflow.pop();
      }
      if (isActiveConversation) {
        renderJobs.chatTransient = true;
        if (state.activeTab === 'workflow') {
          renderJobs.runtimeWorkflow = true;
        }
      }
      break;
    }
    case 'runtime-raw-append':
      ensureRuntime(id).raw.push((event.line || '') as string | RawEventEntry);
      if (isActiveConversation && state.activeTab === 'raw') {
        renderJobs.runtimeRaw = true;
      }
      break;
    case 'runtime-phase':
      ensureRuntime(id).phase = String(event.phase || '');
      renderJobs.conversationList = true;
      if (isActiveConversation) {
        renderJobs.header = true;
        renderJobs.runButtons = true;
        renderJobs.chatTransient = true;
      }
      break;
    case 'runtime-started-at':
      ensureRuntime(id).startedAt = typeof event.startedAt === 'number' ? event.startedAt : null;
      if (isActiveConversation) {
        renderJobs.header = true;
      }
      break;
    case 'runtime-reset':
      state.runtimeByConversation[id] = {
        workflow: [],
        events: [],
        raw: [],
        phase: '空闲',
        startedAt: null,
      };
      renderJobs.conversationList = true;
      if (isActiveConversation) {
        renderJobs.header = true;
        renderJobs.runButtons = true;
        renderJobs.runtime = true;
        renderJobs.chatTransient = true;
      }
      break;
    case 'conversation-updated': {
      const conv = event.conversation;
      if (!conv || !conv.id) {
        break;
      }
      const idx = state.conversations.findIndex((item) => item.id === conv.id);
      const previousTotal = idx >= 0 && Array.isArray(state.conversations[idx]?.messages)
        ? state.conversations[idx].messages.length
        : 0;
      if (idx >= 0) {
        state.conversations[idx] = conv;
      } else {
        state.conversations.push(conv);
      }
      syncChatVisibleCount(conv.id, Array.isArray(conv.messages) ? conv.messages.length : 0, previousTotal);
      renderJobs.conversationList = true;
      if (conv.id === state.activeConversationId) {
        renderJobs.header = true;
        renderJobs.chat = true;
        renderJobs.runButtons = true;
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
      delete state.chatVisibleCountByConversation[id];
      setConversationDraft(id, '');
      state.runningConversationIds.delete(id);
      renderJobs.full = true;
      break;
    case 'meta-updated':
      ensureMeta(id)[String(event.key || '')] = String(event.value || '');
      if (isActiveConversation) {
        renderJobs.header = true;
      }
      break;
    case 'runner-state':
      if (event.running) {
        state.runningConversationIds.add(id);
      } else {
        state.runningConversationIds.delete(id);
      }
      renderJobs.conversationList = true;
      if (isActiveConversation) {
        renderJobs.header = true;
        renderJobs.runButtons = true;
        renderJobs.chatTransient = true;
      }
      break;
    case 'queue-updated':
      state.queuedCountByConversation[id] = Number(event.count || 0);
      if (Array.isArray(event.items)) {
        state.queuedMessagesByConversation[id] = event.items;
      } else if (Number(event.count || 0) <= 0) {
        state.queuedMessagesByConversation[id] = [];
      }
      renderJobs.conversationList = true;
      if (isActiveConversation) {
        renderJobs.header = true;
        renderJobs.runButtons = true;
        renderJobs.chatTransient = true;
        if (state.activeTab === 'workflow') {
          renderJobs.runtimeWorkflow = true;
        }
      }
      break;
    default:
      break;
  }
  scheduleRender(renderJobs, { stickChatToBottom });
}

function askRenameTitle(initialValue): Promise<string | null> {
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

function askCreateConversationWorkdir(): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = el.createConversationModal;
    const defaultInput = el.createConversationDefaultInput;
    const selectedInput = el.createConversationSelectedInput;
    const browseBtn = el.createConversationBrowse;
    const useDefaultBtn = el.createConversationUseDefault;
    const cancelBtn = el.createConversationCancel;
    const confirmBtn = el.createConversationConfirm;
    if (!modal || !defaultInput || !selectedInput || !browseBtn || !useDefaultBtn || !cancelBtn || !confirmBtn) {
      resolve('');
      return;
    }

    const defaultWorkdir = String(state.settings.defaultWorkdir || state.settings.workdir || '').trim();
    let selectedWorkdir = '';

    const syncSelectedInput = () => {
      selectedInput.value = selectedWorkdir;
      selectedInput.title = selectedWorkdir || defaultWorkdir || '-';
      useDefaultBtn.disabled = !selectedWorkdir;
    };

    defaultInput.value = defaultWorkdir;
    defaultInput.title = defaultWorkdir || '-';
    syncSelectedInput();
    modal.classList.remove('hidden');
    browseBtn.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      browseBtn.removeEventListener('click', onBrowse);
      useDefaultBtn.removeEventListener('click', onUseDefault);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      cleanup();
      resolve(selectedWorkdir);
    };

    const onUseDefault = () => {
      selectedWorkdir = '';
      syncSelectedInput();
    };

    const onBrowse = async () => {
      const result = await codexdesk.pickWorkdir({
        defaultPath: selectedWorkdir || defaultWorkdir,
      });
      if (result?.canceled) {
        return;
      }
      if (result?.error) {
        window.alert(localizeKnownText(result.error));
        return;
      }
      selectedWorkdir = String(result?.directoryPath || '').trim();
      syncSelectedInput();
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

    browseBtn.addEventListener('click', onBrowse);
    useDefaultBtn.addEventListener('click', onUseDefault);
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

function askConfirmDialog(options: ConfirmDialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = el.confirmModal;
    const titleEl = el.confirmModalTitle;
    const bodyEl = el.confirmModalBody;
    const cancelBtn = el.confirmCancel;
    const acceptBtn = el.confirmAccept;
    if (!modal || !titleEl || !bodyEl || !cancelBtn || !acceptBtn) {
      resolve(false);
      return;
    }

    titleEl.textContent = String(options.title || '');
    bodyEl.textContent = String(options.message || '');
    modal.classList.remove('hidden');
    cancelBtn.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      acceptBtn.removeEventListener('click', onAccept);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onAccept = () => {
      cleanup();
      resolve(true);
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
        onAccept();
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    acceptBtn.addEventListener('click', onAccept);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

function askImportSessionMode(importInfo: ImportSessionPreview = {}, preferredMode = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = el.importModeModal;
    const cancelBtn = el.importModeCancel;
    const confirmBtn = el.importModeConfirm;
    const fileEl = el.importModeFile;
    const sessionEl = el.importModeSession;
    const optionButtons = [el.importModeResume, el.importModeFork].filter(Boolean);
    if (!modal || !cancelBtn || !confirmBtn || !fileEl || !sessionEl || optionButtons.length < 2) {
      resolve(null);
      return;
    }

    let selectedMode = '';
    fileEl.textContent = t('importModeFile', { value: String(importInfo.filePath || '-') });
    sessionEl.textContent = t('importModeSession', { value: String(importInfo.sessionId || '-') });
    confirmBtn.disabled = true;
    optionButtons.forEach((button) => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
      optionButtons.forEach((button) => {
        button.removeEventListener('click', onOptionClick);
      });
    };

    const applySelection = (mode) => {
      selectedMode = mode;
      confirmBtn.disabled = !selectedMode;
      optionButtons.forEach((button) => {
        const active = button.getAttribute('data-mode') === selectedMode;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      if (!selectedMode) {
        return;
      }
      cleanup();
      resolve(selectedMode);
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
      if (event.key === 'Enter' && selectedMode) {
        event.preventDefault();
        onConfirm();
      }
    };

    const onOptionClick = (event) => {
      const target = event.currentTarget;
      if (!(target instanceof Element)) {
        return;
      }
      applySelection(String(target.getAttribute('data-mode') || ''));
    };

    modal.classList.remove('hidden');
    if (preferredMode === 'resume' || preferredMode === 'fork') {
      applySelection(preferredMode);
    }
    const preferredButton = optionButtons.find((button) => button.getAttribute('data-mode') === selectedMode);
    (preferredButton || optionButtons[0]).focus();

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
    optionButtons.forEach((button) => {
      button.addEventListener('click', onOptionClick);
    });
  });
}

function askImportSessionWorkdirMode(importInfo: ImportSessionPreview = {}): Promise<ImportWorkdirChoice | null> {
  return new Promise((resolve) => {
    const modal = el.importWorkdirModal;
    const fileEl = el.importWorkdirFile;
    const importedBtn = el.importWorkdirImported;
    const importedDesc = el.importWorkdirImportedDesc;
    const defaultBtn = el.importWorkdirDefault;
    const defaultDesc = el.importWorkdirDefaultDesc;
    const customBtn = el.importWorkdirCustom;
    const customDesc = el.importWorkdirCustomDesc;
    const customBrowseBtn = el.importWorkdirCustomBrowse;
    const cancelBtn = el.importWorkdirCancel;
    const confirmBtn = el.importWorkdirConfirm;
    if (!modal || !fileEl || !importedBtn || !importedDesc || !defaultBtn || !defaultDesc || !customBtn || !customDesc || !customBrowseBtn || !cancelBtn || !confirmBtn) {
      resolve({ mode: 'default' });
      return;
    }

    const importedCwd = String(importInfo.cwd || '').trim();
    const hasImportedWorkdir = Boolean(importInfo.hasImportedWorkdir && importedCwd);
    const defaultWorkdir = String(state.settings.defaultWorkdir || '').trim();
    let selectedMode = 'default';
    let customWorkdir = '';

    fileEl.textContent = t('importWorkdirFile', { value: String(importInfo.filePath || '-') });
    importedDesc.textContent = hasImportedWorkdir
      ? t('importWorkdirImportedDesc', { value: importedCwd })
      : t('importWorkdirImportedUnavailable');
    importedDesc.title = importedCwd;
    defaultDesc.textContent = t('importWorkdirDefaultDesc', { value: defaultWorkdir || '-' });
    defaultDesc.title = defaultWorkdir || '-';
    customDesc.textContent = t('importWorkdirCustomUnset');
    customDesc.title = '';
    importedBtn.disabled = !hasImportedWorkdir;

    const updateConfirmState = () => {
      confirmBtn.disabled = selectedMode === 'custom' && !customWorkdir;
    };

    const syncCustomDesc = () => {
      const text = customWorkdir || t('importWorkdirCustomUnset');
      customDesc.textContent = customWorkdir
        ? t('importWorkdirCustomDesc', { value: customWorkdir })
        : text;
      customDesc.title = customWorkdir;
      updateConfirmState();
    };

    const applySelection = (mode: string) => {
      let nextMode = 'default';
      if (mode === 'imported' && hasImportedWorkdir) {
        nextMode = 'imported';
      } else if (mode === 'custom') {
        nextMode = 'custom';
      }
      selectedMode = nextMode;
      importedBtn.classList.toggle('is-selected', nextMode === 'imported');
      importedBtn.setAttribute('aria-pressed', nextMode === 'imported' ? 'true' : 'false');
      defaultBtn.classList.toggle('is-selected', nextMode === 'default');
      defaultBtn.setAttribute('aria-pressed', nextMode === 'default' ? 'true' : 'false');
      customBtn.classList.toggle('is-selected', nextMode === 'custom');
      customBtn.setAttribute('aria-pressed', nextMode === 'custom' ? 'true' : 'false');
      updateConfirmState();
    };

    syncCustomDesc();
    applySelection('default');
    modal.classList.remove('hidden');
    defaultBtn.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      importedBtn.removeEventListener('click', onImported);
      defaultBtn.removeEventListener('click', onDefault);
      customBtn.removeEventListener('click', onCustom);
      customBrowseBtn.removeEventListener('click', onBrowseCustom);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onImported = () => {
      applySelection('imported');
    };

    const onDefault = () => {
      applySelection('default');
    };

    const onCustom = () => {
      applySelection('custom');
    };

    const onBrowseCustom = async () => {
      const result = await codexdesk.pickWorkdir({
        defaultPath: customWorkdir || importedCwd || defaultWorkdir,
      });
      if (result?.canceled) {
        return;
      }
      if (result?.error) {
        window.alert(localizeKnownText(result.error));
        return;
      }
      customWorkdir = String(result?.directoryPath || '').trim();
      syncCustomDesc();
      if (customWorkdir) {
        applySelection('custom');
      }
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      if (selectedMode === 'custom' && !customWorkdir) {
        return;
      }
      cleanup();
      resolve({
        mode: selectedMode,
        workdir: selectedMode === 'custom' ? customWorkdir : '',
      });
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

    importedBtn.addEventListener('click', onImported);
    defaultBtn.addEventListener('click', onDefault);
    customBtn.addEventListener('click', onCustom);
    customBrowseBtn.addEventListener('click', onBrowseCustom);
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

function resolvePreferredImportContinuationMode(importInfo: ImportSessionPreview = {}, workdirChoice: ImportWorkdirChoice | null | undefined): string {
  const importedCwd = String(importInfo.cwd || '').trim();
  const selectedMode = String(workdirChoice?.mode || 'default').trim() || 'default';
  const selectedWorkdir = String(workdirChoice?.workdir || '').trim();
  const defaultWorkdir = String(state.settings.defaultWorkdir || '').trim();

  let resolvedWorkdir = defaultWorkdir;
  if (selectedMode === 'imported') {
    resolvedWorkdir = importedCwd;
  } else if (selectedMode === 'custom') {
    resolvedWorkdir = selectedWorkdir;
  }

  if (!importedCwd) {
    return selectedMode === 'imported' ? 'resume' : 'fork';
  }
  return resolvedWorkdir && resolvedWorkdir === importedCwd ? 'resume' : 'fork';
}

function hideCloseGuardModal() {
  if (!el.closeGuardModal) {
    return;
  }
  el.closeGuardModal.classList.add('hidden');
  if (el.closeGuardCancel) {
    el.closeGuardCancel.disabled = false;
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.disabled = false;
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.disabled = false;
  }
}

function showCloseGuardModal(payload: CloseGuardPayload = {}) {
  if (!el.closeGuardModal) {
    return;
  }
  if (el.closeGuardTitle) {
    el.closeGuardTitle.textContent = String(payload.title || t('closeGuardTitle'));
  }
  if (el.closeGuardMessage) {
    el.closeGuardMessage.textContent = String(payload.message || '');
  }
  if (el.closeGuardDetail) {
    el.closeGuardDetail.textContent = String(payload.detail || t('closeGuardDetail'));
  }
  if (el.closeGuardCancel) {
    el.closeGuardCancel.textContent = String(payload.cancelLabel || t('closeGuardCancel'));
    el.closeGuardCancel.disabled = false;
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.textContent = String(payload.stopAndCloseLabel || t('closeGuardStopAndClose'));
    el.closeGuardStop.disabled = false;
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.textContent = String(payload.forceCloseLabel || t('closeGuardForceClose'));
    el.closeGuardForce.disabled = false;
  }
  el.closeGuardModal.classList.remove('hidden');
  if (el.closeGuardCancel) {
    el.closeGuardCancel.focus();
  }
}

async function resolveCloseGuardAction(action) {
  const nextAction = String(action || '').trim();
  if (!nextAction) {
    return;
  }
  if (el.closeGuardCancel) {
    el.closeGuardCancel.disabled = true;
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.disabled = true;
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.disabled = true;
  }
  try {
    await codexdesk.resolveCloseGuard(nextAction);
    if (nextAction === 'cancel') {
      hideCloseGuardModal();
    }
  } catch {
    hideCloseGuardModal();
  }
}

async function setAppZoomFactor(input: number | string, options: ZoomOptions = {}) {
  const persist = options.persist !== false;
  const rerenderControls = options.rerenderControls !== false;
  const next = clampAppZoom(input, state.ui.zoomFactor);
  if (!codexdesk || typeof codexdesk.setZoomFactor !== 'function') {
    return next;
  }
  const result = await codexdesk.setZoomFactor(next);
  if (result?.error) {
    throw new Error(result.error);
  }
  state.ui.zoomFactor = clampAppZoom(result?.zoomFactor, next);
  if (persist) {
    saveUiPrefs();
  }
  if (rerenderControls) {
    renderSettings();
  }
  return state.ui.zoomFactor;
}

function currentAppZoomPercent() {
  return Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100);
}

function syncZoomControls(percent) {
  const nextPercent = Math.round(Number(percent) || currentAppZoomPercent());
  if (el.zoomFactorRange) {
    el.zoomFactorRange.value = String(nextPercent);
  }
  if (el.zoomFactorValue) {
    el.zoomFactorValue.textContent = `${nextPercent}%`;
  }
}

let quickSettingsAutoHideLockUntil = 0;
let zoomHudHideTimer = 0;

function showZoomHud(percent) {
  if (!el.zoomHud) {
    return;
  }
  const nextPercent = Math.round(Number(percent) || currentAppZoomPercent());
  el.zoomHud.textContent = `${nextPercent}%`;
  el.zoomHud.classList.remove('zoom-hud-visible');
  window.clearTimeout(zoomHudHideTimer);
  window.requestAnimationFrame(() => {
    el.zoomHud.classList.add('zoom-hud-visible');
  });
  zoomHudHideTimer = window.setTimeout(() => {
    el.zoomHud.classList.remove('zoom-hud-visible');
  }, 900);
}

function lockQuickSettingsAutoHide(durationMs = 260) {
  quickSettingsAutoHideLockUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
}

function shouldKeepQuickSettingsOpen() {
  return Date.now() < quickSettingsAutoHideLockUntil;
}

async function init() {
  setRenderHooks({
    renderAll,
    renderSettings,
  });
  setRendererCallbacks({
    onConversationSelected: async (id: string) => {
      const snapshot = await codexdesk.switchConversation(id);
      applySnapshot(snapshot);
      renderAll({ stickChatToBottom: true });
    },
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
    const targetConversation = state.conversations.find((item) => item.id === contextMenuConversationId) || null;
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

  const hideQueuePopover = () => {
    if (!el.queuePopover || !el.queueChip) {
      return;
    }
    el.queuePopover.classList.add('hidden');
    el.queueChip.setAttribute('aria-expanded', 'false');
  };

  const showQueuePopover = () => {
    if (!el.queuePopover || !el.queueChip) {
      return;
    }
    if (Number(state.queuedCountByConversation[state.activeConversationId] || 0) <= 0) {
      hideQueuePopover();
      return;
    }
    renderQueuePopover(state.activeConversationId);
    el.queuePopover.classList.remove('hidden');
    el.queueChip.setAttribute('aria-expanded', 'true');
  };

  const toggleQueuePopover = () => {
    if (!el.queuePopover || el.queueChip.classList.contains('hidden')) {
      return;
    }
    if (el.queuePopover.classList.contains('hidden')) {
      showQueuePopover();
      return;
    }
    hideQueuePopover();
  };

  const switchConversationIfNeeded = async (conversationId) => {
    const targetId = String(conversationId || '').trim();
    if (!targetId || targetId === state.activeConversationId) {
      return;
    }
    const snapshot = await codexdesk.switchConversation(targetId);
    applySnapshot(snapshot);
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

  if (el.queueChip) {
    el.queueChip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleQueuePopover();
    });
  }
  if (el.queuePopoverClose) {
    el.queuePopoverClose.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideQueuePopover();
    });
  }

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
    if (action === 'ui:theme:toggle') {
      setTheme(state.ui.theme === 'dark' ? 'light' : 'dark');
      return;
    }
    if (action === 'help:about') {
      showAboutModal();
      return;
    }
    if (action === 'view:zoom-reset') {
      lockQuickSettingsAutoHide(360);
      const applied = await setAppZoomFactor(APP_ZOOM_DEFAULT, { rerenderControls: false });
      const percent = Math.round(applied * 100);
      syncZoomControls(percent);
      showZoomHud(percent);
      return;
    }
    if (action === 'view:zoom-in') {
      lockQuickSettingsAutoHide(360);
      const applied = await setAppZoomFactor(state.ui.zoomFactor + APP_ZOOM_STEP, { rerenderControls: false });
      const percent = Math.round(applied * 100);
      syncZoomControls(percent);
      showZoomHud(percent);
      return;
    }
    if (action === 'view:zoom-out') {
      lockQuickSettingsAutoHide(360);
      const applied = await setAppZoomFactor(state.ui.zoomFactor - APP_ZOOM_STEP, { rerenderControls: false });
      const percent = Math.round(applied * 100);
      syncZoomControls(percent);
      showZoomHud(percent);
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
        setQuickSettingsPane('root');
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
    hideQuickSettingsMenu();
  });

  window.addEventListener('blur', () => {
    hideChatContextMenu();
    hideConversationContextMenu();
    hideQueuePopover();
    if (!shouldKeepQuickSettingsOpen()) {
      hideQuickSettingsMenu();
    }
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

  let resizingRuntimePanel = false;
  let runtimeResizeStartX = 0;
  let runtimeResizeStartWidth = state.ui.runtimePanelWidth;
  const onRuntimePanelPointerMove = (event) => {
    if (!resizingRuntimePanel || state.ui.runtimePanelHidden) {
      return;
    }
    const delta = Number(event.clientX || 0) - runtimeResizeStartX;
    setRuntimePanelWidth(runtimeResizeStartWidth - delta, { persist: false });
  };
  const stopRuntimePanelResize = () => {
    if (!resizingRuntimePanel) {
      return;
    }
    resizingRuntimePanel = false;
    document.body.classList.remove('sidebar-resizing');
    saveUiPrefs();
    window.removeEventListener('pointermove', onRuntimePanelPointerMove);
    window.removeEventListener('pointerup', stopRuntimePanelResize);
    window.removeEventListener('pointercancel', stopRuntimePanelResize);
  };
  if (el.runtimeResizer) {
    el.runtimeResizer.addEventListener('pointerdown', (event) => {
      if (state.ui.runtimePanelHidden || window.innerWidth <= 1200) {
        return;
      }
      event.preventDefault();
      resizingRuntimePanel = true;
      runtimeResizeStartX = Number(event.clientX || 0);
      runtimeResizeStartWidth = state.ui.runtimePanelWidth;
      document.body.classList.add('sidebar-resizing');
      if (typeof el.runtimeResizer.setPointerCapture === 'function') {
        try {
          el.runtimeResizer.setPointerCapture(event.pointerId);
        } catch {
          // ignore capture failures
        }
      }
      window.addEventListener('pointermove', onRuntimePanelPointerMove);
      window.addEventListener('pointerup', stopRuntimePanelResize);
      window.addEventListener('pointercancel', stopRuntimePanelResize);
    });
  }

  let resizingComposer = false;
  let composerResizeStartY = 0;
  let composerResizeStartHeight = 0;
  const onComposerPointerMove = (event) => {
    if (!resizingComposer || !el.inputBox || el.inputBox.disabled) {
      return;
    }
    const delta = Number(event.clientY || 0) - composerResizeStartY;
    el.inputBox.style.height = `${clampComposerHeight(composerResizeStartHeight - delta)}px`;
  };
  const stopComposerResize = () => {
    if (!resizingComposer) {
      return;
    }
    resizingComposer = false;
    document.body.classList.remove('composer-resizing');
    window.removeEventListener('pointermove', onComposerPointerMove);
    window.removeEventListener('pointerup', stopComposerResize);
    window.removeEventListener('pointercancel', stopComposerResize);
  };
  if (el.composerResizeHandle) {
    el.composerResizeHandle.addEventListener('pointerdown', (event) => {
      if (!el.inputBox || el.inputBox.disabled) {
        return;
      }
      event.preventDefault();
      resizingComposer = true;
      composerResizeStartY = Number(event.clientY || 0);
      composerResizeStartHeight = el.inputBox.getBoundingClientRect().height;
      document.body.classList.add('composer-resizing');
      if (typeof el.composerResizeHandle?.setPointerCapture === 'function') {
        try {
          el.composerResizeHandle.setPointerCapture(event.pointerId);
        } catch {
          // ignore capture failures
        }
      }
      window.addEventListener('pointermove', onComposerPointerMove);
      window.addEventListener('pointerup', stopComposerResize);
      window.addEventListener('pointercancel', stopComposerResize);
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
    syncMenuLanguage();
  });

  if (el.zoomFactorRange) {
    el.zoomFactorRange.addEventListener('input', () => {
      const nextPercent = Math.round(Number(el.zoomFactorRange.value || currentAppZoomPercent()));
      syncZoomControls(nextPercent);
      lockQuickSettingsAutoHide();
      setAppZoomFactor(nextPercent / 100, { persist: false, rerenderControls: false }).catch(() => {
        syncZoomControls(currentAppZoomPercent());
      });
    });

    el.zoomFactorRange.addEventListener('change', () => {
      const nextPercent = Math.round(Number(el.zoomFactorRange.value || currentAppZoomPercent()));
      lockQuickSettingsAutoHide(360);
      setAppZoomFactor(nextPercent / 100, { rerenderControls: false }).then((applied) => {
        syncZoomControls(Math.round(applied * 100));
      }).catch(() => {
        syncZoomControls(currentAppZoomPercent());
      });
    });
  }

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
