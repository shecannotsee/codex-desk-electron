import { currentLang, escapeHtml, t } from './state_i18n.js';

type KatexRenderer = {
  renderToString: (
    expression: string,
    options: {
      displayMode?: boolean;
      throwOnError?: boolean;
      strict?: 'ignore' | boolean | string;
      output?: 'html' | 'mathml' | 'htmlAndMathml';
      trust?: boolean;
    },
  ) => string;
};

function getKatexRenderer() {
  const maybeKatex = (globalThis as typeof globalThis & { katex?: KatexRenderer }).katex;
  if (maybeKatex && typeof maybeKatex.renderToString === 'function') {
    return maybeKatex;
  }
  return null;
}

const MARKDOWN_CACHE_LIMIT = 400;
const markdownRenderCache = new Map<string, string>();

type MarkdownRenderContext = {
  references: Map<string, string>;
};

function normalizeLocalLinkTarget(target) {
  const value = String(target || '').trim();
  if (!value) {
    return '';
  }
  if (/^file:\/\//i.test(value)) {
    return value;
  }
  return /^(\/|[a-zA-Z]:[\\/])/.test(value) ? value : '';
}

function isMarkdownEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || '').trim());
}

function renderMarkdownLink(label, target) {
  const href = String(target || '').trim();
  const localPath = normalizeLocalLinkTarget(href);
  if (localPath) {
    return `<a href="#" class="md-local-link" data-open-path="${escapeHtml(encodeURIComponent(localPath))}" title="${escapeHtml(localPath)}">${label}</a>`;
  }
  if (/^(https?:\/\/|mailto:)/i.test(href)) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
  }
  if (isMarkdownEmail(href)) {
    const mailto = `mailto:${href}`;
    return `<a href="${escapeHtml(mailto)}" target="_blank" rel="noreferrer">${label}</a>`;
  }
  return `[${label}](${escapeHtml(href)})`;
}

function normalizeMarkdownReferenceLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractMarkdownReferenceDefinitions(text) {
  const references = new Map<string, string>();
  const cleanedLines = String(text || '').split(/\r?\n/).filter((line) => {
    const match = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(String(line || ''));
    if (!match) {
      return true;
    }
    references.set(normalizeMarkdownReferenceLabel(match[1]), String(match[2] || '').trim());
    return false;
  });
  return {
    references,
    text: cleanedLines.join('\n'),
  };
}

function renderMarkdownMath(expression, displayMode) {
  const tex = String(expression || '').trim();
  if (!tex) {
    return '';
  }
  const katexRenderer = getKatexRenderer();
  if (!katexRenderer) {
    const fallback = `<code>${escapeHtml(tex)}</code>`;
    if (displayMode) {
      return `<div class="md-math-block md-math-fallback">${fallback}</div>`;
    }
    return `<span class="md-math-inline md-math-fallback">${fallback}</span>`;
  }
  try {
    const html = katexRenderer.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
      trust: false,
    });
    if (displayMode) {
      return `<div class="md-math-block">${html}</div>`;
    }
    return `<span class="md-math-inline">${html}</span>`;
  } catch {
    const fallback = `<code>${escapeHtml(tex)}</code>`;
    if (displayMode) {
      return `<div class="md-math-block md-math-fallback">${fallback}</div>`;
    }
    return `<span class="md-math-inline md-math-fallback">${fallback}</span>`;
  }
}

function splitMarkdownAutoLinkTail(value) {
  const match = /^(.*?)([),.!?:;]+)?$/.exec(String(value || ''));
  return {
    body: String(match?.[1] || ''),
    tail: String(match?.[2] || ''),
  };
}

function renderMarkdownTaskItem(itemText, context: MarkdownRenderContext = { references: new Map() }) {
  const match = /^\[(x|X| )\]\s+([\s\S]+)$/.exec(String(itemText || ''));
  if (!match) {
    return '';
  }
  const checked = match[1].toLowerCase() === 'x';
  return [
    '<li class="md-task-item">',
    `<span class="md-task-checkbox${checked ? ' is-checked' : ''}" aria-hidden="true"></span>`,
    `<span class="md-task-content">${renderInline(match[2], context)}</span>`,
    '</li>',
  ].join('');
}

function renderMarkdownAdmonition(kind, content, context: MarkdownRenderContext = { references: new Map() }) {
  const level = String(kind || '').toLowerCase();
  const title = String(kind || '').toUpperCase();
  return [
    `<div class="md-admonition md-admonition-${escapeHtml(level)}">`,
    `<div class="md-admonition-title">${escapeHtml(title)}</div>`,
    `<div class="md-admonition-body">${renderInline(String(content || '').trim(), context)}</div>`,
    '</div>',
  ].join('');
}

