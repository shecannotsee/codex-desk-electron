import {
  el,
  t,
} from './state_i18n.js';

type QuickSettingsIntegration = {
  getTelegramLogsSnapshot: () => { loaded?: boolean; loading?: boolean };
  refreshTelegramLogs: () => Promise<unknown>;
};

const quickSettingsPaneTitleKey = {
  conversation: 'menuConversation',
  runtime: 'menuRuntime',
  integration: 'menuNotification',
  'integration-security': 'securityPaneTitle',
  'integration-telegram': 'providerTelegram',
  view: 'menuInterface',
  window: 'menuWindow',
  help: 'menuHelp',
  'help-telegram-logs': 'helpTelegramLogs',
};

function resolveQuickSettingsParentPane(paneName) {
  const normalized = String(paneName || '').trim();
  if (!normalized || normalized === 'root' || !normalized.includes('-')) {
    return 'root';
  }
  return String(normalized.split('-')[0] || 'root').trim() || 'root';
}

export function createQuickSettingsController(integrationSettings: QuickSettingsIntegration) {
  let quickSettingsPane = 'root';

  const setPane = (paneName) => {
    if (!el.quickSettingsMenu) {
      return;
    }
    const root = el.quickSettingsRoot;
    const detail = el.quickSettingsDetail;
    const detailTitle = el.qsDetailTitle;
    const categoryButtons = Array.from(el.quickSettingsMenu.querySelectorAll<HTMLElement>('.quick-settings-category[data-pane]'));
    const panes = Array.from(el.quickSettingsMenu.querySelectorAll<HTMLElement>('.quick-settings-pane[data-pane]'));
    if (!panes.length) {
      return;
    }

    const candidate = String(paneName || '').trim() || 'root';
    const validPane = panes.some((pane) => pane.getAttribute('data-pane') === candidate);
    // Invalid routes fall back to the first concrete pane so stale menu data cannot leave the panel blank.
    const target = candidate === 'root'
      ? 'root'
      : (validPane ? candidate : String(panes[0].getAttribute('data-pane') || 'conversation'));
    quickSettingsPane = target;

    if (root) {
      root.classList.toggle('hidden', target !== 'root');
    }
    if (detail) {
      detail.classList.toggle('hidden', target === 'root');
    }

    categoryButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-pane') === target);
    });
    panes.forEach((pane) => {
      const active = pane.getAttribute('data-pane') === target;
      pane.classList.toggle('active', active);
    });

    if (detailTitle && target !== 'root') {
      const key = quickSettingsPaneTitleKey[target] || 'quickSettings';
      detailTitle.setAttribute('data-i18n-key', key);
      detailTitle.textContent = t(key);
    }
    const telegramLogsSnapshot = integrationSettings.getTelegramLogsSnapshot();
    if (target === 'help-telegram-logs' && !telegramLogsSnapshot.loaded && !telegramLogsSnapshot.loading) {
      // Logs are loaded lazily because the pane is rarely opened and can include filesystem IO.
      integrationSettings.refreshTelegramLogs().catch(() => {});
    }
  };

  const hide = () => {
    if (!el.quickSettingsMenu || !el.btnQuickSettings) {
      return;
    }
    el.quickSettingsMenu.classList.add('hidden');
    if (el.quickSettingsScrim) {
      el.quickSettingsScrim.classList.add('hidden');
    }
    el.btnQuickSettings.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('quick-settings-open');
  };

  const show = () => {
    if (!el.quickSettingsMenu || !el.btnQuickSettings) {
      return;
    }
    setPane('root');
    el.quickSettingsMenu.classList.remove('hidden');
    if (el.quickSettingsScrim) {
      el.quickSettingsScrim.classList.remove('hidden');
    }
    el.btnQuickSettings.setAttribute('aria-expanded', 'true');
    document.body.classList.add('quick-settings-open');
  };

  const toggle = () => {
    if (!el.quickSettingsMenu || el.quickSettingsMenu.classList.contains('hidden')) {
      show();
      return;
    }
    hide();
  };

  const bind = (dispatchAction: (action: string) => Promise<void>) => {
    if (el.btnQuickSettings) {
      el.btnQuickSettings.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      });
    }

    if (el.quickSettingsScrim) {
      el.quickSettingsScrim.addEventListener('click', () => {
        hide();
      });
    }

    if (el.quickSettingsMenu) {
      el.quickSettingsMenu.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const category = target?.closest('.quick-settings-category[data-pane]');
        if (category) {
          event.preventDefault();
          event.stopPropagation();
          setPane(category.getAttribute('data-pane'));
          return;
        }
        const backBtn = target?.closest('#qs-back');
        if (backBtn) {
          event.preventDefault();
          event.stopPropagation();
          setPane(resolveQuickSettingsParentPane(quickSettingsPane));
          return;
        }
        const paneRoute = target?.closest<HTMLElement>('[data-pane-route]');
        if (paneRoute) {
          event.preventDefault();
          event.stopPropagation();
          setPane(paneRoute.getAttribute('data-pane-route'));
          return;
        }
        const button = target?.closest('button[data-action]');
        if (!button) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const action = String(button.getAttribute('data-action') || '');
        const keepOpen = action.startsWith('ui:') || action.startsWith('view:');
        dispatchAction(action).catch(() => {});
        if (!keepOpen) {
          hide();
        }
      });
    }
  };

  return {
    bind,
    hide,
    setPane,
    show,
    toggle,
  };
}
