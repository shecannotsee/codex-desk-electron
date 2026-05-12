import {
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  applyChatFontSize,
  applyRuntimePanelWidth,
  applySidebarWidth,
  applyTheme,
  el,
  loadDraftPrefs,
  loadUiPrefs,
  saveUiPrefs,
  setChatFontSize,
  state,
  syncMenuLanguage,
} from './state_i18n.js';
import { bindZoomControls } from './app_zoom_controller.js';
import { loadAgentTeamPrefs } from './agent_team.js';
import { renderAll } from './renderers.js';

export function bindUiInit(deps: {
  integrationSettings: { renderLocalizedState: () => void };
}) {
  loadUiPrefs();
  loadDraftPrefs();
  loadAgentTeamPrefs();
  applyTheme();
  applySidebarWidth();
  applyRuntimePanelWidth();
  applyChatFontSize();

  el.languageSelect.addEventListener('change', () => {
    state.ui.language = el.languageSelect.value === 'en-US' ? 'en-US' : 'zh-CN';
    saveUiPrefs();
    renderAll();
    deps.integrationSettings.renderLocalizedState();
    syncMenuLanguage();
  });

  bindZoomControls();

  el.fontSizeRange.addEventListener('input', () => {
    setChatFontSize(el.fontSizeRange.value);
  });

  el.fontSizeValue.addEventListener('input', () => {
    const raw = String(el.fontSizeValue.value || '').trim();
    if (!raw) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (value < CHAT_FONT_SIZE_MIN || value > CHAT_FONT_SIZE_MAX) return;
    setChatFontSize(value, { rerenderControls: false });
    el.fontSizeRange.value = String(state.ui.chatFontSize);
  });

  const commitFontSizeInput = () => {
    setChatFontSize(el.fontSizeValue.value);
  };
  el.fontSizeValue.addEventListener('focus', () => { el.fontSizeValue.select(); });
  el.fontSizeValue.addEventListener('change', commitFontSizeInput);
  el.fontSizeValue.addEventListener('blur', commitFontSizeInput);
  el.fontSizeValue.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitFontSizeInput();
    }
  });
}