function renderInline(text, context: MarkdownRenderContext = { references: new Map() }) {
  const codeTokens: string[] = [];
  const input = String(text || '').replace(/`([^`\n]+)`/g, (_, codeText) => {
    const token = `@@MD_CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code>${escapeHtml(codeText)}</code>`);
    return token;
  });
  const escapeTokens: string[] = [];
  const escapedMarkdown = input.replace(/\\([\\`*_~{}\[\]()#+\-.!|>])/g, (_, escapedChar) => {
    const token = `@@MD_ESC_${escapeTokens.length}@@`;
    escapeTokens.push(escapeHtml(escapedChar));
    return token;
  });
  const linkTokens: string[] = [];
  const pushLinkToken = (html) => {
    const token = `@@MD_LINK_${linkTokens.length}@@`;
    linkTokens.push(html);
    return token;
  };
  const mathTokens: string[] = [];
  const pushMathToken = (html) => {
    const token = `@@MD_MATH_${mathTokens.length}@@`;
    mathTokens.push(html);
    return token;
  };
  const mathLinked = escapedMarkdown.replace(/(?<!\$)\$([^\s$](?:[^$\n]|\\\$)*?[^\s$])\$(?!\$)/g, (_, expression) => (
    pushMathToken(renderMarkdownMath(expression, false))
  ));
  const linked = mathLinked
    .replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, (_, label, target) => (
      pushLinkToken(renderMarkdownLink(escapeHtml(label), target))
    ))
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_, label, refLabel) => {
      const referenceTarget = context.references.get(normalizeMarkdownReferenceLabel(refLabel));
      return referenceTarget
        ? pushLinkToken(renderMarkdownLink(escapeHtml(label), referenceTarget))
        : `[${label}][${refLabel}]`;
    })
    .replace(/\[([^\]]+)\]\[\]/g, (_, label) => {
      const referenceTarget = context.references.get(normalizeMarkdownReferenceLabel(label));
      return referenceTarget
        ? pushLinkToken(renderMarkdownLink(escapeHtml(label), referenceTarget))
        : `[${label}][]`;
    });
  const autoLinkedUrls = linked.replace(/https?:\/\/[^\s<]+/gi, (rawUrl, offset, whole) => {
    const previous = offset > 0 ? whole[offset - 1] : '';
    if (previous === '"' || previous === '\'' || previous === '=' || previous === '@') {
      return rawUrl;
    }
    const { body, tail } = splitMarkdownAutoLinkTail(rawUrl);
    if (!body) {
      return rawUrl;
    }
    return `${pushLinkToken(renderMarkdownLink(escapeHtml(body), body))}${tail}`;
  });
  const autoLinked = autoLinkedUrls.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (rawEmail, offset, whole) => {
    const previous = offset > 0 ? whole[offset - 1] : '';
    if (/[A-Z0-9._%+-]/i.test(previous) || previous === '/' || previous === '"' || previous === '\'') {
      return rawEmail;
    }
    const next = offset + rawEmail.length < whole.length ? whole[offset + rawEmail.length] : '';
    if (/[A-Z0-9._%+-]/i.test(next)) {
      return rawEmail;
    }
    const { body, tail } = splitMarkdownAutoLinkTail(rawEmail);
    if (!body) {
      return rawEmail;
    }
    return `${pushLinkToken(renderMarkdownLink(escapeHtml(body), body))}${tail}`;
  });
  let escaped = escapeHtml(autoLinked);
  linkTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_LINK_${index}@@`, html);
  });
  mathTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_MATH_${index}@@`, html);
  });
  escaped = escaped.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  escaped = escaped.replace(/\*\*((?:(?!\*\*).|\n)+?)\*\*/g, '<b>$1</b>');
  escaped = escaped.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
  codeTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_CODE_${index}@@`, html);
  });
  escapeTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_ESC_${index}@@`, html);
  });
  return escaped;
}

