import type {
  AgentTeamGroup,
  AgentTeamRole,
  AgentTeamStep,
  CreateAgentTeamGroupOptions,
  CreateAgentTeamRoleOptions,
} from './types.js';
import {
  el,
  escapeHtml,
  state,
  t,
} from './state_i18n.js';
import { renderMarkdownLike } from './markdown_renderer.js';

const TEAM_STORE_KEY = 'conductor.agent-team.v1';
const TEAM_STEP_COLORS = ['blue', 'teal', 'amber', 'violet', 'rose', 'slate'];

function nowTs(): number {
  return Date.now();
}

function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function normalizeRoleStatus(input: unknown): AgentTeamRole['status'] {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'running' || value === 'blocked' || value === 'done') {
    return value;
  }
  return 'idle';
}

function normalizeRole(raw: any): AgentTeamRole | null {
  const id = String(raw?.id || '').trim() || newId('role');
  const name = String(raw?.name || '').trim();
  if (!name) {
    return null;
  }
  const downstreamRoleIds = Array.isArray(raw?.downstreamRoleIds)
    ? raw.downstreamRoleIds.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return {
    id,
    name,
    upstreamRoleId: String(raw?.upstreamRoleId || '').trim(),
    downstreamRoleIds,
    responsibility: String(raw?.responsibility || '').trim(),
    status: normalizeRoleStatus(raw?.status),
    createdAt: Number(raw?.createdAt || nowTs()) || nowTs(),
    updatedAt: Number(raw?.updatedAt || raw?.createdAt || nowTs()) || nowTs(),
  };
}

function normalizeStep(raw: any): AgentTeamStep | null {
  const title = String(raw?.title || '').trim();
  const body = String(raw?.body || '').trim();
  if (!title && !body) {
    return null;
  }
  const kind = String(raw?.kind || '').trim() as AgentTeamStep['kind'];
  return {
    id: String(raw?.id || '').trim() || newId('step'),
    kind: kind === 'role-to-role' || kind === 'role-return' || kind === 'system' ? kind : 'user-to-role',
    title: title || t('agentTeamStepUntitled'),
    body,
    colorKey: String(raw?.colorKey || '').trim() || 'blue',
    status: String(raw?.status || '').trim() === 'running' ? 'running' : String(raw?.status || '').trim() === 'pending' ? 'pending' : 'done',
    timestamp: Number(raw?.timestamp || nowTs()) || nowTs(),
  };
}

function normalizeGroup(raw: any): AgentTeamGroup | null {
  const id = String(raw?.id || '').trim() || newId('team');
  const name = String(raw?.name || '').trim();
  if (!name) {
    return null;
  }
  return {
    id,
    name,
    roles: Array.isArray(raw?.roles) ? raw.roles.map(normalizeRole).filter(Boolean) as AgentTeamRole[] : [],
    steps: Array.isArray(raw?.steps) ? raw.steps.map(normalizeStep).filter(Boolean) as AgentTeamStep[] : [],
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
    createdAt: Number(raw?.createdAt || nowTs()) || nowTs(),
    updatedAt: Number(raw?.updatedAt || raw?.createdAt || nowTs()) || nowTs(),
  };
}

function loadAgentTeamPrefs(): void {
  try {
    const raw = window.localStorage.getItem(TEAM_STORE_KEY);
    const parsed = JSON.parse(String(raw || '{}'));
    state.agentTeamGroups = Array.isArray(parsed.groups)
      ? parsed.groups.map(normalizeGroup).filter(Boolean) as AgentTeamGroup[]
      : [];
    const activeId = String(parsed.activeGroupId || '').trim();
    state.activeAgentTeamGroupId = state.agentTeamGroups.some((item) => item.id === activeId)
      ? activeId
      : String(state.agentTeamGroups[0]?.id || '');
  } catch {
    state.agentTeamGroups = [];
    state.activeAgentTeamGroupId = '';
  }
}

function saveAgentTeamPrefs(): void {
  window.localStorage.setItem(TEAM_STORE_KEY, JSON.stringify({
    activeGroupId: state.activeAgentTeamGroupId,
    groups: state.agentTeamGroups,
  }));
}

