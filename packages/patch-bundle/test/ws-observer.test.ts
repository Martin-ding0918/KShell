import {describe, expect, it} from 'vitest';
import {ABORT_SIGNAL_PATCH_SOURCE, WS_OBSERVER_PATCH_SOURCE} from '../src/index';

type Listener = (ev: Record<string, unknown>) => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: unknown;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: unknown) {
    this.url = url;
  }

  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string, ev: Record<string, unknown> = {}) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(ev);
    }
  }
}

function installWsObserver(hostname = 'code-rc.kimi.com', protocol = 'https:') {
  const posted: Array<{source: string; type: string; detail: Record<string, unknown> | null}> = [];
  const winListeners = new Map<string, Listener[]>();
  const win: Record<string, unknown> = {
    WebSocket: FakeWebSocket,
    ReactNativeWebView: {
      postMessage: (raw: string) => {
        posted.push(JSON.parse(raw));
      },
    },
    addEventListener: (type: string, fn: Listener) => {
      const list = winListeners.get(type) ?? [];
      list.push(fn);
      winListeners.set(type, list);
    },
  };
  const loc = {hostname, protocol};
  const run = new Function('window', 'location', WS_OBSERVER_PATCH_SOURCE);
  run(win, loc);
  return {
    window: win,
    posted,
    WS: win.WebSocket as new (url: unknown) => FakeWebSocket,
  };
}

describe('WS_OBSERVER_PATCH_SOURCE', () => {
  it('forwards KICKED and approval signals from primary socket even after secondary socket opens', () => {
    const {WS, posted} = installWsObserver();
    const primary = new WS('wss://code-rc.kimi.com/ws?role=primary');
    const secondary = new WS('wss://code-rc.kimi.com/ws?role=secondary');

    primary.emit('open');
    secondary.emit('open');
    primary.emit('message', {data: JSON.stringify({pair_status: 'matched'})});
    primary.emit('message', {data: JSON.stringify({type: 'permission_request'})});
    primary.emit('message', {data: JSON.stringify({type: 'KICKED'})});

    expect(posted.map(e => e.type)).toContain('pair-status');
    expect(posted.map(e => e.type)).toContain('approval-waiting');
    expect(posted.map(e => e.type)).toContain('kicked');

    // Secondary socket signals are also observed.
    posted.length = 0;
    secondary.emit('message', {data: JSON.stringify({type: 'KICKED'})});
    expect(posted.map(e => e.type)).toEqual(['kicked']);
  });

  it('does not falsely report ws-closed when an auxiliary socket closes while primary stays open', () => {
    const {WS, posted} = installWsObserver();
    const primary = new WS('wss://zcode.z.ai/ws?main=1');
    const secondary = new WS('wss://zcode.z.ai/ws?aux=1');

    primary.emit('open');
    secondary.emit('open');
    primary.emit('message', {data: JSON.stringify({pair_status: 'matched'})});
    posted.length = 0;

    // Closing auxiliary socket while primary is open should not drop connection status.
    secondary.emit('close', {code: 1000});
    expect(posted).toEqual([]);

    // Closing primary socket reports ws-closed.
    primary.emit('close', {code: 1006});
    expect(posted).toEqual([{source: 'zshell', type: 'ws-closed', detail: {code: 1006}}]);
  });

  it('observes WebSocket(new URL(...)) and ignores chat text containing protocol words', () => {
    const {WS, posted} = installWsObserver('zcode.z.ai');
    const ws = new WS(new URL('wss://zcode.z.ai/ws'));
    ws.emit('open');
    posted.length = 0;

    // Chat text or JSON array containing "KICKED" must not trigger kicked.
    ws.emit('message', {data: JSON.stringify({type: 'message', content: '"KICKED" "pair_status":"waiting"'})});
    ws.emit('message', {data: JSON.stringify(['KICKED', 'permission_request'])});
    expect(posted).toEqual([]);
  });

  it('stays inactive on non-console hosts or non-https pages', () => {
    const auth = installWsObserver('auth.kimi.com', 'https:');
    expect(auth.window.__zshellWsObserver).toBe('probe:no-op');
    expect(auth.WS).toBe(FakeWebSocket);

    const insecure = installWsObserver('code-rc.kimi.com', 'http:');
    expect(insecure.window.__zshellWsObserver).toBe('probe:no-op');
  });
});

describe('ABORT_SIGNAL_PATCH_SOURCE', () => {
  it('supports Set iterables and removes remaining listeners on abort', () => {
    const fakeAbortSignal: Record<string, unknown> = {};
    const win: Record<string, unknown> = {};
    const run = new Function('window', 'AbortSignal', 'AbortController', ABORT_SIGNAL_PATCH_SOURCE);
    run(win, fakeAbortSignal, AbortController);
    const anyFn = fakeAbortSignal.any as (signals: Iterable<AbortSignal>) => AbortSignal;

    let removed = 0;
    const c1 = new AbortController();
    const c2 = new AbortController();
    const origRemove = c2.signal.removeEventListener.bind(c2.signal);
    c2.signal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => {
      removed++;
      return origRemove(...args);
    }) as AbortSignal['removeEventListener'];

    const combined = anyFn(new Set([c1.signal, c2.signal]));
    expect(combined.aborted).toBe(false);
    c1.abort('boom');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('boom');
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
