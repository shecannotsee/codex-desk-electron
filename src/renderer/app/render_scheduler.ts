import type { RenderJobs, ScheduleRenderOptions } from './types.js';
import { state } from './state_i18n.js';
import { ensureRuntime, hasActiveConversation } from './conversation_runtime.js';
import { renderAgentTeamChat } from './agent_team.js';
import {
  renderAll,
  renderChat,
  renderChatTransientPanels,
  renderComposerDraft,
  renderConversationList,
  renderHeader,
  renderLayout,
  renderLocaleTexts,
  renderRawTab,
  renderRunButtons,
  renderRuntime,
  renderSettings,
  renderStructuredTab,
  renderTabs,
  renderWorkflowTab,
} from './renderers.js';

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
    if (state.workspaceMode === 'team') {
      renderAgentTeamChat();
    } else {
      renderChat(stickChatToBottom);
    }
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

export {
  createRenderJobs,
  scheduleRender,
};
