import type {
  AgentTeamGroup,
  AgentTeamRole,
  AgentTeamStep,
  AppSnapshot,
  ConversationMessage,
  ConversationSummary,
} from '../types.js';
import { state, t } from '../state_i18n.js';
import { messagePreview } from '../conversation_runtime.js';

export const TEAM_STORE_KEY = 'conductor.agent-team.v1';
export const TEAM_STEP_COLORS = ['blue', 'teal', 'amber', 'violet', 'rose', 'slate'];
export const TEAM_OWNER_ID = '__team_owner__';
export const TEAM_NO_DOWNSTREAM_ID = '__team_no_downstream__';
export const ROLE_PROCESSING_COLORS = ['blue', 'teal', 'amber', 'violet', 'rose'];
export const ROLE_RUN_POLL_MS = 900;
export const ROLE_COMPLETION_MAX_CONTINUES = 3;

export function nowTs(): number { return Date.now(); }

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeRoleStatus(input: unknown): AgentTeamRole['status'] {
  const v = String(input || '').trim().toLowerCase();
  return (v === 'running' || v === 'blocked' || v === 'done') ? v : 'idle';
}

export function normalizeRoleProvider(input: unknown): AgentTeamRole['provider'] {
  return String(input || '').trim().toLowerCase() === 'claude' ? 'claude' : 'codex';
}

export function providerLabel(provider: unknown): string {
  return normalizeRoleProvider(provider) === 'claude' ? 'Claude' : 'Codex';
}

export function normalizeRoleIdList(input: unknown, validRoleIds: Set<string>, options: { includeOwner?: boolean } = {}): string[] {
  const rawItems = Array.isArray(input) ? input : [input];
  return Array.from(new Set(rawItems
    .map((item) => String(item || '').trim())
    .filter((id) => id && (validRoleIds.has(id) || (options.includeOwner && id === TEAM_OWNER_ID)))));
}

export function upstreamIdsForRole(role: AgentTeamRole): string[] {
  const ids = Array.isArray(role.upstreamRoleIds)
    ? role.upstreamRoleIds.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const legacyId = String(role.upstreamRoleId || '').trim();
  return Array.from(new Set([...ids, legacyId].filter(Boolean)));
}

export function setRoleUpstreamIds(role: AgentTeamRole, upstreamRoleIds: string[]): void {
  const ids = Array.from(new Set(upstreamRoleIds.map((item) => String(item || '').trim()).filter(Boolean)));
  role.upstreamRoleIds = ids;
  role.upstreamRoleId = ids[0] || '';
}

export function roleHasUpstream(role: AgentTeamRole, upstreamId: string): boolean {
  return upstreamIdsForRole(role).includes(upstreamId);
}

export function updateRoleWorkState(role: AgentTeamRole, options: {
  status?: AgentTeamRole['status'];
  upstreamName?: string;
  taskText?: string;
  progress?: string;
  waitingForRoleIds?: string[];
}): void {
  if (options.status) role.status = options.status;
  if (typeof options.upstreamName === 'string') role.currentUpstreamName = options.upstreamName;
  if (typeof options.taskText === 'string') role.currentTaskPreview = messagePreview(options.taskText);
  if (typeof options.progress === 'string') role.currentProgress = options.progress;
  if (Array.isArray(options.waitingForRoleIds)) {
    role.waitingForRoleIds = options.waitingForRoleIds.map((item) => String(item || '').trim()).filter(Boolean);
  }
  role.updatedAt = nowTs();
}

export function currentAgentTeamGroup(): AgentTeamGroup | null {
  return state.agentTeamGroups.find((item) => item.id === state.activeAgentTeamGroupId) || null;
}

export function findConversation(conversationId = ''): ConversationSummary | null {
  const id = String(conversationId || '').trim();
  return id ? (state.conversations.find((item) => item.id === id) || null) : null;
}

export function roleConversation(role: AgentTeamRole): ConversationSummary | null {
  return findConversation(role.conversationId || '');
}

export function roleConversationTitle(group: AgentTeamGroup, role: AgentTeamRole): string {
  return `${group.name} / ${role.name}`;
}

export function extractCreatedConversationId(snapshot: AppSnapshot | null | undefined, title: string): string {
  const directId = String(snapshot?.createdConversationId || '').trim();
  if (directId) return directId;
  const matched = Array.isArray(snapshot?.conversations)
    ? snapshot.conversations.find((item) => String(item.title || '').trim() === String(title || '').trim()) : null;
  return String(matched?.id || '').trim();
}