function currentAgentTeamGroup(): AgentTeamGroup | null {
  return state.agentTeamGroups.find((item) => item.id === state.activeAgentTeamGroupId) || null;
}

function switchAgentTeamGroup(groupId: string): AgentTeamGroup | null {
  const id = String(groupId || '').trim();
  const group = state.agentTeamGroups.find((item) => item.id === id) || null;
  if (!group) {
    return null;
  }
  state.activeAgentTeamGroupId = group.id;
  switchWorkspaceMode('team');
  saveAgentTeamPrefs();
  return group;
}

function renameAgentTeamGroup(groupId: string, title: string): AgentTeamGroup | null {
  const id = String(groupId || '').trim();
  const name = String(title || '').trim();
  if (!id || !name) {
    return null;
  }
  const group = state.agentTeamGroups.find((item) => item.id === id) || null;
  if (!group) {
    return null;
  }
  group.name = name;
  group.updatedAt = nowTs();
  saveAgentTeamPrefs();
  return group;
}

function deleteAgentTeamGroup(groupId: string): boolean {
  const id = String(groupId || '').trim();
  if (!id) {
    return false;
  }
  const before = state.agentTeamGroups.length;
  state.agentTeamGroups = state.agentTeamGroups.filter((item) => item.id !== id);
  if (state.activeAgentTeamGroupId === id) {
    state.activeAgentTeamGroupId = String(state.agentTeamGroups[0]?.id || '');
  }
  saveAgentTeamPrefs();
  return state.agentTeamGroups.length !== before;
}

function switchWorkspaceMode(mode: 'conversation' | 'team'): void {
  state.workspaceMode = mode;
  if (mode === 'team') {
    state.activeAgentTeamTab = state.activeAgentTeamTab || 'workflow';
  }
}

function toggleAgentTeamWorkspace(): void {
  switchWorkspaceMode(state.workspaceMode === 'team' ? 'conversation' : 'team');
}

function createAgentTeamGroup(options: CreateAgentTeamGroupOptions = {}): AgentTeamGroup {
  const ts = nowTs();
  const name = String(options.name || '').trim() || t('agentTeamDefaultName', { index: state.agentTeamGroups.length + 1 });
  const group: AgentTeamGroup = {
    id: newId('team'),
    name,
    roles: [],
    steps: [
      {
        id: newId('step'),
        kind: 'system',
        title: t('agentTeamGroupCreated'),
        body: t('agentTeamGroupCreatedBody'),
        colorKey: 'slate',
        status: 'done',
        timestamp: ts,
      },
    ],
    messages: [],
    createdAt: ts,
    updatedAt: ts,
  };
  state.agentTeamGroups.unshift(group);
  state.activeAgentTeamGroupId = group.id;
  switchWorkspaceMode('team');
  saveAgentTeamPrefs();
  return group;
}

