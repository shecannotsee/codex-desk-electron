import type { AgentTeamGroup, AgentTeamRole } from '../types.js';
import { t } from '../state_i18n.js';
import {
  nowTs,
  providerLabel,
  upstreamIdsForRole,
  resolveRoleName,
} from './agent_team_state.js';

export function downstreamRoleNameList(group: AgentTeamGroup, roleIds: string[] = []): string {
  return roleIds.map((id) => resolveRoleName(group, id)).filter(Boolean).join(', ') || t('agentTeamNoDownstreamRoles');
}

export function infoSourceRoleNameList(group: AgentTeamGroup, roleIds: string[] = []): string {
  return roleIds.map((id) => resolveRoleName(group, id)).filter(Boolean).join(', ') || t('agentTeamNoInfoSourceRoles');
}

export function upstreamRoleNameList(group: AgentTeamGroup, role: AgentTeamRole): string {
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

function infoSourceCommunicationLine(group: AgentTeamGroup, role: AgentTeamRole): string {
  const sourceIds = role.infoSourceRoleIds || [];
  if (!sourceIds.length) {
    return t('agentTeamPromptNoInfoSource');
  }
  const sourceScopes = sourceIds
    .map((id) => group.roles.find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => `- ${item?.name}: ${String(item?.responsibility || '').trim() || t('agentTeamRoleScopeFallback')}`)
    .join('\n');
  return t('agentTeamPromptInfoSource', {
    sources: infoSourceRoleNameList(group, sourceIds),
    scopes: sourceScopes,
  });
}

export function defaultCompletionContractDoc(): string {
  return [
    t('agentTeamCompletionContractNoPremature'),
    t('agentTeamCompletionContractContinue'),
    t('agentTeamCompletionContractFinalOnly'),
    t('agentTeamCompletionContractFormat'),
  ].join('\n');
}

export function buildRoleResponsibilityDoc(group: AgentTeamGroup, role: AgentTeamRole): string {
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

export function buildRoleCompletionContractDoc(role: AgentTeamRole): string {
  return [
    t('agentTeamCompletionContractTitle'),
    String(role.completionContractDoc || '').trim() || defaultCompletionContractDoc(),
  ].join('\n');
}

export function buildRoleRoutingPromptDoc(group: AgentTeamGroup, role: AgentTeamRole): string {
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
    `## ${t('agentTeamDocInfoSource')}`,
    infoSourceCommunicationLine(group, role),
    t('agentTeamPromptInfoQuery'),
    t('agentTeamPromptRejectOutOfScope'),
  ].join('\n');
}

export function ensureRoleDocs(group: AgentTeamGroup, role: AgentTeamRole, options: { onlyMissing?: boolean } = {}): void {
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

export function refreshAllRoleDocs(group: AgentTeamGroup, options: { onlyMissing?: boolean } = {}): void {
  group.roles.forEach((role) => ensureRoleDocs(group, role, options));
}

export function buildRoleRunPrompt(group: AgentTeamGroup, role: AgentTeamRole, taskText: string, upstreamName: string): string {
  ensureRoleDocs(group, role);
  return [
    role.responsibilityDoc || '',
    '',
    role.routingPromptDoc || '',
    '',
    buildRoleCompletionContractDoc(role),
    '',
    t('agentTeamConversationInputPrompt', { from: upstreamName || group.ownerName || t('agentTeamOwnerName') }),
    '',
    taskText,
  ].filter((item) => String(item || '').trim()).join('\n');
}

export function buildDownstreamPrompt(group: AgentTeamGroup, upstreamRole: AgentTeamRole, downstreamRole: AgentTeamRole, originalTask: string, upstreamResult: string): string {
  return [
    t('agentTeamDelegatedPromptTitle', { from: upstreamRole.name, to: downstreamRole.name }),
    '',
    t('agentTeamDelegatedPromptTask', { task: originalTask }),
    '',
    t('agentTeamDelegatedPromptContext', { content: upstreamResult || t('agentTeamNoRoleOutput') }),
  ].join('\n');
}

export function buildInfoQueryPrompt(fromRole: AgentTeamRole, infoRole: AgentTeamRole, question: string): string {
  return [
    t('agentTeamInfoQueryPromptTitle', { from: fromRole.name, to: infoRole.name }),
    '',
    t('agentTeamInfoQueryPromptQuestion', { question }),
    '',
    t('agentTeamInfoQueryPromptRule'),
  ].join('\n');
}

export function buildSummaryPrompt(role: AgentTeamRole, originalTask: string, ownResult: string, downstreamResults: Array<{ role: AgentTeamRole; output: string }>): string {
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
    '',
    buildRoleCompletionContractDoc(role),
  ].join('\n');
}

export function extractContractField(text: string, labels: string[]): string {
  const body = String(text || '').trim();
  if (!body) {
    return '';
  }
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const fieldPattern = new RegExp(`^\\s*(?:${escapedLabels.join('|')})\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:完成状态|Completion status|下级分派|Downstream delegation|交付结果|Deliverable result|信息查询|Information query|阻塞原因|Blocker reason)\\s*[：:]|$)`, 'im');
  const match = fieldPattern.exec(body);
  return String(match?.[1] || '').trim();
}

export function extractDeliveryResult(text: string): string {
  return extractContractField(text, ['交付结果', 'Deliverable result']);
}

export function deliveryForUpstream(text: string): string {
  return extractDeliveryResult(text) || String(text || '').trim() || t('agentTeamNoRoleOutput');
}

export function parseDelegationDirective(text: string): string {
  const body = String(text || '');
  const zhMatch = /^下级分派\s*[：:]\s*(.+)$/im.exec(body);
  if (zhMatch?.[1]) {
    return zhMatch[1].trim();
  }
  const enMatch = /^Downstream delegation\s*:\s*(.+)$/im.exec(body);
  return String(enMatch?.[1] || '').trim();
}

export interface InfoQueryDirective {
  roleName: string;
  question: string;
  raw: string;
}

export function parseInfoQueryDirective(text: string): InfoQueryDirective | null {
  const raw = extractContractField(text, ['信息查询', 'Information query']);
  if (!raw || /^(无|不需要|无需)$/i.test(raw) || /^(none|no|n\/a)\b/i.test(raw)) {
    return null;
  }
  const parts = raw.split(/[，,]/);
  const roleName = String(parts.shift() || '').trim();
  const question = parts.join('，').trim();
  if (!roleName || !question) {
    return { roleName, question: question || raw, raw };
  }
  return { roleName, question, raw };
}

export function isCompletionContractSatisfied(text: string): boolean {
  const body = String(text || '').trim();
  if (!body) {
    return false;
  }
  const isDone = /完成状态\s*[：:]\s*完成/.test(body)
    || /Completion status\s*:\s*done/i.test(body);
  const isBlockedOrRejected = /完成状态\s*[：:]\s*(阻塞|拒绝)/.test(body)
    || /Completion status\s*:\s*(blocked|rejected)/i.test(body);
  const infoQueryValue = extractContractField(body, ['信息查询', 'Information query']);
  const hasActiveInfoQuery = Boolean(infoQueryValue)
    && !/^(无|不需要|无需)$/i.test(infoQueryValue)
    && !/^(none|no|n\/a)\b/i.test(infoQueryValue);
  if (hasActiveInfoQuery) {
    return true;
  }
  if (isBlockedOrRejected) {
    return Boolean(extractContractField(body, ['阻塞原因', 'Blocker reason']));
  }
  if (!isDone) {
    return false;
  }
  const hasDelegation = Boolean(extractContractField(body, ['下级分派', 'Downstream delegation']));
  const hasDelivery = Boolean(extractDeliveryResult(body));
  const hasInfoQuery = Boolean(extractContractField(body, ['信息查询', 'Information query']));
  if (!hasDelegation || !hasDelivery || !hasInfoQuery) {
    return false;
  }
  const planningPattern = /(?:我(?:将|会|打算|准备)|接下来(?:我)?(?:将|会)|(?:将|会)(?:进行|执行|处理|完成|检查|实现|补充|修改|更新|整理)|计划(?:先|将|会|进行|执行)?|准备(?:先|将|会|进行|执行)?|下一步(?:是|将|会)|I\s+(?:will|plan to|am going to)|next\s+I\s+will)/i;
  return !planningPattern.test(body);
}

export function isRejectedOrBlockedCompletion(text: string): boolean {
  const body = String(text || '').trim();
  return /完成状态\s*[：:]\s*(阻塞|拒绝)/.test(body)
    || /Completion status\s*:\s*(blocked|rejected)/i.test(body);
}

export function selectedDelegatedDownstreamRoles(allDownstreamRoles: AgentTeamRole[], assistantText: string): AgentTeamRole[] {
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

export function selectedInfoSourceRole(group: AgentTeamGroup, role: AgentTeamRole, query: InfoQueryDirective): AgentTeamRole | null {
  const allowedIds = new Set((role.infoSourceRoleIds || []).map((item) => String(item || '').trim()).filter(Boolean));
  if (!allowedIds.size) {
    return null;
  }
  const target = String(query.roleName || '').trim().toLowerCase();
  return group.roles.find((item) => allowedIds.has(item.id) && (
    String(item.name || '').trim().toLowerCase() === target
    || String(item.name || '').trim().toLowerCase().includes(target)
    || target.includes(String(item.name || '').trim().toLowerCase())
    || item.id === query.roleName
  )) || null;
}
