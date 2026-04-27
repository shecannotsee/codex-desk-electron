import { codexdesk } from './codexdesk.js';
import type { MessageAttachment } from './types.js';
import {
  el,
  getComposerAttachments,
  setComposerAttachments,
  state,
} from './state_i18n.js';
import { renderComposerDraft } from './composer_renderer.js';

function dragEventHasFiles(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes('Files');
}

function extractDroppedPaths(dataTransfer: DataTransfer | null | undefined): string[] {
  const seen = new Set<string>();
  const files = Array.from(dataTransfer?.files || []);
  files.forEach((file) => {
    const path = String(codexdesk.getPathForFile(file) || '').trim();
    if (path) {
      seen.add(path);
    }
  });
  return [...seen];
}

function normalizeAttachmentFiles(files: File[] = []): MessageAttachment[] {
  const seen = new Set<string>();
  return files.map((file): MessageAttachment | null => {
    const path = String(codexdesk.getPathForFile(file) || '').trim();
    if (!path || seen.has(path)) {
      return null;
    }
    seen.add(path);
    return {
      path,
      name: String(file.name || '').trim(),
      mimeType: String(file.type || '').trim(),
      size: Number(file.size || 0) || 0,
      kind: String(file.type || '').startsWith('image/') ? 'image' : '',
    };
  }).filter((item): item is MessageAttachment => Boolean(item));
}

function imageAttachmentsOnly(items: MessageAttachment[] = []): MessageAttachment[] {
  return items.filter((item) => {
    const mimeType = String(item?.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('image/')) {
      return true;
    }
    const path = String(item?.path || item?.name || '').trim().toLowerCase();
    return /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/.test(path);
  });
}

function addComposerAttachments(items: MessageAttachment[] = []) {
  const current = getComposerAttachments(state.activeConversationId);
  const next = [...current];
  const seen = new Set(current.map((item) => String(item.path || '').trim()).filter(Boolean));
  items.forEach((item) => {
    const path = String(item?.path || '').trim();
    if (!path || seen.has(path)) {
      return;
    }
    seen.add(path);
    next.push(item);
  });
  setComposerAttachments(state.activeConversationId, next);
  renderComposerDraft();
}

function removeComposerAttachment(index: number) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }
  const current = getComposerAttachments(state.activeConversationId);
  const next = current.filter((_, itemIndex) => itemIndex !== index);
  setComposerAttachments(state.activeConversationId, next);
  renderComposerDraft();
}

function setAttachmentMenuOpen(open: boolean) {
  if (!el.attachmentKindMenu || !el.btnAddAttachment) {
    return;
  }
  const expanded = Boolean(open);
  el.attachmentKindMenu.classList.toggle('hidden', !expanded);
  el.btnAddAttachment.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

export {
  addComposerAttachments,
  dragEventHasFiles,
  extractDroppedPaths,
  imageAttachmentsOnly,
  normalizeAttachmentFiles,
  removeComposerAttachment,
  setAttachmentMenuOpen,
};
