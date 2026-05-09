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
  if (state.workspaceMode === 'team') {
    el.composerWorkdir.classList.add('hidden');
    el.composerWorkdirValue.removeAttribute('data-open-path');
    el.composerWorkdirValue.removeAttribute('data-copy-text');
    el.composerWorkdirValue.removeAttribute('aria-label');
    return;
  }
  const conv = currentConversation();
  const workdir = String(conv?.workdir || '').trim();
  el.labelComposerWorkdir.textContent = `${t('composerWorkdir')}:`;
  el.composerWorkdir.classList.toggle('hidden', !workdir);
  el.composerWorkdirValue.textContent = workdir || '-';
  el.composerWorkdirValue.title = workdir || '-';
  if (workdir) {
    el.composerWorkdirValue.setAttribute('data-open-path', encodeURIComponent(workdir));
    el.composerWorkdirValue.setAttribute('data-copy-text', workdir);
    el.composerWorkdirValue.setAttribute('aria-label', `${t('composerWorkdir')}: ${workdir}`);
  } else {
    el.composerWorkdirValue.removeAttribute('data-open-path');
    el.composerWorkdirValue.removeAttribute('data-copy-text');
    el.composerWorkdirValue.removeAttribute('aria-label');
  }
}

function renderComposerAttachments() {
  if (!el.composerAttachments) {
    return;
  }
  if (state.workspaceMode === 'team') {
    el.composerAttachments.classList.add('hidden');
    el.composerAttachments.innerHTML = '';
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
  if (state.workspaceMode === 'team') {
    if (state.inputBindingConversationId !== '__agent_team__' || force) {
      el.inputBox.value = '';
    }
    state.inputBindingConversationId = '__agent_team__';
    renderComposerAttachments();
    return;
  }
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
