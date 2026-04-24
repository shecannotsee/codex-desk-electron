import {
  APP_ZOOM_DEFAULT,
  clampAppZoom,
  currentLang,
  el,
  resolvePermissionSummary,
  state,
  t,
} from './state_i18n.js';
import { ensureMeta } from './conversation_runtime.js';

function renderSecretVisibilityToggle(button: HTMLButtonElement | null | undefined, input: HTMLInputElement | null | undefined) {
  if (!button || !input) {
    return;
  }
  const visible = input.type === 'text';
  const label = visible ? t('hideSecret') : t('showSecret');
  button.textContent = label;
  button.title = label;
  button.setAttribute('aria-label', label);
}

function securityStatusLabel() {
  const hasMasterPassword = Boolean(state.settings.security?.hasMasterPassword);
  const unlocked = Boolean(state.settings.security?.unlocked);
  if (!hasMasterPassword) {
    return t('securityStatusUnset');
  }
  return unlocked ? t('securityStatusUnlocked') : t('securityStatusLocked');
}

function renderSettings() {
  const meta = ensureMeta(state.activeConversationId);
  if (el.aboutCodexVersionInput) {
    const version = String(meta['Codex版本'] || '-').trim() || '-';
    el.aboutCodexVersionInput.value = version;
    el.aboutCodexVersionInput.title = version;
  }
  if (el.commandInput) {
    el.commandInput.value = state.settings.commandText || '';
    el.commandInput.title = state.settings.commandText || '-';
  }
  if (el.workdirInput) {
    el.workdirInput.value = state.settings.workdir || '';
    el.workdirInput.title = state.settings.workdir || '-';
  }
  if (el.qsDeviceIdentityInput) {
    el.qsDeviceIdentityInput.value = String(state.settings.deviceIdentity || '').trim();
    el.qsDeviceIdentityInput.title = String(state.settings.deviceIdentity || '').trim();
  }
  const activeNotificationProvider = String(state.settings.notifications?.activeProvider || 'telegram').trim().toLowerCase();
  const telegramSettings = state.settings.notifications?.providers?.telegram;
  const telegramRemoteControl = state.settings.remoteControl?.providers?.telegram;
  const security = state.settings.security;
  const canEditSecrets = !Boolean(security?.hasMasterPassword) || Boolean(security?.unlocked);
  const isCredentialLocked = Boolean(security?.hasMasterPassword) && !Boolean(security?.unlocked);
  const hasActiveTelegramUsage = Boolean(telegramSettings?.enabled || telegramRemoteControl?.enabled);
  if (el.qsNotificationProviderTelegram) {
    el.qsNotificationProviderTelegram.classList.toggle('active', activeNotificationProvider === 'telegram');
  }
  if (el.qsSecurityRuntimeAlert) {
    el.qsSecurityRuntimeAlert.classList.toggle('hidden', !(isCredentialLocked && hasActiveTelegramUsage));
  }
  if (el.qsTelegramLockAlert) {
    el.qsTelegramLockAlert.classList.toggle('hidden', !(isCredentialLocked && hasActiveTelegramUsage));
  }
  if (el.qsSecurityStatusValue) {
    el.qsSecurityStatusValue.textContent = securityStatusLabel();
  }
  if (el.qsTelegramEnabled) {
    el.qsTelegramEnabled.checked = Boolean(telegramSettings?.enabled);
  }
  if (el.qsTelegramBotTokenInput) {
    el.qsTelegramBotTokenInput.value = String(telegramSettings?.botToken || '').trim();
    el.qsTelegramBotTokenInput.title = canEditSecrets ? t('telegramBotTokenPlaceholder') : t('securityLockedHint');
    el.qsTelegramBotTokenInput.disabled = !canEditSecrets;
  }
  renderSecretVisibilityToggle(el.qsTelegramToggleTokenVisibility, el.qsTelegramBotTokenInput);
  if (el.qsTelegramToggleTokenVisibility) {
    el.qsTelegramToggleTokenVisibility.disabled = !canEditSecrets;
  }
  if (el.qsTelegramChatIdInput) {
    const chatId = String(telegramSettings?.chatId || '').trim();
    el.qsTelegramChatIdInput.value = chatId;
    el.qsTelegramChatIdInput.title = chatId || '-';
  }
  if (el.qsTelegramRemoteControlEnabled) {
    el.qsTelegramRemoteControlEnabled.checked = Boolean(telegramRemoteControl?.enabled);
  }
  if (el.qsTelegramRemoteBotTokenInput) {
    el.qsTelegramRemoteBotTokenInput.value = String(telegramRemoteControl?.botToken || '').trim();
    el.qsTelegramRemoteBotTokenInput.title = canEditSecrets ? t('telegramRemoteBotTokenPlaceholder') : t('securityLockedHint');
    el.qsTelegramRemoteBotTokenInput.disabled = !canEditSecrets;
  }
  renderSecretVisibilityToggle(el.qsTelegramToggleRemoteTokenVisibility, el.qsTelegramRemoteBotTokenInput);
  if (el.qsTelegramToggleRemoteTokenVisibility) {
    el.qsTelegramToggleRemoteTokenVisibility.disabled = !canEditSecrets;
  }
  if (el.qsTelegramAllowedChatIdInput) {
    const allowedChatId = String(telegramRemoteControl?.allowedChatId || '').trim();
    el.qsTelegramAllowedChatIdInput.value = allowedChatId;
    el.qsTelegramAllowedChatIdInput.title = allowedChatId || '-';
  }
  const perm = resolvePermissionSummary();
  if (el.permissionInput) {
    el.permissionInput.value = perm.text;
    el.permissionInput.title = perm.title;
  }
  el.languageSelect.value = currentLang();
  if (el.zoomFactorRange) {
    el.zoomFactorRange.value = String(Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100));
  }
  if (el.zoomFactorValue) {
    el.zoomFactorValue.textContent = `${Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100)}%`;
  }
  el.fontSizeRange.value = String(state.ui.chatFontSize);
  el.fontSizeValue.value = String(state.ui.chatFontSize);
  if (el.qsAppName) {
    el.qsAppName.textContent = String(state.appInfo?.name || 'Codex Desk').trim() || 'Codex Desk';
  }
  if (el.qsAppVersion) {
    const rawVersion = String(state.appInfo?.version || '').trim();
    el.qsAppVersion.textContent = rawVersion ? `v${rawVersion.replace(/^v/i, '')}` : 'v-';
  }
  if (el.qsTelegramTest) {
    el.qsTelegramTest.disabled = Boolean(security?.hasMasterPassword) && !Boolean(security?.unlocked);
  }
  if (el.qsSecurityUnlockInput) {
    el.qsSecurityUnlockInput.disabled = !Boolean(security?.hasMasterPassword) || Boolean(security?.unlocked);
  }
  renderSecretVisibilityToggle(el.qsSecurityUnlockToggle, el.qsSecurityUnlockInput);
  if (el.qsSecurityUnlockToggle) {
    el.qsSecurityUnlockToggle.disabled = !Boolean(security?.hasMasterPassword) || Boolean(security?.unlocked);
  }
  if (el.qsSecurityUnlockAction) {
    el.qsSecurityUnlockAction.disabled = !Boolean(security?.hasMasterPassword) || Boolean(security?.unlocked);
  }
  if (el.qsSecurityLockAction) {
    el.qsSecurityLockAction.disabled = !Boolean(security?.hasMasterPassword) || !Boolean(security?.unlocked);
  }
  if (el.qsSecurityNewPasswordInput) {
    el.qsSecurityNewPasswordInput.disabled = Boolean(security?.hasMasterPassword) && !Boolean(security?.unlocked);
  }
  renderSecretVisibilityToggle(el.qsSecurityNewPasswordToggle, el.qsSecurityNewPasswordInput);
  if (el.qsSecurityNewPasswordToggle) {
    el.qsSecurityNewPasswordToggle.disabled = Boolean(security?.hasMasterPassword) && !Boolean(security?.unlocked);
  }
  if (el.qsSecurityConfirmPasswordInput) {
    el.qsSecurityConfirmPasswordInput.disabled = Boolean(security?.hasMasterPassword) && !Boolean(security?.unlocked);
  }
  renderSecretVisibilityToggle(el.qsSecurityConfirmPasswordToggle, el.qsSecurityConfirmPasswordInput);
  if (el.qsSecurityConfirmPasswordToggle) {
    el.qsSecurityConfirmPasswordToggle.disabled = Boolean(security?.hasMasterPassword) && !Boolean(security?.unlocked);
  }
  if (el.qsSecuritySetPasswordAction) {
    el.qsSecuritySetPasswordAction.disabled = Boolean(security?.hasMasterPassword);
  }
  if (el.qsSecurityChangePasswordAction) {
    el.qsSecurityChangePasswordAction.disabled = !Boolean(security?.hasMasterPassword) || !Boolean(security?.unlocked);
  }
}

export {
  renderSettings,
};
