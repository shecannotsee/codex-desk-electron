import { codexdesk } from './codexdesk.js';
import {
  el,
  localizeKnownText,
  state,
  t,
} from './state_i18n.js';
import { renderQueuePopover } from './renderers.js';
import { showAppNotice } from './app_notice.js';

export function hideQueuePopover() {
  if (!el.queuePopover || !el.queueChip) {
    return;
  }
  el.queuePopover.classList.add('hidden');
  el.queueChip.setAttribute('aria-expanded', 'false');
}

export function showQueuePopover() {
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
}

export function toggleQueuePopover() {
  if (!el.queuePopover || el.queueChip.classList.contains('hidden')) {
    return;
  }
  if (el.queuePopover.classList.contains('hidden')) {
    showQueuePopover();
    return;
  }
  hideQueuePopover();
}

export function bindQueuePopover() {
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
  if (el.queuePopoverClear) {
    el.queuePopoverClear.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const conversationId = state.activeConversationId;
      if (!conversationId) {
        return;
      }
      el.queuePopoverClear.disabled = true;
      codexdesk.cancelAllQueuedMessages(conversationId).then((result) => {
        if (result?.error) {
          showAppNotice(localizeKnownText(String(result.error || '')), 'error');
          el.queuePopoverClear.disabled = false;
          return;
        }
        showAppNotice(t('queuedUndoAll'), 'info');
      }).catch((error) => {
        el.queuePopoverClear.disabled = false;
        showAppNotice(localizeKnownText(error?.message || String(error)), 'error');
      });
    });
  }
  if (el.queuePopoverBody) {
    el.queuePopoverBody.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('.queued-preview-item-remove');
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const conversationId = state.activeConversationId;
      if (!conversationId) {
        return;
      }
      const queuedMessageId = String(button.getAttribute('data-queued-message-id') || '').trim();
      const queuedIndex = Number(button.getAttribute('data-queued-index') || '0');
      button.disabled = true;
      codexdesk.cancelQueuedMessage(conversationId, queuedMessageId, queuedIndex).then((result) => {
        if (result?.error) {
          showAppNotice(localizeKnownText(String(result.error || '')), 'error');
          button.disabled = false;
          return;
        }
        showAppNotice(t('queuedUndo'), 'info');
      }).catch((error) => {
        button.disabled = false;
        showAppNotice(localizeKnownText(error?.message || String(error)), 'error');
      });
    });
  }
}
