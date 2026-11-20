import type {ConsoleStatus} from '@zshell/core-shell';

export interface ConsoleAttempt {
  startedAt: number;
  loadStartedAt?: number;
  firstPaintAt?: number;
}

export type ConsoleFailure =
  | {kind: 'load-error'; code: number | undefined}
  | {kind: 'load-timeout' | 'reload-timeout'};

const failureLabels = {
  'load-error': '页面加载失败',
  'load-timeout': '页面加载超时',
  'reload-timeout': '页面重新加载超时',
};

const statusLabels: Record<ConsoleStatus, string> = {
  connecting: '连接中',
  connected: '已连接',
  waiting: '等待桌面端上线',
  disconnected: '连接已断开',
  kicked: '已在其他设备连接',
};

export function formatConsoleAttempt(
  product: 'Kimi Code' | 'ZCode',
  attempt: ConsoleAttempt,
  status: ConsoleStatus,
  failure: ConsoleFailure,
  failedAt: number,
): string {
  const elapsed = (at: number | undefined) =>
    at === undefined ? '未收到信号' : `${Math.max(0, Math.round(at - attempt.startedAt))} ms`;

  const lines = [
    `KShell · ${product} 连接诊断`,
    `结果：${failureLabels[failure.kind]}`,
    `失败耗时：${elapsed(failedAt)}`,
    `页面开始加载：${elapsed(attempt.loadStartedAt)}`,
    `首帧：${elapsed(attempt.firstPaintAt)}`,
    `最后连接状态：${statusLabels[status]}`,
  ];
  if (failure.kind === 'load-error' && Number.isSafeInteger(failure.code)) {
    lines.push(`WebView 错误码：${failure.code}`);
  }
  return lines.join('\n');
}
