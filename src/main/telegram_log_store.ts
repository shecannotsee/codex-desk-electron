const fs = require('node:fs');
const path = require('node:path');
const { APP_DATA_DIR } = require('./state_store');

const MAX_TELEGRAM_LOGS = 200;
const TELEGRAM_LOG_PATH = path.join(APP_DATA_DIR, 'telegram.logs.json');

const telegramLogs: Array<{
  timestamp: string;
  level: string;
  message: string;
}> = [];
let loaded = false;

function formatTelegramLogTimestamp(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function appendTelegramLog(level = 'info', message = '') {
  ensureTelegramLogsLoaded();
  const text = String(message || '').trim();
  if (!text) {
    return null;
  }
  const entry = {
    timestamp: formatTelegramLogTimestamp(),
    level: String(level || 'info').trim().toLowerCase() || 'info',
    message: text,
  };
  telegramLogs.push(entry);
  if (telegramLogs.length > MAX_TELEGRAM_LOGS) {
    telegramLogs.splice(0, telegramLogs.length - MAX_TELEGRAM_LOGS);
  }
  persistTelegramLogs();
  return entry;
}

function listTelegramLogs(limit = 20) {
  ensureTelegramLogsLoaded();
  const resolvedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  return telegramLogs.slice(-resolvedLimit).reverse();
}

function formatTelegramLogs(entries = []) {
  if (!Array.isArray(entries) || !entries.length) {
    return '当前还没有 Telegram 相关日志。';
  }
  return entries.map((entry) => {
    const level = String(entry?.level || 'info').trim().toUpperCase() || 'INFO';
    const timestamp = String(entry?.timestamp || '').trim() || '--:--:--';
    const message = String(entry?.message || '').trim() || '-';
    return `[${timestamp}] ${level} ${message}`;
  }).join('\n');
}

function ensureTelegramLogsLoaded() {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    if (!fs.existsSync(TELEGRAM_LOG_PATH)) {
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(TELEGRAM_LOG_PATH, 'utf-8'));
    if (!Array.isArray(parsed)) {
      return;
    }
    parsed.forEach((entry) => {
      const timestamp = String(entry?.timestamp || '').trim();
      const level = String(entry?.level || '').trim().toLowerCase();
      const message = String(entry?.message || '').trim();
      if (!timestamp || !message) {
        return;
      }
      telegramLogs.push({
        timestamp,
        level: level || 'info',
        message,
      });
    });
    if (telegramLogs.length > MAX_TELEGRAM_LOGS) {
      telegramLogs.splice(0, telegramLogs.length - MAX_TELEGRAM_LOGS);
    }
  } catch {
    // ignore
  }
}

function persistTelegramLogs() {
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.writeFileSync(TELEGRAM_LOG_PATH, JSON.stringify(telegramLogs, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

module.exports = {
  appendTelegramLog,
  ensureTelegramLogsLoaded,
  formatTelegramLogs,
  TELEGRAM_LOG_PATH,
  listTelegramLogs,
};
