import type { AgentTeamGroup, AgentTeamRole, ConversationMessage } from '../types.js';
import { el, escapeHtml, state, t } from '../state_i18n.js';
import { renderMarkdownLike } from '../markdown_renderer.js';
import {
  cleanupWorkflowCollapsed,
  isWorkflowStepCollapsed,
  messagePreview,
  setWorkflowStepCollapsed,
} from '../conversation_runtime.js';
import {
  TEAM_OWNER_ID,
  TEAM_NO_DOWNSTREAM_ID,
  TEAM_STEP_COLORS,
  currentAgentTeamGroup,
  deleteAgentTeamGroup,
  directDownstreamRoles,
  findConversation,
  newId,
  normalizeRole,
  normalizeRoleIdList,
  normalizeRoleProvider,
  normalizeStep,
  normalizeTeamMessage,
  nowTs,
  renameAgentTeamGroup,
  resolveEntryRoles,
  resolveRoleName,
  roleConversation,
  roleHasUpstream,
  roleLevelMap,
  saveAgentTeamPrefs,
  setRoleUpstreamIds,
  sortedRolesByHierarchy,
  switchAgentTeamGroup,
  switchWorkspaceMode,
  syncRoleGraphForCreatedRole,
  toggleAgentTeamWorkspace,
  upstreamIdsForRole,
} from './agent_team_state.js';
import {
  buildRoleResponsibilityDoc,
  buildRoleCompletionContractDoc,
  buildRoleRoutingPromptDoc,
  defaultCompletionContractDoc,
  downstreamRoleNameList,
  infoSourceRoleNameList,
  upstreamRoleNameList,
  refreshAllRoleDocs,
} from './agent_team_prompt.js';
import { TEAM_STORE_KEY } from './agent_team_state.js';
import { syncAgentTeamRoleRuntimeStatus } from './agent_team_runner.js';

function roleInitial(name: string, fallback = 'R'): string {
  return Array.from(String(name || '').trim())[0] || fallback;
}

