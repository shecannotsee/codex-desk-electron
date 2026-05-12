import { el, localizeKnownText, t } from './state_i18n.js';
import { showAppNotice } from './app_notice.js';
import { bindComposerController } from './composer_controller.js';
import { renderAll } from './renderers.js';

async function copyTextToClipboard(text: string) {
  const content = String(text || '');
  if (!content) return;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(content);
    return;
  }
  const helper = document.createElement('textarea');
  helper.value = content;
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

export function bindComposerInit(deps: { applySnapshot: (snapshot: any) => void }) {
  if (el.composerWorkdirValue) {
    el.composerWorkdirValue.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const workdir = String(el.composerWorkdirValue?.getAttribute('data-copy-text') || '').trim();
      if (!workdir) return;
      try {
        await copyTextToClipboard(workdir);
        showAppNotice(t('copySuccess'), 'success');
      } catch {
        showAppNotice(localizeKnownText('复制失败'), 'error');
      }
    });
  }

  bindComposerController({
    applySnapshot: deps.applySnapshot,
    renderAll,
  });
}
