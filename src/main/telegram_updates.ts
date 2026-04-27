const { normalizeTelegramSettings } = require('./state_store');
const { postTelegram } = require('./telegram_api');

const TELEGRAM_UPDATE_COORDINATORS = new Map();

function createTelegramSubscriptionId() {
  return `tgsub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getTelegramCoordinatorKey(settings: any = {}) {
  return String(settings?.botToken || '').trim();
}

function getTelegramUpdateCoordinator(settings: any = {}) {
  const key = getTelegramCoordinatorKey(settings);
  if (!key) {
    return null;
  }
  let coordinator = TELEGRAM_UPDATE_COORDINATORS.get(key);
  if (!coordinator) {
    coordinator = {
      botToken: key,
      pollTimer: null,
      isPolling: false,
      lastUpdateId: 0,
      subscribers: new Map(),
    };
    TELEGRAM_UPDATE_COORDINATORS.set(key, coordinator);
  }
  return coordinator;
}

function setTelegramCoordinatorOffset(settings: any = {}, lastUpdateId = 0) {
  const coordinator = getTelegramUpdateCoordinator(settings);
  if (!coordinator) {
    return;
  }
  const nextOffset = Math.max(0, Number(lastUpdateId || 0) || 0);
  if (nextOffset > coordinator.lastUpdateId) {
    coordinator.lastUpdateId = nextOffset;
  }
}

function collectCoordinatorAllowedUpdates(coordinator: any = null) {
  if (!coordinator || !(coordinator.subscribers instanceof Map) || !coordinator.subscribers.size) {
    return ['message', 'callback_query'];
  }
  const values = new Set();
  for (const subscriber of coordinator.subscribers.values()) {
    const items = Array.isArray(subscriber?.allowedUpdates) ? subscriber.allowedUpdates : [];
    items.forEach((item) => {
      const value = String(item || '').trim();
      if (value) {
        values.add(value);
      }
    });
  }
  return values.size ? Array.from(values) : ['message', 'callback_query'];
}

function scheduleTelegramCoordinatorPoll(coordinator: any = null, delayMs = 400) {
  if (!coordinator || coordinator.pollTimer || coordinator.isPolling || !coordinator.subscribers.size) {
    return;
  }
  coordinator.pollTimer = setTimeout(() => {
    coordinator.pollTimer = null;
    pollTelegramCoordinator(coordinator).catch(() => {}).finally(() => {
      if (coordinator.subscribers.size) {
        scheduleTelegramCoordinatorPoll(coordinator, 250);
      }
    });
  }, Math.max(0, Number(delayMs) || 0));
}

async function pollTelegramCoordinator(coordinator: any = null) {
  if (!coordinator || coordinator.isPolling || !coordinator.subscribers.size) {
    return;
  }
  coordinator.isPolling = true;
  try {
    const response = await postTelegram({
      botToken: coordinator.botToken,
    }, 'getUpdates', {
      offset: Math.max(0, Number(coordinator.lastUpdateId || 0) || 0) + 1,
      timeout: 25,
      allowed_updates: collectCoordinatorAllowedUpdates(coordinator),
    }, 30000);
    const updates = Array.isArray(response?.result) ? response.result : [];
    let highestUpdateId = Math.max(0, Number(coordinator.lastUpdateId || 0) || 0);
    for (const update of updates) {
      const updateId = Math.max(0, Number(update?.update_id || 0) || 0);
      if (updateId > highestUpdateId) {
        highestUpdateId = updateId;
      }
      for (const subscriber of coordinator.subscribers.values()) {
        if (typeof subscriber?.onUpdate !== 'function') {
          continue;
        }
        try {
          await subscriber.onUpdate(update);
        } catch (error) {
          if (typeof subscriber?.onError === 'function') {
            try {
              await subscriber.onError(error, update);
            } catch {
              // A subscriber error hook must not stop other subscribers from receiving updates.
            }
          }
        }
      }
    }
    if (highestUpdateId > coordinator.lastUpdateId) {
      coordinator.lastUpdateId = highestUpdateId;
      for (const subscriber of coordinator.subscribers.values()) {
        if (typeof subscriber?.onOffsetChange !== 'function') {
          continue;
        }
        try {
          await subscriber.onOffsetChange(highestUpdateId);
        } catch {
          // Offset persistence is best effort; the in-memory coordinator still advances to avoid duplicates.
        }
      }
    }
  } catch (error) {
    for (const subscriber of coordinator.subscribers.values()) {
      if (typeof subscriber?.onError !== 'function') {
        continue;
      }
      try {
        await subscriber.onError(error);
      } catch {
        // Swallow secondary failures so the long-poll loop can keep running.
      }
    }
  } finally {
    coordinator.isPolling = false;
  }
}

function subscribeTelegramUpdates(options: any = {}) {
  const settings = normalizeTelegramSettings(options.settings);
  const coordinator = getTelegramUpdateCoordinator(settings);
  if (!coordinator) {
    return () => {};
  }
  const subscriptionId = String(options.subscriptionId || createTelegramSubscriptionId()).trim() || createTelegramSubscriptionId();
  coordinator.subscribers.set(subscriptionId, {
    allowedUpdates: Array.isArray(options.allowedUpdates) ? options.allowedUpdates : ['message', 'callback_query'],
    onUpdate: typeof options.onUpdate === 'function' ? options.onUpdate : null,
    onOffsetChange: typeof options.onOffsetChange === 'function' ? options.onOffsetChange : null,
    onError: typeof options.onError === 'function' ? options.onError : null,
  });
  setTelegramCoordinatorOffset(settings, options.startFrom);
  scheduleTelegramCoordinatorPoll(coordinator, 0);
  return () => {
    const current = TELEGRAM_UPDATE_COORDINATORS.get(coordinator.botToken);
    if (!current) {
      return;
    }
    current.subscribers.delete(subscriptionId);
    if (current.subscribers.size) {
      return;
    }
    if (current.pollTimer) {
      clearTimeout(current.pollTimer);
      current.pollTimer = null;
    }
    TELEGRAM_UPDATE_COORDINATORS.delete(coordinator.botToken);
  };
}

module.exports = {
  getTelegramCoordinatorKey,
  setTelegramCoordinatorOffset,
  subscribeTelegramUpdates,
};
