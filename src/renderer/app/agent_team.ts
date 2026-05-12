import type {
  AgentTeamGroup,
  AgentTeamRole,
  AgentTeamStep,
  AppSnapshot,
  ConversationMessage,
  ConversationSummary,
  CreateAgentTeamGroupOptions,
  CreateAgentTeamRoleOptions,
  RuntimeState,
  WorkflowItem,
} from './types.js';
import {
  el,
  escapeHtml,
  state,
  t,
} from './state_i18n.js';
import { renderMarkdownLike } from './markdown_renderer.js';
import { codexdesk } from './codexdesk.js';
import {
  cleanupWorkflowCollapsed,
  isWorkflowStepCollapsed,
  messagePreview,
  setWorkflowStepCollapsed,
} from './conversation_runtime.js';

const TEAM_STORE_KEY = 'conductor.agent-team.v1';
const TEAM_STEP_COLORS = ['blue', 'teal', 'amber', 'violet', 'rose', 'slate'];
const TEAM_OWNER_ID = '__team_owner__';
const TEAM_NO_DOWNSTREAM_ID = '__team_no_downstream__';
const ROLE_PROCESSING_COLORS = ['blue', 'teal', 'amber', 'violet', 'rose'];
const ROLE_RUN_POLL_MS = 900;
const ROLE_COMPLETION_MAX_CONTINUES = 3;
let editingRoleId = '';

function roleInitial(name: string, fallback = 'R'): string {
  return Array.from(String(name || '').trim())[0] || fallback;
}

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

function normalizeRoleProvider(input: unknown): AgentTeamRole['provider'] {
  return String(input || '').trim().toLowerCase() === 'claude' ? 'claude' : 'codex';
}

