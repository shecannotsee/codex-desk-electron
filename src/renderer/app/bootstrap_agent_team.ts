import { el, state } from './state_i18n.js';
import { renderRuntime, renderTabs } from './renderers.js';
import { bindAgentTeamController } from './agent_team.js';

export function bindAgentTeamInit(deps: { renderAll: (opts?: any) => void }) {
  bindAgentTeamController(deps.renderAll);

  el.tabButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.workspaceMode === 'team') {
        const teamTab = String(btn.getAttribute('data-team-tab') || '').trim();
        if (teamTab === 'roles' || teamTab === 'status') {
          state.activeAgentTeamTab = teamTab;
        } else {
          state.activeAgentTeamTab = 'workflow';
        }
      } else {
        const nextTab = btn.getAttribute('data-tab');
        state.activeTab = nextTab === 'workflow' || nextTab === 'raw' || nextTab === 'structured'
          ? nextTab
          : 'workflow';
      }
      renderRuntime();
      renderTabs();
      window.requestAnimationFrame(() => {
        let pane = el.tabStructured;
        if (state.activeTab === 'workflow') {
          pane = el.tabWorkflow;
        } else if (state.activeTab === 'raw') {
          pane = el.tabRaw;
        }
        if (pane) {
          pane.scrollTop = pane.scrollHeight;
        }
      });
    });
  });
}
