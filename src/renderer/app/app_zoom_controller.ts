import { codexdesk } from './codexdesk.js';
import type { ZoomOptions } from './types.js';
import {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_STEP,
  clampAppZoom,
  el,
  saveUiPrefs,
  state,
} from './state_i18n.js';
import { renderSettings } from './renderers.js';

let quickSettingsAutoHideLockUntil = 0;
let zoomHudHideTimer = 0;

export async function setAppZoomFactor(input: number | string, options: ZoomOptions = {}) {
  const persist = options.persist !== false;
  const rerenderControls = options.rerenderControls !== false;
  const next = clampAppZoom(input, state.ui.zoomFactor);
  if (!codexdesk || typeof codexdesk.setZoomFactor !== 'function') {
    return next;
  }
  const result = await codexdesk.setZoomFactor(next);
  if (result?.error) {
    throw new Error(result.error);
  }
  state.ui.zoomFactor = clampAppZoom(result?.zoomFactor, next);
  if (persist) {
    saveUiPrefs();
  }
  if (rerenderControls) {
    renderSettings();
  }
  return state.ui.zoomFactor;
}

export function currentAppZoomPercent() {
  return Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100);
}

export function syncZoomControls(percent) {
  const nextPercent = Math.round(Number(percent) || currentAppZoomPercent());
  if (el.zoomFactorRange) {
    el.zoomFactorRange.value = String(nextPercent);
  }
  if (el.zoomFactorValue) {
    el.zoomFactorValue.value = String(nextPercent);
  }
}

export function showZoomHud(percent) {
  if (!el.zoomHud) {
    return;
  }
  const nextPercent = Math.round(Number(percent) || currentAppZoomPercent());
  el.zoomHud.textContent = `${nextPercent}%`;
  window.clearTimeout(zoomHudHideTimer);
  if (!el.zoomHud.classList.contains('zoom-hud-visible')) {
    window.requestAnimationFrame(() => {
      el.zoomHud.classList.add('zoom-hud-visible');
    });
  }
  zoomHudHideTimer = window.setTimeout(() => {
    el.zoomHud.classList.remove('zoom-hud-visible');
  }, 760);
}

export function lockQuickSettingsAutoHide(durationMs = 260) {
  quickSettingsAutoHideLockUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
}

export function shouldKeepQuickSettingsOpen() {
  return Date.now() < quickSettingsAutoHideLockUntil;
}

export function bindZoomControls() {
  if (el.zoomFactorRange) {
    el.zoomFactorRange.addEventListener('input', () => {
      const nextPercent = Math.round(Number(el.zoomFactorRange.value || currentAppZoomPercent()));
      syncZoomControls(nextPercent);
      lockQuickSettingsAutoHide();
      showZoomHud(nextPercent);
    });

    el.zoomFactorRange.addEventListener('change', () => {
      const nextPercent = Math.round(Number(el.zoomFactorRange.value || currentAppZoomPercent()));
      lockQuickSettingsAutoHide(360);
      setAppZoomFactor(nextPercent / 100, { rerenderControls: false }).then((applied) => {
        const appliedPercent = Math.round(applied * 100);
        syncZoomControls(appliedPercent);
        showZoomHud(appliedPercent);
      }).catch(() => {
        syncZoomControls(currentAppZoomPercent());
      });
    });
  }

  const commitZoomInput = () => {
    const raw = String(el.zoomFactorValue.value || '').trim();
    if (!raw) {
      syncZoomControls(currentAppZoomPercent());
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      syncZoomControls(currentAppZoomPercent());
      return;
    }
    lockQuickSettingsAutoHide(360);
    setAppZoomFactor(value / 100, { rerenderControls: false }).then((applied) => {
      const appliedPercent = Math.round(applied * 100);
      syncZoomControls(appliedPercent);
      showZoomHud(appliedPercent);
    }).catch(() => {
      syncZoomControls(currentAppZoomPercent());
    });
  };

  el.zoomFactorValue.addEventListener('focus', () => {
    el.zoomFactorValue.select();
  });
  el.zoomFactorValue.addEventListener('input', () => {
    const raw = String(el.zoomFactorValue.value || '').trim();
    if (!raw) {
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 50 || value > 250) {
      return;
    }
    syncZoomControls(value);
    lockQuickSettingsAutoHide();
    showZoomHud(value);
  });
  el.zoomFactorValue.addEventListener('change', commitZoomInput);
  el.zoomFactorValue.addEventListener('blur', commitZoomInput);
  el.zoomFactorValue.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitZoomInput();
    }
  });
}

export async function runZoomAction(action: string) {
  if (action === 'view:zoom-reset') {
    lockQuickSettingsAutoHide(360);
    const applied = await setAppZoomFactor(APP_ZOOM_DEFAULT, { rerenderControls: false });
    const percent = Math.round(applied * 100);
    syncZoomControls(percent);
    showZoomHud(percent);
    return true;
  }
  if (action === 'view:zoom-in') {
    lockQuickSettingsAutoHide(360);
    const applied = await setAppZoomFactor(state.ui.zoomFactor + APP_ZOOM_STEP, { rerenderControls: false });
    const percent = Math.round(applied * 100);
    syncZoomControls(percent);
    showZoomHud(percent);
    return true;
  }
  if (action === 'view:zoom-out') {
    lockQuickSettingsAutoHide(360);
    const applied = await setAppZoomFactor(state.ui.zoomFactor - APP_ZOOM_STEP, { rerenderControls: false });
    const percent = Math.round(applied * 100);
    syncZoomControls(percent);
    showZoomHud(percent);
    return true;
  }
  return false;
}
