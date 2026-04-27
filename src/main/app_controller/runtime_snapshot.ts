const { getConversation, sortedConversations } = require('../conversation_service');
const { securitySnapshot } = require('./runtime_helpers');

const runtimeSnapshotMethods = {
  _conversationSwitchPayload(conversationId) {
    const activeId = String(conversationId || this.activeConversationId || '').trim();
    const conv = activeId ? getConversation(this.conversations, activeId) : null;
    const runtime = activeId ? this.runtimeStore.ensure(activeId) : null;
    const notificationCenter = this._syncNotificationCenter();
    const remoteControlCenter = this._syncRemoteControlCenter();
    return {
      settings: {
        commandText: this.commandText,
        workdir: activeId ? this._resolveConversationWorkdir(activeId) : this._defaultWorkdir(),
        defaultWorkdir: this._defaultWorkdir(),
        deviceIdentity: notificationCenter.getDeviceIdentity(),
        notifications: notificationCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        remoteControl: remoteControlCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        security: securitySnapshot(this),
      },
      activeConversationId: activeId,
      conversation: conv || null,
      runtime: runtime ? {
        workflow: [...runtime.workflow],
        events: [...runtime.events],
        raw: [...runtime.raw],
        phase: runtime.phase,
        startedAt: runtime.startedAt,
      } : null,
      meta: activeId ? { ...this._ensureMeta(activeId) } : null,
      runningConversationIds: Array.from(this.runners.keys()),
      queuedCount: activeId ? this._pendingQueueSize(activeId) : 0,
      queuedMessages: activeId ? this._queuedItemsForUi(activeId) : [],
    };
  },

  snapshot() {
    const activeWorkdir = this.activeConversationId
      ? this._resolveConversationWorkdir(this.activeConversationId)
      : this._defaultWorkdir();
    const notificationCenter = this._syncNotificationCenter();
    const remoteControlCenter = this._syncRemoteControlCenter();
    return {
      settings: {
        commandText: this.commandText,
        workdir: activeWorkdir,
        defaultWorkdir: this._defaultWorkdir(),
        useNativeMemory: this.useNativeMemory,
        deviceIdentity: notificationCenter.getDeviceIdentity(),
        notifications: notificationCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        remoteControl: remoteControlCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        security: securitySnapshot(this),
      },
      activeConversationId: this.activeConversationId,
      conversations: sortedConversations(this.conversations),
      runtimeByConversation: this.runtimeStore.toObject(),
      metaByConversation: this.metaByConversation,
      runningConversationIds: Array.from(this.runners.keys()),
      queuedCountByConversation: this._queuedCountSnapshot(),
      queuedMessagesByConversation: this._queuedMessagesSnapshot(),
    };
  },
};

module.exports = {
  runtimeSnapshotMethods,
};
