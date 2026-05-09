import type {
  AppEvent,
  RawEventEntry,
  RuntimeEventItem,
  RuntimeState,
  WorkflowItem,
} from './types.js';
import { state, syncChatVisibleCount } from './state_i18n.js';
import {
  ensureMeta,
  ensureRuntime,
  findConversationIndexById,
} from './conversation_runtime.js';
import { patchConversationListItem, isChatViewNearBottom } from './renderers.js';
import { removeConversationRuntimeState, trimRuntimeState } from './app_state_sync.js';
import { createRenderJobs, scheduleRender } from './render_scheduler.js';

function isDuplicateRuntimeEvent(runtime: RuntimeState | null | undefined, item: RuntimeEventItem | null | undefined) {
  if (!runtime || !item || !Array.isArray(runtime.events)) {
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

function applyEvent(event: AppEvent | null | undefined) {
  if (!event || typeof event !== 'object') {
    return;
  }
  const stickChatToBottom = typeof isChatViewNearBottom === 'function'
    ? isChatViewNearBottom()
    : true;

  const id = String(event.conversationId || '');
  const isActiveConversation = Boolean(id) && id === state.activeConversationId;
  const isActiveConversationWorkspace = isActiveConversation && state.workspaceMode !== 'team';
  const renderJobs = createRenderJobs();
  switch (event.type) {
    case 'runtime-event-append': {
      const runtime = ensureRuntime(id);
      const runtimeItem = (event.item || {}) as RuntimeEventItem;
      if (!isDuplicateRuntimeEvent(runtime, runtimeItem)) {
        runtime.events.push(runtimeItem);
        trimRuntimeState(runtime);
      }
      if (isActiveConversationWorkspace && state.activeTab === 'structured') {
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
      if (isActiveConversationWorkspace && state.activeTab === 'structured') {
        renderJobs.runtimeStructured = true;
      }
      break;
    }
    case 'runtime-event-update': {
      const runtime = ensureRuntime(id);
      const index = Number(event.index);
      if (Number.isInteger(index) && index >= 0 && index < runtime.events.length) {
        runtime.events[index] = (event.item || {}) as RuntimeEventItem;
      }
      if (isActiveConversationWorkspace && state.activeTab === 'structured') {
        renderJobs.runtimeStructured = true;
      }
      break;
    }
    case 'runtime-workflow-append':
      ensureRuntime(id).workflow.push((event.item || {}) as WorkflowItem);
      trimRuntimeState(state.runtimeByConversation[id]);
      if (isActiveConversationWorkspace) {
        renderJobs.chatTransient = true;
        renderJobs.runtimeWorkflow = true;
      }
      break;
    case 'runtime-workflow-update': {
      const runtime = ensureRuntime(id);
      const index = Number(event.index);
      if (Number.isInteger(index) && index >= 0 && index < runtime.workflow.length) {
        runtime.workflow[index] = (event.item || {}) as WorkflowItem;
      }
      if (isActiveConversationWorkspace) {
        renderJobs.chatTransient = true;
        renderJobs.runtimeWorkflow = true;
      }
      break;
    }
    case 'runtime-workflow-pop': {
      const runtime = ensureRuntime(id);
      const index = Number(event.index);
      if (Number.isInteger(index) && index >= 0 && index < runtime.workflow.length) {
        runtime.workflow.splice(index, 1);
      } else if (runtime.workflow.length) {
        runtime.workflow.pop();
      }
      if (isActiveConversationWorkspace) {
        renderJobs.chatTransient = true;
        renderJobs.runtimeWorkflow = true;
      }
      break;
    }
    case 'runtime-raw-append':
      ensureRuntime(id).raw.push((event.line || '') as string | RawEventEntry);
      trimRuntimeState(state.runtimeByConversation[id]);
      if (isActiveConversationWorkspace && state.activeTab === 'raw') {
        renderJobs.runtimeRaw = true;
      }
      break;
    case 'runtime-phase':
      ensureRuntime(id).phase = String(event.phase || '');
      if (!patchConversationListItem(id)) {
        renderJobs.conversationList = true;
      }
      if (isActiveConversationWorkspace) {
        renderJobs.header = true;
        renderJobs.runButtons = true;
        renderJobs.chatTransient = true;
        renderJobs.runtimeWorkflow = true;
      }
      break;
    case 'runtime-started-at':
      ensureRuntime(id).startedAt = typeof event.startedAt === 'number' ? event.startedAt : null;
      if (isActiveConversationWorkspace) {
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
      if (!patchConversationListItem(id)) {
        renderJobs.conversationList = true;
      }
      if (isActiveConversationWorkspace) {
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
      const idx = findConversationIndexById(conv.id);
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
      if (conv.id === state.activeConversationId && state.workspaceMode !== 'team') {
        renderJobs.header = true;
        renderJobs.chat = true;
        renderJobs.runButtons = true;
      }
      break;
    }
    case 'conversation-removed':
      state.conversations = state.conversations.filter((item) => item.id !== id);
      removeConversationRuntimeState(id);
      renderJobs.full = true;
      break;
    case 'meta-updated':
      ensureMeta(id)[String(event.key || '')] = String(event.value || '');
      if (isActiveConversationWorkspace) {
        renderJobs.header = true;
      }
      break;
    case 'runner-state':
      if (event.running) {
        state.runningConversationIds.add(id);
      } else {
        state.runningConversationIds.delete(id);
      }
      if (!patchConversationListItem(id)) {
        renderJobs.conversationList = true;
      }
      if (isActiveConversationWorkspace) {
        renderJobs.header = true;
        renderJobs.runButtons = true;
        renderJobs.chatTransient = true;
        renderJobs.runtimeWorkflow = true;
      }
      break;
    case 'queue-updated':
      state.queuedCountByConversation[id] = Number(event.count || 0);
      if (Array.isArray(event.items)) {
        state.queuedMessagesByConversation[id] = event.items;
      } else if (Number(event.count || 0) <= 0) {
        state.queuedMessagesByConversation[id] = [];
      }
      if (!patchConversationListItem(id)) {
        renderJobs.conversationList = true;
      }
      if (isActiveConversationWorkspace) {
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

export {
  applyEvent,
  isDuplicateRuntimeEvent,
};
