import { codexdesk } from './codexdesk.js';
import type { AppSnapshot, GenericResult } from './types.js';
import { el, localizeKnownText, state, t } from './state_i18n.js';
import { renderAll, renderSettings } from './renderers.js';

type NoticeTone = 'info' | 'success' | 'error';
type MasterPasswordMode = 'set' | 'change';

type ApplySnapshot = (snapshot: AppSnapshot | null | undefined) => void;
type ShowNotice = (message: string, tone?: NoticeTone) => void;

interface IntegrationSettingsHooks {
  applySnapshot: ApplySnapshot;
  showNotice: ShowNotice;
}

type TelegramTestTarget = {
  label: string;
  ready: boolean;
  run: () => Promise<{ ok?: boolean; error?: string }>;
};

const telegramLogsState = {
  loading: false,
  loaded: false,
  text: '',
  path: '',
  count: 0,
};

const securityFormState = {
  unlockError: '',
  passwordError: '',
};

let credentialRuntimeNoticeShown = false;

function collectNotificationSettingsPayload() {
  const botToken = String(el.qsTelegramBotTokenInput?.value || '').trim();
  const remoteBotToken = String(el.qsTelegramRemoteBotTokenInput?.value || '').trim();
  return {
    deviceIdentity: String(el.qsDeviceIdentityInput?.value || '').trim(),
    notifications: {
      activeProvider: 'telegram',
      telegram: {
        enabled: Boolean(el.qsTelegramEnabled?.checked),
        chatId: String(el.qsTelegramChatIdInput?.value || '').trim(),
        ...(botToken ? { botToken } : {}),
      },
    },
    remoteControl: {
      activeProvider: 'telegram',
      telegram: {
        enabled: Boolean(el.qsTelegramRemoteControlEnabled?.checked),
        ...(remoteBotToken ? { botToken: remoteBotToken } : {}),
        allowedChatId: String(el.qsTelegramAllowedChatIdInput?.value || '').trim(),
      },
    },
  };
}

function updateSecretToggleLabel(button: HTMLButtonElement | null | undefined, input: HTMLInputElement | null | undefined) {
  if (!button || !input) {
    return;
  }
  const label = input.type === 'text' ? t('hideSecret') : t('showSecret');
  button.textContent = label;
  button.title = label;
  button.setAttribute('aria-label', label);
}

function clearSecurityDraftInputs() {
  if (el.qsSecurityUnlockInput) {
    el.qsSecurityUnlockInput.value = '';
  }
  if (el.qsSecurityNewPasswordInput) {
    el.qsSecurityNewPasswordInput.value = '';
  }
  if (el.qsSecurityConfirmPasswordInput) {
    el.qsSecurityConfirmPasswordInput.value = '';
  }
}

function renderSecurityInlineError(target: HTMLElement | null | undefined, message: string) {
  if (!target) {
    return;
  }
  const text = String(message || '').trim();
  target.textContent = text;
  target.classList.toggle('hidden', !text);
}

function setUnlockError(message: string) {
  securityFormState.unlockError = String(message || '').trim();
  renderSecurityInlineError(el.qsSecurityUnlockError, securityFormState.unlockError);
}

function setPasswordError(message: string) {
  securityFormState.passwordError = String(message || '').trim();
  renderSecurityInlineError(el.qsSecurityPasswordError, securityFormState.passwordError);
}

function clearUnlockError() {
  setUnlockError('');
}

function clearPasswordError() {
  setPasswordError('');
}

function clearSecurityErrors() {
  clearUnlockError();
  clearPasswordError();
}

function collectTelegramTestTargets(): TelegramTestTarget[] {
  const targets: TelegramTestTarget[] = [];
  if (el.qsTelegramEnabled?.checked) {
    const telegramSettings = state.settings.notifications?.providers?.telegram;
    targets.push({
      label: t('telegramTestNotificationLabel'),
      ready: Boolean(telegramSettings?.hasBotToken && String(telegramSettings?.chatId || '').trim()),
      run: () => codexdesk.testNotificationProvider(),
    });
  }
  if (el.qsTelegramRemoteControlEnabled?.checked) {
    const telegramRemoteControl = state.settings.remoteControl?.providers?.telegram;
    targets.push({
      label: t('telegramTestRemoteLabel'),
      ready: Boolean(telegramRemoteControl?.hasBotToken && String(telegramRemoteControl?.allowedChatId || '').trim()),
      run: () => codexdesk.testRemoteControlProvider(),
    });
  }
  return targets;
}

