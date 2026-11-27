import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Clipboard,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import type {AppStateStatus} from 'react-native';
import {
  WebView,
  WebViewNavigation,
  WebViewMessageEvent,
} from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';
import {
  buildConsoleUrl,
  ConsoleEvent,
  ConsoleStatus,
  deriveConsoleStatus,
  hostKindOf,
  hostLabel,
  MachineLoginState,
  MachineRecord,
  parseClock,
  parseConsoleEvent,
  withinQuietHours,
} from '@zshell/core-shell';
import {buildPatchSource} from '@zshell/patch-bundle';
import {buildKimiThemePrelude, KIMI_TOPBAR_PATCH} from '../kimiTopbar';
import {buildZcodeTopbarPatch, shouldShowZcodeFooter, type ZcodePage} from '../zcodeTopbar';
import {observeKimiLogin} from '../consoleLogin';
import {formatConsoleAttempt, type ConsoleAttempt, type ConsoleFailure} from '../consoleAttempt';
import {BottomSheet} from '../components/BottomSheet';
import {Icon} from '../components/Icon';
import {logDiag} from '../diagnostics';
import {openInBrowser} from '../downloads';
import {loadPrefs, notifications} from '../notifications';
import {makeStyles, Palette, palettes, radius, useTheme} from '../theme';

const kimiConsoleColors = {dark: palettes.dark.consoleBg, light: palettes.light.consoleBg};
const zcodeTopbarPatch = buildZcodeTopbarPatch(palettes);

// 优先等待 first-contentful-paint；不支持或未上报时用双 rAF 兜底。
const FIRST_PAINT_PROBE = String.raw`(function () {
  try {
    if (window.__zshellPaintProbeApplied) return;
    var bridge = window.ReactNativeWebView;
    if (!bridge) return;
    window.__zshellPaintProbeApplied = true;
    var observer, timer, sent = false;
    var post = function () {
      if (sent) return;
      sent = true;
      clearTimeout(timer);
      if (observer) observer.disconnect();
      bridge.postMessage('zshell:first-paint');
    };
    var fallback = function () {
      requestAnimationFrame(function () { requestAnimationFrame(post); });
    };
    if (window.performance && performance.getEntriesByName &&
        performance.getEntriesByName('first-contentful-paint', 'paint').length) {
      post();
      return;
    }
    try {
      if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes &&
          PerformanceObserver.supportedEntryTypes.indexOf('paint') !== -1) {
        observer = new PerformanceObserver(function (list) {
          if (list.getEntriesByName('first-contentful-paint').length) post();
        });
        observer.observe({type: 'paint', buffered: true});
        timer = setTimeout(fallback, 1000);
        return;
      }
    } catch (_) {}
    fallback();
  } catch (_) {}
})();
`;

function statusMeta(
  status: ConsoleStatus,
  colors: Palette,
): {label: string; color: string; short: string} {
  switch (status) {
    case 'connecting':
      return {label: '连接中…', short: '连接中', color: colors.star};
    case 'connected':
      return {label: '已连接', short: '已连接', color: colors.success};
    case 'waiting':
      return {label: '等待桌面端上线', short: '等待中', color: colors.star};
    case 'disconnected':
      return {label: '连接已断开', short: '已断开', color: colors.danger};
    case 'kicked':
      return {label: '已在其他设备连接', short: '已断开', color: colors.danger};
  }
}

function authHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function httpsHostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

const KIMI_CONSOLE_HOST_RE = /^code-rc\.kimi\.(?:com|ai)$/;
const ZCODE_CONSOLE_HOST_RE = /^(?:zcode\.z\.ai|zcode\.chatglm\.site)$/;
const COMMON_OAUTH_HOST_RE =
  /^(?:accounts\.google\.com|accounts\.youtube\.com|appleid\.apple\.com|idmsa\.apple\.com|open\.weixin\.qq\.com|github\.com|open\.feishu\.cn)$/;
const KIMI_MAIN_NAV_HOST_RE =
  /^(?:(?:code-rc|auth|www)\.)?kimi\.(?:com|ai)$|^(?:[a-z0-9-]+\.)?moonshot\.cn$/;
const ZCODE_MAIN_NAV_HOST_RE =
  /^(?:[a-z0-9-]+\.)?(?:z\.ai|chatglm\.site|chatglm\.cn|bigmodel\.cn|zhipuai\.cn)$|^(?:accounts\.google\.com|accounts\.youtube\.com|appleid\.apple\.com|idmsa\.apple\.com|open\.weixin\.qq\.com|github\.com|open\.feishu\.cn)$/;
const KIMI_AUTH_NAV_HOST_RE =
  /^(?:[a-z0-9-]+\.)?(?:kimi\.com|kimi\.ai|moonshot\.cn)$|^(?:accounts\.google\.com|accounts\.youtube\.com|appleid\.apple\.com|idmsa\.apple\.com|open\.weixin\.qq\.com)$/;
const ZCODE_AUTH_NAV_HOST_RE = ZCODE_MAIN_NAV_HOST_RE;

const MAX_RENDERER_AUTO_RECOVERIES = 2;
const RENDERER_CRASH_WINDOW_MS = 60_000;

