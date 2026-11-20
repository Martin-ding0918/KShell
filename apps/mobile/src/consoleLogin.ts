import type {MachineLoginState} from '@zshell/core-shell';

export function observeKimiLogin(url: string): MachineLoginState | undefined {
  const path = /^https:\/\/code-rc\.kimi\.(?:com|ai)(?::443)?(\/[^?#]*)(?:[?#]|$)/i.exec(url)?.[1];
  if (path === undefined) return;
  if (/^\/login\/?$/.test(path)) return 'logged-out';
  if (/^\/devices\/[^/]+/.test(path)) return 'logged-in';
}
