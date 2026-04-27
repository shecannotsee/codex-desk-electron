import { codexdesk } from './codexdesk.js';
import {
  draftStorageKey,
  el,
  setConversationDraft,
  state,
} from './state_i18n.js';
import { resolveCloseGuardAction } from './app_dialogs.js';
import { hideQueuePopover } from './queue_popover_controller.js';

type GlobalEventBindingsOptions = {
  dispatchAction: (action: string) => Promise<void>;
  hideAboutModal: () => void;
  hideChatContextMenu: () => void;
  hideConversationContextMenu: () => void;
  hideQuickSettingsMenu: () => void;
  shouldKeepQuickSettingsOpen: () => boolean;
};

function getEventNodeTarget(event: Event): Node | null {
  return event.target instanceof Node ? event.target : null;
}

export function bindGlobalEventHandlers(options: GlobalEventBindingsOptions) {
  document.addEventListener('click', (event) => {
    if (
      el.aboutModal
      && !el.aboutModal.classList.contains('hidden')
      && event.target === el.aboutModal
    ) {
      options.hideAboutModal();
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
      options.hideChatContextMenu();
    }
    if (el.contextMenu && !el.contextMenu.classList.contains('hidden') && (!targetNode || !el.contextMenu.contains(targetNode))) {
      options.hideConversationContextMenu();
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
  });

  window.addEventListener('blur', () => {
    options.hideChatContextMenu();
    options.hideConversationContextMenu();
    hideQueuePopover();
  });
  window.addEventListener('beforeunload', () => {
    // Persist the current textarea synchronously so reload/close does not lose unsent draft text.
    setConversationDraft(state.activeConversationId, el.inputBox?.value || '');
    state.inputBindingConversationId = draftStorageKey(state.activeConversationId);
  });
  window.addEventListener('resize', () => {
    options.hideChatContextMenu();
    options.hideConversationContextMenu();
    hideQueuePopover();
    if (!options.shouldKeepQuickSettingsOpen()) {
      options.hideQuickSettingsMenu();
    }
    options.hideAboutModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      // Keep zoom shortcuts app-local to avoid conflicting with browser Ctrl/Cmd zoom behavior in Electron.
      if (event.code === 'Equal') {
        event.preventDefault();
        options.dispatchAction('view:zoom-in').catch(() => {});
        return;
      }
      if (!event.shiftKey && event.code === 'Minus') {
        event.preventDefault();
        options.dispatchAction('view:zoom-out').catch(() => {});
        return;
      }
      if (!event.shiftKey && event.code === 'Digit0') {
        event.preventDefault();
        options.dispatchAction('view:zoom-reset').catch(() => {});
        return;
      }
    }
    if (event.key === 'Escape') {
      if (el.closeGuardModal && !el.closeGuardModal.classList.contains('hidden')) {
        resolveCloseGuardAction('cancel');
        return;
      }
      hideQueuePopover();
      options.hideChatContextMenu();
      options.hideConversationContextMenu();
      options.hideQuickSettingsMenu();
      options.hideAboutModal();
    }
  });

  if (el.aboutClose) {
    el.aboutClose.addEventListener('click', () => {
      options.hideAboutModal();
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

  if (typeof codexdesk.onMenuAction === 'function') {
    codexdesk.onMenuAction((payload) => {
      const action = String(payload?.action || '').trim();
      if (!action) {
        return;
      }
      options.dispatchAction(action).catch(() => {});
    });
  }
}
