import { codexdesk } from './codexdesk.js';
import type { CloseGuardPayload, ConfirmDialogOptions, ImportSessionPreview, ImportWorkdirChoice } from './types.js';
import { el, localizeKnownText, state, t } from './state_i18n.js';

function askRenameTitle(initialValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = el.renameModal;
    const input = el.renameInput;
    const cancelBtn = el.renameCancel;
    const confirmBtn = el.renameConfirm;

    input.value = initialValue || '';
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      input.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      const next = String(input.value || '').trim();
      cleanup();
      resolve(next);
    };

    const onBackdrop = (event: Event) => {
      if (event.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    input.addEventListener('keydown', onKeyDown);
  });
}

function askCreateConversationWorkdir(): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = el.createConversationModal;
    const workdirInput = el.createConversationWorkdirInput;
    const browseBtn = el.createConversationBrowse;
    const cancelBtn = el.createConversationCancel;
    const confirmBtn = el.createConversationConfirm;
    if (!modal || !workdirInput || !browseBtn || !cancelBtn || !confirmBtn) {
      resolve('');
      return;
    }

    const defaultWorkdir = String(state.settings.defaultWorkdir || state.settings.workdir || '').trim();
    let selectedWorkdir = defaultWorkdir;

    const syncWorkdirInput = () => {
      workdirInput.value = selectedWorkdir;
      workdirInput.title = selectedWorkdir || '-';
    };

    syncWorkdirInput();
    modal.classList.remove('hidden');
    browseBtn.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      browseBtn.removeEventListener('click', onBrowse);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      cleanup();
      resolve(selectedWorkdir);
    };

    const onBrowse = async () => {
      const result = await codexdesk.pickWorkdir({
        defaultPath: selectedWorkdir || defaultWorkdir,
      });
      if (result?.canceled) {
        return;
      }
      if (result?.error) {
        window.alert(localizeKnownText(result.error));
        return;
      }
      selectedWorkdir = String(result?.directoryPath || '').trim();
      syncWorkdirInput();
    };

    const onBackdrop = (event: Event) => {
      if (event.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };

    browseBtn.addEventListener('click', onBrowse);
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

function askConfirmDialog(options: ConfirmDialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = el.confirmModal;
    const titleEl = el.confirmModalTitle;
    const bodyEl = el.confirmModalBody;
    const cancelBtn = el.confirmCancel;
    const acceptBtn = el.confirmAccept;
    if (!modal || !titleEl || !bodyEl || !cancelBtn || !acceptBtn) {
      resolve(false);
      return;
    }

    titleEl.textContent = String(options.title || '');
    bodyEl.textContent = String(options.message || '');
    modal.classList.remove('hidden');
    cancelBtn.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      acceptBtn.removeEventListener('click', onAccept);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onAccept = () => {
      cleanup();
      resolve(true);
    };

    const onBackdrop = (event: Event) => {
      if (event.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onAccept();
      }
    };

    cancelBtn.addEventListener('click', onCancel);
    acceptBtn.addEventListener('click', onAccept);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

function askImportSessionMode(importInfo: ImportSessionPreview = {}, preferredMode = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = el.importModeModal;
    const cancelBtn = el.importModeCancel;
    const confirmBtn = el.importModeConfirm;
    const fileEl = el.importModeFile;
    const sessionEl = el.importModeSession;
    const optionButtons = [el.importModeResume, el.importModeFork].filter(Boolean);
    if (!modal || !cancelBtn || !confirmBtn || !fileEl || !sessionEl || optionButtons.length < 2) {
      resolve(null);
      return;
    }

    let selectedMode = '';
    fileEl.textContent = t('importModeFile', { value: String(importInfo.filePath || '-') });
    sessionEl.textContent = t('importModeSession', { value: String(importInfo.sessionId || '-') });
    confirmBtn.disabled = true;
    optionButtons.forEach((button) => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
    const cleanup = () => {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
      optionButtons.forEach((button) => {
        button.removeEventListener('click', onOptionClick);
      });
    };

    const applySelection = (mode: string) => {
      selectedMode = mode;
      confirmBtn.disabled = !selectedMode;
      optionButtons.forEach((button) => {
        const active = button.getAttribute('data-mode') === selectedMode;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      if (!selectedMode) {
        return;
      }
      cleanup();
      resolve(selectedMode);
    };

    const onBackdrop = (event: Event) => {
      if (event.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter' && selectedMode) {
        event.preventDefault();
        onConfirm();
      }
    };

    const onOptionClick = (event: Event) => {
      const target = event.currentTarget;
      if (!(target instanceof Element)) {
        return;
      }
      applySelection(String(target.getAttribute('data-mode') || ''));
    };

    modal.classList.remove('hidden');
    if (preferredMode === 'resume' || preferredMode === 'fork') {
      applySelection(preferredMode);
    }
    const preferredButton = optionButtons.find((button) => button.getAttribute('data-mode') === selectedMode);
    (preferredButton || optionButtons[0]).focus();

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
    optionButtons.forEach((button) => {
      button.addEventListener('click', onOptionClick);
    });
  });
}

function askImportSessionWorkdirMode(importInfo: ImportSessionPreview = {}): Promise<ImportWorkdirChoice | null> {
  return new Promise((resolve) => {
    const modal = el.importWorkdirModal;
    const fileEl = el.importWorkdirFile;
    const importedBtn = el.importWorkdirImported;
    const importedDesc = el.importWorkdirImportedDesc;
    const defaultBtn = el.importWorkdirDefault;
    const defaultDesc = el.importWorkdirDefaultDesc;
    const customBtn = el.importWorkdirCustom;
    const customDesc = el.importWorkdirCustomDesc;
    const customBrowseBtn = el.importWorkdirCustomBrowse;
    const cancelBtn = el.importWorkdirCancel;
    const confirmBtn = el.importWorkdirConfirm;
    if (!modal || !fileEl || !importedBtn || !importedDesc || !defaultBtn || !defaultDesc || !customBtn || !customDesc || !customBrowseBtn || !cancelBtn || !confirmBtn) {
      resolve({ mode: 'default' });
      return;
    }

    const importedCwd = String(importInfo.cwd || '').trim();
    const hasImportedWorkdir = Boolean(importInfo.hasImportedWorkdir && importedCwd);
    const defaultWorkdir = String(state.settings.defaultWorkdir || '').trim();
    let selectedMode = 'default';
    let customWorkdir = '';

    fileEl.textContent = t('importWorkdirFile', { value: String(importInfo.filePath || '-') });
    importedDesc.textContent = hasImportedWorkdir
      ? t('importWorkdirImportedDesc', { value: importedCwd })
      : t('importWorkdirImportedUnavailable');
    importedDesc.title = importedCwd;
    defaultDesc.textContent = t('importWorkdirDefaultDesc', { value: defaultWorkdir || '-' });
    defaultDesc.title = defaultWorkdir || '-';
    customDesc.textContent = t('importWorkdirCustomUnset');
    customDesc.title = '';
    importedBtn.disabled = !hasImportedWorkdir;

    const updateConfirmState = () => {
      confirmBtn.disabled = selectedMode === 'custom' && !customWorkdir;
    };

    const syncCustomDesc = () => {
      const text = customWorkdir || t('importWorkdirCustomUnset');
      customDesc.textContent = customWorkdir
        ? t('importWorkdirCustomDesc', { value: customWorkdir })
        : text;
      customDesc.title = customWorkdir;
      updateConfirmState();
    };

    const applySelection = (mode: string) => {
      let nextMode = 'default';
      if (mode === 'imported' && hasImportedWorkdir) {
        nextMode = 'imported';
      } else if (mode === 'custom') {
        nextMode = 'custom';
      }
      selectedMode = nextMode;
      importedBtn.classList.toggle('is-selected', nextMode === 'imported');
      importedBtn.setAttribute('aria-pressed', nextMode === 'imported' ? 'true' : 'false');
      defaultBtn.classList.toggle('is-selected', nextMode === 'default');
      defaultBtn.setAttribute('aria-pressed', nextMode === 'default' ? 'true' : 'false');
      customBtn.classList.toggle('is-selected', nextMode === 'custom');
      customBtn.setAttribute('aria-pressed', nextMode === 'custom' ? 'true' : 'false');
      updateConfirmState();
    };

    syncCustomDesc();
    applySelection('default');
    modal.classList.remove('hidden');
    defaultBtn.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      importedBtn.removeEventListener('click', onImported);
      defaultBtn.removeEventListener('click', onDefault);
      customBtn.removeEventListener('click', onCustom);
      customBrowseBtn.removeEventListener('click', onBrowseCustom);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onImported = () => {
      applySelection('imported');
    };

    const onDefault = () => {
      applySelection('default');
    };

    const onCustom = () => {
      applySelection('custom');
    };

    const onBrowseCustom = async () => {
      const result = await codexdesk.pickWorkdir({
        defaultPath: customWorkdir || importedCwd || defaultWorkdir,
      });
      if (result?.canceled) {
        return;
      }
      if (result?.error) {
        window.alert(localizeKnownText(result.error));
        return;
      }
      customWorkdir = String(result?.directoryPath || '').trim();
      syncCustomDesc();
      if (customWorkdir) {
        applySelection('custom');
      }
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onConfirm = () => {
      if (selectedMode === 'custom' && !customWorkdir) {
        return;
      }
      cleanup();
      resolve({
        mode: selectedMode,
        workdir: selectedMode === 'custom' ? customWorkdir : '',
      });
    };

    const onBackdrop = (event: Event) => {
      if (event.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onConfirm();
      }
    };

    importedBtn.addEventListener('click', onImported);
    defaultBtn.addEventListener('click', onDefault);
    customBtn.addEventListener('click', onCustom);
    customBrowseBtn.addEventListener('click', onBrowseCustom);
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);
  });
}

function resolvePreferredImportContinuationMode(importInfo: ImportSessionPreview = {}, workdirChoice: ImportWorkdirChoice | null | undefined): string {
  const importedCwd = String(importInfo.cwd || '').trim();
  const selectedMode = String(workdirChoice?.mode || 'default').trim() || 'default';
  const selectedWorkdir = String(workdirChoice?.workdir || '').trim();
  const defaultWorkdir = String(state.settings.defaultWorkdir || '').trim();

  let resolvedWorkdir = defaultWorkdir;
  if (selectedMode === 'imported') {
    resolvedWorkdir = importedCwd;
  } else if (selectedMode === 'custom') {
    resolvedWorkdir = selectedWorkdir;
  }

  if (!importedCwd) {
    return selectedMode === 'imported' ? 'resume' : 'fork';
  }
  return resolvedWorkdir && resolvedWorkdir === importedCwd ? 'resume' : 'fork';
}

function hideCloseGuardModal() {
  if (!el.closeGuardModal) {
    return;
  }
  el.closeGuardModal.classList.add('hidden');
  if (el.closeGuardCancel) {
    el.closeGuardCancel.disabled = false;
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.disabled = false;
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.disabled = false;
  }
}

function showCloseGuardModal(payload: CloseGuardPayload = {}) {
  if (!el.closeGuardModal) {
    return;
  }
  if (el.closeGuardTitle) {
    el.closeGuardTitle.textContent = String(payload.title || t('closeGuardTitle'));
  }
  if (el.closeGuardMessage) {
    el.closeGuardMessage.textContent = String(payload.message || '');
  }
  if (el.closeGuardDetail) {
    el.closeGuardDetail.textContent = String(payload.detail || t('closeGuardDetail'));
  }
  if (el.closeGuardCancel) {
    el.closeGuardCancel.textContent = String(payload.cancelLabel || t('closeGuardCancel'));
    el.closeGuardCancel.disabled = false;
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.textContent = String(payload.stopAndCloseLabel || t('closeGuardStopAndClose'));
    el.closeGuardStop.disabled = false;
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.textContent = String(payload.forceCloseLabel || t('closeGuardForceClose'));
    el.closeGuardForce.disabled = false;
  }
  el.closeGuardModal.classList.remove('hidden');
  if (el.closeGuardCancel) {
    el.closeGuardCancel.focus();
  }
}

async function resolveCloseGuardAction(action: string) {
  const nextAction = String(action || '').trim();
  if (!nextAction) {
    return;
  }
  if (el.closeGuardCancel) {
    el.closeGuardCancel.disabled = true;
  }
  if (el.closeGuardStop) {
    el.closeGuardStop.disabled = true;
  }
  if (el.closeGuardForce) {
    el.closeGuardForce.disabled = true;
  }
  try {
    await codexdesk.resolveCloseGuard(nextAction);
    if (nextAction === 'cancel') {
      hideCloseGuardModal();
    }
  } catch {
    hideCloseGuardModal();
  }
}

export {
  askConfirmDialog,
  askCreateConversationWorkdir,
  askImportSessionMode,
  askImportSessionWorkdirMode,
  askRenameTitle,
  hideCloseGuardModal,
  resolveCloseGuardAction,
  resolvePreferredImportContinuationMode,
  showCloseGuardModal,
};
