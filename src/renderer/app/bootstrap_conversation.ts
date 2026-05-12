import type { ConversationSwitchPayload } from './types.js';
import { codexdesk } from './codexdesk.js';
import { el, state, t } from './state_i18n.js';
import {
  renderAll,
  renderChat,
  renderComposerDraft,
  renderConversationList,
  renderHeader,
  renderRunButtons,
  renderRuntime,
  renderSettings,
  renderTabs,
  setRendererCallbacks,
  updateConversationListActiveState,
} from './renderers.js';
import { showAppNotice } from './app_notice.js';
import { bindConversationActions } from './conversation_actions_controller.js';
import { switchAgentTeamGroup, switchWorkspaceMode } from './agent_team.js';

export function bindConversationInit(deps: {
  applySnapshot: (snapshot: any) => void;
  applyConversationSwitchPayload: (payload: ConversationSwitchPayload | null | undefined) => void;
}) {
  const switchConversationAndRender = async (id: string) => {
    switchWorkspaceMode('conversation');
    const previousActiveId = state.activeConversationId;
    const payload = await codexdesk.switchConversation(id);
    deps.applyConversationSwitchPayload(payload);
    if (!updateConversationListActiveState(previousActiveId, state.activeConversationId)) {
      renderConversationList();
    }
    renderSettings();
    renderHeader();
    renderChat(true);
    renderRuntime(true);
    renderRunButtons();
    renderComposerDraft();
    renderTabs();
  };

  setRendererCallbacks({
    onConversationSelected: switchConversationAndRender,
  });

  el.sidebarSearchInput.addEventListener('input', () => {
    renderConversationList();
  });

  el.conversationList.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const teamItem = target?.closest<HTMLElement>('.conversation-item[data-team-group-id]');
    if (teamItem) {
      const groupId = String(teamItem.getAttribute('data-team-group-id') || '').trim();
      if (!groupId || !switchAgentTeamGroup(groupId)) return;
      renderAll({ stickChatToBottom: true });
      return;
    }
    const item = target?.closest<HTMLElement>('.conversation-item[data-id]');
    if (!item) return;
    const id = String(item.getAttribute('data-id') || '').trim();
    if (!id) return;
    await switchConversationAndRender(id);
  });

  el.btnSidebarNewConv.addEventListener('click', () => {
    el.btnNewConv.click();
  });

  if (el.btnSessionId) {
    el.btnSessionId.addEventListener('click', async () => {
      const fullValue = String(el.btnSessionId.dataset.fullValue || '').trim();
      if (!fullValue || fullValue === '-') return;
      const flashCopiedState = () => {
        el.btnSessionId.classList.remove('is-copied');
        window.requestAnimationFrame(() => {
          el.btnSessionId.classList.add('is-copied');
          window.setTimeout(() => { el.btnSessionId.classList.remove('is-copied'); }, 900);
        });
        showAppNotice(t('copySuccess'), 'success');
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

  bindConversationActions({
    applySnapshot: deps.applySnapshot,
    renderAll,
  });
}
