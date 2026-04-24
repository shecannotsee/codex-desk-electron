import { el, t } from './state_i18n.js';

type NoticeTone = 'info' | 'success' | 'error';

let noticeLayer: HTMLElement | null = null;
let noticeHideTimer = 0;
let noticeClearTimer = 0;

function ensureNoticeLayer(): HTMLElement {
  const host = el.focusRow || el.workspace || document.body;
  if (noticeLayer && host.contains(noticeLayer)) {
    return noticeLayer;
  }
  const layer = document.createElement('div');
  layer.className = 'app-notice-layer';
  layer.setAttribute('aria-live', 'polite');
  layer.setAttribute('aria-atomic', 'true');
  host.appendChild(layer);
  noticeLayer = layer;
  return layer;
}

function showAppNotice(message: string, tone: NoticeTone = 'info') {
  const text = String(message || '').trim();
  if (!text) {
    return;
  }
  const layer = ensureNoticeLayer();
  layer.innerHTML = '';
  const card = document.createElement('div');
  card.className = `app-notice app-notice-${tone}`;
  card.textContent = text;
  card.title = t('clickToCopy');
  card.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Ignore clipboard failures for transient notices.
    }
  });
  layer.appendChild(card);
  window.clearTimeout(noticeHideTimer);
  window.clearTimeout(noticeClearTimer);
  window.requestAnimationFrame(() => {
    card.classList.add('is-visible');
  });
  const lineCount = text.split('\n').filter(Boolean).length;
  const visibleMs = tone === 'error'
    ? Math.max(6000, 2500 + lineCount * 2200)
    : Math.max(2200, 1200 + lineCount * 900);
  noticeHideTimer = window.setTimeout(() => {
    card.classList.remove('is-visible');
    noticeClearTimer = window.setTimeout(() => {
      if (noticeLayer === layer) {
        layer.innerHTML = '';
      }
    }, 180);
  }, visibleMs);
}

export {
  showAppNotice,
};
