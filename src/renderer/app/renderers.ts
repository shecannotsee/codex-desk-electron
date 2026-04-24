import type {
  RenderAllOptions,
  RendererCallbacks,
} from './types.js';
import {
  patchConversationListItem,
  pruneConversationRenderCaches,
  renderConversationList,
  updateConversationListActiveState,
} from './conversation_list_renderer.js';
import { renderSettings } from './settings_renderer.js';
import {
  formatQueuedAt,
  renderQueuePopover,
  renderQueuedMessagesPanel,
  renderRawTab,
  renderRuntime,
  renderStructuredTab,
  renderWorkflowTab,
} from './runtime_renderer.js';
import {
  formatMessageTime,
  formatUsageCount,
  isChatViewNearBottom,
  renderChat,
  renderChatMessageBlock,
  renderChatPaginationBar,
  renderChatTransientPanels,
  renderChatTransientStack,
  renderRunningHintBlock,
  resolveMessageTime,
  toMessageTimeMs,
  updateUsageMetaValue,
} from './chat_renderer.js';
import { renderComposerDraft, renderComposerWorkdir } from './composer_renderer.js';
import {
  renderCurrentTimeDisplay,
  renderHeader,
  renderLayout,
  renderLocaleTexts,
  renderRunButtons,
  renderTabs,
} from './shell_renderer.js';

function setRendererCallbacks(_nextCallbacks: Partial<RendererCallbacks> = {}) {}

function renderAll(options: RenderAllOptions = {}) {
  const stickChatToBottom = options.stickChatToBottom ?? isChatViewNearBottom();
  renderLocaleTexts();
  renderLayout();
  renderConversationList();
  renderSettings();
  renderHeader();
  renderChat(stickChatToBottom);
  renderRuntime(stickChatToBottom);
  renderRunButtons();
  renderComposerDraft();
  renderTabs();
}

export {
  setRendererCallbacks,
  renderConversationList,
  updateConversationListActiveState,
  patchConversationListItem,
  pruneConversationRenderCaches,
  renderHeader,
  renderSettings,
  renderComposerDraft,
  toMessageTimeMs,
  formatMessageTime,
  formatUsageCount,
  updateUsageMetaValue,
  resolveMessageTime,
  renderRunningHintBlock,
  renderChatPaginationBar,
  renderChatTransientStack,
  renderChatMessageBlock,
  renderChatTransientPanels,
  renderChat,
  renderStructuredTab,
  formatQueuedAt,
  renderQueuedMessagesPanel,
  renderQueuePopover,
  renderCurrentTimeDisplay,
  renderWorkflowTab,
  renderRawTab,
  renderRuntime,
  renderRunButtons,
  renderComposerWorkdir,
  isChatViewNearBottom,
  renderTabs,
  renderLayout,
  renderLocaleTexts,
  renderAll,
};
