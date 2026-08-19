import type { AppSnapshot, ConversationSwitchPayload, NotificationSettingsState, RemoteControlSettingsState, RuntimeState } from './types.js';
import {
  ensureChatVisibleCount,
  pruneGoalModes,
  pruneChatVisibleCounts,
  pruneComposerAttachments,
  pruneConversationDrafts,
  pruneRuntimeVisibleCounts,
  setConversationDraft,
  state,
  syncChatVisibleCount,
} from './state_i18n.js';
import { pruneConversationRenderCaches } from './conversation_list_renderer.js';
import { findConversationIndexById } from './conversation_runtime.js';

const MAX_RUNTIME_EVENTS = 500;
const MAX_RUNTIME_WORKFLOW = 500;
const MAX_RUNTIME_RAW = 1000;

function trimRuntimeList<T>(items: T[] = [], limit = 1): T[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const cappedLimit = Math.max(1, Number(limit) || 1);
  if (items.length <= cappedLimit) {
    return items;
  }
  items.splice(0, items.length - cappedLimit);
  return items;
}

function trimRuntimeState(runtime: RuntimeState | null | undefined): RuntimeState | null | undefined {
  if (!runtime || typeof runtime !== 'object') {
    return runtime;
  }
  trimRuntimeList(runtime.events, MAX_RUNTIME_EVENTS);
  trimRuntimeList(runtime.workflow, MAX_RUNTIME_WORKFLOW);
  trimRuntimeList(runtime.raw, MAX_RUNTIME_RAW);
  return runtime;
}

function normalizeTelegramProviderState(raw: any, fallback: any = {}) {
  const tokenHash = String(raw?.botTokenHash ?? fallback?.botTokenHash ?? '').trim();
  return {
    enabled: Boolean(raw?.enabled ?? fallback?.enabled),
    botToken: String(raw?.botToken ?? fallback?.botToken ?? '').trim(),
    chatId: String(raw?.chatId ?? fallback?.chatId ?? '').trim(),
    hasBotToken: Boolean(raw?.hasBotToken ?? fallback?.hasBotToken ?? tokenHash),
    botTokenHash: tokenHash,
    botTokenFingerprint: String(raw?.botTokenFingerprint ?? fallback?.botTokenFingerprint ?? '').trim(),
  };
}

function normalizeNotificationSettingsState(raw: any, fallback: any = {}): NotificationSettingsState {
  const nextActiveProvider = String(raw?.activeProvider ?? fallback?.activeProvider ?? 'telegram').trim().toLowerCase();
  return {
    activeProvider: nextActiveProvider === 'telegram' ? 'telegram' : 'telegram',
    providers: {
      telegram: normalizeTelegramProviderState(
        raw?.providers?.telegram ?? raw?.telegram,
        fallback?.providers?.telegram ?? fallback?.telegram,
      ),
    },
  };
}

function normalizeTelegramRemoteControlState(raw: any, fallback: any = {}) {
  const tokenHash = String(raw?.botTokenHash ?? fallback?.botTokenHash ?? '').trim();
  return {
    enabled: Boolean(raw?.enabled ?? fallback?.enabled),
    botToken: String(raw?.botToken ?? fallback?.botToken ?? '').trim(),
    hasBotToken: Boolean(raw?.hasBotToken ?? fallback?.hasBotToken ?? tokenHash),
    botTokenHash: tokenHash,
    botTokenFingerprint: String(raw?.botTokenFingerprint ?? fallback?.botTokenFingerprint ?? '').trim(),
    allowedChatId: String(raw?.allowedChatId ?? fallback?.allowedChatId ?? '').trim(),
  };
}

function normalizeRemoteControlSettingsState(raw: any, fallback: any = {}): RemoteControlSettingsState {
  const nextActiveProvider = String(raw?.activeProvider ?? fallback?.activeProvider ?? 'telegram').trim().toLowerCase();
  return {
    activeProvider: nextActiveProvider === 'telegram' ? 'telegram' : 'telegram',
    providers: {
      telegram: normalizeTelegramRemoteControlState(
        raw?.providers?.telegram ?? raw?.telegram,
        fallback?.providers?.telegram ?? fallback?.telegram,
      ),
    },
  };
}

function normalizeSecuritySettingsState(raw: any, fallback: any = {}) {
  const hasMasterPassword = Boolean(raw?.hasMasterPassword ?? fallback?.hasMasterPassword);
  return {
    hasMasterPassword,
    unlocked: hasMasterPassword
      ? Boolean(raw?.unlocked ?? fallback?.unlocked)
      : true,
  };
}

