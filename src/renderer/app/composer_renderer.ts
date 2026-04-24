import type { ComposerRenderOptions } from './types.js';
import {
  draftStorageKey,
  el,
  escapeHtml,
  getComposerAttachments,
  getConversationDraft,
  state,
  t,
} from './state_i18n.js';
import { currentConversation } from './conversation_runtime.js';
import { renderAttachmentChips } from './chat_renderer.js';

function renderComposerWorkdir() {
  if (!el.composerWorkdir || !el.labelComposerWorkdir || !el.composerWorkdirValue) {
    return;
  }
  const conv = currentConversation();
  const workdir = String(conv?.workdir || '').trim();
  el.labelComposerWorkdir.textContent = `${t('composerWorkdir')}:`;
  el.composerWorkdir.classList.toggle('hidden', !workdir);
  el.composerWorkdirValue.textContent = workdir || '-';
  el.composerWorkdirValue.title = workdir || '-';
}

function renderComposerAttachments() {
  if (!el.composerAttachments) {
    return;
  }
  const items = getComposerAttachments(state.activeConversationId);
  el.composerAttachments.classList.toggle('hidden', items.length <= 0);
  el.composerAttachments.innerHTML = items.length
    ? [
      '<div class="composer-attachments-head">',
      `<span class="composer-attachments-title">${escapeHtml(t('attachmentCount', { count: items.length }))}</span>`,
      `<span class="composer-attachments-hint">${escapeHtml(t('attachmentHint'))}</span>`,
      '</div>',
      `<div class="composer-attachments-list">${renderAttachmentChips(items, true)}</div>`,
    ].join('')
    : '';
}

function renderComposerDraft(options: ComposerRenderOptions = {}) {
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
  renderComposerAttachments();
}

export {
  renderComposerWorkdir,
  renderComposerDraft,
};
