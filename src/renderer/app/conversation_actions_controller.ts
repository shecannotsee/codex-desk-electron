import { codexdesk } from './codexdesk.js';
import {
  el,
  localizeKnownText,
  saveUiPrefs,
  state,
  t,
} from './state_i18n.js';
import { currentConversation } from './conversation_runtime.js';
import {
  askConfirmDialog,
  askCreateConversationWorkdir,
  askImportSessionMode,
  askImportSessionWorkdirMode,
  askRenameTitle,
  resolvePreferredImportContinuationMode,
} from './app_dialogs.js';

type ConversationActionsOptions = {
  applySnapshot: (snapshot: unknown) => void;
  renderAll: () => void;
};

export function bindConversationActions(options: ConversationActionsOptions) {
  const runCreateConversationFlow = async () => {
    const selection = await askCreateConversationWorkdir();
    if (selection === null) {
      return;
    }
    const next = await codexdesk.createConversation({
      workdir: String(selection.workdir || '').trim(),
      provider: selection.provider,
    });
    options.applySnapshot(next);
    options.renderAll();
  };

  const runImportSessionFlow = async () => {
    const picked = await codexdesk.pickImportSession();
    if (picked?.canceled) {
      return;
    }
    if (picked?.error) {
      window.alert(localizeKnownText(picked.error));
      options.applySnapshot(picked?.snapshot || {});
      options.renderAll();
      return;
    }

    const preview = picked?.preview;
    const filePath = String(preview?.filePath || '').trim();
    if (!filePath) {
      window.alert(localizeKnownText('导入会话失败: 未获取到导入文件信息'));
      options.applySnapshot(picked?.snapshot || {});
      options.renderAll();
      return;
    }

    const workdirChoice = await askImportSessionWorkdirMode(preview);
    if (!workdirChoice) {
      return;
    }

    let continuationMode = 'resume';
    if (String(preview?.sessionId || '').trim()) {
      // Imported native sessions can either resume original memory or fork into local history; ask after workdir is known.
      const selectedMode = await askImportSessionMode(
        preview,
        resolvePreferredImportContinuationMode(preview, workdirChoice),
      );
      if (!selectedMode) {
        return;
      }
      continuationMode = selectedMode;
    }

    const result = await codexdesk.importSessionFromFile(filePath, continuationMode, workdirChoice);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      options.applySnapshot(result?.snapshot || {});
      options.renderAll();
      return;
    }

    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
  };

  el.btnNewConv.addEventListener('click', async () => {
    await runCreateConversationFlow();
  });

  el.btnImportSession.addEventListener('click', () => {
    runImportSessionFlow().catch((error) => {
      window.alert(localizeKnownText(`导入会话失败: ${error?.message || String(error)}`));
    });
  });

  el.btnExportSession.addEventListener('click', async () => {
    const result = await codexdesk.exportSession(state.activeConversationId);
    if (result?.canceled) {
      return;
    }
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      options.applySnapshot(result?.snapshot || {});
      options.renderAll();
      return;
    }
    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
    const exportedPath = String(result?.exported?.filePath || '').trim();
    const exportedCount = Number(result?.exported?.messageCount || 0);
    if (exportedPath) {
      window.alert(localizeKnownText(`已导出会话到:\n${exportedPath}\n\n消息数: ${exportedCount}`));
    }
  });

  el.btnRenameConv.addEventListener('click', async () => {
    const conv = currentConversation();
    const title = await askRenameTitle(conv?.title || '');
    if (title === null) {
      return;
    }
    if (!title.trim()) {
      window.alert(t('alertConversationNameEmpty'));
      return;
    }
    const next = await codexdesk.renameConversation(state.activeConversationId, title);
    if (next?.error) {
      window.alert(localizeKnownText(next.error));
      return;
    }
    options.applySnapshot(next);
    options.renderAll();
  });

  el.btnCloseConv.addEventListener('click', async () => {
    const conv = currentConversation();
    const title = String(conv?.title || t('chatTitlePrefix'));
    const ok = await askConfirmDialog({
      title: t('closeConversationTitle'),
      message: t('confirmCloseConversation', { title }),
    });
    if (!ok) {
      return;
    }
    const next = await codexdesk.closeCurrentConversation();
    options.applySnapshot(next);
    options.renderAll();
  });

  el.btnRefreshVersion.addEventListener('click', async () => {
    const next = await codexdesk.refreshCodexVersion(state.activeConversationId);
    if (next?.error) {
      window.alert(localizeKnownText(next.error));
      options.applySnapshot(next.snapshot || {});
      options.renderAll();
      return;
    }
    options.applySnapshot(next);
    options.renderAll();
  });

  el.btnRefreshModel.addEventListener('click', async () => {
    const next = await codexdesk.refreshModelInfo(state.activeConversationId);
    if (next?.error) {
      window.alert(localizeKnownText(next.error));
      options.applySnapshot(next.snapshot || {});
      options.renderAll();
      return;
    }
    options.applySnapshot(next);
    options.renderAll();
  });

  if (el.btnMetaModel) {
    el.btnMetaModel.addEventListener('click', () => {
      el.btnRefreshModel.click();
    });
  }

  el.btnClearChat.addEventListener('click', async () => {
    const result = await codexdesk.clearChat(state.activeConversationId);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
    }
    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
  });

  el.btnClearRuntime.addEventListener('click', async () => {
    const result = await codexdesk.clearRuntime(state.activeConversationId, false);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
    }
    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
  });

  el.btnToggleRuntime.addEventListener('click', () => {
    state.ui.runtimePanelHidden = !state.ui.runtimePanelHidden;
    saveUiPrefs();
    options.renderAll();
  });

  el.btnToggleSidebar.addEventListener('click', () => {
    state.ui.sidebarHidden = !state.ui.sidebarHidden;
    saveUiPrefs();
    options.renderAll();
  });

  el.btnStop.addEventListener('click', async () => {
    const next = await codexdesk.stopConversation(state.activeConversationId);
    options.applySnapshot(next);
    options.renderAll();
  });

  el.btnRetryLast.addEventListener('click', async () => {
    const result = await codexdesk.retryLastMessage(state.activeConversationId);
    if (result?.error) {
      window.alert(localizeKnownText(result.error));
      options.applySnapshot(result?.snapshot || {});
      options.renderAll();
      return;
    }
    options.applySnapshot(result?.snapshot || result);
    options.renderAll();
  });
}
