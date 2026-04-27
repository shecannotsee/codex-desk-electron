import { codexdesk } from './codexdesk.js';
import {
  el,
  localizeKnownText,
  state,
  t,
} from './state_i18n.js';
import { findConversationById } from './conversation_runtime.js';

type ContextMenuOptions = {
  applySnapshot: (snapshot: unknown) => void;
  renderAll: (options?: unknown) => void;
  switchConversationIfNeeded: (conversationId: string) => Promise<void>;
};

function getEventElementTarget(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function clampMenuPosition(menu: HTMLElement, x: number, y: number) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  return {
    left: Math.max(margin, Math.min(x, maxLeft)),
    top: Math.max(margin, Math.min(y, maxTop)),
  };
}

function currentSelectionText() {
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
}

function hasSelectionText() {
  return String(currentSelectionText() || '').length > 0;
}

async function copyPlainText(text) {
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
}

export function createContextMenuController(options: ContextMenuOptions) {
  let contextMenuConversationId = '';
  let chatContextSelectionText = '';

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
    const targetConversation = findConversationById(contextMenuConversationId);
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
    const position = clampMenuPosition(el.contextMenu, x, y);
    el.contextMenu.style.left = `${position.left}px`;
    el.contextMenu.style.top = `${position.top}px`;
  };

  const hideChatContextMenu = () => {
    if (!el.chatContextMenu) {
      return;
    }
    el.chatContextMenu.classList.add('hidden');
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
    const position = clampMenuPosition(el.chatContextMenu, x, y);
    el.chatContextMenu.style.left = `${position.left}px`;
    el.chatContextMenu.style.top = `${position.top}px`;
  };

  const bind = () => {
    el.conversationList.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const row = getEventElementTarget(event)?.closest('.conversation-item');
      const id = row ? String(row.getAttribute('data-id') || '').trim() : '';
      hideChatContextMenu();
      showConversationContextMenu(event.clientX, event.clientY, id);
    });

    if (el.chatView) {
      el.chatView.addEventListener('contextmenu', (event) => {
        const target = getEventElementTarget(event);
        if (target?.closest('button')) {
          return;
        }
        const clickedMessage = target?.closest('.msg-block');
        // Message cards keep their native context menu unless the user has selected text to copy.
        if (!hasSelectionText() && clickedMessage) {
          return;
        }
        event.preventDefault();
        hideConversationContextMenu();
        showChatContextMenu(event.clientX, event.clientY);
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
        // Context menu actions operate on the right-clicked row, not necessarily the active conversation.
        await options.switchConversationIfNeeded(id);
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
        await options.switchConversationIfNeeded(id);
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
        options.applySnapshot(next?.snapshot || next);
        options.renderAll();
      });
    }
    if (el.ctxCloseConv) {
      el.ctxCloseConv.addEventListener('click', async () => {
        const id = contextMenuConversationId;
        hideConversationContextMenu();
        await options.switchConversationIfNeeded(id);
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
  };

  return {
    bind,
    hideChatContextMenu,
    hideConversationContextMenu,
    showChatContextMenu,
    showConversationContextMenu,
  };
}
