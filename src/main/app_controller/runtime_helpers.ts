const { normalizePreview } = require('./shared');

const MAX_RUNTIME_EVENTS = 500;
const MAX_RUNTIME_WORKFLOW = 500;
const MAX_RUNTIME_RAW = 1000;
const TELEGRAM_VAULT_LOCKED_ERROR = '当前已启用的通知和远程对话已暂停，请先在设置 > 通知解锁与保护中解锁';

function isCompletedPhase(phaseText) {
  const text = String(phaseText || '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  return ['已完成', '完成', 'completed', 'success', 'done'].some((item) => text.includes(item));
}

function pushBounded(list, item, limit) {
  if (!Array.isArray(list)) {
    return;
  }
  list.push(item);
  const overflow = list.length - Math.max(1, Number(limit) || 1);
  if (overflow > 0) {
    list.splice(0, overflow);
  }
}

function securitySnapshot(controller) {
  const hasMasterPassword = Boolean(controller?.security?.hasMasterPassword);
  const unlocked = hasMasterPassword
    ? Boolean(controller?.security?.unlocked)
    : true;
  return {
    hasMasterPassword,
    unlocked,
  };
}

function normalizeNotificationFailureEventMessage(message, exitCode = '') {
  const text = String(message || '').trim();
  if (!text) {
    return '';
  }
  if (/^通知发送失败[:：]/.test(text)) {
    return '';
  }
  if (/^当前任务非正常结束，剩余\s+\d+\s+条排队消息已停止自动执行$/.test(text)) {
    return '';
  }
  if (/^任务失败，退出码\b/.test(text)) {
    return '';
  }
  if (/^turn\.failed\b/i.test(text)) {
    const detail = text.replace(/^turn\.failed\b[:：\s-]*/i, '').trim();
    return detail || '';
  }
  if (
    Number.isInteger(Number(exitCode))
    && Number(exitCode) > 0
    && text === `任务失败，退出码 ${Number(exitCode)}`
  ) {
    return '';
  }
  return text;
}

function normalizeWorkflowPlanStatus(status = '') {
  const text = String(status || '').trim().toLowerCase();
  if (text === 'completed' || text === 'done' || text === 'success') {
    return 'completed';
  }
  if (text === 'in_progress' || text === 'inprogress' || text === 'running' || text === 'active') {
    return 'in_progress';
  }
  return 'pending';
}

function buildWorkflowPlanBody(explanation = '', plan = []) {
  const lines = [];
  const note = String(explanation || '').trim();
  if (note) {
    lines.push(`> ${note}`);
    lines.push('');
  }
  const items = Array.isArray(plan) ? plan : [];
  if (!items.length) {
    lines.push('- [ ] 暂无计划步骤');
    return lines.join('\n');
  }
  items.forEach((item) => {
    const stepText = String(item?.step || '').trim() || '未命名步骤';
    const status = normalizeWorkflowPlanStatus(item?.status);
    if (status === 'completed') {
      lines.push(`- [x] ${stepText}`);
      return;
    }
    if (status === 'in_progress') {
      lines.push(`- [ ] ${stepText} **(进行中)**`);
      return;
    }
    lines.push(`- [ ] ${stepText}`);
  });
  return lines.join('\n');
}

function summarizeWorkflowPlan(plan = []) {
  const items = Array.isArray(plan) ? plan : [];
  const total = items.length;
  let completed = 0;
  let activeStep = '';
  items.forEach((item) => {
    const status = normalizeWorkflowPlanStatus(item?.status);
    if (status === 'completed') {
      completed += 1;
      return;
    }
    if (!activeStep && status === 'in_progress') {
      activeStep = String(item?.step || '').trim();
    }
  });
  const preview = activeStep
    ? `进行中: ${activeStep}`
    : (total > 0 ? `已完成 ${completed}/${total}` : '暂无计划步骤');
  return {
    total,
    completed,
    activeStep,
    preview,
  };
}

function summarizeWorkflowPurposeText(text = '', limit = 140) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return '';
  }
  const firstParagraph = normalized.split(/\n{2,}/)[0]?.replace(/\s+/g, ' ').trim() || '';
  if (!firstParagraph) {
    return '';
  }
  return normalizePreview(firstParagraph, limit);
}

function buildStructuredProgressMessage(body = '', segmentIndex = 0) {
  const preview = normalizePreview(body, 96);
  if (!preview) {
    return '';
  }
  const index = Number(segmentIndex || 0);
  return index > 0
    ? `阶段进展 #${index}: ${preview}`
    : `阶段进展: ${preview}`;
}

function extractIncrementalProgressText(fullText = '', previousFullText = '') {
  const current = String(fullText || '').trim();
  const previous = String(previousFullText || '').trim();
  if (!current) {
    return '';
  }
  if (!previous) {
    return current;
  }
  if (current === previous) {
    return '';
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length).replace(/^\s+/, '').trim();
  }
  return current;
}

function inferStructuredEventKind(level = '', message = '', metaKey = '') {
  const normalizedLevel = String(level || '').trim().toLowerCase();
  const text = String(message || '').trim();
  const key = String(metaKey || '').trim();
  if (!text && !key) {
    return '';
  }
  if (key === '会话ID' || key === '模型') {
    return 'startup';
  }
  if (/^请求[:：]/.test(text) || /^收到新请求/.test(text)) {
    return 'request';
  }
  if (
    normalizedLevel === 'hint'
    && (
      /^启动 app-server[:：]/.test(text)
      || /^已(恢复|创建|分叉)原生会话[:：]/.test(text)
      || /^使用原生会话续聊[:：]/.test(text)
      || /^创建新的 Codex 原生会话$/.test(text)
      || /^当前为本地拼接上下文模式/.test(text)
    )
  ) {
    return 'startup';
  }
  return '';
}

module.exports = {
  MAX_RUNTIME_EVENTS,
  MAX_RUNTIME_RAW,
  MAX_RUNTIME_WORKFLOW,
  TELEGRAM_VAULT_LOCKED_ERROR,
  buildStructuredProgressMessage,
  buildWorkflowPlanBody,
  extractIncrementalProgressText,
  inferStructuredEventKind,
  isCompletedPhase,
  normalizeNotificationFailureEventMessage,
  normalizeWorkflowPlanStatus,
  pushBounded,
  securitySnapshot,
  summarizeWorkflowPlan,
  summarizeWorkflowPurposeText,
};