function providerLabel(provider: unknown): string {
  return normalizeRoleProvider(provider) === 'claude' ? 'Claude' : 'Codex';
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
  const legacyUpstreamId = String(raw?.upstreamRoleId || '').trim();
  const upstreamRoleIds = Array.isArray(raw?.upstreamRoleIds)
    ? raw.upstreamRoleIds.map((item) => String(item || '').trim()).filter(Boolean)
    : (legacyUpstreamId ? [legacyUpstreamId] : []);
  return {
    id,
    name,
    conversationId: String(raw?.conversationId || '').trim(),
    provider: normalizeRoleProvider(raw?.provider),
    upstreamRoleId: upstreamRoleIds[0] || '',
    upstreamRoleIds,
    downstreamRoleIds,
    responsibility: String(raw?.responsibility || '').trim(),
    responsibilityDoc: String(raw?.responsibilityDoc || '').trim(),
    completionContractDoc: String(raw?.completionContractDoc || '').trim(),
    routingPromptDoc: String(raw?.routingPromptDoc || '').trim(),
    docsUpdatedAt: Number(raw?.docsUpdatedAt || 0) || undefined,
    lastReadAt: Number(raw?.lastReadAt || 0) || undefined,
    status: normalizeRoleStatus(raw?.status),
    currentUpstreamName: String(raw?.currentUpstreamName || '').trim(),
    currentTaskPreview: String(raw?.currentTaskPreview || '').trim(),
    currentProgress: String(raw?.currentProgress || '').trim(),
    waitingForRoleIds: Array.isArray(raw?.waitingForRoleIds)
      ? raw.waitingForRoleIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
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

function normalizeTeamMessage(raw: any): ConversationMessage | null {
  const text = String(raw?.text || '').trim();
  if (!text) {
    return null;
  }
  const role = raw?.role === 'assistant' ? 'assistant' : 'user';
  const sourceKind = String(raw?.sourceKind || '').trim();
  return {
    role,
    text,
    speakerName: String(raw?.speakerName || '').trim(),
    sourceKind: sourceKind === 'role' || sourceKind === 'system' ? sourceKind : role === 'assistant' ? 'role' : 'user',
    roleId: String(raw?.roleId || '').trim(),
    targetRoleId: String(raw?.targetRoleId || '').trim(),
    createdAt: Number(raw?.createdAt || raw?.timestamp || nowTs()) || nowTs(),
  };
}

function normalizeGroup(raw: any): AgentTeamGroup | null {
  const id = String(raw?.id || '').trim() || newId('team');
  const name = String(raw?.name || '').trim();
  if (!name) {
    return null;
  }
  const group: AgentTeamGroup = {
    id,
    name,
    ownerName: String(raw?.ownerName || '').trim() || t('agentTeamOwnerName'),
    roles: Array.isArray(raw?.roles) ? raw.roles.map(normalizeRole).filter(Boolean) as AgentTeamRole[] : [],
    steps: Array.isArray(raw?.steps) ? raw.steps.map(normalizeStep).filter(Boolean) as AgentTeamStep[] : [],
    messages: Array.isArray(raw?.messages) ? raw.messages.map(normalizeTeamMessage).filter(Boolean) as ConversationMessage[] : [],
    createdAt: Number(raw?.createdAt || nowTs()) || nowTs(),
    updatedAt: Number(raw?.updatedAt || raw?.createdAt || nowTs()) || nowTs(),
  };
  refreshAllRoleDocs(group);
  return group;
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

function applyTeamSnapshot(snapshot: AppSnapshot | null | undefined): void {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }
  if (Array.isArray(snapshot.conversations)) {
    state.conversations = snapshot.conversations;
  }
  if (snapshot.runtimeByConversation && typeof snapshot.runtimeByConversation === 'object') {
    state.runtimeByConversation = snapshot.runtimeByConversation;
  }
  if (snapshot.metaByConversation && typeof snapshot.metaByConversation === 'object') {
    state.metaByConversation = snapshot.metaByConversation;
  }
  if (Array.isArray(snapshot.runningConversationIds)) {
    state.runningConversationIds = new Set(snapshot.runningConversationIds.map((item) => String(item || '').trim()).filter(Boolean));
  }
  if (snapshot.queuedCountByConversation && typeof snapshot.queuedCountByConversation === 'object') {
    state.queuedCountByConversation = snapshot.queuedCountByConversation;
  }
  if (snapshot.queuedMessagesByConversation && typeof snapshot.queuedMessagesByConversation === 'object') {
    state.queuedMessagesByConversation = snapshot.queuedMessagesByConversation;
  }
  if (snapshot.settings && typeof snapshot.settings === 'object') {
    state.settings = {
      ...state.settings,
      ...snapshot.settings,
    };
  }
}

function findConversation(conversationId = ''): ConversationSummary | null {
  const id = String(conversationId || '').trim();
  if (!id) {
    return null;
  }
  return state.conversations.find((item) => item.id === id) || null;
}

function roleConversation(role: AgentTeamRole): ConversationSummary | null {
  return findConversation(role.conversationId || '');
}

function roleConversationTitle(group: AgentTeamGroup, role: AgentTeamRole): string {
  return `${group.name} / ${role.name}`;
}

function extractCreatedConversationId(snapshot: AppSnapshot | null | undefined, title: string): string {
  const directId = String(snapshot?.createdConversationId || '').trim();
  if (directId) {
    return directId;
  }
  const targetTitle = String(title || '').trim();
  const matched = Array.isArray(snapshot?.conversations)
    ? snapshot.conversations.find((item) => String(item.title || '').trim() === targetTitle)
    : null;
  return String(matched?.id || '').trim();
}

function normalizeRoleIdList(input: unknown, validRoleIds: Set<string>, options: { includeOwner?: boolean } = {}): string[] {
  const rawItems = Array.isArray(input) ? input : [input];
  return Array.from(new Set(rawItems
    .map((item) => String(item || '').trim())
    .filter((id) => id && (validRoleIds.has(id) || (options.includeOwner && id === TEAM_OWNER_ID)))));
}

function upstreamIdsForRole(role: AgentTeamRole): string[] {
  const ids = Array.isArray(role.upstreamRoleIds)
    ? role.upstreamRoleIds.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const legacyId = String(role.upstreamRoleId || '').trim();
  return Array.from(new Set([...ids, legacyId].filter(Boolean)));
}

function setRoleUpstreamIds(role: AgentTeamRole, upstreamRoleIds: string[]): void {
  const ids = Array.from(new Set(upstreamRoleIds.map((item) => String(item || '').trim()).filter(Boolean)));
  role.upstreamRoleIds = ids;
  role.upstreamRoleId = ids[0] || '';
}

function roleHasUpstream(role: AgentTeamRole, upstreamId: string): boolean {
  return upstreamIdsForRole(role).includes(upstreamId);
}

function updateRoleWorkState(role: AgentTeamRole, options: {
  status?: AgentTeamRole['status'];
  upstreamName?: string;
  taskText?: string;
  progress?: string;
  waitingForRoleIds?: string[];
}): void {
  if (options.status) {
    role.status = options.status;
  }
  if (typeof options.upstreamName === 'string') {
    role.currentUpstreamName = options.upstreamName;
  }
  if (typeof options.taskText === 'string') {
    role.currentTaskPreview = messagePreview(options.taskText);
  }
  if (typeof options.progress === 'string') {
    role.currentProgress = options.progress;
  }
  if (Array.isArray(options.waitingForRoleIds)) {
    role.waitingForRoleIds = options.waitingForRoleIds.map((item) => String(item || '').trim()).filter(Boolean);
  }
  role.updatedAt = nowTs();
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
    ownerName: t('agentTeamOwnerName'),
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
  const upstreamRoleIds = normalizeRoleIdList(
    Array.isArray(options.upstreamRoleIds) && options.upstreamRoleIds.length ? options.upstreamRoleIds : options.upstreamRoleId,
    validRoleIds,
    { includeOwner: true },
  );
  const role: AgentTeamRole = {
    id: newId('role'),
    name,
    provider: normalizeRoleProvider(options.provider),
    upstreamRoleId: upstreamRoleIds[0] || TEAM_OWNER_ID,
    upstreamRoleIds: upstreamRoleIds.length ? upstreamRoleIds : [TEAM_OWNER_ID],
    downstreamRoleIds,
    responsibility,
    completionContractDoc: String(options.completionContractDoc || '').trim() || defaultCompletionContractDoc(),
    status: 'idle',
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  group.roles.push(role);
  syncRoleGraphForCreatedRole(group, role);
  refreshAllRoleDocs(group);
  group.updatedAt = nowTs();
  group.steps.push({
    id: newId('step'),
    kind: 'system',
    title: t('agentTeamRoleAdded', { name: role.name }),
    body: role.responsibilityDoc || role.responsibility,
    colorKey: TEAM_STEP_COLORS[group.steps.length % TEAM_STEP_COLORS.length],
    status: 'done',
    timestamp: nowTs(),
  });
  saveAgentTeamPrefs();
  return role;
}

function updateAgentTeamRole(roleId: string, options: CreateAgentTeamRoleOptions = {}): AgentTeamRole | null {
  const group = currentAgentTeamGroup();
  const id = String(roleId || '').trim();
  if (!group || !id) {
    return null;
  }
  const role = group.roles.find((item) => item.id === id) || null;
  if (!role) {
    return null;
  }
  const name = String(options.name || '').trim();
  const responsibility = String(options.responsibility || '').trim();
  if (!name || !responsibility) {
    return null;
  }
  const validRoleIds = new Set(group.roles.map((item) => item.id).filter((item) => item !== id));
  const upstreamRoleIds = normalizeRoleIdList(
    Array.isArray(options.upstreamRoleIds) && options.upstreamRoleIds.length ? options.upstreamRoleIds : options.upstreamRoleId,
    validRoleIds,
    { includeOwner: true },
  );
  const downstreamRoleIds = Array.isArray(options.downstreamRoleIds)
    ? options.downstreamRoleIds.map((item) => String(item || '').trim()).filter((item) => validRoleIds.has(item))
    : [];
  const previousUpstream = upstreamIdsForRole(role);
  const previousDownstream = Array.from(new Set((role.downstreamRoleIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
  setRoleUpstreamIds(role, upstreamRoleIds.length ? upstreamRoleIds : [TEAM_OWNER_ID]);
  role.downstreamRoleIds = Array.from(new Set(downstreamRoleIds));
  role.name = name;
  role.provider = normalizeRoleProvider(options.provider);
  role.responsibility = responsibility;
  role.completionContractDoc = String(options.completionContractDoc || '').trim() || defaultCompletionContractDoc();

  previousUpstream.forEach((upstreamId) => {
    if (!upstreamId || upstreamId === TEAM_OWNER_ID || role.upstreamRoleIds?.includes(upstreamId)) {
      return;
    }
    const upstream = group.roles.find((item) => item.id === upstreamId) || null;
    if (upstream) {
      upstream.downstreamRoleIds = (upstream.downstreamRoleIds || []).filter((item) => item !== role.id);
      upstream.updatedAt = nowTs();
    }
  });
  previousDownstream.forEach((downstreamId) => {
    if (!downstreamId || role.downstreamRoleIds?.includes(downstreamId)) {
      return;
    }
    const downstream = group.roles.find((item) => item.id === downstreamId) || null;
    if (downstream) {
      setRoleUpstreamIds(downstream, upstreamIdsForRole(downstream).filter((item) => item !== role.id));
      downstream.updatedAt = nowTs();
    }
  });
  (role.upstreamRoleIds || []).forEach((upstreamId) => {
    if (!upstreamId || upstreamId === TEAM_OWNER_ID) {
      return;
    }
    const upstream = group.roles.find((item) => item.id === upstreamId) || null;
    if (upstream) {
      upstream.downstreamRoleIds = Array.from(new Set([...(upstream.downstreamRoleIds || []), role.id]));
      upstream.updatedAt = nowTs();
    }
  });
  (role.downstreamRoleIds || []).forEach((downstreamId) => {
    const downstream = group.roles.find((item) => item.id === downstreamId) || null;
    if (downstream) {
      setRoleUpstreamIds(downstream, [...upstreamIdsForRole(downstream), role.id]);
      downstream.updatedAt = nowTs();
    }
  });

  role.updatedAt = nowTs();
  refreshAllRoleDocs(group);
  group.updatedAt = role.updatedAt;
  group.steps.push({
    id: newId('step'),
    kind: 'system',
    title: t('agentTeamRoleUpdated', { name: role.name }),
    body: t('agentTeamRoleUpdatedBody'),
    colorKey: 'amber',
    status: 'done',
    timestamp: role.updatedAt,
  });
  saveAgentTeamPrefs();
  return role;
}

async function ensureRoleConversation(group: AgentTeamGroup, role: AgentTeamRole): Promise<string> {
  const existingId = String(role.conversationId || '').trim();
  if (existingId && findConversation(existingId)) {
    return existingId;
  }
  const title = roleConversationTitle(group, role);
  const result = await codexdesk.createConversation({
    title,
    provider: normalizeRoleProvider(role.provider),
    workdir: state.settings.defaultWorkdir || state.settings.workdir || '',
    preserveActive: true,
  });
  applyTeamSnapshot(result);
  const conversationId = extractCreatedConversationId(result, title);
  if (!conversationId) {
    throw new Error(t('agentTeamRoleConversationCreateFailed', { name: role.name }));
  }
  role.conversationId = conversationId;
  role.updatedAt = nowTs();
  group.updatedAt = role.updatedAt;
  saveAgentTeamPrefs();
  return conversationId;
}

function deleteAgentTeamRole(roleId: string): boolean {
  const group = currentAgentTeamGroup();
  const id = String(roleId || '').trim();
  if (!group || !id) {
    return false;
  }
  const role = group.roles.find((item) => item.id === id) || null;
  if (!role) {
    return false;
  }
  const ts = nowTs();
  const upstreamIds = upstreamIdsForRole(role);
  const fallbackUpstreamIds = upstreamIds.length ? upstreamIds : [TEAM_OWNER_ID];
  const downstreamIds = new Set(role.downstreamRoleIds || []);
  group.roles = group.roles.filter((item) => item.id !== id);
  group.roles.forEach((item) => {
    item.downstreamRoleIds = (item.downstreamRoleIds || []).filter((downstreamId) => downstreamId !== id);
    const nextUpstreamIds = upstreamIdsForRole(item)
      .filter((upstreamId) => upstreamId !== id)
      .concat(downstreamIds.has(item.id) ? fallbackUpstreamIds : []);
    if (roleHasUpstream(item, id) || downstreamIds.has(item.id)) {
      setRoleUpstreamIds(item, nextUpstreamIds);
    }
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
  group.steps.push({
    id: newId('step'),
    kind: 'system',
    title: t('agentTeamRoleDeleted', { name: role.name }),
    body: t('agentTeamRoleDeletedBody'),
    colorKey: 'rose',
    status: 'done',
    timestamp: ts,
  });
  group.updatedAt = ts;
  saveAgentTeamPrefs();
  return true;
}

async function appendAgentTeamUserMessage(text: string, onUpdate: () => void = () => {}): Promise<AgentTeamGroup | null> {
  const group = currentAgentTeamGroup();
  const messageText = String(text || '').trim();
  if (!group || !messageText) {
    return null;
  }
  const ts = nowTs();
  refreshAllRoleDocs(group);
  const entryRoles = resolveEntryRoles(group);
  const entryRole = entryRoles[0] || null;
  const ownerName = String(group.ownerName || '').trim() || t('agentTeamOwnerName');
  group.messages.push({
    role: 'user',
    speakerName: ownerName,
    sourceKind: 'user',
    targetRoleId: entryRole?.id || '',
    text: messageText,
    createdAt: ts,
  });
  if (entryRoles.length) {
    entryRoles.forEach((role, index) => {
      group.steps.push({
        id: newId('step'),
        kind: 'user-to-role',
        title: `${t('roleYou')} -> ${role.name}`,
        body: messageText,
        colorKey: ROLE_PROCESSING_COLORS[index % ROLE_PROCESSING_COLORS.length],
        status: 'done',
        timestamp: ts + index,
      });
      updateRoleWorkState(role, {
        status: 'running',
        upstreamName: ownerName,
        taskText: messageText,
        progress: t('agentTeamProgressAccepted'),
        waitingForRoleIds: [],
      });
    });
    group.updatedAt = ts;
    saveAgentTeamPrefs();
    onUpdate();
    entryRoles.forEach((role) => {
      runRoleConversationTurn(group, role, messageText, ownerName, new Set<string>(), onUpdate).catch((error) => {
        appendTeamMessage(group, {
          role: 'assistant',
          speakerName: role.name,
          roleId: role.id,
          text: t('agentTeamRoleRunFailed', { name: role.name, error: error?.message || String(error) }),
        });
        updateRoleWorkState(role, {
          status: 'blocked',
          progress: t('agentTeamProgressBlocked'),
          waitingForRoleIds: [],
        });
        group.updatedAt = role.updatedAt;
        saveAgentTeamPrefs();
        onUpdate();
      });
    });
  } else {
    group.steps.push({
      id: `step-${ts.toString(36)}`,
      kind: 'user-to-role',
      title: `${t('roleYou')} -> ${t('agentTeamLabel')}`,
      body: messageText,
      colorKey: 'blue',
      status: 'done',
      timestamp: ts,
    });
    group.updatedAt = ts;
    saveAgentTeamPrefs();
    onUpdate();
  }
  return group;
}

function syncRoleGraphForCreatedRole(group: AgentTeamGroup, role: AgentTeamRole): void {
  upstreamIdsForRole(role).forEach((upstreamId) => {
    if (!upstreamId || upstreamId === TEAM_OWNER_ID) {
      return;
    }
    const upstream = group.roles.find((item) => item.id === upstreamId);
    if (upstream) {
      upstream.downstreamRoleIds = Array.from(new Set([...(upstream.downstreamRoleIds || []), role.id]));
      upstream.updatedAt = nowTs();
    }
  });
  (role.downstreamRoleIds || []).forEach((downstreamId) => {
    const downstream = group.roles.find((item) => item.id === downstreamId);
    if (!downstream || downstream.id === role.id) {
      return;
    }
    setRoleUpstreamIds(downstream, [...upstreamIdsForRole(downstream), role.id]);
    downstream.updatedAt = nowTs();
  });
}

function downstreamRoleNameList(group: AgentTeamGroup, roleIds: string[] = []): string {
  return roleIds.map((id) => resolveRoleName(group, id)).filter(Boolean).join(', ') || t('agentTeamNoDownstreamRoles');
}

function upstreamRoleNameList(group: AgentTeamGroup, role: AgentTeamRole): string {
  return upstreamIdsForRole(role).map((id) => resolveRoleName(group, id)).filter(Boolean).join(', ') || t('agentTeamNoOwner');
}

function downstreamCommunicationLine(group: AgentTeamGroup, role: AgentTeamRole): string {
  const downstreamIds = role.downstreamRoleIds || [];
  if (!downstreamIds.length) {
    return t('agentTeamPromptNoDownstream');
  }
  const downstreamScopes = downstreamIds
    .map((id) => group.roles.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => `- ${item?.name}: ${String(item?.responsibility || '').trim() || t('agentTeamRoleScopeFallback')}`)
    .join('\n');
  return t('agentTeamPromptDownstream', {
    downstream: downstreamRoleNameList(group, downstreamIds),
    scopes: downstreamScopes,
  });
}

function defaultCompletionContractDoc(): string {
  return [
    t('agentTeamCompletionContractNoPremature'),
    t('agentTeamCompletionContractContinue'),
    t('agentTeamCompletionContractFinalOnly'),
    t('agentTeamCompletionContractFormat'),
  ].join('\n');
}

function buildRoleResponsibilityDoc(group: AgentTeamGroup, role: AgentTeamRole): string {
  return [
    `# ${role.name} ${t('agentTeamResponsibilityDoc')}`,
    '',
    t('agentTeamPromptIdentity', { name: role.name }),
    t('agentTeamDocProvider', { provider: providerLabel(role.provider) }),
    t('agentTeamDocResponsibilityBody', { responsibility: String(role.responsibility || '').trim() }),
    t('agentTeamDocResponsibilityBoundary'),
    '',
    t('agentTeamDocReadRule'),
  ].join('\n');
}

function buildRoleCompletionContractDoc(role: AgentTeamRole): string {
  return [
    t('agentTeamCompletionContractTitle'),
    String(role.completionContractDoc || '').trim() || defaultCompletionContractDoc(),
  ].join('\n');
}

function buildRoleRoutingPromptDoc(group: AgentTeamGroup, role: AgentTeamRole): string {
  return [
    `# ${role.name} ${t('agentTeamRoutingPromptDoc')}`,
    '',
    `## ${t('agentTeamCommunicationBasics')}`,
    t('agentTeamPromptReadDocs'),
    t('agentTeamPromptProvider', { provider: providerLabel(role.provider) }),
    '',
    `## ${t('agentTeamCommunicationUpstream')}`,
    t('agentTeamPromptUpstream', { upstream: upstreamRoleNameList(group, role) }),
    t('agentTeamPromptAskUpstream'),
    '',
    `## ${t('agentTeamCommunicationDownstream')}`,
    downstreamCommunicationLine(group, role),
    t('agentTeamPromptDelegate'),
    t('agentTeamPromptDelegateBoundary'),
    t('agentTeamPromptDelegateFormat'),
    '',
    `## ${t('agentTeamCommunicationReport')}`,
    t('agentTeamPromptRejectOutOfScope'),
    t('agentTeamPromptReport'),
    t('agentTeamPromptCompletionGate'),
  ].join('\n');
}

function ensureRoleDocs(group: AgentTeamGroup, role: AgentTeamRole, options: { onlyMissing?: boolean } = {}): void {
  if (options.onlyMissing && role.responsibilityDoc && role.routingPromptDoc) {
    return;
  }
  role.responsibilityDoc = buildRoleResponsibilityDoc(group, role);
  if (!String(role.completionContractDoc || '').trim()) {
    role.completionContractDoc = defaultCompletionContractDoc();
  }
  role.routingPromptDoc = buildRoleRoutingPromptDoc(group, role);
  role.docsUpdatedAt = nowTs();
}

function refreshAllRoleDocs(group: AgentTeamGroup, options: { onlyMissing?: boolean } = {}): void {
  group.roles.forEach((role) => ensureRoleDocs(group, role, options));
}

function markRoleDocsRead(role: AgentTeamRole, timestamp: number): void {
  role.lastReadAt = timestamp;
}

function appendTeamMessage(group: AgentTeamGroup, options: {
  role: 'user' | 'assistant';
  text: string;
  speakerName?: string;
  sourceKind?: 'user' | 'role' | 'system';
  roleId?: string;
  targetRoleId?: string;
  createdAt?: number;
}): void {
  const text = String(options.text || '').trim();
  if (!text) {
    return;
  }
  group.messages.push({
    role: options.role,
    speakerName: String(options.speakerName || '').trim(),
    sourceKind: options.sourceKind || (options.role === 'user' ? 'user' : 'role'),
    roleId: String(options.roleId || '').trim(),
    targetRoleId: String(options.targetRoleId || '').trim(),
    text,
    createdAt: Number(options.createdAt || nowTs()) || nowTs(),
  });
  group.updatedAt = nowTs();
}

function appendTeamStep(group: AgentTeamGroup, options: {
  kind: AgentTeamStep['kind'];
  title: string;
  body: string;
  colorKey?: string;
  status?: AgentTeamStep['status'];
  timestamp?: number;
}): void {
  const title = String(options.title || '').trim();
  const body = String(options.body || '').trim();
  if (!title && !body) {
    return;
  }
  group.steps.push({
    id: newId('step'),
    kind: options.kind,
    title: title || t('agentTeamStepUntitled'),
    body,
    colorKey: String(options.colorKey || '').trim() || TEAM_STEP_COLORS[group.steps.length % TEAM_STEP_COLORS.length],
    status: options.status || 'done',
    timestamp: Number(options.timestamp || nowTs()) || nowTs(),
  });
  group.updatedAt = nowTs();
}

function buildRoleRunPrompt(group: AgentTeamGroup, role: AgentTeamRole, taskText: string, upstreamName: string): string {
  ensureRoleDocs(group, role);
  return [
    role.responsibilityDoc || '',
    '',
    buildRoleCompletionContractDoc(role),
    '',
    role.routingPromptDoc || '',
    '',
    t('agentTeamConversationInputPrompt', { from: upstreamName || group.ownerName || t('agentTeamOwnerName') }),
    '',
    taskText,
  ].filter((item) => String(item || '').trim()).join('\n');
}

function latestAssistantText(conversation: ConversationSummary | null): string {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role === 'assistant' && String(item.text || '').trim()) {
      return String(item.text || '').trim();
    }
  }
  return '';
}

function isTerminalPhase(phase: unknown): boolean {
  const value = String(phase || '').trim();
  return value === '已完成' || value === '完成' || value === '失败' || value === '空闲'
    || value.includes('已停止') || value.includes('任务已停止') || value.toLowerCase().includes('stopped');
}

function isStoppedPhase(phase: unknown): boolean {
  const value = String(phase || '').trim().toLowerCase();
  return value.includes('已停止') || value.includes('任务已停止') || value.includes('stopped') || value.includes('stop');
}

function runtimeEntryText(item: unknown): string {
  if (!item) {
    return '';
  }
  if (typeof item === 'string') {
    return item;
  }
  if (typeof item !== 'object') {
    return String(item || '');
  }
  const record = item as Record<string, unknown>;
  return [
    record.message,
    record.title,
    record.body,
    record.preview,
    record.line,
    record.tag,
  ].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
}

function hasStoppedRuntimeSignal(runtime: RuntimeState | null | undefined, conversationId = ''): boolean {
  if (runtime && isStoppedPhase(runtime.phase)) {
    return true;
  }
  const conversation = findConversation(conversationId);
  const hasInterruptedUserMessage = Array.isArray(conversation?.messages)
    && conversation.messages.slice(-6).some((item) => item?.role === 'user' && (
      item.interrupted === true
      || String(item.interruptedReason || '').trim() === 'user-stop'
    ));
  if (hasInterruptedUserMessage) {
    return true;
  }
  if (!runtime) {
    return false;
  }
  const text = [
    ...(Array.isArray(runtime.events) ? runtime.events.slice(-12).map(runtimeEntryText) : []),
    ...(Array.isArray(runtime.workflow) ? runtime.workflow.slice(-12).map(runtimeEntryText) : []),
    ...(Array.isArray(runtime.raw) ? runtime.raw.slice(-12).map(runtimeEntryText) : []),
  ].join('\n').toLowerCase();
  return text.includes('已请求停止当前对话任务')
    || text.includes('任务已停止')
    || text.includes('turn.interrupted')
    || text.includes('user-stop')
    || text.includes('interrupted')
    || text.includes('exit code 130')
    || text.includes('退出码 130');
}

function workflowText(item: WorkflowItem | null | undefined): string {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const body = String(item.body || '').trim();
  const preview = String(item.preview || '').trim();
  const title = String(item.title || '').trim();
  return body || preview || title;
}

function summarizeWorkflow(runtime: RuntimeState | null | undefined, sinceIndex = 0): string {
  const items = Array.isArray(runtime?.workflow) ? runtime.workflow.slice(Math.max(0, sinceIndex)) : [];
  const selected = items
    .filter((item) => item && (item.type === 'plan' || item.type === 'step' || item.type === 'assistant'))
    .slice(-8)
    .map((item) => {
      const title = String(item.title || item.tag || t('agentTeamStepUntitled')).trim();
      const text = workflowText(item);
      return text ? `- ${title}: ${text}` : `- ${title}`;
    });
  return selected.join('\n');
}

function waitForRoleConversation(conversationId: string, previousMessageCount: number, previousWorkflowCount: number): Promise<{
  assistantText: string;
  workflowSummary: string;
  ok: boolean;
}> {
  return new Promise((resolve) => {
    const tick = () => {
      const runtime = state.runtimeByConversation[conversationId];
      const conv = findConversation(conversationId);
      const messages = Array.isArray(conv?.messages) ? conv.messages : [];
      const hasNewAssistant = messages.slice(Math.max(0, previousMessageCount)).some((item) => item?.role === 'assistant');
      const running = state.runningConversationIds.has(conversationId);
      const queued = Number(state.queuedCountByConversation[conversationId] || 0) > 0;
      if ((hasNewAssistant || isTerminalPhase(runtime?.phase)) && !running && !queued) {
        resolve({
          assistantText: latestAssistantText(conv),
          workflowSummary: summarizeWorkflow(runtime, previousWorkflowCount),
          ok: String(runtime?.phase || '').trim() !== '失败',
        });
        return;
      }
      window.setTimeout(tick, ROLE_RUN_POLL_MS);
    };
    tick();
  });
}

async function sendRoleConversation(group: AgentTeamGroup, role: AgentTeamRole, prompt: string, onUpdate: () => void): Promise<{
  assistantText: string;
  workflowSummary: string;
  ok: boolean;
}> {
  const conversationId = await ensureRoleConversation(group, role);
  const runtime = state.runtimeByConversation[conversationId];
  const conversation = findConversation(conversationId);
  const previousMessageCount = Array.isArray(conversation?.messages) ? conversation.messages.length : 0;
  const previousWorkflowCount = Array.isArray(runtime?.workflow) ? runtime.workflow.length : 0;
  const result = await codexdesk.sendMessage(conversationId, prompt, [], { appendUserMessage: false });
  applyTeamSnapshot(result?.snapshot || result);
  if (result?.error) {
    throw new Error(String(result.error));
  }
  onUpdate();
  return waitForRoleConversation(conversationId, previousMessageCount, previousWorkflowCount);
}

function isCompletionContractSatisfied(text: string): boolean {
  const body = String(text || '').trim();
  if (!body) {
    return false;
  }
  return /完成状态\s*[：:]\s*(完成|阻塞)/.test(body)
    || /完成状态\s*[：:]\s*拒绝/.test(body)
    || /Completion status\s*:\s*(done|blocked|rejected)/i.test(body);
}

function isRejectedOrBlockedCompletion(text: string): boolean {
  const body = String(text || '').trim();
  return /完成状态\s*[：:]\s*(阻塞|拒绝)/.test(body)
    || /Completion status\s*:\s*(blocked|rejected)/i.test(body);
}

async function sendRoleConversationUntilComplete(
  group: AgentTeamGroup,
  role: AgentTeamRole,
  prompt: string,
  onUpdate: () => void,
): Promise<{
  assistantText: string;
  workflowSummary: string;
  ok: boolean;
}> {
  let result = await sendRoleConversation(group, role, prompt, onUpdate);
  let continueCount = 0;
  while (result.ok && !isCompletionContractSatisfied(result.assistantText) && continueCount < ROLE_COMPLETION_MAX_CONTINUES) {
    continueCount += 1;
    appendTeamMessage(group, {
      role: 'assistant',
      speakerName: t('agentTeamCompletionGateName'),
      sourceKind: 'system',
      roleId: role.id,
      text: t('agentTeamCompletionGateRetry', { name: role.name, count: continueCount }),
    });
    saveAgentTeamPrefs();
    onUpdate();
    const nextResult = await sendRoleConversation(group, role, t('agentTeamCompletionContinuePrompt'), onUpdate);
    result = {
      assistantText: nextResult.assistantText || result.assistantText,
      workflowSummary: [result.workflowSummary, nextResult.workflowSummary].filter(Boolean).join('\n'),
      ok: nextResult.ok,
    };
  }
  if (result.ok && !isCompletionContractSatisfied(result.assistantText)) {
    return {
      ...result,
      assistantText: [
        t('agentTeamCompletionGateExceeded', { name: role.name }),
        result.assistantText,
      ].filter(Boolean).join('\n\n'),
      ok: false,
    };
  }
  return result;
}

function buildDownstreamPrompt(group: AgentTeamGroup, upstreamRole: AgentTeamRole, downstreamRole: AgentTeamRole, originalTask: string, upstreamResult: string): string {
  return [
    t('agentTeamDelegatedPromptTitle', { from: upstreamRole.name, to: downstreamRole.name }),
    '',
    t('agentTeamDelegatedPromptTask', { task: originalTask }),
    '',
    t('agentTeamDelegatedPromptContext', { content: upstreamResult || t('agentTeamNoRoleOutput') }),
  ].join('\n');
}

function parseDelegationDirective(text: string): string {
  const body = String(text || '');
  const zhMatch = /^下级分派\s*[：:]\s*(.+)$/im.exec(body);
  if (zhMatch?.[1]) {
    return zhMatch[1].trim();
  }
  const enMatch = /^Downstream delegation\s*:\s*(.+)$/im.exec(body);
  return String(enMatch?.[1] || '').trim();
}

function selectedDelegatedDownstreamRoles(allDownstreamRoles: AgentTeamRole[], assistantText: string): AgentTeamRole[] {
  const directive = parseDelegationDirective(assistantText);
  if (!directive) {
    return [];
  }
  const normalized = directive.toLowerCase();
  if (/^(无|none|no|n\/a|不分派|无需|不用)\b/i.test(directive) || normalized.includes('none')) {
    return [];
  }
  if (/^(全部|all)\b/i.test(directive)) {
    return allDownstreamRoles;
  }
  return allDownstreamRoles.filter((role) => {
    const name = String(role.name || '').trim();
    return Boolean(name && directive.includes(name)) || directive.includes(role.id);
  });
}

function buildSummaryPrompt(role: AgentTeamRole, originalTask: string, ownResult: string, downstreamResults: Array<{ role: AgentTeamRole; output: string }>): string {
  const returns = downstreamResults
    .map((item) => `## ${item.role.name}\n${item.output || t('agentTeamNoRoleOutput')}`)
    .join('\n\n');
  return [
    t('agentTeamSummaryPromptTitle', { name: role.name }),
    '',
    t('agentTeamSummaryPromptTask', { task: originalTask }),
    '',
    t('agentTeamSummaryPromptOwn', { content: ownResult || t('agentTeamNoRoleOutput') }),
    '',
    t('agentTeamSummaryPromptReturns'),
    returns || t('agentTeamNoDownstreamReturns'),
  ].join('\n');
}

async function runRoleConversationTurn(
  group: AgentTeamGroup,
  role: AgentTeamRole,
  taskText: string,
  upstreamName: string,
  visited: Set<string>,
  onUpdate: () => void,
): Promise<string> {
  if (visited.has(role.id)) {
    return '';
  }
  visited.add(role.id);
  const ts = nowTs();
  ensureRoleDocs(group, role);
  markRoleDocsRead(role, ts);
  updateRoleWorkState(role, {
    status: 'running',
    upstreamName: upstreamName || group.ownerName || t('agentTeamOwnerName'),
    taskText,
    progress: t('agentTeamProgressAccepted'),
    waitingForRoleIds: [],
  });
  appendTeamStep(group, {
    kind: upstreamName === (group.ownerName || t('agentTeamOwnerName')) ? 'user-to-role' : 'role-to-role',
    title: `${upstreamName || group.ownerName || t('agentTeamOwnerName')} -> ${role.name}`,
    body: taskText,
    colorKey: ROLE_PROCESSING_COLORS[visited.size % ROLE_PROCESSING_COLORS.length],
    status: 'running',
  });
  appendTeamMessage(group, {
    role: 'assistant',
    speakerName: role.name,
    roleId: role.id,
    text: t('agentTeamRoleAcceptedTask', { from: upstreamName || group.ownerName || t('agentTeamOwnerName') }),
  });
  saveAgentTeamPrefs();
  onUpdate();

  const availableDownstreamRoles = directDownstreamRoles(group, role).filter((item) => !visited.has(item.id));
  updateRoleWorkState(role, {
    status: 'running',
    progress: t('agentTeamProgressWorking'),
  });
  saveAgentTeamPrefs();
  onUpdate();
  const firstResult = await sendRoleConversationUntilComplete(group, role, buildRoleRunPrompt(group, role, taskText, upstreamName), onUpdate);
  if (!firstResult.ok) {
    updateRoleWorkState(role, {
      status: 'blocked',
      progress: t('agentTeamProgressBlocked'),
      waitingForRoleIds: [],
    });
  }
  appendTeamStep(group, {
    kind: 'system',
    title: t('agentTeamConversationStepsTitle', { name: role.name }),
    body: firstResult.workflowSummary || t('agentTeamNoRuntimeSteps'),
    colorKey: 'slate',
  });
  appendTeamMessage(group, {
    role: 'assistant',
    speakerName: t('agentTeamConversationStepsTitle', { name: role.name }),
    sourceKind: 'system',
    roleId: role.id,
    text: firstResult.workflowSummary || t('agentTeamNoRuntimeSteps'),
  });
  appendTeamMessage(group, {
    role: 'assistant',
    speakerName: role.name,
    roleId: role.id,
    text: firstResult.assistantText || t('agentTeamNoRoleOutput'),
  });

  const downstreamRoles = selectedDelegatedDownstreamRoles(availableDownstreamRoles, firstResult.assistantText);
  const downstreamResults: Array<{ role: AgentTeamRole; output: string }> = [];
  const shouldStopHere = !firstResult.ok || isRejectedOrBlockedCompletion(firstResult.assistantText);
  if (shouldStopHere && role.status !== 'blocked') {
    updateRoleWorkState(role, {
      status: 'blocked',
      progress: t('agentTeamProgressBlocked'),
      waitingForRoleIds: [],
    });
  }
  if (firstResult.ok && !shouldStopHere) {
    updateRoleWorkState(role, {
      status: 'running',
      progress: downstreamRoles.length
        ? t('agentTeamProgressWaitingDownstream', { names: downstreamRoles.map((item) => item.name).join(', ') })
        : availableDownstreamRoles.length
          ? t('agentTeamProgressNoDelegation')
          : t('agentTeamProgressNoDownstream'),
      waitingForRoleIds: downstreamRoles.map((item) => item.id),
    });
    saveAgentTeamPrefs();
    onUpdate();
    for (let index = 0; index < downstreamRoles.length; index += 1) {
      const downstreamRole = downstreamRoles[index];
      const delegatedPrompt = buildDownstreamPrompt(group, role, downstreamRole, taskText, firstResult.assistantText);
      appendTeamStep(group, {
        kind: 'role-to-role',
        title: `${role.name} -> ${downstreamRole.name}`,
        body: delegatedPrompt,
        colorKey: ROLE_PROCESSING_COLORS[index % ROLE_PROCESSING_COLORS.length],
        status: 'running',
      });
      saveAgentTeamPrefs();
      onUpdate();
      const output = await runRoleConversationTurn(group, downstreamRole, delegatedPrompt, role.name, new Set(visited), onUpdate);
      downstreamResults.push({ role: downstreamRole, output });
      updateRoleWorkState(role, {
        status: 'running',
        progress: t('agentTeamProgressWaitingDownstream', {
          names: downstreamRoles
            .filter((item) => !downstreamResults.some((result) => result.role.id === item.id))
            .map((item) => item.name)
            .join(', ') || t('agentTeamNoDownstreamRoles'),
        }),
        waitingForRoleIds: downstreamRoles
          .filter((item) => !downstreamResults.some((result) => result.role.id === item.id))
          .map((item) => item.id),
      });
      appendTeamStep(group, {
        kind: 'role-return',
        title: `${downstreamRole.name} -> ${role.name}`,
        body: output || t('agentTeamNoRoleOutput'),
        colorKey: 'teal',
      });
    }
  }

  let finalText = firstResult.assistantText;
  if (firstResult.ok && !shouldStopHere && downstreamRoles.length) {
    const summaryPrompt = buildSummaryPrompt(role, taskText, firstResult.assistantText, downstreamResults);
    appendTeamMessage(group, {
      role: 'assistant',
      speakerName: role.name,
      roleId: role.id,
      text: t('agentTeamRoleSummarizingReturns', { count: downstreamResults.length }),
    });
    saveAgentTeamPrefs();
    onUpdate();
    updateRoleWorkState(role, {
      status: 'running',
      progress: t('agentTeamProgressSummarizing'),
      waitingForRoleIds: [],
    });
    const summaryResult = await sendRoleConversationUntilComplete(group, role, summaryPrompt, onUpdate);
    appendTeamStep(group, {
      kind: 'system',
      title: t('agentTeamConversationStepsTitle', { name: role.name }),
      body: summaryResult.workflowSummary || t('agentTeamNoRuntimeSteps'),
      colorKey: 'slate',
    });
    appendTeamMessage(group, {
      role: 'assistant',
      speakerName: t('agentTeamConversationStepsTitle', { name: role.name }),
      sourceKind: 'system',
      roleId: role.id,
      text: summaryResult.workflowSummary || t('agentTeamNoRuntimeSteps'),
    });
    finalText = summaryResult.assistantText || finalText;
    appendTeamMessage(group, {
      role: 'assistant',
      speakerName: role.name,
      roleId: role.id,
      text: finalText || t('agentTeamNoRoleOutput'),
    });
  }
  updateRoleWorkState(role, {
    status: role.status === 'blocked' ? 'blocked' : 'done',
    progress: role.status === 'blocked' ? t('agentTeamProgressBlocked') : t('agentTeamProgressDone'),
    waitingForRoleIds: [],
  });
  group.updatedAt = role.updatedAt;
  saveAgentTeamPrefs();
  onUpdate();
  return finalText || '';
}

function resolveRoleName(group: AgentTeamGroup, roleId = ''): string {
  if (roleId === TEAM_OWNER_ID) {
    return group.ownerName || t('agentTeamOwnerName');
  }
  if (!roleId) {
    return t('agentTeamNoOwner');
  }
  return group.roles.find((item) => item.id === roleId)?.name || t('agentTeamUnknownRole');
}

function roleOrderIndexMap(group: AgentTeamGroup): Map<string, number> {
  const map = new Map<string, number>();
  (group.roles || []).forEach((role, index) => {
    map.set(role.id, index);
  });
  return map;
}

function roleLevelMap(group: AgentTeamGroup): Map<string, number> {
  const levels = new Map<string, number>();
  const roles = group.roles || [];
  roles.forEach((role) => levels.set(role.id, 1));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const maxDepth = Math.max(roles.length * 2, 8);
  for (let round = 0; round < maxDepth; round += 1) {
    let changed = false;
    for (const role of roles) {
      const current = Number(levels.get(role.id) || 1);
      const upstreamIds = upstreamIdsForRole(role);
      let nextLevel = current;
      if (!upstreamIds.length || upstreamIds.includes(TEAM_OWNER_ID)) {
        nextLevel = Math.max(nextLevel, 1);
      }
      upstreamIds.forEach((upstreamId) => {
        if (upstreamId === TEAM_OWNER_ID) {
          nextLevel = Math.max(nextLevel, 1);
          return;
        }
        const upstream = roleById.get(upstreamId);
        if (!upstream) {
          return;
        }
        const upstreamLevel = Number(levels.get(upstream.id) || 1);
        nextLevel = Math.max(nextLevel, upstreamLevel + 1);
      });
      if (nextLevel !== current) {
        levels.set(role.id, nextLevel);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return levels;
}

function sortedRolesByHierarchy(group: AgentTeamGroup): AgentTeamRole[] {
  const levels = roleLevelMap(group);
  const orderMap = roleOrderIndexMap(group);
  return [...(group.roles || [])].sort((a, b) => {
    const levelDiff = Number(levels.get(a.id) || 1) - Number(levels.get(b.id) || 1);
    if (levelDiff !== 0) {
      return levelDiff;
    }
    return Number(orderMap.get(a.id) || 0) - Number(orderMap.get(b.id) || 0);
  });
}

function resolveEntryRoles(group: AgentTeamGroup): AgentTeamRole[] {
  const ownerRoles = group.roles.filter((role) => roleHasUpstream(role, TEAM_OWNER_ID));
  if (ownerRoles.length) {
    return ownerRoles;
  }
  const rootRoles = group.roles.filter((role) => upstreamIdsForRole(role).length <= 0);
  return rootRoles.length ? rootRoles : group.roles.slice(0, 1);
}

function directDownstreamRoles(group: AgentTeamGroup, role: AgentTeamRole | null): AgentTeamRole[] {
  if (!role) {
    return [];
  }
  return (role.downstreamRoleIds || [])
    .map((id) => group.roles.find((item) => item.id === id))
    .filter(Boolean) as AgentTeamRole[];
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
    if (!(target instanceof Element)) {
      return;
    }
    const clickable = target.closest('.runtime-step-toggle, .runtime-step-head, .runtime-step-collapsed-line');
    if (!clickable) {
      return;
    }
    const container = clickable.closest('[data-agent-team-wf-index]');
    if (!container) {
      return;
    }
    const index = Number(container.getAttribute('data-agent-team-wf-index') || '-1');
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextCollapsed = !isWorkflowStepCollapsed(group.id, index);
    setWorkflowStepCollapsed(group.id, index, nextCollapsed);
    renderAgentTeamWorkflowTab();
  };
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

function roleStatusLabel(role: AgentTeamRole): string {
  const status = role.status || 'idle';
  if (status === 'running') {
    return t('agentTeamStatusRunning');
  }
  if (status === 'blocked') {
    return t('agentTeamStatusBlocked');
  }
  if (status === 'done') {
    return t('agentTeamStatusDone');
  }
  return t('agentTeamStatusIdle');
}

function renderRoleStatusLine(group: AgentTeamGroup, role: AgentTeamRole): string {
  const waitingNames = (role.waitingForRoleIds || [])
    .map((id) => resolveRoleName(group, id))
    .filter(Boolean)
    .join(', ');
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

function roleDepthLabel(level: number): string {
  const depth = Math.max(1, Number(level) || 1);
  return t('agentTeamRoleLevelLabel', { level: depth });
}

function renderAgentTeamRolesTab(): void {
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
    return [
      '<div class="agent-team-side-role">',
      '<div class="agent-team-side-role-head">',
      `<div class="agent-team-side-role-title">${escapeHtml(role.name)}</div>`,
      '<div class="agent-team-role-actions">',
      `<button type="button" class="agent-team-role-edit" data-agent-team-edit-role="${escapeHtml(role.id)}" title="${escapeHtml(t('agentTeamEditRole'))}">${escapeHtml(t('agentTeamEditRole'))}</button>`,
      `<button type="button" class="agent-team-role-delete" data-agent-team-delete-role="${escapeHtml(role.id)}" title="${escapeHtml(t('agentTeamDeleteRole'))}">${escapeHtml(t('agentTeamDeleteRole'))}</button>`,
      '</div>',
      '</div>',
      `<div>${escapeHtml(t('agentTeamRoleLevel'))}: ${escapeHtml(roleDepthLabel(level))}</div>`,
      renderRoleStatusLine(group, role),
      `<div>${escapeHtml(t('agentTeamRoleProvider'))}: ${escapeHtml(providerLabel(role.provider))}</div>`,
      `<div>${escapeHtml(t('agentTeamRoleConversation'))}: ${escapeHtml(roleConversation(role)?.title || t('agentTeamRoleConversationPending'))}</div>`,
      `<div>${escapeHtml(t('agentTeamUpstream'))}: ${escapeHtml(upstreamRoleNameList(group, role))}</div>`,
      `<div>${escapeHtml(t('agentTeamDownstream'))}: ${escapeHtml(downstreamNames)}</div>`,
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
    ].join('');
  }).join('');
  el.tabTeamRoles.innerHTML = [
    `<button type="button" class="agent-team-side-add" data-agent-team-add-role>${escapeHtml(t('agentTeamAddRole'))}</button>`,
    `<div class="agent-team-role-summary">${escapeHtml(t('agentTeamRoleSummary', { count: roles.length }))}</div>`,
    ownerHtml,
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
  el.tabTeamStatus.innerHTML = [
    renderAgentTeamRoleStats(group),
    renderAgentTeamFlowStatus(group),
    '<div class="agent-team-status-note">',
    escapeHtml(t('agentTeamStatusHint')),
    '</div>',
  ].join('');
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
  if (!group.roles.length) {
    return `<div class="tip">${escapeHtml(t('agentTeamNoRoles'))}</div>`;
  }
  const activeRoles = group.roles.filter((role) => role.status === 'running' || role.status === 'blocked' || (role.waitingForRoleIds || []).length > 0);
  if (!activeRoles.length) {
    return `<div class="tip">${escapeHtml(t('agentTeamNoActiveFlow'))}</div>`;
  }
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

function renderStatusMetric(label: string, value: number): string {
  return [
    '<div class="agent-team-status-metric">',
    `<div>${escapeHtml(label)}</div>`,
    `<strong>${escapeHtml(String(value))}</strong>`,
    '</div>',
  ].join('');
}

function syncAgentTeamRoleRuntimeStatus(group: AgentTeamGroup): boolean {
  let changed = false;
  (group.roles || []).forEach((role) => {
    const conversationId = String(role.conversationId || '').trim();
    if (!conversationId) {
      return;
    }
    const runtime = state.runtimeByConversation[conversationId];
    const running = state.runningConversationIds.has(conversationId);
    const queued = Number(state.queuedCountByConversation[conversationId] || 0) > 0;
    const phase = String(runtime?.phase || '').trim();
    const previousStatus = role.status || 'idle';
    const previousProgress = role.currentProgress || '';
    let nextStatus = previousStatus;
    let nextProgress = previousProgress;
    if (running || queued) {
      nextStatus = 'running';
      if (!nextProgress || previousStatus !== 'running') {
        nextProgress = t('agentTeamProgressWorking');
      }
    } else if (hasStoppedRuntimeSignal(runtime, conversationId)) {
      nextStatus = 'idle';
      nextProgress = t('agentTeamProgressStopped');
    } else if (phase === '空闲' && (previousStatus === 'running' || previousProgress === t('agentTeamProgressWorking'))) {
      nextStatus = 'idle';
      nextProgress = t('agentTeamProgressStopped');
    } else if (phase === '失败' && previousStatus === 'running') {
      nextStatus = 'blocked';
      nextProgress = t('agentTeamProgressBlocked');
    }
    if (nextStatus !== previousStatus || nextProgress !== previousProgress) {
      role.status = nextStatus;
      role.currentProgress = nextProgress;
      if (nextStatus !== 'running') {
        role.waitingForRoleIds = [];
      }
      role.updatedAt = nowTs();
      changed = true;
    }
  });
  if (changed) {
    group.updatedAt = nowTs();
    saveAgentTeamPrefs();
  }
  return changed;
}

function syncAllAgentTeamRoleRuntimeStatus(): boolean {
  return state.agentTeamGroups.reduce((changed, group) => syncAgentTeamRoleRuntimeStatus(group) || changed, false);
}

function syncAgentTeamRoleConversationStatus(conversationId: string, running?: boolean): boolean {
  const id = String(conversationId || '').trim();
  if (!id) {
    return false;
  }
  let changed = false;
  state.agentTeamGroups.forEach((group) => {
    (group.roles || []).forEach((role) => {
      if (role.conversationId !== id) {
        return;
      }
      const previousStatus = role.status || 'idle';
      const previousProgress = role.currentProgress || '';
      if (running === true) {
        role.status = 'running';
        role.currentProgress = t('agentTeamProgressWorking');
      } else if (running === false) {
        const runtime = state.runtimeByConversation[id];
        const phase = String(runtime?.phase || '').trim();
        if (hasStoppedRuntimeSignal(runtime, id) || phase === '空闲' || previousStatus === 'running') {
          role.status = 'idle';
          role.currentProgress = t('agentTeamProgressStopped');
          role.waitingForRoleIds = [];
        }
      }
      syncAgentTeamRoleRuntimeStatus(group);
      if (role.status !== previousStatus || role.currentProgress !== previousProgress) {
        role.updatedAt = nowTs();
        group.updatedAt = role.updatedAt;
        changed = true;
      }
    });
  });
  if (changed) {
    saveAgentTeamPrefs();
  }
  return changed;
}

function renderAgentTeamRuntime(): void {
  const group = currentAgentTeamGroup();
  if (group) {
    syncAgentTeamRoleRuntimeStatus(group);
  }
  renderAgentTeamWorkflowTab();
  el.tabTeamAdd.innerHTML = '';
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

function populateRoleModal(role: AgentTeamRole | null = null): void {
  const group = currentAgentTeamGroup();
  const roles = (group?.roles || []).filter((item) => item.id !== role?.id);
  const upstreamIds = new Set(role ? upstreamIdsForRole(role) : [TEAM_OWNER_ID]);
  const downstreamIds = new Set(role?.downstreamRoleIds || []);
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
    ...roles.map((role) => [
      '<label class="team-role-downstream-option">',
      `<input type="checkbox" value="${escapeHtml(role.id)}" ${upstreamIds.has(role.id) ? 'checked' : ''} />`,
      `<span>${escapeHtml(role.name)}</span>`,
      '</label>',
    ].join('')),
  ].join('');
  el.addTeamRoleDownstreamList.innerHTML = [
    '<label class="team-role-downstream-option">',
    `<input type="checkbox" value="${escapeHtml(TEAM_NO_DOWNSTREAM_ID)}" ${noDownstream ? 'checked' : ''} />`,
    `<span>${escapeHtml(t('agentTeamNoDownstreamRoles'))}</span>`,
    '</label>',
    ...roles.map((role) => [
    '<label class="team-role-downstream-option">',
    `<input type="checkbox" value="${escapeHtml(role.id)}" ${downstreamIds.has(role.id) ? 'checked' : ''} />`,
    `<span>${escapeHtml(role.name)}</span>`,
    '</label>',
    ].join('')),
  ].join('');
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

function openAddTeamRoleModal(): void {
  if (!currentAgentTeamGroup()) {
    openCreateTeamModal();
    return;
  }
  editingRoleId = '';
  populateRoleModal(null);
  el.addTeamRoleModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.addTeamRoleNameInput.focus());
}

function openEditTeamRoleModal(roleId: string): void {
  const group = currentAgentTeamGroup();
  const role = group?.roles.find((item) => item.id === roleId) || null;
  if (!role) {
    return;
  }
  editingRoleId = role.id;
  populateRoleModal(role);
  el.addTeamRoleModal.classList.remove('hidden');
  window.requestAnimationFrame(() => el.addTeamRoleNameInput.focus());
}

function closeAddTeamRoleModal(): void {
  editingRoleId = '';
  el.addTeamRoleModal.classList.add('hidden');
}

function selectedDownstreamRoleIds(): string[] {
  const checkedValues = Array.from(el.addTeamRoleDownstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((item) => item.checked)
    .map((item) => String(item.value || '').trim())
    .filter(Boolean);
  if (checkedValues.includes(TEAM_NO_DOWNSTREAM_ID)) {
    return [];
  }
  return checkedValues;
}

function selectedUpstreamRoleIds(): string[] {
  return Array.from(el.addTeamRoleUpstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .filter((item) => item.checked)
    .map((item) => String(item.value || '').trim())
    .filter(Boolean);
}

function bindExclusiveEmptyDownstreamOption(): void {
  el.addTeamRoleDownstreamList.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.type !== 'checkbox') {
      return;
    }
    const noneOption = el.addTeamRoleDownstreamList.querySelector<HTMLInputElement>(`input[value="${TEAM_NO_DOWNSTREAM_ID}"]`);
    const roleOptions = Array.from(el.addTeamRoleDownstreamList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((item) => item.value !== TEAM_NO_DOWNSTREAM_ID);
    if (target.value === TEAM_NO_DOWNSTREAM_ID && target.checked) {
      roleOptions.forEach((item) => {
        item.checked = false;
      });
      return;
    }
    if (target.value !== TEAM_NO_DOWNSTREAM_ID && target.checked && noneOption) {
      noneOption.checked = false;
    }
    if (noneOption && !roleOptions.some((item) => item.checked)) {
      noneOption.checked = true;
    }
  });
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
      responsibility: el.addTeamRoleResponsibilityInput.value,
      completionContractDoc: el.addTeamRoleCompletionInput.value,
    };
    const role = editingRoleId
      ? updateAgentTeamRole(editingRoleId, payload)
      : createAgentTeamRole(payload);
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
    const editRoleButton = target?.closest('[data-agent-team-edit-role]');
    if (editRoleButton) {
      event.preventDefault();
      const roleId = String(editRoleButton.getAttribute('data-agent-team-edit-role') || '').trim();
      openEditTeamRoleModal(roleId);
      return;
    }
    const deleteRoleButton = target?.closest('[data-agent-team-delete-role]');
    if (deleteRoleButton) {
      event.preventDefault();
      const roleId = String(deleteRoleButton.getAttribute('data-agent-team-delete-role') || '').trim();
      const group = currentAgentTeamGroup();
      const role = group?.roles.find((item) => item.id === roleId) || null;
      if (!role) {
        return;
      }
      if (!window.confirm(t('agentTeamConfirmDeleteRole', { name: role.name }))) {
        return;
      }
      if (deleteAgentTeamRole(roleId)) {
        renderAll();
      }
      return;
    }
    if (target?.closest('[data-agent-team-add-role]')) {
      event.preventDefault();
      openAddTeamRoleModal();
    }
  });
}

export {
  bindAgentTeamController,
  appendAgentTeamUserMessage,
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
  syncAllAgentTeamRoleRuntimeStatus,
  syncAgentTeamRoleConversationStatus,
  syncAgentTeamRoleRuntimeStatus,
  switchAgentTeamGroup,
  toggleAgentTeamWorkspace,
  switchWorkspaceMode,
};