export function applyTeamSnapshot(snapshot: AppSnapshot | null | undefined): void {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (Array.isArray(snapshot.conversations)) state.conversations = snapshot.conversations;
  if (snapshot.runtimeByConversation && typeof snapshot.runtimeByConversation === 'object') state.runtimeByConversation = snapshot.runtimeByConversation;
  if (snapshot.metaByConversation && typeof snapshot.metaByConversation === 'object') state.metaByConversation = snapshot.metaByConversation;
  if (Array.isArray(snapshot.runningConversationIds)) state.runningConversationIds = new Set(snapshot.runningConversationIds.map((item) => String(item || '').trim()).filter(Boolean));
  if (snapshot.queuedCountByConversation && typeof snapshot.queuedCountByConversation === 'object') state.queuedCountByConversation = snapshot.queuedCountByConversation;
  if (snapshot.queuedMessagesByConversation && typeof snapshot.queuedMessagesByConversation === 'object') state.queuedMessagesByConversation = snapshot.queuedMessagesByConversation;
  if (snapshot.settings && typeof snapshot.settings === 'object') state.settings = { ...state.settings, ...snapshot.settings };
}

export function saveAgentTeamPrefs(): void {
  window.localStorage.setItem(TEAM_STORE_KEY, JSON.stringify({
    activeGroupId: state.activeAgentTeamGroupId,
    groups: state.agentTeamGroups,
  }));
}

export function normalizeRole(raw: any): AgentTeamRole | null {
  const id = String(raw?.id || '').trim() || newId('role');
  const name = String(raw?.name || '').trim();
  if (!name) return null;
  const downstreamRoleIds = Array.isArray(raw?.downstreamRoleIds) ? raw.downstreamRoleIds.map((item: any) => String(item || '').trim()).filter(Boolean) : [];
  const infoSourceRoleIds = Array.isArray(raw?.infoSourceRoleIds) ? raw.infoSourceRoleIds.map((item: any) => String(item || '').trim()).filter(Boolean) : [];
  const legacyUpstreamId = String(raw?.upstreamRoleId || '').trim();
  const upstreamRoleIds = Array.isArray(raw?.upstreamRoleIds)
    ? raw.upstreamRoleIds.map((item: any) => String(item || '').trim()).filter(Boolean)
    : (legacyUpstreamId ? [legacyUpstreamId] : []);
  return {
    id, name,
    conversationId: String(raw?.conversationId || '').trim(),
    provider: normalizeRoleProvider(raw?.provider),
    upstreamRoleId: upstreamRoleIds[0] || '',
    upstreamRoleIds, downstreamRoleIds, infoSourceRoleIds,
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
    waitingForRoleIds: Array.isArray(raw?.waitingForRoleIds) ? raw.waitingForRoleIds.map((item: any) => String(item || '').trim()).filter(Boolean) : [],
    createdAt: Number(raw?.createdAt || nowTs()) || nowTs(),
    updatedAt: Number(raw?.updatedAt || raw?.createdAt || nowTs()) || nowTs(),
  };
}

export function normalizeStep(raw: any): AgentTeamStep | null {
  const title = String(raw?.title || '').trim();
  const body = String(raw?.body || '').trim();
  if (!title && !body) return null;
  const kind = String(raw?.kind || '').trim() as AgentTeamStep['kind'];
  return {
    id: String(raw?.id || '').trim() || newId('step'),
    kind: kind === 'role-to-role' || kind === 'role-return' || kind === 'system' ? kind : 'user-to-role',
    title: title || t('agentTeamStepUntitled'), body,
    colorKey: String(raw?.colorKey || '').trim() || 'blue',
    status: String(raw?.status || '').trim() === 'running' ? 'running' : String(raw?.status || '').trim() === 'pending' ? 'pending' : 'done',
    timestamp: Number(raw?.timestamp || nowTs()) || nowTs(),
  };
}

export function normalizeTeamMessage(raw: any): ConversationMessage | null {
  const text = String(raw?.text || '').trim();
  if (!text) return null;
  const role = raw?.role === 'assistant' ? 'assistant' : 'user';
  const sourceKind = String(raw?.sourceKind || '').trim();
  return {
    role, text,
    speakerName: String(raw?.speakerName || '').trim(),
    sourceKind: sourceKind === 'role' || sourceKind === 'system' ? sourceKind : role === 'assistant' ? 'role' : 'user',
    roleId: String(raw?.roleId || '').trim(),
    targetRoleId: String(raw?.targetRoleId || '').trim(),
    createdAt: Number(raw?.createdAt || raw?.timestamp || nowTs()) || nowTs(),
  };
}