export interface ConsoleSwitchTarget {
  id: string;
  name: string;
  active: boolean;
  kind: 'kimi' | 'zcode';
}

interface ConsoleScreenProps {
  machine: MachineRecord;
  foreground: boolean;
  onBack: () => void;
  /**
   * Registers a web-history back handler. The system back button prefers
   * the page's own history (e.g. navigating inside the console); when there
   * is none it falls through to the app-level back (return to machine list).
   */
  registerBackHandler: (fn: (() => boolean) | null) => void;
  /** Opens the download manager (console-triggered downloads land there). */
  onOpenDownloads: () => void;
  /**
   * Observed web-login state for Kimi Code machines (page landing on /login
   * means signed out, staying on /devices/ means signed in).
   */
  onLoginState?: (machineId: string, state: MachineLoginState) => void;
  /** All paired machines for quick switching from inside the console menu. */
  switchTargets?: ReadonlyArray<ConsoleSwitchTarget>;
  onSwitchMachine?: (machineId: string) => void;
}

/**
 * The official remote console in a WebView. The document-start patch bundle
 * (matchMedia fix etc.) is injected before any page script runs; everything
 * else — relay WSS, pairing handshake — is done by the official page itself.
 */
export function ConsoleScreen({
  machine,
  foreground,
  onBack,
  registerBackHandler,
  onOpenDownloads,
  onLoginState,
  switchTargets,
  onSwitchMachine,
}: ConsoleScreenProps) {
  const {colors, font} = useTheme();
  const styles = useStyles();
  const webviewRef = useRef<WebView<object>>(null);
  const authWebViewRef = useRef<WebView<object>>(null);
  const syncTopbarActivity = useCallback((active: boolean) => {
    webviewRef.current?.injectJavaScript(
      `window.__zshellTopbarActive = ${active}; window.__zshellSetTopbarActive?.(${active}); true;`,
    );
  }, []);
  const [rendererGone, setRendererGone] = useState(false);
  const crashCountRef = useRef(0);
  const lastCrashAtRef = useRef(0);
  const crashRecoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canGoBackRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<ConsoleStatus>('connecting');
  const statusRef = useRef<ConsoleStatus>('connecting');
  statusRef.current = status;
  const isKimi = machine.credentials.kind === 'kimi';
  const attempt = useRef<ConsoleAttempt>({startedAt: performance.now()});
  const [failureReport, setFailureReport] = useState('');
  const recordFailure = useCallback((failure: ConsoleFailure) => {
    setFailureReport(formatConsoleAttempt(isKimi ? 'Kimi Code' : 'ZCode',
      attempt.current, statusRef.current, failure, performance.now()));
  }, [isKimi]);
  // True while the WebView's own load has failed (error page visible).
  const [loadFailed, setLoadFailed] = useState(false);
  const prefsRef = useRef(loadPrefs());
  const url = useMemo(() => buildConsoleUrl(machine.credentials), [machine.credentials]);
  // The WebView source must stay referentially stable: with keep-alive the
  // console stays mounted while App re-renders (registry copies make the
  // machine prop a fresh object each time), and a new source object would
  // reload the page. The key is used to rebuild a failed renderer.
  const webSource = useMemo(() => ({uri: url}), [url]);
  // 原生遮罩：盖住 WebView 表面，直到真实页面提交首帧。实测（小米 17，
  // 录屏逐帧 + logcat）从 WebView 创建到首帧绘制之间（慢隧道下 6~10s），
  // 表面一直显示初始白色缓冲；原生遮罩由 App 进程合成，首帧信号或 15s 兜底后撤除。
  const [cover, setCover] = useState<
    'opening' | 'reloading' | 'load-timeout' | 'reload-timeout' | 'hidden'
  >('opening');
  useEffect(() => {
    if (cover === 'reloading') webviewRef.current?.reload();
    if (cover !== 'opening' && cover !== 'reloading') return;
    const timeout = cover === 'reloading' ? 'reload-timeout' : 'load-timeout';
    const timer = setTimeout(() => {
      logDiag(timeout);
      recordFailure({kind: timeout});
      setCover(current => current === cover ? timeout : current);
    }, 15000);
    return () => clearTimeout(timer);
  }, [cover, reloadKey, recordFailure]);
  const isZcode = hostKindOf(machine.credentials) === 'zcode';
  const [needsLogin, setNeedsLogin] = useState(false);
  const [kimiHeaderReady, setKimiHeaderReady] = useState(false);
  const [kimiHeaderFallback, setKimiHeaderFallback] = useState(false);
  const [zcodePage, setZcodePage] = useState<ZcodePage>('other');
  const [controlsVisible, setControlsVisible] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const canSwitch = onSwitchMachine != null && (switchTargets?.length ?? 0) > 1;

  // Fallback watchdog: if Kimi ever ships new topbar class names and the
  // injected pill never attaches after first-paint, surface the native
  // statusPill so downloads/reload/back remain reachable and log diagnostics.
  useEffect(() => {
    if (!isKimi || kimiHeaderReady || cover !== 'hidden' || loadFailed || needsLogin) {
      if (kimiHeaderReady) setKimiHeaderFallback(false);
      return;
    }
    const timer = setTimeout(() => {
      setKimiHeaderFallback(true);
      logDiag('kimi-topbar-fallback');
    }, 3500);
    return () => clearTimeout(timer);
  }, [isKimi, kimiHeaderReady, cover, loadFailed, needsLogin]);

  // Close the switcher sheet whenever this console leaves the foreground.
  useEffect(() => {
    if (!foreground) {
      setSwitcherOpen(false);
    }
  }, [foreground]);

  // Push live theme changes to already-mounted keep-alive WebViews.
  useEffect(() => {
    if (isKimi) {
      webviewRef.current?.injectJavaScript(
        `window.__zshellUpdateKimiTheme?.(${JSON.stringify(colors.scheme)}, ${JSON.stringify(colors.consoleBg)}); true;`,
      );
    } else if (isZcode) {
      webviewRef.current?.injectJavaScript('window.__zshellSyncZcodeSkin?.(); true;');
    }
  }, [isKimi, isZcode, colors.scheme, colors.consoleBg]);

  const patchSource = useMemo(
    () =>
      (isKimi ? buildKimiThemePrelude(colors.scheme, kimiConsoleColors) : '') +
      buildPatchSource() +
      (isKimi ? '\n' + KIMI_TOPBAR_PATCH : '') +
      (isZcode ? '\n' + zcodeTopbarPatch : ''),
    [isKimi, isZcode, colors.scheme],
  );
  const statusDetails = useMemo(() => statusMeta(status, colors), [status, colors]);
  const pushKimiStatus = useCallback(() => {
    const reconnect = status === 'disconnected' || status === 'kicked';
    const value = JSON.stringify(
      reconnect
        ? {
            short: '重连',
            label: `${statusDetails.label}，点按重连`,
            color: statusDetails.color,
            reconnect: true,
            canSwitch,
          }
        : {
            short: statusDetails.short,
            label: statusDetails.label,
            color: statusDetails.color,
            canSwitch,
          },
    );
    webviewRef.current?.injectJavaScript(`window.__zshellUpdateKimiStatus?.(${value}); true;`);
  }, [status, statusDetails, canSwitch]);
  useEffect(() => {
    if (kimiHeaderReady) pushKimiStatus();
  }, [kimiHeaderReady, pushKimiStatus]);
  // ZCode: the merged topbar's status pill is fed the same way. When the
  // connection is dead the pill doubles as the reconnect button.
  const pushZcodeStatus = useCallback(() => {
    const reconnect = status === 'disconnected' || status === 'kicked';
    const value = JSON.stringify(
      reconnect
        ? {
            short: '重连',
            label: `${statusDetails.label}，点按重连`,
            color: statusDetails.color,
            reconnect: true,
            canSwitch,
          }
        : {
            short: statusDetails.short,
            label: statusDetails.label,
            color: statusDetails.color,
            canSwitch,
          },
    );
    webviewRef.current?.injectJavaScript(`window.__zshellUpdateZcodeStatus?.(${value}); true;`);
  }, [status, statusDetails, canSwitch]);
  useEffect(() => {
    if (zcodePage === 'chat') pushZcodeStatus();
  }, [zcodePage, pushZcodeStatus]);
  // Notification ids must not collide across simultaneously-alive console
  // sessions or reserved app ids (5=update, 6=stalled, 7=paused): offset >= 10.
  const notifyIdBase = useMemo(
    () => ((machine.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 399) + 1) * 10,
    [machine.id],
  );

  useEffect(() => {
    prefsRef.current = loadPrefs();
  }, [foreground]);

  const notify = useCallback(
    (
      id: number,
      kind: 'approval' | 'security' | 'info',
      title: string,
      body: string,
    ) => {
      const prefs = loadPrefs();
      prefsRef.current = prefs;
      if (!prefs.notificationsEnabled || machine.muted || notifications == null) {
        return;
      }
      if (kind === 'info' && prefs.quietHours.enabled) {
        const now = new Date();
        const start = parseClock(prefs.quietHours.start);
        const end = parseClock(prefs.quietHours.end);
        if (
          start != null &&
          end != null &&
          withinQuietHours(now.getHours() * 60 + now.getMinutes(), start, end)
        ) {
          return; // quiet hours mute informational pings only
        }
      }
      notifications.notify(id, title, body);
    },
    [machine.muted],
  );

  const diagDetail = (event: ConsoleEvent): string | undefined => {
    const d = event.detail;
    if (d == null || typeof d !== 'object') {
      return undefined;
    }
    const text = JSON.stringify(d);
    return text.length > 60 ? text.slice(0, 60) + '…' : text;
  };

  const brand = hostLabel(machine.credentials);
  // Kimi Code 登录用 window.open 新开 auth.kimi.com 授权页，授权完成后
  // 原（登录）页面轮询拿到 token 并跳回设备页。壳用覆盖层模拟这个弹窗：
  // 主窗口保留登录页继续轮询，授权页叠在上层；主窗口离开 /login 时覆盖
  // 层自动收起。不能丢给系统浏览器——登录态会落进浏览器的 Cookie 存储，
  // 壳里永远未登录。
  const [authWindowUrl, setAuthWindowUrl] = useState<string | null>(null);
  const [authCurrentHost, setAuthCurrentHost] = useState('');
  const [authCanGoBack, setAuthCanGoBack] = useState(false);
  const [authLoadProgress, setAuthLoadProgress] = useState(0);
  const closeAuthOverlay = useCallback(() => {
    setAuthWindowUrl(null);
    setAuthCurrentHost('');
    setAuthCanGoBack(false);
    setAuthLoadProgress(0);
  }, []);
  const authWebSource = useMemo(
    () => (authWindowUrl != null ? {uri: authWindowUrl} : null),
    [authWindowUrl],
  );
  const authPatchSource = useMemo(() => buildPatchSource(), []);
  // The bridge handler is created once per machine; menu items reach the
  // latest reload through a ref so the callback identity stays stable.
  const reloadRef = useRef<(mode?: 'current-page') => void>(() => {});
  // Web-history back, shared by the system back handler and the merged ZCode
  // topbar's ‹ button (web back is distinct from back-to-list).
  const handleWebBack = useCallback(() => {
    if (canGoBackRef.current && webviewRef.current != null) {
      webviewRef.current.goBack();
      return true;
    }
    return false;
  }, []);
  const handleBridgeMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const data = event.nativeEvent.data;
      const host = httpsHostOf(event.nativeEvent.url);
      const kimiPage = isKimi && KIMI_CONSOLE_HOST_RE.test(host);
      const zcodeConsole = isZcode && ZCODE_CONSOLE_HOST_RE.test(host);
      // Only trusted HTTPS official console origins may talk to the native bridge.
      if (!kimiPage && !zcodeConsole) {
        return;
      }
      if (data === 'zshell:topbar-activity-ready') {
        syncTopbarActivity(foreground && AppState.currentState === 'active');
        return;
      }
      if (data === 'zshell:first-paint') {
        attempt.current.firstPaintAt ??= performance.now();
        logDiag('first-paint');
        setLoadFailed(false);
        setCover('hidden');
        return;
      }
      if (kimiPage) {
        if (data === 'zshell:kimi-header-on' || data === 'zshell:kimi-header-off') {
          const ready = data === 'zshell:kimi-header-on';
          setKimiHeaderReady(ready);
          if (ready) {
            setKimiHeaderFallback(false);
            pushKimiStatus();
          } else {
            setControlsVisible(false);
          }
          return;
        }
        if (data.startsWith('zshell:kimi-theme:')) {
          // Document-start theme pin from buildKimiThemePrelude.
          logDiag('kimi-theme-pin', data.slice('zshell:kimi-theme:'.length));
          return;
        }
        if (data === 'zshell:kimi-menu') {
          if (foreground) setControlsVisible(visible => !visible);
          return;
        }
        if (data === 'zshell:kimi-back') {
          if (!foreground) return;
          setControlsVisible(false);
          onBack();
          return;
        }
        if (data === 'zshell:kimi-switch') {
          if (!foreground || !canSwitch) return;
          setControlsVisible(false);
          setSwitcherOpen(true);
          return;
        }
        if (data === 'zshell:kimi-downloads') {
          if (!foreground) return;
          setControlsVisible(false);
          onOpenDownloads();
          return;
        }
        if (data === 'zshell:kimi-reload') {
          if (!foreground) return;
          reloadRef.current('current-page');
          return;
        }
        if (data === 'zshell:kimi-reconnect') {
          if (!foreground) return;
          reloadRef.current();
          return;
        }
      }
      if (zcodeConsole) {
        if (data === 'zshell:zcode-header-on' || data === 'zshell:zcode-header-off') {
          const ready = data === 'zshell:zcode-header-on';
          setZcodePage(ready ? 'chat' : 'other');
          if (ready) {
            pushZcodeStatus();
          }
          return;
        }
        if (data.startsWith('zshell:zcode-topbar-miss:')) {
          logDiag('zcode-topbar-miss', data.slice('zshell:zcode-topbar-miss:'.length));
          return;
        }
        if (data === 'zshell:zcode-home') {
          setZcodePage('home');
          return;
        }
        if (data === 'zshell:zcode-webback') {
          if (!foreground) return;
          handleWebBack();
          return;
        }
        if (data === 'zshell:zcode-back') {
          if (!foreground) return;
          onBack();
          return;
        }
        if (data === 'zshell:zcode-switch') {
          if (!foreground || !canSwitch) return;
          setSwitcherOpen(true);
          return;
        }
        if (data === 'zshell:zcode-downloads') {
          if (!foreground) return;
          onOpenDownloads();
          return;
        }
        if (data === 'zshell:zcode-reload') {
          if (!foreground) return;
          reloadRef.current('current-page');
          return;
        }
        if (data === 'zshell:zcode-reconnect') {
          if (!foreground) return;
          reloadRef.current();
          return;
        }
      }
      const bridgeEvent = parseConsoleEvent(event.nativeEvent.data);
      if (bridgeEvent == null) {
        return;
      }
      logDiag(bridgeEvent.type, diagDetail(bridgeEvent));
      if (bridgeEvent.type === 'approval-waiting') {
        if (foreground && AppState.currentState === 'active') return;
        notify(notifyIdBase + 2, 'approval', `${brand} · 等待你的批准`, 'Agent 请求执行操作，点开应用处理');
        return;
      }
      const prev = statusRef.current;
      const next = deriveConsoleStatus(prev, bridgeEvent);
      if (next !== prev) {
        statusRef.current = next;
        setStatus(next);
        if (next === 'kicked') {
          notify(notifyIdBase + 3, 'security', '会话已在其他设备连接', '如需夺回请点开应用重连');
        } else if (next === 'disconnected' && prev === 'connected') {
          notify(notifyIdBase + 4, 'info', '连接已断开', '正在自动重连，可点开应用查看');
        }
      }
    },
    [notify, notifyIdBase, brand, isKimi, isZcode, foreground, canSwitch, pushKimiStatus, pushZcodeStatus, handleWebBack, onBack, onOpenDownloads, syncTopbarActivity],
  );

  const reload = useCallback((mode?: 'current-page', fromAutoCrash = false) => {
    logDiag('page-reload');
    if (crashRecoverTimerRef.current != null) {
      clearTimeout(crashRecoverTimerRef.current);
      crashRecoverTimerRef.current = null;
    }
    if (!fromAutoCrash) {
      crashCountRef.current = 0;
    }
    setRendererGone(false);
    attempt.current = {startedAt: performance.now()};
    setFailureReport('');
    setKimiHeaderReady(false);
    setKimiHeaderFallback(false);
    setZcodePage('other');
    statusRef.current = 'connecting';
    setStatus('connecting');
    setLoadFailed(false);
    setNeedsLogin(false);
    setControlsVisible(false);
    setSwitcherOpen(false);
    closeAuthOverlay();
    if (mode === 'current-page' && webviewRef.current) {
      // Keep the live renderer and refresh the current console document.
      setCover('reloading');
      return;
    }
    setCover('opening');
    canGoBackRef.current = false;
    setReloadKey(k => k + 1);
  }, [closeAuthOverlay]);
  reloadRef.current = reload;

  const loadFailedRef = useRef(false);
  loadFailedRef.current = loadFailed;

  useEffect(() => {
    logDiag('console-open', machine.name);
  }, [machine.name]);

  // Keep hidden sessions mounted for notifications. Recover a failed session
  // when its console becomes visible in the active app.
  useEffect(() => {
    if (!foreground) {
      syncTopbarActivity(false);
      return;
    }

    let active: boolean | undefined;
    const update = (state: AppStateStatus, fromAppState: boolean) => {
      const next = state === 'active';
      if (next === active) return;
      active = next;
      syncTopbarActivity(active);
      if (!active) {
        if (crashRecoverTimerRef.current != null) {
          clearTimeout(crashRecoverTimerRef.current);
          crashRecoverTimerRef.current = null;
        }
        return;
      }

      if (fromAppState) logDiag('app-active', statusRef.current);
      if (rendererGone) {
        if (crashCountRef.current <= MAX_RENDERER_AUTO_RECOVERIES) {
          const delay = crashCountRef.current * 1500;
          logDiag('auto-reload');
          if (crashRecoverTimerRef.current != null) {
            clearTimeout(crashRecoverTimerRef.current);
          }
          crashRecoverTimerRef.current = setTimeout(() => {
            crashRecoverTimerRef.current = null;
            reload(undefined, true);
          }, delay);
        } else {
          setLoadFailed(true);
          setCover('hidden');
        }
      } else if (statusRef.current === 'disconnected' || loadFailedRef.current) {
        logDiag('auto-reload');
        reload();
      }
    };
    const sub = AppState.addEventListener('change', state => update(state, true));
    update(AppState.currentState, false);
    return () => {
      sub.remove();
      if (crashRecoverTimerRef.current != null) {
        clearTimeout(crashRecoverTimerRef.current);
        crashRecoverTimerRef.current = null;
      }
    };
  }, [foreground, reload, rendererGone, syncTopbarActivity]);

  // Kimi Code 登录态观测：页面最终落在 /login = 未登录，留在 /devices/ = 已登录。
  // 注：必须用 onNavigationStateChange——本版本 onLoadEnd 事件在 Android
  // 上不带 url（undefined）。诊断只记布尔，不记 URL 内容（路径含设备标识）。
  const observeLoginState = useCallback((url: string) => {
    if (!isKimi) return;
    const login = observeKimiLogin(url);
    setNeedsLogin(login === 'logged-out');
    if (login === undefined) return;
    logDiag('login-observed', login);
    onLoginState?.(machine.id, login);
    if (login === 'logged-in') {
      closeAuthOverlay();
    }
  }, [isKimi, machine.id, onLoginState, closeAuthOverlay]);

  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    if (!foreground || AppState.currentState !== 'active') return;
    const target = event.nativeEvent.targetUrl;
    if (typeof target !== 'string' || !/^https:\/\//i.test(target)) return;
    const host = authHostOf(target);
    const httpsHost = httpsHostOf(target);
    if (!host || !httpsHost) return;
    logDiag('window-open', host);
    const isKimiAuthPopup = isKimi && /^auth\.kimi\.(?:com|ai)$/.test(httpsHost);
    const isZcodeAuthPopup =
      isZcode &&
      (ZCODE_AUTH_NAV_HOST_RE.test(httpsHost) || COMMON_OAUTH_HOST_RE.test(httpsHost));
    if (isKimiAuthPopup || isZcodeAuthPopup) {
      setAuthWindowUrl(target);
      setAuthCurrentHost(host);
      setAuthCanGoBack(false);
      setAuthLoadProgress(0.12);
    } else {
      openInBrowser(target).catch(() => Alert.alert('无法打开浏览器'));
    }
  }, [foreground, isKimi, isZcode]);

  const handleShouldStartMain = useCallback(
    (req: ShouldStartLoadRequest): boolean => {
      const target = req.url;
      if (target === 'about:blank') return true;
      const host = httpsHostOf(target);
      if (!host) {
        // Block non-HTTPS schemes (http:, file:, intent:, javascript:, data:).
        return false;
      }
      if (req.isTopFrame === false) {
        // Allow HTTPS subframes (e.g. login captcha widgets); native bridge
        // strictly enforces isMainFrame + console origin allowlist.
        return true;
      }
      const allowed = isKimi
        ? KIMI_MAIN_NAV_HOST_RE.test(host)
        : isZcode
          ? ZCODE_MAIN_NAV_HOST_RE.test(host)
          : false;
      if (allowed) {
        return true;
      }
      if (foreground && AppState.currentState === 'active') {
        openInBrowser(target).catch(() => Alert.alert('无法打开浏览器'));
      }
      return false;
    },
    [foreground, isKimi, isZcode],
  );

  const handleShouldStartAuth = useCallback(
    (req: ShouldStartLoadRequest): boolean => {
      const target = req.url;
      if (target === 'about:blank') return true;
      const host = httpsHostOf(target);
      if (!host) {
        return false;
      }
      if (req.isTopFrame === false) {
        return true;
      }
      const allowed = isKimi
        ? KIMI_AUTH_NAV_HOST_RE.test(host)
        : isZcode
          ? ZCODE_AUTH_NAV_HOST_RE.test(host)
          : false;
      if (allowed) {
        return true;
      }
      if (foreground && AppState.currentState === 'active') {
        openInBrowser(target).catch(() => Alert.alert('无法打开浏览器'));
      }
      return false;
    },
    [foreground, isKimi, isZcode],
  );

  useEffect(() => {
    registerBackHandler(handleWebBack);
    return () => registerBackHandler(null);
  }, [handleWebBack, registerBackHandler]);

  // Keep the footer height fixed so expanding its controls never resizes the WebView.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 5000);
  }, []);

  const renderFailure = (message: string, retry: () => void) => (
    <View style={styles.errorBox} accessibilityLiveRegion="polite">
      <View style={styles.errorCard}>
        <View style={styles.errorIconWrap}>
          <Icon name="info" size={24} color={colors.danger} />
        </View>
        <Text style={styles.noticeTitle}>{message}</Text>
        <Text style={[font.faint, {textAlign: 'center'}]}>{machine.name}</Text>
        <View style={styles.noticeActions}>
          <TouchableOpacity style={styles.secondaryPillButton} onPress={onBack} accessibilityRole="button">
            <Text style={styles.secondaryPillText}>返回列表</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.retryButton} onPress={retry} accessibilityRole="button">
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
        {failureReport !== '' && (
          <TouchableOpacity style={styles.diagCopyButton} accessibilityRole="button" onPress={() => {
            Clipboard.setString(failureReport);
            ToastAndroid.show('已复制本次诊断', ToastAndroid.SHORT);
          }}>
            <Text style={styles.diagCopyText}>复制本次诊断</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
  const connectionHint = needsLogin ? '请在上方登录 Kimi 账号' :
    status === 'waiting' ? statusDetails.label : undefined;
  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const showFooter = isKimi
    ? (kimiHeaderReady && controlsVisible) ||
      (kimiHeaderFallback && cover === 'hidden' && !needsLogin && !loadFailed)
    : isZcode
      ? shouldShowZcodeFooter(zcodePage, status, loadFailed)
      : true;

  return (
    <View style={styles.root}>
      {!rendererGone && <WebView<object>
        key={reloadKey}
        ref={webviewRef}
        source={webSource}
        injectedJavaScriptBeforeContentLoaded={patchSource}
        injectedJavaScript={
          FIRST_PAINT_PROBE +
          (isKimi ? KIMI_TOPBAR_PATCH : isZcode ? zcodeTopbarPatch : '') +
          '\ntrue;'
        }
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled={false}
        originWhitelist={['https://*', 'about:blank']}
        onShouldStartLoadWithRequest={handleShouldStartMain}
        style={styles.webview}
        containerStyle={styles.webview}
        // Kimi Code 登录（auth.kimi.com）经 window.open 发起，必须放行
        // 多窗口事件；官方授权页留在应用内，其余 HTTP(S) 链接外开。
        setSupportMultipleWindows
        javaScriptCanOpenWindowsAutomatically
        onOpenWindow={handleOpenWindow}
        // File downloads inside the console are handled by the webview's own
        // system-DownloadManager path; they land in 下载管理 (uid query).
        downloadingMessage="已开始下载，可在 设置 → 下载管理 查看"
        onNavigationStateChange={(nav: WebViewNavigation) => {
          canGoBackRef.current = nav.canGoBack;
          const url = typeof nav.url === 'string' ? nav.url : '';
          observeLoginState(url);
          // ZCode 合并顶栏的 ‹ 需要 canGoBack 决定置灰
          if (isZcode) {
            webviewRef.current?.injectJavaScript(
              `window.__zshellUpdateZcodeNav?.({canGoBack:${nav.canGoBack ? 'true' : 'false'}}); true;`,
            );
          }
        }}
        onLoadStart={() => {
          attempt.current.loadStartedAt ??= performance.now();
          logDiag('page-load-start');
        }}
        onError={(e: WebViewErrorEvent) => {
          const {code} = e.nativeEvent;
          recordFailure({kind: 'load-error', code});
          setLoadFailed(true);
          setCover('hidden');
          logDiag('load-error', Number.isSafeInteger(code) ? String(code) : undefined);
        }}
        // Dispose of the dead native view even when its console is hidden.
        onRenderProcessGone={() => {
          const now = Date.now();
          if (now - lastCrashAtRef.current > RENDERER_CRASH_WINDOW_MS) {
            crashCountRef.current = 0;
          }
          crashCountRef.current += 1;
          lastCrashAtRef.current = now;
          recordFailure({kind: 'load-error', code: -1});
          setRendererGone(true);
        }}
        onMessage={handleBridgeMessage}
        renderError={() => <View />}
      />}

      {cover === 'hidden' && !loadFailed && connectionHint && (
        <View style={styles.connectionHint} accessibilityLiveRegion="polite">
          <Text style={[font.dim, styles.hintText]}>{connectionHint}</Text>
          <TouchableOpacity style={styles.hintAction} onPress={onBack} accessibilityRole="button">
            <Text style={styles.backText}>返回列表</Text>
          </TouchableOpacity>
        </View>
      )}

      {showFooter ? (
      <View style={[styles.consoleFooter, kimiHeaderReady && styles.kimiMenu]}>
        {controlsVisible ? (
          <View style={styles.controlBar}>
            <TouchableOpacity onPress={onBack} style={styles.backButton} accessibilityRole="button">
              <Icon name="chevron-left" size={16} color={colors.accent} />
              <Text style={styles.backText}>列表</Text>
            </TouchableOpacity>
            <View style={[styles.statusDot, {backgroundColor: statusDetails.color}]} />
            <Text style={styles.title} numberOfLines={1}>
              {machine.name}
            </Text>
            {canSwitch ? (
              <TouchableOpacity
                onPress={() => {
                  setControlsVisible(false);
                  setSwitcherOpen(true);
                }}
                style={styles.reloadButton}>
                <Text style={styles.reloadText}>切机</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => {
                showControls();
                onOpenDownloads();
              }}
              style={styles.reloadButton}>
              <Text style={styles.reloadText}>下载</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                showControls();
                reload();
              }}
              style={styles.reloadButton}>
              <Text style={styles.reloadText}>重连</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.statusPill}
            onPress={showControls}
            accessibilityRole="button"
            accessibilityLabel={`${statusDetails.label}，展开控制台操作`}
            activeOpacity={0.8}>
            <View style={[styles.statusDot, {backgroundColor: statusDetails.color}]} />
            <Text style={styles.pillText}>{statusDetails.label}</Text>
          </TouchableOpacity>
        )}
      </View>
      ) : null}

      {(cover === 'opening' || cover === 'reloading') && !loadFailed && (
        <View style={styles.paintCover} accessibilityLiveRegion="polite">
          <View style={styles.coverBadge}>
            <Icon name="terminal" size={26} color={colors.accent} />
          </View>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.noticeTitle}>
            {cover === 'reloading' ? '正在重新加载控制台' : '正在加载控制台'}
          </Text>
          <Text style={font.faint}>{machine.name}</Text>
          <TouchableOpacity style={styles.secondaryPillButton} onPress={onBack} accessibilityRole="button">
            <Text style={styles.secondaryPillText}>返回列表</Text>
          </TouchableOpacity>
        </View>
      )}
      {(loadFailed || cover === 'load-timeout' || cover === 'reload-timeout') && (
        <View style={StyleSheet.absoluteFill}>
          {renderFailure(
            loadFailed ? '控制台加载失败' : cover === 'reload-timeout' ? '控制台重新加载超时' : '控制台加载超时',
            () => reload(!loadFailed && cover === 'reload-timeout' ? 'current-page' : undefined),
          )}
        </View>
      )}

      {authWindowUrl != null && authWebSource != null && (
        <View style={styles.authOverlay}>
          <View style={styles.authBar}>
            <TouchableOpacity
              style={[styles.authIconBtn, !authCanGoBack && styles.authIconDisabled]}
              disabled={!authCanGoBack}
              accessibilityRole="button"
              accessibilityLabel="授权页返回上一页"
              onPress={() => authWebViewRef.current?.goBack()}>
              <Icon name="chevron-left" size={18} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.authTitle} numberOfLines={1}>
              {authCurrentHost || authHostOf(authWindowUrl)} · 授权登录
            </Text>
            <TouchableOpacity
              style={styles.authIconBtn}
              accessibilityRole="button"
              accessibilityLabel="关闭授权页"
              onPress={closeAuthOverlay}>
              <Icon name="close" size={17} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          {authLoadProgress > 0 && authLoadProgress < 1 ? (
            <View style={styles.authProgressTrack}>
              <View
                style={[
                  styles.authProgressFill,
                  {width: `${Math.max(8, Math.round(authLoadProgress * 100))}%`},
                ]}
              />
            </View>
          ) : null}
          <WebView<object>
            ref={authWebViewRef}
            source={authWebSource}
            injectedJavaScriptBeforeContentLoaded={authPatchSource}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled={false}
            originWhitelist={['https://*', 'about:blank']}
            onShouldStartLoadWithRequest={handleShouldStartAuth}
            onLoadProgress={({nativeEvent}) => {
              setAuthLoadProgress(nativeEvent.progress);
            }}
            onNavigationStateChange={(nav: WebViewNavigation) => {
              const h = typeof nav.url === 'string' ? authHostOf(nav.url) : '';
              if (h) setAuthCurrentHost(h);
              setAuthCanGoBack(Boolean(nav.canGoBack));
            }}
            style={styles.webview}
            setSupportMultipleWindows
            javaScriptCanOpenWindowsAutomatically
            onOpenWindow={handleOpenWindow}
          />
        </View>
      )}

      <BottomSheet visible={foreground && switcherOpen} onClose={() => setSwitcherOpen(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>切换机器</Text>
          <TouchableOpacity
            style={styles.authIconBtn}
            onPress={() => setSwitcherOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭切换机器">
            <Icon name="close" size={17} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <View style={styles.switchList}>
          {(switchTargets ?? []).map(target => {
            const isCurrent = target.id === machine.id;
            return (
              <TouchableOpacity
                key={target.id}
                style={[styles.switchRow, isCurrent && styles.switchRowCurrent]}
                activeOpacity={0.8}
                onPress={() => {
                  setSwitcherOpen(false);
                  if (!isCurrent) {
                    onSwitchMachine?.(target.id);
                  }
                }}>
                <View
                  style={[
                    styles.switchBadge,
                    {backgroundColor: target.kind === 'kimi' ? colors.iconBadgeBg : colors.zcodeBadgeBg},
                  ]}>
                  <Icon
                    name="terminal"
                    size={17}
                    color={target.kind === 'kimi' ? colors.accent : colors.textDim}
                  />
                </View>
                <View style={{flex: 1, gap: 2}}>
                  <Text style={styles.switchName} numberOfLines={1}>
                    {target.name}
                  </Text>
                  <Text style={font.faint}>
                    {target.kind === 'kimi' ? 'Kimi Code' : 'ZCode'}
                  </Text>
                </View>
                {target.active ? (
                  <View style={styles.switchLive}>
                    <View style={styles.switchLiveDot} />
                    <Text style={styles.switchLiveText}>运行中</Text>
                  </View>
                ) : null}
                {isCurrent ? (
                  <View style={styles.currentPill}>
                    <Text style={styles.currentPillText}>当前</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

const useStyles = makeStyles((colors, font) => ({
  root: {flex: 1, backgroundColor: colors.consoleBg},
  consoleFooter: {
    height: 46,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: colors.consoleBg,
  },
  kimiMenu: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    borderRadius: radius.l,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: 6,
  },
  controlBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    alignSelf: 'flex-start',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgElevatedOverlay,
    borderRadius: radius.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  pillText: {...font.pill, color: colors.textDim},
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  backText: {color: colors.accent, fontSize: 14, fontWeight: '500'},
  title: {...font.body, fontWeight: '600', flex: 1, textAlign: 'center'},
  reloadButton: {paddingHorizontal: 10, paddingVertical: 6},
  reloadText: {color: colors.accent, fontSize: 14, fontWeight: '500'},
  statusDot: {width: 7, height: 7, borderRadius: 4},
  webview: {flex: 1, backgroundColor: colors.consoleBg},
  paintCover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: colors.consoleBg,
  },
  coverBadge: {
    width: 56,
    height: 56,
    borderRadius: 17,
    backgroundColor: colors.iconBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  noticeTitle: {fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center'},
  noticeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 6,
  },
  connectionHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  hintText: {flex: 1},
  hintAction: {paddingHorizontal: 10, paddingVertical: 6},
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.bg,
  },
  errorCard: {
    width: '100%',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  errorIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  retryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 26,
    paddingVertical: 11,
    borderRadius: radius.s,
  },
  retryText: {color: colors.onAccent, fontSize: 14, fontWeight: '600'},
  secondaryPillButton: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: radius.s,
  },
  secondaryPillText: {color: colors.text, fontSize: 14, fontWeight: '500'},
  diagCopyButton: {paddingHorizontal: 14, paddingVertical: 6, marginTop: 2},
  diagCopyText: {color: colors.accent, fontSize: 13, fontWeight: '500'},
  authOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    elevation: 10,
  },
  authBar: {
    height: 56,
    backgroundColor: colors.bgElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  authTitle: {...font.body, flex: 1, textAlign: 'center', fontWeight: '600'},
  authIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgInput,
  },
  authIconDisabled: {opacity: 0.35},
  authProgressTrack: {
    height: 2,
    backgroundColor: colors.bgInput,
    overflow: 'hidden',
  },
  authProgressFill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  switchList: {
    gap: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bgInput,
    borderRadius: radius.l,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchRowCurrent: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  switchBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  switchLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  switchLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  switchLiveText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  currentPill: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.s,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  currentPillText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
}));
