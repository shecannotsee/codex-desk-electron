const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_NOTIFICATION_SUMMARY_LIMITS = {
  title: 48,
  user: 90,
  detail: 180,
};
const TELEGRAM_NOTIFICATION_FULL_LIMITS = {
  title: 80,
};
const TELEGRAM_NOTIFICATION_CALLBACK_PREFIX = 'notif';

function compactTelegramText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeTelegramText(text, limit = 1200) {
  const value = compactTelegramText(text);
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

function escapeTelegramHtml(text = '') {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveConversationLabel(conversationId = '', conversationTitle = '', limit = 80) {
  const resolvedConversationId = String(conversationId || '').trim() || '-';
  const resolvedConversationTitle = normalizeTelegramText(conversationTitle, limit) || '';
  return resolvedConversationTitle && resolvedConversationTitle !== resolvedConversationId
    ? `${resolvedConversationTitle} [${resolvedConversationId}]`
    : resolvedConversationId;
}

function buildTelegramLabelLine(label = '', value = '') {
  return `<b>${escapeTelegramHtml(label)}:</b> ${escapeTelegramHtml(value || '-')}`;
}

function buildConversationResultHeaderLines({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  titleLimit = 80,
  page = 0,
  totalPages = 0,
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'failed'
    ? 'failed'
    : 'completed';
  const lines = [
    escapeTelegramHtml(`Conductor${deviceIdentity ? ` [${String(deviceIdentity).trim()}]` : ''} ${normalizedStatus === 'failed' ? '对话失败' : '对话完成'}`),
    buildTelegramLabelLine('对话', resolveConversationLabel(conversationId, conversationTitle, titleLimit)),
  ];
  if (totalPages > 1) {
    lines.push(escapeTelegramHtml(`第 ${Math.max(1, Number(page) || 1)}/${Math.max(1, Number(totalPages) || 1)} 页`));
  }
  return lines;
}

function findTelegramSplitIndex(text = '', limit = 1000) {
  const raw = String(text || '');
  if (raw.length <= limit) {
    return raw.length;
  }
  const minIndex = Math.max(40, Math.floor(limit * 0.55));
  const newlineIndex = raw.lastIndexOf('\n', limit);
  if (newlineIndex >= minIndex) {
    return newlineIndex;
  }
  const spaceIndex = raw.lastIndexOf(' ', limit);
  if (spaceIndex >= minIndex) {
    return spaceIndex;
  }
  return limit;
}

function splitTelegramContent(text = '', limit = 1000) {
  const value = compactTelegramText(text);
  if (!value) {
    return ['-'];
  }
  const parts = [];
  let remaining = value;
  const maxLength = Math.max(80, Number(limit) || 1000);
  while (remaining.length > maxLength) {
    // Prefer semantic boundaries so long assistant replies remain readable after Telegram pagination.
    const splitIndex = findTelegramSplitIndex(remaining, maxLength);
    parts.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts.filter(Boolean);
}

function buildLabeledSectionLines(label = '', text = '', chunkLimit = 1000) {
  const parts = splitTelegramContent(text, chunkLimit);
  if (parts.length <= 1) {
    return [buildTelegramLabelLine(label, parts[0] || '-')];
  }
  return parts.map((part, index) => (
    buildTelegramLabelLine(`${label}${index === 0 ? '' : `（续 ${index + 1}/${parts.length}）`}`, part)
  ));
}

function paginateTelegramNotificationLines(baseLines = [], bodyLines = []) {
  const pages = [];
  const normalizedBaseLines = Array.isArray(baseLines) ? baseLines.filter(Boolean) : [];
  const normalizedBodyLines = Array.isArray(bodyLines) && bodyLines.length ? bodyLines : ['-'];
  let currentPageLines = [];

  normalizedBodyLines.forEach((line) => {
    const candidateLines = currentPageLines.length
      ? [...currentPageLines, line]
      : [line];
    const candidateText = [...normalizedBaseLines, ...candidateLines].join('\n');
    if (candidateText.length <= TELEGRAM_MESSAGE_LIMIT || !currentPageLines.length) {
      currentPageLines = candidateLines;
      return;
    }
    pages.push(currentPageLines);
    currentPageLines = [line];
  });

  if (currentPageLines.length) {
    pages.push(currentPageLines);
  }
  return pages.length ? pages : [['-']];
}

function buildConversationResultSummaryMessage({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  userText = '',
  assistantText = '',
  errorText = '',
  exitCode = '',
  expandable = false,
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'failed'
    ? 'failed'
    : 'completed';
  const lines = buildConversationResultHeaderLines({
    deviceIdentity,
    status: normalizedStatus,
    conversationId,
    conversationTitle,
    titleLimit: TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.title,
  });
  lines.push(buildTelegramLabelLine('用户', normalizeTelegramText(userText, TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.user) || '-'));
  if (normalizedStatus === 'failed') {
    lines.push(buildTelegramLabelLine('退出码', String(exitCode || '').trim() || '-'));
    lines.push(buildTelegramLabelLine('错误', normalizeTelegramText(errorText, TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.detail) || '-'));
  } else {
    lines.push(buildTelegramLabelLine('回复', normalizeTelegramText(assistantText, TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.detail) || '-'));
  }
  if (expandable) {
    lines.push(escapeTelegramHtml('内容已省略，点击下方按钮展开全文。'));
  }
  return lines.join('\n');
}

function buildConversationResultDetailPages({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  userText = '',
  assistantText = '',
  errorText = '',
  exitCode = '',
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'failed'
    ? 'failed'
    : 'completed';
  const headerLines = buildConversationResultHeaderLines({
    deviceIdentity,
    status: normalizedStatus,
    conversationId,
    conversationTitle,
    titleLimit: TELEGRAM_NOTIFICATION_FULL_LIMITS.title,
  });
  const detailLines = [
    ...buildLabeledSectionLines('用户', userText, 1400),
  ];
  if (normalizedStatus === 'failed') {
    detailLines.push(buildTelegramLabelLine('退出码', String(exitCode || '').trim() || '-'));
    detailLines.push(...buildLabeledSectionLines('错误', errorText, 1800));
  } else {
    detailLines.push(...buildLabeledSectionLines('回复', assistantText, 1800));
  }

  const bodyPages = paginateTelegramNotificationLines(headerLines, detailLines);
  return bodyPages.map((pageLines, index) => {
    const lines = buildConversationResultHeaderLines({
      deviceIdentity,
      status: normalizedStatus,
      conversationId,
      conversationTitle,
      titleLimit: TELEGRAM_NOTIFICATION_FULL_LIMITS.title,
      page: index + 1,
      totalPages: bodyPages.length,
    });
    return normalizeTelegramText([...lines, ...pageLines].join('\n'), TELEGRAM_MESSAGE_LIMIT);
  });
}

function buildConversationResultMessage({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  userText = '',
  assistantText = '',
  errorText = '',
  exitCode = '',
}) {
  return buildConversationResultSummaryMessage({
    deviceIdentity,
    status,
    conversationId,
    conversationTitle,
    userText,
    assistantText,
    errorText,
    exitCode,
    expandable: false,
  });
}

module.exports = {
  TELEGRAM_MESSAGE_LIMIT,
  TELEGRAM_NOTIFICATION_CALLBACK_PREFIX,
  buildConversationResultDetailPages,
  buildConversationResultMessage,
  buildConversationResultSummaryMessage,
  normalizeTelegramText,
};