function formatTime(input: unknown): string {
  const dt = new Date(Number(input || 0));
  if (Number.isNaN(dt.getTime())) return '--:--';
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function roleStatusLabel(role: AgentTeamRole): string {
  const status = role.status || 'idle';
  if (status === 'running') return t('agentTeamStatusRunning');
  if (status === 'blocked') return t('agentTeamStatusBlocked');
  if (status === 'done') return t('agentTeamStatusDone');
  return t('agentTeamStatusIdle');
}

function roleDepthLabel(level: number): string {
  const depth = Math.max(1, Number(level) || 1);
  return t('agentTeamRoleLevelLabel', { level: depth });
}

function renderStatusMetric(label: string, value: number): string {
  return [
    '<div class="agent-team-status-metric">',
    `<div>${escapeHtml(label)}</div>`,
    `<strong>${escapeHtml(String(value))}</strong>`,
    '</div>',
  ].join('');
}

function workflowText(item: any): string {
  if (!item || typeof item !== 'object') return '';
  return String(item.body || '').trim() || String(item.preview || '').trim() || String(item.title || '').trim();
}

function renderRoleConversationRuntime(role: AgentTeamRole): string {
  const conversationId = String(role.conversationId || '').trim();
  const runtime = state.runtimeByConversation[conversationId];
  const workflow = Array.isArray(runtime?.workflow) ? runtime.workflow.slice(-6) : [];
  const phase = String(runtime?.phase || '空闲').trim();
  const body = workflow.length
    ? workflow.map((item) => {
      const title = String(item.title || item.tag || t('agentTeamStepUntitled')).trim();
      const text = workflowText(item);
      return `<div class="agent-team-runtime-item"><strong>${escapeHtml(title)}</strong>${text ? `<span>${escapeHtml(text)}</span>` : ''}</div>`;
    }).join('')
    : `<div class="agent-team-runtime-item"><span>${escapeHtml(t('agentTeamNoRuntimeSteps'))}</span></div>`;
  return [
    '<div class="agent-team-role-runtime">',
    '<div class="agent-team-role-runtime-head">',
    `<span>${escapeHtml(role.name)}</span>`,
    `<em>${escapeHtml(phase)}</em>`,
    '</div>',
    body,
    '</div>',
  ].join('');
}

function renderRoleStatusLine(group: AgentTeamGroup, role: AgentTeamRole): string {
  const waitingNames = (role.waitingForRoleIds || [])
    .map((id) => resolveRoleName(group, id)).filter(Boolean).join(', ');
  return [
    '<div class="agent-team-role-inline-status">',
    `<span class="agent-team-role-status state-${escapeHtml(role.status || 'idle')}">${escapeHtml(roleStatusLabel(role))}</span>`,
    role.currentUpstreamName ? `<span>${escapeHtml(t('agentTeamDelegatedFrom'))}: ${escapeHtml(role.currentUpstreamName)}</span>` : '',
    role.currentProgress ? `<span>${escapeHtml(t('agentTeamProgress'))}: ${escapeHtml(role.currentProgress)}</span>` : '',
    waitingNames ? `<span>${escapeHtml(t('agentTeamWaitingFor'))}: ${escapeHtml(waitingNames)}</span>` : '',
    role.currentTaskPreview ? `<span>${escapeHtml(t('agentTeamCurrentTask'))}: ${escapeHtml(role.currentTaskPreview)}</span>` : '',
    '</div>',
  ].filter(Boolean).join('');
}

function renderAgentTeamMessage(group: AgentTeamGroup, item: ConversationMessage, index: number): string {
  const role = item.role === 'assistant' ? 'assistant' : 'user';
  const speakerName = String(item.speakerName || '').trim()
    || (role === 'user' ? t('agentTeamSelfName') : resolveRoleName(group, item.roleId));
  const label = role === 'user' ? t('agentTeamSelfName') : speakerName;
  const rowClass = role === 'user' ? 'msg-user-row agent-team-message-user-row' : 'msg-assistant-row agent-team-message-role-row';
  const bubbleClass = role === 'user' ? 'msg-user agent-team-user-bubble' : 'msg-assistant agent-team-role-bubble';
  return [
    `<div class="msg-block ${rowClass} agent-team-message" data-agent-team-message-index="${escapeHtml(index)}">`,
    '<div class="msg-head agent-team-message-head">',
    `<div class="msg-role agent-team-message-role">${escapeHtml(label)}</div>`,
    '</div>',
    `<div class="msg-bubble ${bubbleClass}">`,
    `<div class="msg-expanded">${renderMarkdownLike(item.text || '')}</div>`,
    '</div>',
    '</div>',
  ].join('');
}

function renderAgentTeamMessages(group: AgentTeamGroup): string {
  const messages = Array.isArray(group.messages) ? group.messages : [];
  if (!messages.length) {
    return [
      '<div class="agent-team-conversation-empty">',
      `<div class="agent-team-empty-title">${escapeHtml(t('agentTeamConversationEmptyTitle'))}</div>`,
      `<div>${escapeHtml(t('agentTeamConversationEmptyHint'))}</div>`,
      '</div>',
    ].join('');
  }
  return [
    '<div class="chat-history-list agent-team-message-list">',
    messages.map((item, index) => renderAgentTeamMessage(group, item, index)).join(''),
    '</div>',
  ].join('');
}

function renderAgentTeamRosterStrip(group: AgentTeamGroup): string {
  const entryRoleIds = new Set(resolveEntryRoles(group).map((role) => role.id));
  const roles = group.roles.slice(0, 6).map((role) => {
    const entryClass = entryRoleIds.has(role.id) ? ' is-entry' : '';
    return [
      `<div class="agent-team-roster-chip${entryClass}" title="${escapeHtml(role.responsibility || role.name)}">`,
      `<span class="agent-team-roster-avatar">${escapeHtml(roleInitial(role.name))}</span>`,
      `<span>${escapeHtml(role.name)}</span>`,
      '</div>',
    ].join('');
  }).join('');
  return [
    '<div class="agent-team-roster-strip">',
    '<div class="agent-team-roster-main">',
    `<div class="agent-team-roster-chip agent-team-roster-owner"><span class="agent-team-roster-avatar">${escapeHtml(roleInitial(group.ownerName || t('agentTeamOwnerName'), 'O'))}</span><span>${escapeHtml(group.ownerName || t('agentTeamOwnerName'))}</span></div>`,
    roles || `<div class="agent-team-empty-inline agent-team-roster-empty">${escapeHtml(t('agentTeamNoRoles'))}</div>`,
    '</div>',
    `<button type="button" class="agent-team-primary-action" data-agent-team-add-role>${escapeHtml(t('agentTeamAddRole'))}</button>`,
    '</div>',
  ].join('');
}

export function renderAgentTeamChat(): void {
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
  el.chatView.innerHTML = [
    '<section class="agent-team-chat-shell">',
    '<div class="agent-team-group-head">',
    '<div>',
    `<div class="agent-team-eyebrow">${escapeHtml(t('agentTeamLabel'))}</div>`,
    `<h2>${escapeHtml(group.name)}</h2>`,
    '</div>',
    '</div>',
    renderAgentTeamRosterStrip(group),
    renderAgentTeamMessages(group),
    '</section>',
  ].join('');
  el.chatView.scrollTop = el.chatView.scrollHeight;
}

export function renderAgentTeamGroupList(): void {
  const keyword = String(el.sidebarSearchInput?.value || '').trim().toLowerCase();
  const groups = state.agentTeamGroups
    .slice()
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
    .filter((group) => !keyword || `${group.name}\n${group.id}`.toLowerCase().includes(keyword));
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

export function renderAgentTeamWorkflowTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabWorkflow.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  const steps = Array.isArray(group.steps) ? group.steps : [];
  cleanupWorkflowCollapsed(group.id, steps.length);
  const teamStepsHtml = steps.map((step, index) => {
    const collapsed = isWorkflowStepCollapsed(group.id, index);
    const toggleText = collapsed ? t('expandMessage') : t('collapseMessage');
    const collapsedLine = messagePreview(step.body || step.title || '');
    return [
      `<div class="runtime-step agent-team-step tag-${escapeHtml(step.kind || 'system')} color-${escapeHtml(step.colorKey || 'blue')}${collapsed ? ' collapsed' : ''}" data-agent-team-wf-index="${escapeHtml(index)}">`,
      '<div class="runtime-step-head agent-team-step-head">',
      `<span class="left">${escapeHtml(step.title || t('agentTeamStepUntitled'))}</span>`,
      '<span class="right-group">',
      `<span class="right">${escapeHtml(formatTime(step.timestamp))}</span>`,
      `<button type="button" class="runtime-step-toggle" data-agent-team-wf-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
      '</span>',
      '</div>',
      `<div class="runtime-step-body agent-team-step-body">${renderMarkdownLike(step.body || '')}</div>`,
      `<div class="runtime-step-collapsed-line">${escapeHtml(collapsedLine)}</div>`,
      '</div>',
    ].join('');
  }).join('');
  const roleRuntimeHtml = sortedRolesByHierarchy(group)
    .filter((role) => String(role.conversationId || '').trim())
    .map((role) => renderRoleConversationRuntime(role))
    .join('');
  el.tabWorkflow.innerHTML = [
    teamStepsHtml || `<div class="tip">${escapeHtml(t('agentTeamNoSteps'))}</div>`,
    roleRuntimeHtml,
  ].filter(Boolean).join('');
  el.tabWorkflow.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clickable = target.closest('.runtime-step-toggle, .runtime-step-head, .runtime-step-collapsed-line');
    if (!clickable) return;
    const container = clickable.closest('[data-agent-team-wf-index]');
    if (!container) return;
    const index = Number(container.getAttribute('data-agent-team-wf-index') || '-1');
    if (!Number.isInteger(index) || index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    setWorkflowStepCollapsed(group.id, index, !isWorkflowStepCollapsed(group.id, index));
    renderAgentTeamWorkflowTab();
  };
}

function renderAgentTeamRoleStats(group: AgentTeamGroup): string {
  const roles = group.roles || [];
  const counts = roles.reduce((acc, role) => {
    const key = String(role.status || 'idle').trim() || 'idle';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const levels = roleLevelMap(group);
  const maxLevel = roles.reduce((max, role) => Math.max(max, Number(levels.get(role.id) || 1)), 0);
  return [
    '<div class="agent-team-status-grid agent-team-role-stats">',
    renderStatusMetric(t('agentTeamRoleCount'), roles.length),
    renderStatusMetric(t('agentTeamRoleLevelCount'), maxLevel + 1),
    renderStatusMetric(t('agentTeamStatusRunning'), counts.running || 0),
    renderStatusMetric(t('agentTeamStatusBlocked'), counts.blocked || 0),
    '</div>',
  ].join('');
}

function renderAgentTeamFlowStatus(group: AgentTeamGroup): string {
  if (!group.roles.length) return `<div class="tip">${escapeHtml(t('agentTeamNoRoles'))}</div>`;
  const activeRoles = group.roles.filter((role) => role.status === 'running' || role.status === 'blocked' || (role.waitingForRoleIds || []).length > 0);
  if (!activeRoles.length) return `<div class="tip">${escapeHtml(t('agentTeamNoActiveFlow'))}</div>`;
  return [
    '<div class="agent-team-flow-status-list">',
    activeRoles.map((role) => {
      const waitingNames = (role.waitingForRoleIds || []).map((id) => resolveRoleName(group, id)).filter(Boolean).join(', ');
      const lines = [
        `<div><strong>${escapeHtml(t('agentTeamCurrentWorker'))}</strong>: ${escapeHtml(role.name)} · ${escapeHtml(roleStatusLabel(role))}</div>`,
        role.currentUpstreamName ? `<div><strong>${escapeHtml(t('agentTeamDelegatedFrom'))}</strong>: ${escapeHtml(role.currentUpstreamName)}</div>` : '',
        role.currentProgress ? `<div><strong>${escapeHtml(t('agentTeamProgress'))}</strong>: ${escapeHtml(role.currentProgress)}</div>` : '',
        waitingNames ? `<div><strong>${escapeHtml(t('agentTeamWaitingFor'))}</strong>: ${escapeHtml(waitingNames)}</div>` : '',
        role.currentTaskPreview ? `<div><strong>${escapeHtml(t('agentTeamCurrentTask'))}</strong>: ${escapeHtml(role.currentTaskPreview)}</div>` : '',
      ].filter(Boolean).join('');
      return `<div class="agent-team-flow-status-item">${lines}</div>`;
    }).join(''),
    '</div>',
  ].join('');
}

export function renderAgentTeamRolesTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabTeamRoles.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  const roles = sortedRolesByHierarchy(group);
  const levels = roleLevelMap(group);
  const ownerHtml = [
    '<div class="agent-team-side-role agent-team-side-owner">',
    `<div class="agent-team-side-role-title">${escapeHtml(group.ownerName || t('agentTeamOwnerName'))}</div>`,
    `<div>${escapeHtml(t('agentTeamRoleLevelOwner'))}</div>`,
    `<div>${escapeHtml(t('agentTeamOwnerHint'))}</div>`,
    '</div>',
  ].join('');
  const html = roles.map((role) => {
    const level = Number(levels.get(role.id) || 1);
    const downstreamNames = downstreamRoleNameList(group, role.downstreamRoleIds || []);
    const infoSourceNames = infoSourceRoleNameList(group, role.infoSourceRoleIds || []);
    return [
      '<details class="agent-team-side-role agent-team-side-role-collapsible">',
      '<summary class="agent-team-side-role-summary">',
      `<span class="agent-team-side-role-title">${escapeHtml(role.name)}</span>`,
      `<span class="agent-team-role-status state-${escapeHtml(role.status || 'idle')}">${escapeHtml(roleStatusLabel(role))}</span>`,
      '</summary>',
      '<div class="agent-team-side-role-body">',
      '<div class="agent-team-role-actions">',
      `<button type="button" class="agent-team-role-edit" data-agent-team-edit-role="${escapeHtml(role.id)}" title="${escapeHtml(t('agentTeamEditRole'))}">${escapeHtml(t('agentTeamEditRole'))}</button>`,
      `<button type="button" class="agent-team-role-delete" data-agent-team-delete-role="${escapeHtml(role.id)}" title="${escapeHtml(t('agentTeamDeleteRole'))}">${escapeHtml(t('agentTeamDeleteRole'))}</button>`,
      '</div>',
      `<div>${escapeHtml(t('agentTeamRoleLevel'))}: ${escapeHtml(roleDepthLabel(level))}</div>`,
      renderRoleStatusLine(group, role),
      `<div>${escapeHtml(t('agentTeamRoleProvider'))}: ${escapeHtml(role.provider === 'claude' ? 'Claude' : 'Codex')}</div>`,
      `<div>${escapeHtml(t('agentTeamRoleConversation'))}: ${escapeHtml(roleConversation(role)?.title || t('agentTeamRoleConversationPending'))}</div>`,
      `<div>${escapeHtml(t('agentTeamUpstream'))}: ${escapeHtml(upstreamRoleNameList(group, role))}</div>`,
      `<div>${escapeHtml(t('agentTeamDownstream'))}: ${escapeHtml(downstreamNames)}</div>`,
      `<div>${escapeHtml(t('agentTeamInfoSource'))}: ${escapeHtml(infoSourceNames)}</div>`,
      '<details class="agent-team-doc-details">',
      `<summary>${escapeHtml(t('agentTeamResponsibilityDoc'))}</summary>`,
      `<div class="agent-team-doc-body">${renderMarkdownLike(role.responsibilityDoc || buildRoleResponsibilityDoc(group, role))}</div>`,
      '</details>',
      '<details class="agent-team-doc-details">',
      `<summary>${escapeHtml(t('agentTeamCompletionContractTitlePlain'))}</summary>`,
      `<div class="agent-team-doc-body">${renderMarkdownLike(buildRoleCompletionContractDoc(role))}</div>`,
      '</details>',
      '<details class="agent-team-doc-details">',
      `<summary>${escapeHtml(t('agentTeamRoutingPromptDoc'))}</summary>`,
      `<div class="agent-team-doc-body">${renderMarkdownLike(role.routingPromptDoc || buildRoleRoutingPromptDoc(group, role))}</div>`,
      '</details>',
      '</div>',
      '</details>',
    ].join('');
  }).join('');
  el.tabTeamRoles.innerHTML = [
    `<button type="button" class="agent-team-side-add" data-agent-team-add-role>${escapeHtml(t('agentTeamAddRole'))}</button>`,
    `<div class="agent-team-role-summary">${escapeHtml(t('agentTeamRoleSummary', { count: roles.length }))}</div>`,
    ownerHtml,
    html || `<div class="tip">${escapeHtml(t('agentTeamNoRoles'))}</div>`,
  ].join('');
}

export function renderAgentTeamAddTab(): void {
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

export function renderAgentTeamStatusTab(): void {
  const group = currentAgentTeamGroup();
  if (!group) {
    el.tabTeamStatus.innerHTML = `<div class="tip">${escapeHtml(t('agentTeamEmptyTitle'))}</div>`;
    return;
  }
  el.tabTeamStatus.innerHTML = [
    renderAgentTeamRoleStats(group),
    renderAgentTeamFlowStatus(group),
    '<div class="agent-team-status-note">',
    escapeHtml(t('agentTeamStatusHint')),
    '</div>',
  ].join('');
}

export function renderAgentTeamRuntime(): void {
  const group = currentAgentTeamGroup();
  if (group) syncAgentTeamRoleRuntimeStatus(group);
  renderAgentTeamWorkflowTab();
  el.tabTeamAdd.innerHTML = '';
  renderAgentTeamRolesTab();
  renderAgentTeamStatusTab();
}

let editingRoleId = '';

export function openCreateTeamModal(): void {
  el.createTeamNameInput.value = '';
  el.createTeamModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.createTeamNameInput.focus());
}

export function closeCreateTeamModal(): void {
  el.createTeamModal.classList.add('hidden');
}

function selectRoleProvider(provider: 'codex' | 'claude'): void {
  const normalized = provider === 'claude' ? 'claude' : 'codex';
  el.addTeamRoleProviderCodex.classList.toggle('active', normalized === 'codex');
  el.addTeamRoleProviderClaude.classList.toggle('active', normalized === 'claude');
  el.addTeamRoleProviderCodex.setAttribute('aria-pressed', normalized === 'codex' ? 'true' : 'false');
  el.addTeamRoleProviderClaude.setAttribute('aria-pressed', normalized === 'claude' ? 'true' : 'false');
}

function selectedRoleProvider(): 'codex' | 'claude' {
  return el.addTeamRoleProviderClaude.classList.contains('active') ? 'claude' : 'codex';
}

function selectedDownstreamRoleIds(): string[] {
  const checkedValues = Array.from(el.addTeamRoleDownstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((item) => item.checked).map((item) => String(item.value || '').trim()).filter(Boolean);
  return checkedValues.includes(TEAM_NO_DOWNSTREAM_ID) ? [] : checkedValues;
}

function selectedUpstreamRoleIds(): string[] {
  return Array.from(el.addTeamRoleUpstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((item) => item.checked).map((item) => String(item.value || '').trim()).filter(Boolean);
}

function selectedInfoSourceRoleIds(): string[] {
  return Array.from(el.addTeamRoleInfoSourceList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((item) => item.checked).map((item) => String(item.value || '').trim()).filter(Boolean);
}

function populateRoleModal(role: import('../types.js').AgentTeamRole | null = null): void {
  const group = currentAgentTeamGroup();
  const roles = (group?.roles || []).filter((item) => item.id !== role?.id);
  const upstreamIds = new Set(role ? upstreamIdsForRole(role) : [TEAM_OWNER_ID]);
  const downstreamIds = new Set(role?.downstreamRoleIds || []);
  const infoSourceIds = new Set(role?.infoSourceRoleIds || []);
  const noDownstream = !downstreamIds.size;
  el.addTeamRoleTitle.textContent = role ? t('agentTeamEditRole') : t('agentTeamAddRole');
  el.addTeamRoleConfirm.textContent = role ? t('save') : t('agentTeamAddRole');
  el.addTeamRoleNameInput.value = role?.name || '';
  el.addTeamRoleResponsibilityInput.value = role?.responsibility || '';
  el.addTeamRoleCompletionInput.value = String(role?.completionContractDoc || '').trim() || defaultCompletionContractDoc();
  selectRoleProvider(role?.provider || (state.settings.provider === 'claude' ? 'claude' : 'codex'));
  el.addTeamRoleUpstreamList.innerHTML = [
    '<label class="team-role-downstream-option">',
    `<input type="checkbox" value="${escapeHtml(TEAM_OWNER_ID)}" ${upstreamIds.has(TEAM_OWNER_ID) ? 'checked' : ''} />`,
    `<span>${escapeHtml(group?.ownerName || t('agentTeamOwnerName'))}</span>`,
    '</label>',
    ...roles.map((r) => [
      '<label class="team-role-downstream-option">',
      `<input type="checkbox" value="${escapeHtml(r.id)}" ${upstreamIds.has(r.id) ? 'checked' : ''} />`,
      `<span>${escapeHtml(r.name)}</span>`,
      '</label>',
    ].join('')),
  ].join('');
  el.addTeamRoleDownstreamList.innerHTML = [
    '<label class="team-role-downstream-option">',
    `<input type="checkbox" value="${escapeHtml(TEAM_NO_DOWNSTREAM_ID)}" ${noDownstream ? 'checked' : ''} />`,
    `<span>${escapeHtml(t('agentTeamNoDownstreamRoles'))}</span>`,
    '</label>',
    ...roles.map((r) => [
      '<label class="team-role-downstream-option">',
      `<input type="checkbox" value="${escapeHtml(r.id)}" ${downstreamIds.has(r.id) ? 'checked' : ''} />`,
      `<span>${escapeHtml(r.name)}</span>`,
      '</label>',
    ].join('')),
  ].join('');
  el.addTeamRoleInfoSourceList.innerHTML = roles.length
    ? roles.map((r) => [
      '<label class="team-role-downstream-option">',
      `<input type="checkbox" value="${escapeHtml(r.id)}" ${infoSourceIds.has(r.id) ? 'checked' : ''} />`,
      `<span>${escapeHtml(r.name)}</span>`,
      '</label>',
    ].join('')).join('')
    : `<div class="tip">${escapeHtml(t('agentTeamNoInfoSourceRoles'))}</div>`;
}

export function openAddTeamRoleModal(): void {
  if (!currentAgentTeamGroup()) { openCreateTeamModal(); return; }
  editingRoleId = '';
  populateRoleModal(null);
  el.addTeamRoleModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.addTeamRoleNameInput.focus());
}

export function openEditTeamRoleModal(roleId: string): void {
  const group = currentAgentTeamGroup();
  const role = group?.roles.find((item) => item.id === roleId) || null;
  if (!role) return;
  editingRoleId = role.id;
  populateRoleModal(role);
  el.addTeamRoleModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.addTeamRoleNameInput.focus());
}

function closeAddTeamRoleModal(): void {
  editingRoleId = '';
  el.addTeamRoleModal.classList.add('hidden');
}

function bindExclusiveEmptyDownstreamOption(): void {
  el.addTeamRoleDownstreamList.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.type !== 'checkbox') return;
    const noneOption = el.addTeamRoleDownstreamList.querySelector<HTMLInputElement>(`input[value="${TEAM_NO_DOWNSTREAM_ID}"]`);
    const roleOptions = Array.from(el.addTeamRoleDownstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((item) => item.value !== TEAM_NO_DOWNSTREAM_ID);
    if (target.value === TEAM_NO_DOWNSTREAM_ID && target.checked) { roleOptions.forEach((item) => { item.checked = false; }); return; }
    if (target.value !== TEAM_NO_DOWNSTREAM_ID && target.checked && noneOption) noneOption.checked = false;
    if (noneOption && !roleOptions.some((item) => item.checked)) noneOption.checked = true;
  });
}

export function loadAgentTeamPrefs(): void {
  try {
    const raw = window.localStorage.getItem(TEAM_STORE_KEY);
    const parsed = JSON.parse(String(raw || '{}'));
    const normalizeGroupLocal = (rawGroup: any): import('../types.js').AgentTeamGroup | null => {
      const id = String(rawGroup?.id || '').trim() || newId('team');
      const name = String(rawGroup?.name || '').trim();
      if (!name) return null;
      const group: import('../types.js').AgentTeamGroup = {
        id, name,
        ownerName: String(rawGroup?.ownerName || '').trim() || t('agentTeamOwnerName'),
        roles: Array.isArray(rawGroup?.roles) ? rawGroup.roles.map(normalizeRole).filter(Boolean) : [],
        steps: Array.isArray(rawGroup?.steps) ? rawGroup.steps.map(normalizeStep).filter(Boolean) : [],
        messages: Array.isArray(rawGroup?.messages) ? rawGroup.messages.map(normalizeTeamMessage).filter(Boolean) : [],
        createdAt: Number(rawGroup?.createdAt || nowTs()) || nowTs(),
        updatedAt: Number(rawGroup?.updatedAt || rawGroup?.createdAt || nowTs()) || nowTs(),
      };
      refreshAllRoleDocs(group);
      return group;
    };
    state.agentTeamGroups = Array.isArray(parsed.groups)
      ? parsed.groups.map(normalizeGroupLocal).filter(Boolean) as import('../types.js').AgentTeamGroup[]
      : [];
    const activeId = String(parsed.activeGroupId || '').trim();
    state.activeAgentTeamGroupId = state.agentTeamGroups.some((item) => item.id === activeId)
      ? activeId : String(state.agentTeamGroups[0]?.id || '');
  } catch {
    state.agentTeamGroups = [];
    state.activeAgentTeamGroupId = '';
  }
}

export function createAgentTeamGroup(options: import('../types.js').CreateAgentTeamGroupOptions = {}): import('../types.js').AgentTeamGroup {
  const ts = nowTs();
  const name = String(options.name || '').trim() || t('agentTeamDefaultName', { index: state.agentTeamGroups.length + 1 });
  const group: import('../types.js').AgentTeamGroup = {
    id: newId('team'), name, ownerName: t('agentTeamOwnerName'), roles: [],
    steps: [{ id: newId('step'), kind: 'system', title: t('agentTeamGroupCreated'), body: t('agentTeamGroupCreatedBody'), colorKey: 'slate', status: 'done', timestamp: ts }],
    messages: [], createdAt: ts, updatedAt: ts,
  };
  state.agentTeamGroups.unshift(group);
  state.activeAgentTeamGroupId = group.id;
  switchWorkspaceMode('team');
  refreshAllRoleDocs(group);
  saveAgentTeamPrefs();
  return group;
}

export function createAgentTeamRole(options: import('../types.js').CreateAgentTeamRoleOptions = {}): import('../types.js').AgentTeamRole | null {
  const group = currentAgentTeamGroup();
  if (!group) return null;
  const name = String(options.name || '').trim();
  const responsibility = String(options.responsibility || '').trim();
  if (!name || !responsibility) return null;
  const validRoleIds = new Set(group.roles.map((item) => item.id));
  const downstreamRoleIds = Array.isArray(options.downstreamRoleIds) ? options.downstreamRoleIds.map((item) => String(item || '').trim()).filter((id) => validRoleIds.has(id)) : [];
  const infoSourceRoleIds = Array.isArray(options.infoSourceRoleIds) ? options.infoSourceRoleIds.map((item) => String(item || '').trim()).filter((id) => validRoleIds.has(id)) : [];
  const upstreamRoleIds = normalizeRoleIdList(Array.isArray(options.upstreamRoleIds) && options.upstreamRoleIds.length ? options.upstreamRoleIds : options.upstreamRoleId, validRoleIds, { includeOwner: true });
  const role: import('../types.js').AgentTeamRole = {
    id: newId('role'), name, provider: normalizeRoleProvider(options.provider),
    upstreamRoleId: upstreamRoleIds[0] || TEAM_OWNER_ID,
    upstreamRoleIds: upstreamRoleIds.length ? upstreamRoleIds : [TEAM_OWNER_ID],
    downstreamRoleIds, infoSourceRoleIds, responsibility,
    completionContractDoc: String(options.completionContractDoc || '').trim() || defaultCompletionContractDoc(),
    status: 'idle', createdAt: nowTs(), updatedAt: nowTs(),
  };
  group.roles.push(role);
  syncRoleGraphForCreatedRole(group, role);
  refreshAllRoleDocs(group);
  group.updatedAt = nowTs();
  group.steps.push({ id: newId('step'), kind: 'system', title: t('agentTeamRoleAdded', { name: role.name }), body: role.responsibilityDoc || role.responsibility, colorKey: TEAM_STEP_COLORS[group.steps.length % TEAM_STEP_COLORS.length], status: 'done', timestamp: nowTs() });
  saveAgentTeamPrefs();
  return role;
}

export function updateAgentTeamRole(roleId: string, options: import('../types.js').CreateAgentTeamRoleOptions = {}): import('../types.js').AgentTeamRole | null {
  const group = currentAgentTeamGroup();
  const id = String(roleId || '').trim();
  if (!group || !id) return null;
  const role = group.roles.find((item) => item.id === id) || null;
  if (!role) return null;
  const name = String(options.name || '').trim();
  const responsibility = String(options.responsibility || '').trim();
  if (!name || !responsibility) return null;
  const validRoleIds = new Set(group.roles.map((item) => item.id).filter((item) => item !== id));
  const upstreamRoleIds = normalizeRoleIdList(Array.isArray(options.upstreamRoleIds) && options.upstreamRoleIds.length ? options.upstreamRoleIds : options.upstreamRoleId, validRoleIds, { includeOwner: true });
  const downstreamRoleIds = Array.isArray(options.downstreamRoleIds) ? options.downstreamRoleIds.map((item) => String(item || '').trim()).filter((item) => validRoleIds.has(item)) : [];
  const infoSourceRoleIds = Array.isArray(options.infoSourceRoleIds) ? options.infoSourceRoleIds.map((item) => String(item || '').trim()).filter((item) => validRoleIds.has(item)) : [];
  const previousUpstream = upstreamIdsForRole(role);
  const previousDownstream = Array.from(new Set((role.downstreamRoleIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
  setRoleUpstreamIds(role, upstreamRoleIds.length ? upstreamRoleIds : [TEAM_OWNER_ID]);
  role.downstreamRoleIds = Array.from(new Set(downstreamRoleIds));
  role.infoSourceRoleIds = Array.from(new Set(infoSourceRoleIds));
  role.name = name; role.provider = normalizeRoleProvider(options.provider); role.responsibility = responsibility;
  role.completionContractDoc = String(options.completionContractDoc || '').trim() || defaultCompletionContractDoc();
  previousUpstream.forEach((upstreamId) => {
    if (!upstreamId || upstreamId === TEAM_OWNER_ID || role.upstreamRoleIds?.includes(upstreamId)) return;
    const upstream = group.roles.find((item) => item.id === upstreamId) || null;
    if (upstream) { upstream.downstreamRoleIds = (upstream.downstreamRoleIds || []).filter((item) => item !== role.id); upstream.updatedAt = nowTs(); }
  });
  previousDownstream.forEach((downstreamId) => {
    if (!downstreamId || role.downstreamRoleIds?.includes(downstreamId)) return;
    const downstream = group.roles.find((item) => item.id === downstreamId) || null;
    if (downstream) { setRoleUpstreamIds(downstream, upstreamIdsForRole(downstream).filter((item) => item !== role.id)); downstream.updatedAt = nowTs(); }
  });
  (role.upstreamRoleIds || []).forEach((upstreamId) => {
    if (!upstreamId || upstreamId === TEAM_OWNER_ID) return;
    const upstream = group.roles.find((item) => item.id === upstreamId) || null;
    if (upstream) { upstream.downstreamRoleIds = Array.from(new Set([...(upstream.downstreamRoleIds || []), role.id])); upstream.updatedAt = nowTs(); }
  });
  (role.downstreamRoleIds || []).forEach((downstreamId) => {
    const downstream = group.roles.find((item) => item.id === downstreamId) || null;
    if (downstream) { setRoleUpstreamIds(downstream, [...upstreamIdsForRole(downstream), role.id]); downstream.updatedAt = nowTs(); }
  });
  role.updatedAt = nowTs();
  refreshAllRoleDocs(group);
  group.updatedAt = role.updatedAt;
  group.steps.push({ id: newId('step'), kind: 'system', title: t('agentTeamRoleUpdated', { name: role.name }), body: t('agentTeamRoleUpdatedBody'), colorKey: 'amber', status: 'done', timestamp: role.updatedAt });
  saveAgentTeamPrefs();
  return role;
}

export function deleteAgentTeamRole(roleId: string): boolean {
  const group = currentAgentTeamGroup();
  const id = String(roleId || '').trim();
  if (!group || !id) return false;
  const role = group.roles.find((item) => item.id === id) || null;
  if (!role) return false;
  const ts = nowTs();
  const upstreamIds = upstreamIdsForRole(role);
  const fallbackUpstreamIds = upstreamIds.length ? upstreamIds : [TEAM_OWNER_ID];
  const downstreamIds = new Set(role.downstreamRoleIds || []);
  group.roles = group.roles.filter((item) => item.id !== id);
  group.roles.forEach((item) => {
    item.downstreamRoleIds = (item.downstreamRoleIds || []).filter((downstreamId) => downstreamId !== id);
    item.infoSourceRoleIds = (item.infoSourceRoleIds || []).filter((sourceId) => sourceId !== id);
    const nextUpstreamIds = upstreamIdsForRole(item).filter((upstreamId) => upstreamId !== id).concat(downstreamIds.has(item.id) ? fallbackUpstreamIds : []);
    if (roleHasUpstream(item, id) || downstreamIds.has(item.id)) setRoleUpstreamIds(item, nextUpstreamIds);
    item.updatedAt = ts;
  });
  fallbackUpstreamIds.filter((upstreamId) => upstreamId !== TEAM_OWNER_ID).forEach((upstreamId) => {
    const upstream = group.roles.find((item) => item.id === upstreamId) || null;
    if (upstream) {
      const adoptedIds = Array.from(downstreamIds).filter((downstreamId) => downstreamId !== upstream.id && group.roles.some((item) => item.id === downstreamId));
      upstream.downstreamRoleIds = Array.from(new Set([...(upstream.downstreamRoleIds || []), ...adoptedIds]));
      upstream.updatedAt = ts;
    }
  });
  refreshAllRoleDocs(group);
  group.steps.push({ id: newId('step'), kind: 'system', title: t('agentTeamRoleDeleted', { name: role.name }), body: t('agentTeamRoleDeletedBody'), colorKey: 'rose', status: 'done', timestamp: ts });
  group.updatedAt = ts;
  saveAgentTeamPrefs();
  return true;
}

export function bindAgentTeamController(renderAll: () => void): void {
  el.btnSidebarNewTeam.addEventListener('click', () => {
    toggleAgentTeamWorkspace();
    if (el.sidebarSearchInput) el.sidebarSearchInput.value = '';
    renderAll();
  });
  el.createTeamCancel.addEventListener('click', closeCreateTeamModal);
  el.createTeamConfirm.addEventListener('click', () => {
    createAgentTeamGroup({ name: el.createTeamNameInput.value });
    closeCreateTeamModal();
    renderAll();
  });
  el.createTeamNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); el.createTeamConfirm.click(); }
  });
  el.btnAddTeamRole.addEventListener('click', openAddTeamRoleModal);
  el.addTeamRoleProviderCodex.addEventListener('click', () => selectRoleProvider('codex'));
  el.addTeamRoleProviderClaude.addEventListener('click', () => selectRoleProvider('claude'));
  bindExclusiveEmptyDownstreamOption();
  el.addTeamRoleCancel.addEventListener('click', closeAddTeamRoleModal);
  el.addTeamRoleConfirm.addEventListener('click', () => {
    const payload = {
      name: el.addTeamRoleNameInput.value,
      provider: selectedRoleProvider(),
      upstreamRoleIds: selectedUpstreamRoleIds(),
      downstreamRoleIds: selectedDownstreamRoleIds(),
      infoSourceRoleIds: selectedInfoSourceRoleIds(),
      responsibility: el.addTeamRoleResponsibilityInput.value,
      completionContractDoc: el.addTeamRoleCompletionInput.value,
    };
    const role = editingRoleId ? updateAgentTeamRole(editingRoleId, payload) : createAgentTeamRole(payload);
    if (!role) { window.alert(t('agentTeamRoleRequired')); return; }
    closeAddTeamRoleModal();
    renderAll();
  });
  el.chatView.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-agent-team-create]')) { event.preventDefault(); openCreateTeamModal(); return; }
    if (target?.closest('[data-agent-team-add-role]')) { event.preventDefault(); openAddTeamRoleModal(); }
  });
  el.runtimePanel.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const editRoleButton = target?.closest('[data-agent-team-edit-role]');
    if (editRoleButton) {
      event.preventDefault();
      openEditTeamRoleModal(String(editRoleButton.getAttribute('data-agent-team-edit-role') || '').trim());
      return;
    }
    const deleteRoleButton = target?.closest('[data-agent-team-delete-role]');
    if (deleteRoleButton) {
      event.preventDefault();
      const roleId = String(deleteRoleButton.getAttribute('data-agent-team-delete-role') || '').trim();
      const group = currentAgentTeamGroup();
      const role = group?.roles.find((item) => item.id === roleId) || null;
      if (!role) return;
      if (!window.confirm(t('agentTeamConfirmDeleteRole', { name: role.name }))) return;
      if (deleteAgentTeamRole(roleId)) renderAll();
      return;
    }
    if (target?.closest('[data-agent-team-add-role]')) { event.preventDefault(); openAddTeamRoleModal(); }
  });
}