function shouldShowCredentialRuntimeLockNotice() {
  const security = state.settings.security;
  if (!security?.hasMasterPassword || security?.unlocked) {
    return false;
  }
  const notificationsEnabled = Boolean(state.settings.notifications?.providers?.telegram?.enabled);
  const remoteControlEnabled = Boolean(state.settings.remoteControl?.providers?.telegram?.enabled);
  return notificationsEnabled || remoteControlEnabled;
}

export function createIntegrationSettingsController(hooks: IntegrationSettingsHooks) {
  const applyResultSnapshot = (result: GenericResult | AppSnapshot | null | undefined) => {
    hooks.applySnapshot(((result as GenericResult)?.snapshot || result || {}) as AppSnapshot);
  };

  const renderTelegramLogsPane = () => {
    if (el.qsTelegramLogsPath) {
      el.qsTelegramLogsPath.value = telegramLogsState.path;
      el.qsTelegramLogsPath.title = telegramLogsState.path || '-';
    }
    if (el.qsTelegramLogsCount) {
      el.qsTelegramLogsCount.textContent = String(Math.max(0, Number(telegramLogsState.count) || 0));
    }
    if (el.qsTelegramLogsOutput) {
      if (telegramLogsState.loading) {
        el.qsTelegramLogsOutput.value = t('telegramLogsLoading');
      } else {
        el.qsTelegramLogsOutput.value = telegramLogsState.text || t('telegramLogsEmpty');
      }
    }
    if (el.qsTelegramLogsRefresh) {
      el.qsTelegramLogsRefresh.disabled = telegramLogsState.loading;
    }
    if (el.qsTelegramLogsCopy) {
      el.qsTelegramLogsCopy.disabled = telegramLogsState.loading || Math.max(0, Number(telegramLogsState.count) || 0) <= 0;
    }
  };

  const refreshCredentialRuntimeLockNotice = () => {
    if (!shouldShowCredentialRuntimeLockNotice()) {
      credentialRuntimeNoticeShown = false;
      return;
    }
    if (credentialRuntimeNoticeShown) {
      return;
    }
    credentialRuntimeNoticeShown = true;
    hooks.showNotice(t('securityRuntimeLockedNotice'), 'error');
  };

  const saveNotificationSettings = async (options: { silent?: boolean } = {}) => {
    const result = await codexdesk.updateSettings(collectNotificationSettingsPayload());
    if (result?.error) {
      hooks.showNotice(localizeKnownText(result.error), 'error');
      hooks.applySnapshot(result?.snapshot || {});
      renderAll();
      return null;
    }
    applyResultSnapshot(result);
    renderSettings();
    if (!options.silent) {
      hooks.showNotice(t('settingsSaved'), 'success');
    }
    return result;
  };

  const testTelegramSettings = async () => {
    const hasCheckedTarget = Boolean(el.qsTelegramEnabled?.checked || el.qsTelegramRemoteControlEnabled?.checked);
    if (!hasCheckedTarget) {
      hooks.showNotice(t('telegramTestNoSelection'), 'error');
      return;
    }
    const saved = await saveNotificationSettings({ silent: true });
    if (!saved) {
      return;
    }
    const targets = collectTelegramTestTargets();
    const failures: string[] = [];
    const readyTargets = targets.filter((item) => {
      if (item.ready) {
        return true;
      }
      failures.push(t('telegramTestSkippedIncomplete', { label: item.label }));
      return false;
    });
    if (!readyTargets.length) {
      hooks.showNotice(t('telegramTestNoReadyConfig'), 'error');
      return;
    }
    const results = await Promise.all(readyTargets.map(async (item) => {
      try {
        return {
          label: item.label,
          result: await item.run(),
        };
      } catch (error) {
        return {
          label: item.label,
          result: {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }));
    let successCount = 0;
    const successLabels: string[] = [];
    results.forEach(({ label, result }) => {
      if (result?.ok) {
        successCount += 1;
        successLabels.push(label);
        return;
      }
      failures.push(t('telegramTestFailed', {
        label,
        error: localizeKnownText(String(result?.error || 'Telegram 请求失败')),
      }));
    });
    if (!failures.length) {
      hooks.showNotice(t('telegramTestSummarySuccess', { labels: successLabels.join('、') }), 'success');
      return;
    }
    if (successCount > 0) {
      hooks.showNotice([
        t('telegramTestSummaryPartial', {
          successCount: String(successCount),
          failureCount: String(failures.length),
        }),
        failures.join('\n'),
      ].filter(Boolean).join('\n'), 'error');
      return;
    }
    hooks.showNotice(t('telegramTestSummaryFailed', { details: failures.join('\n') }), 'error');
  };

  const refreshTelegramLogs = async () => {
    if (!codexdesk || typeof codexdesk.getTelegramLogs !== 'function') {
      return;
    }
    telegramLogsState.loading = true;
    renderTelegramLogsPane();
    try {
      const result = await codexdesk.getTelegramLogs();
      if (result?.error) {
        throw new Error(String(result.error || '读取 Telegram 日志失败'));
      }
      telegramLogsState.loaded = true;
      telegramLogsState.path = String(result?.logPath || '').trim();
      telegramLogsState.count = Math.max(0, Number(result?.logCount || 0) || 0);
      telegramLogsState.text = String(result?.logsText || '').trim();
      renderTelegramLogsPane();
    } catch (error) {
      telegramLogsState.text = '';
      renderTelegramLogsPane();
      hooks.showNotice(localizeKnownText(error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      telegramLogsState.loading = false;
      renderTelegramLogsPane();
    }
  };

  const submitMasterPasswordUpdate = async (mode: MasterPasswordMode) => {
    const password = String(el.qsSecurityNewPasswordInput?.value || '');
    const confirmPassword = String(el.qsSecurityConfirmPasswordInput?.value || '');
    clearPasswordError();
    if (!password.trim()) {
      setPasswordError(t('securityPasswordEmpty'));
      el.qsSecurityNewPasswordInput?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError(t('securityPasswordMismatch'));
      el.qsSecurityConfirmPasswordInput?.focus();
      return;
    }
    const result = await codexdesk.setMasterPassword(password);
    if (result?.error) {
      setPasswordError(localizeKnownText(String(result.error || '')));
      hooks.applySnapshot(result?.snapshot || {});
      renderAll();
      return;
    }
    applyResultSnapshot(result);
    clearSecurityDraftInputs();
    clearSecurityErrors();
    renderSettings();
    hooks.showNotice(t(mode === 'set' ? 'securitySetPasswordSuccess' : 'securityChangePasswordSuccess'), 'success');
  };

  const unlockMasterPassword = async () => {
    const password = String(el.qsSecurityUnlockInput?.value || '');
    clearUnlockError();
    if (!password.trim()) {
      setUnlockError(t('securityPasswordEmpty'));
      el.qsSecurityUnlockInput?.focus();
      return;
    }
    const result = await codexdesk.unlockMasterPassword(password);
    if (result?.error) {
      setUnlockError(localizeKnownText(String(result.error || '')));
      hooks.applySnapshot(result?.snapshot || {});
      renderAll();
      return;
    }
    applyResultSnapshot(result);
    clearSecurityDraftInputs();
    clearSecurityErrors();
    renderSettings();
    hooks.showNotice(t('securityUnlockSuccess'), 'success');
  };

  const lockMasterPassword = async () => {
    const result = await codexdesk.lockMasterPassword();
    if (result?.error) {
      hooks.showNotice(localizeKnownText(String(result.error || '')), 'error');
      hooks.applySnapshot(result?.snapshot || {});
      renderAll();
      return;
    }
    applyResultSnapshot(result);
    clearSecurityDraftInputs();
    clearSecurityErrors();
    renderSettings();
    hooks.showNotice(t('securityLockSuccess'), 'success');
  };

  return {
    getTelegramLogsSnapshot() {
      return {
        loaded: telegramLogsState.loaded,
        loading: telegramLogsState.loading,
        text: telegramLogsState.text,
        count: telegramLogsState.count,
        path: telegramLogsState.path,
      };
    },
    toggleSecretVisibility(input: HTMLInputElement | null | undefined, button: HTMLButtonElement | null | undefined) {
      if (!input) {
        return;
      }
      input.type = input.type === 'password' ? 'text' : 'password';
      updateSecretToggleLabel(button, input);
    },
    clearUnlockError,
    clearPasswordError,
    renderTelegramLogsPane,
    refreshTelegramLogs,
    refreshCredentialRuntimeLockNotice,
    saveNotificationSettings,
    testTelegramSettings,
    submitMasterPasswordUpdate,
    unlockMasterPassword,
    lockMasterPassword,
  };
}