export function appendTeamMessage(group: AgentTeamGroup, options: {
  role: 'user' | 'assistant'; text: string; speakerName?: string;
  sourceKind?: 'user' | 'role' | 'system'; roleId?: string; targetRoleId?: string; createdAt?: number;
}): void {
  const text = String(options.text || '').trim();
  if (!text) return;
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

export function appendTeamStep(group: AgentTeamGroup, options: {
  kind: AgentTeamStep['kind']; title: string; body: string;
  colorKey?: string; status?: AgentTeamStep['status']; timestamp?: number;
}): void {
  const title = String(options.title || '').trim();
  const body = String(options.body || '').trim();
  if (!title && !body) return;
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

export function markRoleDocsRead(role: AgentTeamRole, timestamp: number): void {
  role.lastReadAt = timestamp;
}

export function resolveRoleName(group: AgentTeamGroup, roleId = ''): string {
  if (roleId === TEAM_OWNER_ID) return group.ownerName || t('agentTeamOwnerName');
  if (!roleId) return t('agentTeamNoOwner');
  return group.roles.find((item) => item.id === roleId)?.name || t('agentTeamUnknownRole');
}

export function roleLevelMap(group: AgentTeamGroup): Map<string, number> {
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
      if (!upstreamIds.length || upstreamIds.includes(TEAM_OWNER_ID)) nextLevel = Math.max(nextLevel, 1);
      upstreamIds.forEach((upstreamId) => {
        if (upstreamId === TEAM_OWNER_ID) { nextLevel = Math.max(nextLevel, 1); return; }
        const upstream = roleById.get(upstreamId);
        if (!upstream) return;
        nextLevel = Math.max(nextLevel, Number(levels.get(upstream.id) || 1) + 1);
      });
      if (nextLevel !== current) { levels.set(role.id, nextLevel); changed = true; }
    }
    if (!changed) break;
  }
  return levels;
}

export function sortedRolesByHierarchy(group: AgentTeamGroup): AgentTeamRole[] {
  const levels = roleLevelMap(group);
  const orderMap = new Map<string, number>();
  (group.roles || []).forEach((role, index) => orderMap.set(role.id, index));
  return [...(group.roles || [])].sort((a, b) => {
    const levelDiff = Number(levels.get(a.id) || 1) - Number(levels.get(b.id) || 1);
    return levelDiff !== 0 ? levelDiff : Number(orderMap.get(a.id) || 0) - Number(orderMap.get(b.id) || 0);
  });
}

export function resolveEntryRoles(group: AgentTeamGroup): AgentTeamRole[] {
  const ownerRoles = group.roles.filter((role) => roleHasUpstream(role, TEAM_OWNER_ID));
  if (ownerRoles.length) return ownerRoles;
  const rootRoles = group.roles.filter((role) => upstreamIdsForRole(role).length <= 0);
  return rootRoles.length ? rootRoles : group.roles.slice(0, 1);
}

export function directDownstreamRoles(group: AgentTeamGroup, role: AgentTeamRole | null): AgentTeamRole[] {
  if (!role) return [];
  return (role.downstreamRoleIds || []).map((id) => group.roles.find((item) => item.id === id)).filter(Boolean) as AgentTeamRole[];
}

export function syncRoleGraphForCreatedRole(group: AgentTeamGroup, role: AgentTeamRole): void {
  upstreamIdsForRole(role).forEach((upstreamId) => {
    if (!upstreamId || upstreamId === TEAM_OWNER_ID) return;
    const upstream = group.roles.find((item) => item.id === upstreamId);
    if (upstream) { upstream.downstreamRoleIds = Array.from(new Set([...(upstream.downstreamRoleIds || []), role.id])); upstream.updatedAt = nowTs(); }
  });
  (role.downstreamRoleIds || []).forEach((downstreamId) => {
    const downstream = group.roles.find((item) => item.id === downstreamId);
    if (!downstream || downstream.id === role.id) return;
    setRoleUpstreamIds(downstream, [...upstreamIdsForRole(downstream), role.id]);
    downstream.updatedAt = nowTs();
  });
}

export function switchWorkspaceMode(mode: 'conversation' | 'team'): void {
  state.workspaceMode = mode;
  if (mode === 'team') state.activeAgentTeamTab = state.activeAgentTeamTab || 'workflow';
}

export function toggleAgentTeamWorkspace(): void {
  switchWorkspaceMode(state.workspaceMode === 'team' ? 'conversation' : 'team');
}

export function switchAgentTeamGroup(groupId: string): AgentTeamGroup | null {
  const id = String(groupId || '').trim();
  const group = state.agentTeamGroups.find((item) => item.id === id) || null;
  if (!group) return null;
  state.activeAgentTeamGroupId = group.id;
  switchWorkspaceMode('team');
  saveAgentTeamPrefs();
  return group;
}

export function renameAgentTeamGroup(groupId: string, title: string): AgentTeamGroup | null {
  const id = String(groupId || '').trim();
  const name = String(title || '').trim();
  if (!id || !name) return null;
  const group = state.agentTeamGroups.find((item) => item.id === id) || null;
  if (!group) return null;
  group.name = name;
  group.updatedAt = nowTs();
  saveAgentTeamPrefs();
  return group;
}

export function deleteAgentTeamGroup(groupId: string): boolean {
  const id = String(groupId || '').trim();
  if (!id) return false;
  const before = state.agentTeamGroups.length;
  state.agentTeamGroups = state.agentTeamGroups.filter((item) => item.id !== id);
  if (state.activeAgentTeamGroupId === id) state.activeAgentTeamGroupId = String(state.agentTeamGroups[0]?.id || '');
  saveAgentTeamPrefs();
  return state.agentTeamGroups.length !== before;
}
