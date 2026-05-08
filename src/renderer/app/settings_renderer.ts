import {
  APP_ZOOM_DEFAULT,
  clampAppZoom,
  currentLang,
  el,
  state,
  t,
} from './state_i18n.js';
import { ensureMeta } from './conversation_runtime.js';
import { resolvePermissionSummary } from './permission_summary.js';

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

function securityStatusSummary(hasActiveMessagingUsage: boolean) {
  const hasMasterPassword = Boolean(state.settings.security?.hasMasterPassword);
  const unlocked = Boolean(state.settings.security?.unlocked);
  if (!hasMasterPassword) {
    return t('securityStatusSummaryUnset');
  }
  if (unlocked) {
    return t('securityStatusSummaryUnlocked');
  }
  return hasActiveMessagingUsage
    ? t('securityStatusSummaryLockedActive')
    : t('securityStatusSummaryLockedIdle');
}

function renderSettings() {
  const meta = ensureMeta(state.activeConversationId);
  if (el.aboutCodexVersionInput) {
    const version = String(meta['Claude版本'] || meta['Codex版本'] || '-').trim() || '-';
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
  const hasMasterPassword = Boolean(security?.hasMasterPassword);
  const isUnlocked = Boolean(security?.unlocked);
  const canEditSecrets = !hasMasterPassword || isUnlocked;
  const isCredentialLocked = hasMasterPassword && !isUnlocked;
  const showUnlockCard = hasMasterPassword && !isUnlocked;
  const showLockCard = hasMasterPassword && isUnlocked;
  const showPasswordCard = !hasMasterPassword || isUnlocked;
  const showPasswordLockedNote = hasMasterPassword && !isUnlocked;
  const hasActiveMessagingUsage = Boolean(telegramSettings?.enabled || telegramRemoteControl?.enabled);
  if (el.qsNotificationProviderTelegram) {
    el.qsNotificationProviderTelegram.classList.toggle('active', activeNotificationProvider === 'telegram');
  }
  if (el.qsSecurityRuntimeAlert) {
    el.qsSecurityRuntimeAlert.classList.toggle('hidden', !(isCredentialLocked && hasActiveMessagingUsage));
  }
  if (el.qsTelegramLockAlert) {
    el.qsTelegramLockAlert.classList.toggle('hidden', !(isCredentialLocked && hasActiveMessagingUsage));
  }
  if (el.qsSecurityStatusValue) {
    el.qsSecurityStatusValue.textContent = securityStatusLabel();
  }
  const securitySummary = securityStatusSummary(hasActiveMessagingUsage);
  if (el.qsSecurityEntryStatus) {
    el.qsSecurityEntryStatus.textContent = securitySummary;
  }
  if (el.qsSecurityStatusExplainer) {
    el.qsSecurityStatusExplainer.textContent = securitySummary;
  }
  if (el.qsSecurityUnlockCard) {
    el.qsSecurityUnlockCard.classList.toggle('hidden', !showUnlockCard);
  }
  if (el.qsSecurityLockCard) {
    el.qsSecurityLockCard.classList.toggle('hidden', !showLockCard);
  }
  if (el.qsSecurityPasswordCard) {
    el.qsSecurityPasswordCard.classList.toggle('hidden', !showPasswordCard);
  }
  if (el.qsSecurityPasswordLockedNote) {
    el.qsSecurityPasswordLockedNote.classList.toggle('hidden', !showPasswordLockedNote);
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
    el.zoomFactorValue.value = String(Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100));
  }
  el.fontSizeRange.value = String(state.ui.chatFontSize);
  el.fontSizeValue.value = String(state.ui.chatFontSize);
  el.qsLanguageOptions.forEach((node) => {
    const value = String(node.getAttribute('data-language-option') || '').trim();
    const active = value === currentLang();
    node.setAttribute('aria-checked', active ? 'true' : 'false');
    node.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (el.qsAppName) {
    el.qsAppName.textContent = String(state.appInfo?.name || 'Conductor').trim() || 'Conductor';
  }
  if (el.qsAppVersion) {
    const rawVersion = String(state.appInfo?.version || '').trim();
    el.qsAppVersion.textContent = rawVersion ? `v${rawVersion.replace(/^v/i, '')}` : 'v-';
  }
  if (el.qsTelegramTest) {
    el.qsTelegramTest.disabled = isCredentialLocked;
  }
  if (el.qsSecurityUnlockInput) {
    el.qsSecurityUnlockInput.disabled = !showUnlockCard;
  }
  renderSecretVisibilityToggle(el.qsSecurityUnlockToggle, el.qsSecurityUnlockInput);
  if (el.qsSecurityUnlockToggle) {
    el.qsSecurityUnlockToggle.disabled = !showUnlockCard;
  }
  if (el.qsSecurityUnlockAction) {
    el.qsSecurityUnlockAction.disabled = !showUnlockCard;
  }
  if (el.qsSecurityLockAction) {
    el.qsSecurityLockAction.disabled = !showLockCard;
  }
  if (el.qsSecurityNewPasswordInput) {
    el.qsSecurityNewPasswordInput.disabled = !showPasswordCard;
  }
  renderSecretVisibilityToggle(el.qsSecurityNewPasswordToggle, el.qsSecurityNewPasswordInput);
  if (el.qsSecurityNewPasswordToggle) {
    el.qsSecurityNewPasswordToggle.disabled = !showPasswordCard;
  }
  if (el.qsSecurityConfirmPasswordInput) {
    el.qsSecurityConfirmPasswordInput.disabled = !showPasswordCard;
  }
  renderSecretVisibilityToggle(el.qsSecurityConfirmPasswordToggle, el.qsSecurityConfirmPasswordInput);
  if (el.qsSecurityConfirmPasswordToggle) {
    el.qsSecurityConfirmPasswordToggle.disabled = !showPasswordCard;
  }
  if (el.qsSecuritySetPasswordAction) {
    el.qsSecuritySetPasswordAction.disabled = hasMasterPassword || !showPasswordCard;
  }
  if (el.qsSecurityChangePasswordAction) {
    el.qsSecurityChangePasswordAction.disabled = !hasMasterPassword || !isUnlocked || !showPasswordCard;
  }
}

export {
  renderSettings,
};
