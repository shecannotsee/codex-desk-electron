import { codexdesk } from './codexdesk.js';
import {
  draftStorageKey,
  el,
  getComposerAttachments,
  localizeKnownText,
  setComposerAttachments,
  setConversationDraft,
  state,
} from './state_i18n.js';
import {
  addComposerAttachments,
  dragEventHasFiles,
  extractDroppedPaths,
  imageAttachmentsOnly,
  normalizeAttachmentFiles,
  removeComposerAttachment,
  setAttachmentMenuOpen,
} from './composer_attachments.js';
import { currentConversation } from './conversation_runtime.js';

function isClaudeConversation() {
  const conv = currentConversation();
  return String(conv?.provider || state.settings.provider || '').trim().toLowerCase() === 'claude';
}

type ComposerControllerOptions = {
  applySnapshot: (snapshot: unknown) => void;
  renderAll: () => void;
};

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
  // Drag/drop can blur the textarea, so the last remembered caret is used when live selection is unavailable.
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

export function bindComposerController(options: ComposerControllerOptions) {
  el.btnAddAttachment.addEventListener('click', () => {
    if (el.attachmentInput.disabled || isClaudeConversation()) {
      return;
    }
    const willOpen = el.attachmentKindMenu.classList.contains('hidden');
    setAttachmentMenuOpen(willOpen);
  });

  el.btnAddImageAttachment.addEventListener('click', () => {
    if (el.attachmentInput.disabled || isClaudeConversation()) {
      return;
    }
    setAttachmentMenuOpen(false);
    el.attachmentInput.click();
  });

  el.attachmentInput.addEventListener('change', () => {
    if (isClaudeConversation()) {
      el.attachmentInput.value = '';
      return;
    }
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
    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
  });

  el.btnInsertMessage.addEventListener('click', async () => {
    if (isClaudeConversation()) {
      return;
    }
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
    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
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
    // Dropped files are inserted as paths, while image attachments still go through the explicit picker.
    const paths = extractDroppedPaths(event.dataTransfer);
    if (!paths.length) {
      return;
    }
    insertTextIntoInputBox(paths.join('\n'));
  });

  el.inputBox.addEventListener('keydown', async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      el.btnSend.click();
    }
  });

  el.composerAttachments.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.composer-attachment-remove');
    if (!button) {
      return;
    }
    const index = Number(button.getAttribute('data-attachment-index') || '-1');
    removeComposerAttachment(index);
  });
}
