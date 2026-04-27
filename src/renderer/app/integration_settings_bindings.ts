import {
  el,
  localizeKnownText,
  state,
  t,
} from './state_i18n.js';
import { renderSettings } from './renderers.js';
import { showAppNotice } from './app_notice.js';

type IntegrationSettingsBindingsOptions = {
  setQuickSettingsPane: (paneName: string) => void;
};

async function writeClipboardText(text: string) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Electron/Linux environments can miss navigator.clipboard outside secure focus; textarea copy is the fallback.
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', 'readonly');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  helper.style.pointerEvents = 'none';
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(helper);
  }
}

export function bindIntegrationSettingsBindings(integrationSettings, options: IntegrationSettingsBindingsOptions) {
  if (el.qsTelegramSave) {
    el.qsTelegramSave.addEventListener('click', async () => {
      await integrationSettings.saveNotificationSettings();
    });
  }

  if (el.qsTelegramToggleTokenVisibility) {
    el.qsTelegramToggleTokenVisibility.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsTelegramBotTokenInput, el.qsTelegramToggleTokenVisibility);
    });
  }

  if (el.qsTelegramToggleRemoteTokenVisibility) {
    el.qsTelegramToggleRemoteTokenVisibility.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsTelegramRemoteBotTokenInput, el.qsTelegramToggleRemoteTokenVisibility);
    });
  }

  if (el.qsNotificationProviderTelegram) {
    el.qsNotificationProviderTelegram.addEventListener('click', () => {
      state.settings.notifications.activeProvider = 'telegram';
      renderSettings();
    });
  }

  const openCredentialVaultPane = () => {
    options.setQuickSettingsPane('integration-security');
    window.setTimeout(() => {
      // Focus after pane switch so hidden cards have already updated their classes and disabled state.
      if (el.qsSecurityUnlockInput && !el.qsSecurityUnlockInput.disabled && !el.qsSecurityUnlockCard.classList.contains('hidden')) {
        el.qsSecurityUnlockInput.focus();
        return;
      }
      if (el.qsSecurityNewPasswordInput && !el.qsSecurityNewPasswordInput.disabled && !el.qsSecurityPasswordCard.classList.contains('hidden')) {
        el.qsSecurityNewPasswordInput.focus();
      }
    }, 0);
  };

  if (el.qsSecurityRuntimeUnlock) {
    el.qsSecurityRuntimeUnlock.addEventListener('click', () => {
      openCredentialVaultPane();
    });
  }

  if (el.qsTelegramLockUnlock) {
    el.qsTelegramLockUnlock.addEventListener('click', () => {
      openCredentialVaultPane();
    });
  }

  if (el.qsTelegramTest) {
    el.qsTelegramTest.addEventListener('click', async () => {
      await integrationSettings.testTelegramSettings();
    });
  }
  if (el.qsTelegramLogsRefresh) {
    el.qsTelegramLogsRefresh.addEventListener('click', async () => {
      await integrationSettings.refreshTelegramLogs();
    });
  }
  if (el.qsTelegramLogsCopy) {
    el.qsTelegramLogsCopy.addEventListener('click', async () => {
      const telegramLogsSnapshot = integrationSettings.getTelegramLogsSnapshot();
      const text = String(telegramLogsSnapshot.text || '').trim();
      if (!text || Math.max(0, Number(telegramLogsSnapshot.count) || 0) <= 0) {
        return;
      }
      try {
        await writeClipboardText(text);
        showAppNotice(t('telegramLogsCopySuccess'), 'success');
      } catch (error) {
        showAppNotice(localizeKnownText(error instanceof Error ? error.message : String(error)), 'error');
      }
    });
  }

  if (el.qsSecurityUnlockToggle) {
    el.qsSecurityUnlockToggle.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsSecurityUnlockInput, el.qsSecurityUnlockToggle);
    });
  }

  if (el.qsSecurityNewPasswordToggle) {
    el.qsSecurityNewPasswordToggle.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsSecurityNewPasswordInput, el.qsSecurityNewPasswordToggle);
    });
  }

  if (el.qsSecurityConfirmPasswordToggle) {
    el.qsSecurityConfirmPasswordToggle.addEventListener('click', () => {
      integrationSettings.toggleSecretVisibility(el.qsSecurityConfirmPasswordInput, el.qsSecurityConfirmPasswordToggle);
    });
  }

  if (el.qsSecurityUnlockAction) {
    el.qsSecurityUnlockAction.addEventListener('click', async () => {
      await integrationSettings.unlockMasterPassword();
    });
  }

  if (el.qsSecurityLockAction) {
    el.qsSecurityLockAction.addEventListener('click', async () => {
      await integrationSettings.lockMasterPassword();
    });
  }

  if (el.qsSecuritySetPasswordAction) {
    el.qsSecuritySetPasswordAction.addEventListener('click', async () => {
      await integrationSettings.submitMasterPasswordUpdate('set');
    });
  }

  if (el.qsSecurityChangePasswordAction) {
    el.qsSecurityChangePasswordAction.addEventListener('click', async () => {
      await integrationSettings.submitMasterPasswordUpdate('change');
    });
  }

  if (el.qsSecurityUnlockInput) {
    el.qsSecurityUnlockInput.addEventListener('input', () => {
      integrationSettings.clearUnlockError();
    });
    el.qsSecurityUnlockInput.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      await integrationSettings.unlockMasterPassword();
    });
  }

  const runMasterPasswordSubmitFromKeyboard = async (event: KeyboardEvent) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    if (state.settings.security?.hasMasterPassword) {
      await integrationSettings.submitMasterPasswordUpdate('change');
      return;
    }
    await integrationSettings.submitMasterPasswordUpdate('set');
  };

  if (el.qsSecurityNewPasswordInput) {
    el.qsSecurityNewPasswordInput.addEventListener('input', () => {
      integrationSettings.clearPasswordError();
    });
    el.qsSecurityNewPasswordInput.addEventListener('keydown', runMasterPasswordSubmitFromKeyboard);
  }

  if (el.qsSecurityConfirmPasswordInput) {
    el.qsSecurityConfirmPasswordInput.addEventListener('input', () => {
      integrationSettings.clearPasswordError();
    });
    el.qsSecurityConfirmPasswordInput.addEventListener('keydown', runMasterPasswordSubmitFromKeyboard);
  }
}