function isMarkdownTableSeparator(text) {
  const value = String(text || '').trim();
  if (!value || !value.includes('|')) {
    return false;
  }
  const normalized = value.replace(/^\|/, '').replace(/\|$/, '');
  const cells = normalized.split('|').map((item) => item.trim()).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitMarkdownTableRow(text) {
  const raw = String(text || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return raw.split('|').map((item) => item.trim());
}

function tableAlignmentFromMarker(marker) {
  const value = String(marker || '').trim();
  if (value.startsWith(':') && value.endsWith(':')) {
    return 'center';
  }
  if (value.endsWith(':')) {
    return 'right';
  }
  if (value.startsWith(':')) {
    return 'left';
  }
  return '';
}

function isMarkdownTableStart(headerLine, separatorLine) {
  if (!isMarkdownTableSeparator(separatorLine)) {
    return false;
  }
  const headers = splitMarkdownTableRow(headerLine);
  const separators = splitMarkdownTableRow(separatorLine);
  return headers.length > 0 && headers.length === separators.length;
}

function renderMarkdownTable(headerLine, separatorLine, bodyLines, context: MarkdownRenderContext = { references: new Map() }) {
  const headers = splitMarkdownTableRow(headerLine);
  const separators = splitMarkdownTableRow(separatorLine);
  if (!headers.length || headers.length !== separators.length) {
    return '';
  }

  const alignments = separators.map((item) => tableAlignmentFromMarker(item));
  const renderCell = (tag, value, alignment) => {
    const style = alignment ? ` style="text-align:${escapeHtml(alignment)}"` : '';
    return `<${tag}${style}>${renderInline(value, context)}</${tag}>`;
  };

  const headHtml = `<thead><tr>${headers.map((item, index) => renderCell('th', item, alignments[index])).join('')}</tr></thead>`;
  const bodyHtml = bodyLines.length
    ? `<tbody>${bodyLines.map((line) => {
      const cells = splitMarkdownTableRow(line);
      const normalized = headers.map((_, index) => cells[index] || '');
      return `<tr>${normalized.map((item, index) => renderCell('td', item, alignments[index])).join('')}</tr>`;
    }).join('')}</tbody>`
    : '';

  return `<div class="md-table-wrap"><table class="md-table">${headHtml}${bodyHtml}</table></div>`;
}

function isBlockquoteLine(line) {
  return /^\s*>(?:\s|>|$)/.test(String(line || ''));
}

function stripOneBlockquoteLevel(line) {
  return String(line || '').replace(/^\s*>\s?/, '');
}

function renderMarkdownParagraph(lines, context: MarkdownRenderContext = { references: new Map() }) {
  const parts = [];
  lines.forEach((line, index) => {
    const raw = String(line || '');
    parts.push(renderInline(raw.trim(), context));
    if (index >= lines.length - 1) {
      return;
    }
    parts.push(/ {2,}$/.test(raw) ? '<br>' : ' ');
  });
  return `<p>${parts.join('')}</p>`;
}

function collectMarkdownBlockMath(lines, startIndex) {
  const first = String(lines[startIndex] || '');
  const firstTrim = first.trim();
  if (!firstTrim.startsWith('$$')) {
    return null;
  }
  const inlineBody = firstTrim.slice(2);
  if (inlineBody.endsWith('$$') && inlineBody.trim() !== '$$') {
    const content = inlineBody.slice(0, -2).trim();
    return {
      html: renderMarkdownMath(content, true),
      nextIndex: startIndex + 1,
    };
  }
  const mathLines = [];
  if (inlineBody.trim()) {
    mathLines.push(inlineBody);
  }
  let index = startIndex + 1;
  while (index < lines.length) {
    const current = String(lines[index] || '');
    const currentTrim = current.trim();
    if (currentTrim.endsWith('$$')) {
      const tail = currentTrim.slice(0, -2);
      if (tail) {
        mathLines.push(tail);
      }
      return {
        html: renderMarkdownMath(mathLines.join('\n').trim(), true),
        nextIndex: index + 1,
      };
    }
    mathLines.push(current);
    index += 1;
  }
  return null;
}

function renderMarkdownFallback(text, context: MarkdownRenderContext = { references: new Map() }) {
  const lines = String(text || '').split(/\r?\n/);
  const result = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const stripped = String(line || '').trim();
    if (!stripped) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(stripped);
    if (heading) {
      const level = heading[1].length;
      result.push(`<h${level}>${renderInline(heading[2], context)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}$/.test(stripped)) {
      result.push('<hr/>');
      index += 1;
      continue;
    }

    const admonition = /^\[!(NOTE|TIP|WARNING|CAUTION)\]\s*(.*)$/i.exec(stripped);
    if (admonition) {
      const detailLines = [admonition[2]];
      index += 1;
      while (index < lines.length) {
        const current = String(lines[index] || '');
        const currentStrip = current.trim();
        if (
          !currentStrip
          || /^(#{1,6})\s+/.test(currentStrip)
          || /^[-*_]{3,}$/.test(currentStrip)
          || isBlockquoteLine(current)
          || /^\s*[-*+]\s+/.test(current)
          || /^\s*\d+\.\s+/.test(current)
          || currentStrip.startsWith('$$')
          || /^\[!(NOTE|TIP|WARNING|CAUTION)\]/i.test(currentStrip)
        ) {
          break;
        }
        detailLines.push(currentStrip);
        index += 1;
      }
      result.push(renderMarkdownAdmonition(admonition[1], detailLines.filter(Boolean).join(' '), context));
      continue;
    }

    const mathBlock = collectMarkdownBlockMath(lines, index);
    if (mathBlock) {
      result.push(mathBlock.html);
      index = mathBlock.nextIndex;
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines = [];
      while (index < lines.length && isBlockquoteLine(lines[index])) {
        quoteLines.push(stripOneBlockquoteLevel(lines[index]));
        index += 1;
      }
      result.push(`<blockquote>${renderMarkdownFallback(quoteLines.join('\n'), context)}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*[-*+]\s+/, '').trim();
        const taskItem = renderMarkdownTaskItem(item, context);
        items.push(taskItem || `<li>${renderInline(item, context)}</li>`);
        index += 1;
      }
      result.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*\d+\.\s+/, '').trim();
        const taskItem = renderMarkdownTaskItem(item, context);
        items.push(taskItem || `<li>${renderInline(item, context)}</li>`);
        index += 1;
      }
      result.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (stripped.includes('|') && index + 1 < lines.length && isMarkdownTableStart(line, lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length) {
        const current = String(lines[index] || '');
        const currentStrip = current.trim();
        if (!currentStrip || !currentStrip.includes('|') || isMarkdownTableSeparator(currentStrip)) {
          break;
        }
        tableLines.push(current);
        index += 1;
      }
      const tableHtml = renderMarkdownTable(tableLines[0], tableLines[1], tableLines.slice(2), context);
      if (tableHtml) {
        result.push(tableHtml);
        continue;
      }
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const current = String(lines[index] || '');
      const currentStrip = current.trim();
      if (!currentStrip) {
        break;
      }
      if (/^(#{1,6})\s+/.test(currentStrip)) {
        break;
      }
      if (/^[-*_]{3,}$/.test(currentStrip)) {
        break;
      }
      if (isBlockquoteLine(current)) {
        break;
      }
      if (/^\s*[-*+]\s+/.test(current)) {
        break;
      }
      if (/^\s*\d+\.\s+/.test(current)) {
        break;
      }
      if (currentStrip.startsWith('$$')) {
        break;
      }
      if (/^\[!(NOTE|TIP|WARNING|CAUTION)\]/i.test(currentStrip)) {
        break;
      }
      if (currentStrip.includes('|') && index + 1 < lines.length && isMarkdownTableStart(current, lines[index + 1])) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    result.push(renderMarkdownParagraph(paragraphLines, context));
  }

  return result.join('');
}

function renderMarkdownLike(text) {
  const raw = String(text || '');
  const cacheable = raw.length > 0 && raw.length <= 50000;
  const cacheKey = cacheable ? `${currentLang()}::${raw}` : '';
  if (cacheKey && markdownRenderCache.has(cacheKey)) {
    const cached = markdownRenderCache.get(cacheKey);
    markdownRenderCache.delete(cacheKey);
    markdownRenderCache.set(cacheKey, cached);
    return cached;
  }
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const fenceCollectorPattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const references = new Map<string, string>();
  raw.replace(fenceCollectorPattern, '\n').split(/\r?\n/).forEach((line) => {
    const match = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(String(line || ''));
    if (!match) {
      return;
    }
    references.set(normalizeMarkdownReferenceLabel(match[1]), String(match[2] || '').trim());
  });
  const context: MarkdownRenderContext = { references };
  let start = 0;
  let html = '';
  let match = null;

  while ((match = fencePattern.exec(raw)) !== null) {
    const normalPart = raw.slice(start, match.index);
    if (normalPart.trim()) {
      html += renderMarkdownFallback(extractMarkdownReferenceDefinitions(normalPart).text, context);
    }

    const language = String(match[1] || '').trim() || 'code';
    const codeText = escapeHtml(String(match[2] || '').replace(/\n$/, ''));
    html += [
      '<div class="md-code-wrap">',
      `<div class="md-code-lang">${escapeHtml(language)}</div>`,
      `<pre><code>${codeText}</code></pre>`,
      '</div>',
    ].join('');
    start = fencePattern.lastIndex;
  }

  const tail = raw.slice(start);
  if (tail.trim() || !html) {
    html += renderMarkdownFallback(extractMarkdownReferenceDefinitions(tail).text, context);
  }
  if (cacheKey) {
    markdownRenderCache.set(cacheKey, html);
    while (markdownRenderCache.size > MARKDOWN_CACHE_LIMIT) {
      const oldestKey = markdownRenderCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      markdownRenderCache.delete(oldestKey);
    }
  }
  return html;
}

export {
  renderMarkdownLike,
};