function createAgentTeamRole(options: CreateAgentTeamRoleOptions = {}): AgentTeamRole | null {
  const group = currentAgentTeamGroup();
  if (!group) {
    return null;
  }
  const name = String(options.name || '').trim();
  const responsibility = String(options.responsibility || '').trim();
  if (!name || !responsibility) {
    return null;
  }
  const validRoleIds = new Set(group.roles.map((item) => item.id));
  const downstreamRoleIds = Array.isArray(options.downstreamRoleIds)
    ? options.downstreamRoleIds.map((item) => String(item || '').trim()).filter((id) => validRoleIds.has(id))
    : [];
  const upstreamRoleId = String(options.upstreamRoleId || '').trim();
  const role: AgentTeamRole = {
    id: newId('role'),
    name,
    upstreamRoleId: validRoleIds.has(upstreamRoleId) ? upstreamRoleId : '',
    downstreamRoleIds,
    responsibility,
    status: 'idle',
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  group.roles.push(role);
  group.updatedAt = nowTs();
  group.steps.push({
    id: newId('step'),
    kind: 'system',
    title: t('agentTeamRoleAdded', { name: role.name }),
    body: role.responsibility,
    colorKey: TEAM_STEP_COLORS[group.steps.length % TEAM_STEP_COLORS.length],
    status: 'done',
    timestamp: nowTs(),
  });
  saveAgentTeamPrefs();
  return role;
}

function resolveRoleName(group: AgentTeamGroup, roleId = ''): string {
  if (!roleId) {
    return t('agentTeamNoOwner');
  }
  return group.roles.find((item) => item.id === roleId)?.name || t('agentTeamUnknownRole');
}

function renderAgentTeamChat(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.chatView.innerHTML = [
      '<div class="agent-team-empty">',
      `<div class="agent-team-empty-title">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`,
      `<button type="button" class="agent-team-primary-action" data-agent-team-create>${escapeHtml(t('agentTeamCreate'))}</button>`,
      '</div>',
    ].join('');
    return;
  }
  const roleBlocks = group.roles.map((role) => {
    const downstreamNames = (role.downstreamRoleIds || []).map((id) => resolveRoleName(group, id)).join(', ') || t('agentTeamNoOwner');
    return [
      '<article class="agent-team-role-card">',
      '<div class="agent-team-role-card-head">',
      `<div class="agent-team-role-avatar">${escapeHtml(Array.from(role.name)[0] || 'R')}</div>`,
      '<div class="agent-team-role-card-titlewrap">',
      `<div class="agent-team-role-name">${escapeHtml(role.name)}</div>`,
      `<div class="agent-team-role-meta">${escapeHtml(t('agentTeamUpstream'))}: ${escapeHtml(resolveRoleName(group, role.upstreamRoleId))}</div>`,
      `<div class="agent-team-role-meta">${escapeHtml(t('agentTeamDownstream'))}: ${escapeHtml(downstreamNames)}</div>`,
      '</div>',
      `<span class="agent-team-role-status state-${escapeHtml(role.status || 'idle')}">${escapeHtml(t(`agentTeamStatus${String(role.status || 'idle').replace(/^./, (ch) => ch.toUpperCase())}`))}</span>`,
      '</div>',
      `<div class="agent-team-role-duty">${renderMarkdownLike(role.responsibility)}</div>`,
      '</article>',
    ].join('');
  }).join('');
  el.chatView.innerHTML = [
    '<section class="agent-team-chat-shell">',
    '<div class="agent-team-group-head">',
    '<div>',
    `<div class="agent-team-eyebrow">${escapeHtml(t('agentTeamLabel'))}</div>`,
    `<h2>${escapeHtml(group.name)}</h2>`,
    `<p>${escapeHtml(t('agentTeamGroupHint'))}</p>`,
    '</div>',
    `<button type="button" class="agent-team-primary-action" data-agent-team-add-role>${escapeHtml(t('agentTeamAddRole'))}</button>`,
    '</div>',
    roleBlocks || `<div class="agent-team-empty-inline">${escapeHtml(t('agentTeamNoRoles'))}</div>`,
    '</section>',
  ].join('');
}

function renderAgentTeamGroupList(): void {
  const keyword = String(el.sidebarSearchInput?.value || '').trim().toLowerCase();
  const groups = state.agentTeamGroups
    .slice()
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .filter((group) => {
      if (!keyword) {
        return true;
      }
      return `${group.name}\n${group.id}`.toLowerCase().includes(keyword);
    });
  if (!groups.length) {
    el.conversationList.innerHTML = [
      `<div class="tip" style="padding:16px;">${escapeHtml(keyword ? t('sidebarSearchEmpty') : t('agentTeamEmptyTitle'))}</div>`,
      `<div class="tip" style="padding:0 16px 16px 16px;">${escapeHtml(t('agentTeamCreateHint'))}</div>`,
    ].join('');
    return;
  }
  el.conversationList.innerHTML = groups.map((group) => {
    const active = group.id === state.activeAgentTeamGroupId ? ' active' : '';
    const roleCount = Array.isArray(group.roles) ? group.roles.length : 0;
    const stepCount = Array.isArray(group.steps) ? group.steps.length : 0;
    const avatarChar = Array.from(String(group.name || 'A'))[0] || 'A';
    return [
      `<div class="conversation-item agent-team-list-item${active}" data-team-group-id="${escapeHtml(group.id)}">`,
      `<div class="conversation-avatar tone-${((roleCount + stepCount) % 6) + 1}">${escapeHtml(avatarChar)}</div>`,
      '<div class="conversation-main">',
      '<div class="conversation-top-row">',
      '<div class="conversation-title-row">',
      `<span class="conversation-title-text">${escapeHtml(group.name)}</span>`,
      '</div>',
      `<div class="conversation-time">${escapeHtml(formatTime(group.updatedAt || group.createdAt))}</div>`,
      '</div>',
      '<div class="conversation-bottom-row">',
      '<div class="conversation-preview-row">',
      `<span class="conv-state-pill state-idle">${escapeHtml(t('agentTeamLabel'))}</span>`,
      `<span class="conversation-preview">${escapeHtml(t('agentTeamListMeta', { roles: roleCount, steps: stepCount }))}</span>`,
      '</div>',
      '</div>',
      '</div>',
      '</div>',
    ].join('');
  }).join('');
}

function renderAgentTeamWorkflowTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabWorkflow.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  const steps = Array.isArray(group.steps) ? group.steps : [];
  const html = steps.map((step) => [
    `<div class="agent-team-step color-${escapeHtml(step.colorKey || 'blue')}">`,
    '<div class="agent-team-step-head">',
    `<span>${escapeHtml(step.title || t('agentTeamStepUntitled'))}</span>`,
    `<time>${escapeHtml(formatTime(step.timestamp))}</time>`,
    '</div>',
    `<div class="agent-team-step-body">${renderMarkdownLike(step.body || '')}</div>`,
    '</div>',
  ].join('')).join('');
  el.tabWorkflow.innerHTML = html || `<div class="tip">${escapeHtml(t('agentTeamNoSteps'))}</div>`;
}

function renderAgentTeamRolesTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabTeamRoles.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  const html = group.roles.map((role) => {
    const downstreamNames = (role.downstreamRoleIds || []).map((id) => resolveRoleName(group, id)).join(', ') || t('agentTeamNoOwner');
    return [
      '<div class="agent-team-side-role">',
      `<div class="agent-team-side-role-title">${escapeHtml(role.name)}</div>`,
      `<div>${escapeHtml(t('agentTeamUpstream'))}: ${escapeHtml(resolveRoleName(group, role.upstreamRoleId))}</div>`,
      `<div>${escapeHtml(t('agentTeamDownstream'))}: ${escapeHtml(downstreamNames)}</div>`,
      `<p>${escapeHtml(role.responsibility)}</p>`,
      '</div>',
    ].join('');
  }).join('');
  el.tabTeamRoles.innerHTML = [
    `<button type="button" class="agent-team-side-add" data-agent-team-add-role>${escapeHtml(t('agentTeamAddRole'))}</button>`,
    html || `<div class="tip">${escapeHtml(t('agentTeamNoRoles'))}</div>`,
  ].join('');
}

function renderAgentTeamAddTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabTeamAdd.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  el.tabTeamAdd.innerHTML = [
    '<div class="agent-team-add-panel">',
    `<div class="agent-team-add-title">${escapeHtml(t('agentTeamAddRole'))}</div>`,
    `<p>${escapeHtml(t('agentTeamAddRoleHint'))}</p>`,
    `<button type="button" class="agent-team-side-add" data-agent-team-add-role>${escapeHtml(t('agentTeamAddRole'))}</button>`,
    '</div>',
  ].join('');
}

function renderAgentTeamStatusTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabTeamStatus.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  const counts = group.roles.reduce((acc, role) => {
    const key = role.status || 'idle';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  el.tabTeamStatus.innerHTML = [
    '<div class="agent-team-status-grid">',
    renderStatusMetric(t('agentTeamRoles'), group.roles.length),
    renderStatusMetric(t('agentTeamStatusIdle'), counts.idle || 0),
    renderStatusMetric(t('agentTeamStatusRunning'), counts.running || 0),
    renderStatusMetric(t('agentTeamSteps'), group.steps.length),
    '</div>',
    '<div class="agent-team-status-note">',
    escapeHtml(t('agentTeamStatusHint')),
    '</div>',
  ].join('');
}

function renderStatusMetric(label: string, value: number): string {
  return [
    '<div class="agent-team-status-metric">',
    `<div>${escapeHtml(label)}</div>`,
    `<strong>${escapeHtml(String(value))}</strong>`,
    '</div>',
  ].join('');
}

function renderAgentTeamRuntime(): void {
  renderAgentTeamWorkflowTab();
  renderAgentTeamAddTab();
  renderAgentTeamRolesTab();
  renderAgentTeamStatusTab();
}

function formatTime(input: unknown): string {
  const dt = new Date(Number(input || 0));
  if (Number.isNaN(dt.getTime())) {
    return '--:--';
  }
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function openCreateTeamModal(): void {
  el.createTeamNameInput.value = '';
  el.createTeamModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.createTeamNameInput.focus());
}

function closeCreateTeamModal(): void {
  el.createTeamModal.classList.add('hidden');
}

function populateRoleModal(): void {
  const group = currentAgentTeamGroup();
  const roles = group?.roles || [];
  el.addTeamRoleNameInput.value = '';
  el.addTeamRoleResponsibilityInput.value = '';
  el.addTeamRoleUpstreamSelect.innerHTML = [
    `<option value="">${escapeHtml(t('agentTeamNoOwner'))}</option>`,
    ...roles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`),
  ].join('');
  el.addTeamRoleDownstreamList.innerHTML = roles.map((role) => [
    '<label class="team-role-downstream-option">',
    `<input type="checkbox" value="${escapeHtml(role.id)}" />`,
    `<span>${escapeHtml(role.name)}</span>`,
    '</label>',
  ].join('')).join('') || `<div class="team-role-empty-option">${escapeHtml(t('agentTeamNoRoles'))}</div>`;
}

function openAddTeamRoleModal(): void {
  if (!currentAgentTeamGroup()) {
    openCreateTeamModal();
    return;
  }
  populateRoleModal();
  el.addTeamRoleModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.addTeamRoleNameInput.focus());
}

function closeAddTeamRoleModal(): void {
  el.addTeamRoleModal.classList.add('hidden');
}

function selectedDownstreamRoleIds(): string[] {
  return Array.from(el.addTeamRoleDownstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((item) => item.checked)
    .map((item) => String(item.value || '').trim())
    .filter(Boolean);
}

function bindAgentTeamController(renderAll: () => void): void {
  el.btnSidebarNewTeam.addEventListener('click', () => {
    toggleAgentTeamWorkspace();
    if (el.sidebarSearchInput) {
      el.sidebarSearchInput.value = '';
    }
    renderAll();
  });
  el.createTeamCancel.addEventListener('click', closeCreateTeamModal);
  el.createTeamConfirm.addEventListener('click', () => {
    createAgentTeamGroup({ name: el.createTeamNameInput.value });
    closeCreateTeamModal();
    renderAll();
  });
  el.createTeamNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.createTeamConfirm.click();
    }
  });
  el.btnAddTeamRole.addEventListener('click', openAddTeamRoleModal);
  el.addTeamRoleCancel.addEventListener('click', closeAddTeamRoleModal);
  el.addTeamRoleConfirm.addEventListener('click', () => {
    const role = createAgentTeamRole({
      name: el.addTeamRoleNameInput.value,
      upstreamRoleId: el.addTeamRoleUpstreamSelect.value,
      downstreamRoleIds: selectedDownstreamRoleIds(),
      responsibility: el.addTeamRoleResponsibilityInput.value,
    });
    if (!role) {
      window.alert(t('agentTeamRoleRequired'));
      return;
    }
    closeAddTeamRoleModal();
    renderAll();
  });
  el.chatView.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-agent-team-create]')) {
      event.preventDefault();
      openCreateTeamModal();
      return;
    }
    if (target?.closest('[data-agent-team-add-role]')) {
      event.preventDefault();
      openAddTeamRoleModal();
    }
  });
  el.runtimePanel.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-agent-team-add-role]')) {
      event.preventDefault();
      openAddTeamRoleModal();
    }
  });
}

export {
  bindAgentTeamController,
  currentAgentTeamGroup,
  deleteAgentTeamGroup,
  loadAgentTeamPrefs,
  openAddTeamRoleModal,
  openCreateTeamModal,
  renderAgentTeamChat,
  renderAgentTeamGroupList,
  renderAgentTeamRuntime,
  renameAgentTeamGroup,
  saveAgentTeamPrefs,
  switchAgentTeamGroup,
  toggleAgentTeamWorkspace,
  switchWorkspaceMode,
};
