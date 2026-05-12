import type { AgentTeamGroup, AgentTeamRole, RuntimeState, WorkflowItem } from '../types.js';
import { state, t } from '../state_i18n.js';
import { codexdesk } from '../codexdesk.js';
import {
  nowTs,
  ROLE_RUN_POLL_MS,
  ROLE_COMPLETION_MAX_CONTINUES,
  ROLE_PROCESSING_COLORS,
  applyTeamSnapshot,
  appendTeamMessage,
  appendTeamStep,
  directDownstreamRoles,
  findConversation,
  markRoleDocsRead,
  resolveEntryRoles,
  saveAgentTeamPrefs,
  updateRoleWorkState,
  currentAgentTeamGroup,
  roleConversationTitle,
  extractCreatedConversationId,
} from './agent_team_state.js';
import {
  buildRoleRunPrompt,
  buildDownstreamPrompt,
  buildSummaryPrompt,
  buildInfoQueryPrompt,
  deliveryForUpstream,
  ensureRoleDocs,
  isCompletionContractSatisfied,
  isRejectedOrBlockedCompletion,
  parseInfoQueryDirective,
  refreshAllRoleDocs,
  selectedDelegatedDownstreamRoles,
  selectedInfoSourceRole,
  type InfoQueryDirective,
} from './agent_team_prompt.js';

function latestAssistantText(conversation: ReturnType<typeof findConversation>): string {
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
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (typeof item !== 'object') return String(item || '');
  const record = item as Record<string, unknown>;
  return [record.message, record.title, record.body, record.preview, record.line, record.tag]
    .map((value) => String(value || '').trim()).filter(Boolean).join('\n');
}

