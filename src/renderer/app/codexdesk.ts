import type { CodexDeskApi } from './types.js';

declare global {
  interface Window {
    codexdesk: CodexDeskApi;
  }
}

const codexdesk = window.codexdesk;

export { codexdesk };