function applySnapshot(snapshot: AppSnapshot | null | undefined, onSecurityStateChanged: () => void = () => {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }

  state.settings = {
    commandText: snapshot.settings?.commandText || '',
    provider: snapshot.settings?.provider === 'claude' ? 'claude' : 'codex',
    workdir: snapshot.settings?.workdir || '',
    defaultWorkdir: snapshot.settings?.defaultWorkdir || snapshot.settings?.workdir || '',
    deviceIdentity: String(snapshot.settings?.deviceIdentity || '').trim(),
    notifications: normalizeNotificationSettingsState(snapshot.settings?.notifications, state.settings.notifications),
    remoteControl: normalizeRemoteControlSettingsState(snapshot.settings?.remoteControl, state.settings.remoteControl),
    security: normalizeSecuritySettingsState(snapshot.settings?.security, state.settings.security),
  };
  state.activeConversationId = String(snapshot.activeConversationId || '');
  state.conversations = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
  state.runtimeByConversation = snapshot.runtimeByConversation || {};
  Object.values(state.runtimeByConversation).forEach((runtime) => {
    trimRuntimeState(runtime);
  });
  state.metaByConversation = snapshot.metaByConversation || {};
  state.runningConversationIds = new Set(Array.isArray(snapshot.runningConversationIds) ? snapshot.runningConversationIds : []);
  state.queuedCountByConversation = snapshot.queuedCountByConversation || {};
  state.queuedMessagesByConversation = snapshot.queuedMessagesByConversation || {};
  const validIds = new Set(state.conversations.map((item) => String(item.id || '')));
  Object.keys(state.collapsedByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.collapsedByConversation[id];
    }
  });
  Object.keys(state.messageMarkdownByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.messageMarkdownByConversation[id];
    }
  });
  Object.keys(state.workflowCollapsedByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.workflowCollapsedByConversation[id];
    }
  });
  Object.keys(state.queuedMessagesByConversation).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.queuedMessagesByConversation[id];
    }
  });
  pruneChatVisibleCounts([...validIds]);
  pruneRuntimeVisibleCounts([...validIds]);
  pruneConversationDrafts([...validIds]);
  pruneComposerAttachments([...validIds]);
  pruneGoalModes([...validIds]);
  pruneConversationRenderCaches([...validIds]);

  if (!state.activeConversationId && state.conversations.length) {
    state.activeConversationId = state.conversations[0].id;
  }
  state.conversations.forEach((conv) => {
    const total = Array.isArray(conv?.messages) ? conv.messages.length : 0;
    ensureChatVisibleCount(conv.id, total);
  });
  onSecurityStateChanged();
}

function applyConversationSwitchPayload(payload: ConversationSwitchPayload | null | undefined, onSecurityStateChanged: () => void = () => {}) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  state.settings = {
    commandText: payload.settings?.commandText || state.settings.commandText || '',
    provider: payload.settings?.provider === 'claude' ? 'claude' : 'codex',
    workdir: payload.settings?.workdir || state.settings.workdir || '',
    defaultWorkdir: payload.settings?.defaultWorkdir || state.settings.defaultWorkdir || state.settings.workdir || '',
    deviceIdentity: String(payload.settings?.deviceIdentity || state.settings.deviceIdentity || '').trim(),
    notifications: normalizeNotificationSettingsState(payload.settings?.notifications, state.settings.notifications),
    remoteControl: normalizeRemoteControlSettingsState(payload.settings?.remoteControl, state.settings.remoteControl),
    security: normalizeSecuritySettingsState(payload.settings?.security, state.settings.security),
  };

  const nextActiveId = String(payload.activeConversationId || state.activeConversationId || '').trim();
  const nextConversation = payload.conversation;
  if (nextConversation && typeof nextConversation === 'object' && String(nextConversation.id || '').trim()) {
    const conversationId = String(nextConversation.id || '').trim();
    const idx = findConversationIndexById(conversationId);
    const previousTotal = idx >= 0 && Array.isArray(state.conversations[idx]?.messages)
      ? state.conversations[idx].messages.length
      : 0;
    if (idx >= 0) {
      state.conversations[idx] = nextConversation;
    } else {
      state.conversations.push(nextConversation);
    }
    syncChatVisibleCount(conversationId, Array.isArray(nextConversation.messages) ? nextConversation.messages.length : 0, previousTotal);
  }
  onSecurityStateChanged();

  state.activeConversationId = nextActiveId;

  if (nextActiveId) {
    if (payload.runtime && typeof payload.runtime === 'object') {
      state.runtimeByConversation[nextActiveId] = payload.runtime;
      trimRuntimeState(state.runtimeByConversation[nextActiveId]);
    }
    if (payload.meta && typeof payload.meta === 'object') {
      state.metaByConversation[nextActiveId] = payload.meta;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'queuedCount')) {
      state.queuedCountByConversation[nextActiveId] = Number(payload.queuedCount || 0);
      if (Array.isArray(payload.queuedMessages)) {
        state.queuedMessagesByConversation[nextActiveId] = payload.queuedMessages;
      } else if (state.queuedCountByConversation[nextActiveId] <= 0) {
        state.queuedMessagesByConversation[nextActiveId] = [];
      }
    }
  }

  if (Array.isArray(payload.runningConversationIds)) {
    state.runningConversationIds = new Set(payload.runningConversationIds);
  }

  if (!state.activeConversationId && state.conversations.length) {
    state.activeConversationId = state.conversations[0].id;
  }
}

function removeConversationRuntimeState(conversationId: string) {
  delete state.runtimeByConversation[conversationId];
  delete state.metaByConversation[conversationId];
  delete state.queuedCountByConversation[conversationId];
  delete state.queuedMessagesByConversation[conversationId];
  delete state.collapsedByConversation[conversationId];
  delete state.workflowCollapsedByConversation[conversationId];
  delete state.chatVisibleCountByConversation[conversationId];
  delete state.goalModeByConversation[conversationId];
  setConversationDraft(conversationId, '');
  state.runningConversationIds.delete(conversationId);
}

export {
  applyConversationSwitchPayload,
  applySnapshot,
  removeConversationRuntimeState,
  trimRuntimeState,
};