export function hasStoppedRuntimeSignal(runtime: RuntimeState | null | undefined, conversationId = ''): boolean {
  if (runtime && isStoppedPhase(runtime.phase)) return true;
  const conversation = findConversation(conversationId);
  const hasInterruptedUserMessage = Array.isArray(conversation?.messages)
    && conversation.messages.slice(-6).some((item) => item?.role === 'user' && (
      item.interrupted === true || String(item.interruptedReason || '').trim() === 'user-stop'
    ));
  if (hasInterruptedUserMessage) return true;
  if (!runtime) return false;
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
  if (!item || typeof item !== 'object') return '';
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

async function ensureRoleConversation(group: AgentTeamGroup, role: AgentTeamRole): Promise<string> {
  const existingId = String(role.conversationId || '').trim();
  if (existingId && findConversation(existingId)) return existingId;
  const title = roleConversationTitle(group, role);
  const result = await codexdesk.createConversation({
    title,
    provider: role.provider === 'claude' ? 'claude' : 'codex',
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
  if (result?.error) throw new Error(String(result.error));
  onUpdate();
  return waitForRoleConversation(conversationId, previousMessageCount, previousWorkflowCount);
}

export async function sendRoleConversationUntilComplete(
  group: AgentTeamGroup,
  role: AgentTeamRole,
  prompt: string,
  onUpdate: () => void,
): Promise<{ assistantText: string; workflowSummary: string; ok: boolean }> {
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
      assistantText: [t('agentTeamCompletionGateExceeded', { name: role.name }), result.assistantText].filter(Boolean).join('\n\n'),
      ok: false,
    };
  }
  return result;
}

async function resolveRoleInfoQuery(
  group: AgentTeamGroup,
  role: AgentTeamRole,
  query: InfoQueryDirective,
  onUpdate: () => void,
): Promise<string> {
  const infoRole = selectedInfoSourceRole(group, role, query);
  if (!infoRole) {
    const text = t('agentTeamInfoQueryNoSource', { query: query.raw });
    appendTeamMessage(group, { role: 'assistant', speakerName: role.name, sourceKind: 'system', roleId: role.id, text });
    appendTeamStep(group, {
      kind: 'system',
      title: t('agentTeamInfoQueryNoSource', { query: query.roleName || query.raw }),
      body: query.question || query.raw,
      colorKey: 'rose',
    });
    saveAgentTeamPrefs();
    onUpdate();
    return '';
  }
  appendTeamStep(group, {
    kind: 'system',
    title: `${role.name} -> ${infoRole.name}`,
    body: t('agentTeamInfoQueryPromptQuestion', { question: query.question }),
    colorKey: 'amber',
    status: 'running',
  });
  saveAgentTeamPrefs();
  onUpdate();
  const result = await sendRoleConversation(group, infoRole, buildInfoQueryPrompt(role, infoRole, query.question), onUpdate);
  const answer = result.assistantText || result.workflowSummary || t('agentTeamNoRoleOutput');
  appendTeamMessage(group, {
    role: 'assistant',
    speakerName: infoRole.name,
    sourceKind: 'system',
    roleId: infoRole.id,
    targetRoleId: role.id,
    text: t('agentTeamInfoQueryResult', { name: infoRole.name, answer }),
  });
  appendTeamStep(group, { kind: 'role-return', title: `${infoRole.name} -> ${role.name}`, body: answer, colorKey: 'amber' });
  saveAgentTeamPrefs();
  onUpdate();
  return t('agentTeamInfoQueryResult', { name: infoRole.name, answer });
}

async function continueRoleWithInfoQueries(
  group: AgentTeamGroup,
  role: AgentTeamRole,
  result: { assistantText: string; workflowSummary: string; ok: boolean },
  onUpdate: () => void,
): Promise<{ assistantText: string; workflowSummary: string; ok: boolean }> {
  let current = result;
  const seenQueries = new Set<string>();
  for (let round = 0; round < 2; round += 1) {
    if (!current.ok) break;
    const query = parseInfoQueryDirective(current.assistantText);
    if (!query) break;
    const queryKey = `${query.roleName}\n${query.question}`.toLowerCase();
    if (seenQueries.has(queryKey)) return { ...current, ok: false };
    seenQueries.add(queryKey);
    const info = await resolveRoleInfoQuery(group, role, query, onUpdate);
    if (!info) return { ...current, ok: false };
    const nextResult = await sendRoleConversationUntilComplete(group, role, t('agentTeamContinueWithInfoPrompt', { info }), onUpdate);
    current = {
      assistantText: nextResult.assistantText || current.assistantText,
      workflowSummary: [current.workflowSummary, nextResult.workflowSummary].filter(Boolean).join('\n'),
      ok: nextResult.ok,
    };
  }
  if (current.ok && parseInfoQueryDirective(current.assistantText)) return { ...current, ok: false };
  return current;
}

export async function runRoleConversationTurn(
  group: AgentTeamGroup,
  role: AgentTeamRole,
  taskText: string,
  upstreamName: string,
  visited: Set<string>,
  onUpdate: () => void,
): Promise<string> {
  if (visited.has(role.id)) return '';
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
    colorKey: ['blue', 'teal', 'amber', 'violet', 'rose'][visited.size % 5],
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
  updateRoleWorkState(role, { status: 'running', progress: t('agentTeamProgressWorking') });
  saveAgentTeamPrefs();
  onUpdate();
  const initialResult = await sendRoleConversationUntilComplete(group, role, buildRoleRunPrompt(group, role, taskText, upstreamName), onUpdate);
  const firstResult = await continueRoleWithInfoQueries(group, role, initialResult, onUpdate);
  if (!firstResult.ok) {
    updateRoleWorkState(role, { status: 'blocked', progress: t('agentTeamProgressBlocked'), waitingForRoleIds: [] });
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
    text: deliveryForUpstream(firstResult.assistantText),
  });

  const downstreamRoles = selectedDelegatedDownstreamRoles(availableDownstreamRoles, firstResult.assistantText);
  const downstreamResults: Array<{ role: AgentTeamRole; output: string }> = [];
  const shouldStopHere = !firstResult.ok || isRejectedOrBlockedCompletion(firstResult.assistantText);
  if (shouldStopHere && role.status !== 'blocked') {
    updateRoleWorkState(role, { status: 'blocked', progress: t('agentTeamProgressBlocked'), waitingForRoleIds: [] });
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
      const delegatedPrompt = buildDownstreamPrompt(group, role, downstreamRole, taskText, deliveryForUpstream(firstResult.assistantText));
      appendTeamStep(group, {
        kind: 'role-to-role',
        title: `${role.name} -> ${downstreamRole.name}`,
        body: delegatedPrompt,
        colorKey: ['blue', 'teal', 'amber', 'violet', 'rose'][index % 5],
        status: 'running',
      });
      saveAgentTeamPrefs();
      onUpdate();
      const output = await runRoleConversationTurn(group, downstreamRole, delegatedPrompt, role.name, new Set(visited), onUpdate);
      const downstreamDelivery = deliveryForUpstream(output);
      downstreamResults.push({ role: downstreamRole, output: downstreamDelivery });
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
      appendTeamStep(group, { kind: 'role-return', title: `${downstreamRole.name} -> ${role.name}`, body: downstreamDelivery, colorKey: 'teal' });
    }
  }

  let finalText = firstResult.assistantText;
  if (firstResult.ok && !shouldStopHere && downstreamRoles.length) {
    const summaryPrompt = buildSummaryPrompt(role, taskText, deliveryForUpstream(firstResult.assistantText), downstreamResults);
    appendTeamMessage(group, {
      role: 'assistant',
      speakerName: role.name,
      roleId: role.id,
      text: t('agentTeamRoleSummarizingReturns', { count: downstreamResults.length }),
    });
    saveAgentTeamPrefs();
    onUpdate();
    updateRoleWorkState(role, { status: 'running', progress: t('agentTeamProgressSummarizing'), waitingForRoleIds: [] });
    const rawSummaryResult = await sendRoleConversationUntilComplete(group, role, summaryPrompt, onUpdate);
    const summaryResult = await continueRoleWithInfoQueries(group, role, rawSummaryResult, onUpdate);
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
    if (!summaryResult.ok || isRejectedOrBlockedCompletion(summaryResult.assistantText)) {
      updateRoleWorkState(role, { status: 'blocked', progress: t('agentTeamProgressBlocked'), waitingForRoleIds: [] });
    }
    appendTeamMessage(group, { role: 'assistant', speakerName: role.name, roleId: role.id, text: deliveryForUpstream(finalText) });
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

export async function appendAgentTeamUserMessage(text: string, onUpdate: () => void = () => {}): Promise<AgentTeamGroup | null> {
  const group = currentAgentTeamGroup();
  const messageText = String(text || '').trim();
  if (!group || !messageText) return null;
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
      appendTeamStep(group, {
        kind: 'user-to-role',
        title: `${t('roleYou')} -> ${role.name}`,
        body: messageText,
        colorKey: ['blue', 'teal', 'amber', 'violet', 'rose'][index % 5],
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
        updateRoleWorkState(role, { status: 'blocked', progress: t('agentTeamProgressBlocked'), waitingForRoleIds: [] });
        group.updatedAt = role.updatedAt;
        saveAgentTeamPrefs();
        onUpdate();
      });
    });
  } else {
    appendTeamStep(group, {
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

export function syncAgentTeamRoleRuntimeStatus(group: AgentTeamGroup): boolean {
  let changed = false;
  (group.roles || []).forEach((role) => {
    const conversationId = String(role.conversationId || '').trim();
    if (!conversationId) return;
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
      if (!nextProgress || previousStatus !== 'running') nextProgress = t('agentTeamProgressWorking');
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
      if (nextStatus !== 'running') role.waitingForRoleIds = [];
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

export function syncAllAgentTeamRoleRuntimeStatus(): boolean {
  return state.agentTeamGroups.reduce((changed, group) => syncAgentTeamRoleRuntimeStatus(group) || changed, false);
}

export function syncAgentTeamRoleConversationStatus(conversationId: string, running?: boolean): boolean {
  const id = String(conversationId || '').trim();
  if (!id) return false;
  let changed = false;
  state.agentTeamGroups.forEach((group) => {
    (group.roles || []).forEach((role) => {
      if (role.conversationId !== id) return;
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
  if (changed) saveAgentTeamPrefs();
  return changed;
}
