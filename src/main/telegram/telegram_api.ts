// Telegram HTTP API helpers. This module owns request transport, proxy fallback,
// timeout handling, and user-friendly API error normalization.
const { spawnCommand } = require('../child_process_helper');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function resolveSystemProxyUrl() {
  const keys = [
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
    'HTTP_PROXY',
    'http_proxy',
  ];
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeTelegramApiError(message = '', statusCode = 0) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) {
    return 'Telegram API error';
  }
  if (statusCode === 404 || lower === 'not found' || lower.endsWith(': not found') || lower.includes('response: not found')) {
    return 'Telegram Bot Token 无效，接口返回 Not Found';
  }
  if (lower.includes('chat not found')) {
    return 'Telegram Chat ID 无效，或该聊天还没有和 Bot 建立会话';
  }
  if (lower.includes('bot was blocked by the user')) {
    return 'Telegram Bot 已被对方屏蔽，请先解除屏蔽后再测试';
  }
  return text;
}

function buildTelegramApiUrl(botToken, method = '') {
  const token = String(botToken || '').trim();
  if (!token) {
    return '';
  }
  const suffix = String(method || '').trim();
  return `${TELEGRAM_API_BASE}/bot${token}${suffix ? `/${suffix}` : ''}`;
}

async function postTelegram(settings, method, payload, timeoutMs = 15000) {
  const url = buildTelegramApiUrl(settings?.botToken, method);
  if (!url) {
    throw new Error('Telegram Bot Token 未配置');
  }
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
  const systemProxyUrl = resolveSystemProxyUrl();
  if (systemProxyUrl) {
    return postTelegramViaCurl(url, payload, resolvedTimeoutMs);
  }
  try {
    return await postTelegramViaFetch(url, payload, resolvedTimeoutMs);
  } catch (error) {
    return postTelegramViaCurl(url, payload, resolvedTimeoutMs, error);
  }
}

async function postTelegramViaFetch(url, payload, timeoutMs) {
  const controller = new AbortController();
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
  const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(normalizeTelegramApiError(
        String(data?.description || response.statusText || 'Telegram API error').trim(),
        response.status,
      ));
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Telegram 请求超时（${Math.round(resolvedTimeoutMs / 1000)}s）。请检查当前网络是否能访问 api.telegram.org，必要时为应用启用代理或 VPN。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function postTelegramViaCurl(url, payload, timeoutMs, fetchError = null) {
  return new Promise((resolve, reject) => {
    const maxTimeSeconds = Math.max(1, Math.ceil(Math.max(1000, Number(timeoutMs) || 15000) / 1000));
    const args = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      String(maxTimeSeconds),
      '--request',
      'POST',
      '--header',
      'Content-Type: application/json',
      '--data',
      JSON.stringify(payload || {}),
      url,
    ];

    const child = spawnCommand('curl', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const done = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      handler(value);
    };

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      const fetchMessage = fetchError?.message ? `fetch: ${normalizeTelegramApiError(fetchError.message)}` : '';
      const curlMessage = error?.message ? `curl: ${error.message}` : '';
      done(reject, new Error([fetchMessage, curlMessage].filter(Boolean).join(' | ') || 'Telegram 请求失败'));
    });

    child.on('close', (code) => {
      if (Number(code || 0) !== 0) {
        const fetchMessage = fetchError?.message ? `fetch: ${normalizeTelegramApiError(fetchError.message)}` : '';
        const curlMessage = String(stderr || '').trim() ? `curl: ${String(stderr || '').trim()}` : '';
        done(reject, new Error([fetchMessage, curlMessage].filter(Boolean).join(' | ') || `curl exited with code ${code}`));
        return;
      }
      try {
        const data = JSON.parse(String(stdout || '{}'));
        if (!data?.ok) {
          throw new Error(normalizeTelegramApiError(String(data?.description || 'Telegram API error').trim()));
        }
        done(resolve, data);
      } catch (error) {
        const fetchMessage = fetchError?.message ? `fetch: ${normalizeTelegramApiError(fetchError.message)}` : '';
        const curlMessage = String(stderr || '').trim() ? `curl: ${String(stderr || '').trim()}` : '';
        const parseMessage = error?.message ? `response: ${normalizeTelegramApiError(error.message)}` : '';
        done(reject, new Error([fetchMessage, curlMessage, parseMessage].filter(Boolean).join(' | ') || 'Telegram 响应解析失败'));
      }
    });
  });
}

module.exports = {
  TELEGRAM_API_BASE,
  buildTelegramApiUrl,
  normalizeTelegramApiError,
  postTelegram,
  resolveSystemProxyUrl,
};
