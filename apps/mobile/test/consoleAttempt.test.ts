import {describe, expect, it} from 'vitest';
import {formatConsoleAttempt} from '../src/consoleAttempt';

describe('console failure summary', () => {
  it('reports relative milestones, status and the native error code', () => {
    const report = formatConsoleAttempt('Kimi Code', {
      startedAt: 50_000,
      loadStartedAt: 50_015,
      firstPaintAt: 50_880,
    }, 'waiting', {kind: 'load-error', code: -2}, 51_200);

    expect(report.split('\n')).toEqual([
      'KShell · Kimi Code 连接诊断',
      '结果：页面加载失败',
      '失败耗时：1200 ms',
      '页面开始加载：15 ms',
      '首帧：880 ms',
      '最后连接状态：等待桌面端上线',
      'WebView 错误码：-2',
    ]);
  });

  it('leaves out unobserved milestones and error codes for a new attempt', () => {
    const report = formatConsoleAttempt('ZCode', {startedAt: 80_000}, 'connecting',
      {kind: 'reload-timeout'}, 95_000);

    expect(report).toContain('结果：页面重新加载超时');
    expect(report).toContain('失败耗时：15000 ms');
    expect(report).toContain('首帧：未收到信号');
    expect(report).not.toContain('错误码');
  });
});
