const { StateStore } = require('../state_store');

class JsonAppStateStorage {
  [key: string]: any;

  constructor(options: any = {}) {
    this.driver = options.driver || new StateStore(options.statePath);
    this.kind = 'json';
  }

  loadState() {
    return this.driver.load();
  }

  saveState(state) {
    this.driver.save(state);
  }
}

function createAppStateStorage(options: any = {}) {
  const kind = String(options.kind || 'json').trim().toLowerCase();
  if (!kind || kind === 'json') {
    return new JsonAppStateStorage(options);
  }
  throw new Error(`暂不支持的存储类型: ${kind}`);
}

module.exports = {
  JsonAppStateStorage,
  createAppStateStorage,
};
