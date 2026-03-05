const crypto = require('node:crypto');

function nowTs() {
  return Date.now() / 1000;
}

function formatConversationTitle(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const mss = String(date.getMilliseconds()).padStart(3, '0');
  return `会话 ${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${mss}`;
}

function newConversation(title = formatConversationTitle()) {
  const now = nowTs();
  return {
    id: crypto.randomUUID().replaceAll('-', ''),
    title,
    sessionId: '',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getConversation(conversations, conversationId) {
  return conversations.find((item) => item.id === conversationId) || null;
}

function sortedConversations(conversations) {
  return [...conversations].sort((a, b) => {
    const au = Number(a.updatedAt || 0);
    const bu = Number(b.updatedAt || 0);
    if (bu !== au) {
      return bu - au;
    }
    const ac = Number(a.createdAt || 0);
    const bc = Number(b.createdAt || 0);
    return bc - ac;
  });
}

module.exports = {
  nowTs,
  formatConversationTitle,
  newConversation,
  getConversation,
  sortedConversations,
};
