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
const KIMI_MAIN_NAV_HOST_RE = /^(?:(?:code-rc|auth|www)\.)?kimi\.(?:com|ai)$|^(?:[a-z0-9-]+\.)?moonshot\.cn$/;
const ZCODE_MAIN_NAV_HOST_RE = /^(?:[a-z0-9-]+\.)?(?:z\.ai|chatglm\.site|chatglm\.cn|bigmodel\.cn|zhipuai\.cn)$/;
const KIMI_AUTH_NAV_HOST_RE = /^(?:[a-z0-9-]+\.)?(?:kimi\.com|kimi\.ai|moonshot\.cn)$|^accounts\.google\.com$|^appleid\.apple\.com$|^open\.weixin\.qq\.com$/;

const MAX_RENDERER_AUTO_RECOVERIES = 2;
const RENDERER_CRASH_WINDOW_MS = 60_000;

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
}

/**
 * The official remote console in a WebView. The document-start patch bundle
 * (matchMedia fix etc.) is injected before any page script runs; everything
 * else — relay WSS, pairing handshake — is done by the official page itself.
 */
export function ConsoleScreen({machine, foreground, onBack, registerBackHandler, onOpenDownloads, onLoginState}: ConsoleScreenProps) {
  const {colors, font} = useTheme();
  const styles = useStyles();
  const webviewRef = useRef<WebView<object>>(null);
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
  // 表面一直显示初始白色缓冲；0.0.1.23 的 warm-up 页方案依赖"已绘制帧
  // 跨导航保留"，在默认渲染后端下不成立（验收通过时设备残留强制 GL 实验
  // 旗标），还会把 data: 页留在 WebView 历史里（侧滑返回多出白色中间页）。
  // 原生遮罩由 App 进程合成，与 WebView 后端无关；首帧信号或 15s 兜底后撤除。
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
  const [zcodePage, setZcodePage] = useState<ZcodePage>('other');
  const [controlsVisible, setControlsVisible] = useState(false);
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
    const value = JSON.stringify({
      short: statusDetails.short,
      label: statusDetails.label,
      color: statusDetails.color,
    });
    webviewRef.current?.injectJavaScript(`window.__zshellUpdateKimiStatus?.(${value}); true;`);
  }, [statusDetails]);
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
          }
        : {
            short: statusDetails.short,
            label: statusDetails.label,
            color: statusDetails.color,
          },
    );
    webviewRef.current?.injectJavaScript(`window.__zshellUpdateZcodeStatus?.(${value}); true;`);
  }, [status, statusDetails]);
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
          if (ready) pushKimiStatus();
          else setControlsVisible(false);
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
    [notify, notifyIdBase, brand, isKimi, isZcode, foreground, pushKimiStatus, pushZcodeStatus, handleWebBack, onBack, onOpenDownloads, syncTopbarActivity],
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
    setZcodePage('other');
    statusRef.current = 'connecting';
    setStatus('connecting');
    setLoadFailed(false);
    setNeedsLogin(false);
    setControlsVisible(false);
    // A full page load cannot complete an OAuth popup started earlier; leaving
    // the overlay up would cover the reloaded console forever.
    setAuthWindowUrl(null);
    setAuthCurrentHost('');
    if (mode === 'current-page' && webviewRef.current) {
      // Keep the live renderer and refresh the current console document.
      setCover('reloading');
      return;
    }
    setCover('opening');
    canGoBackRef.current = false;
    setReloadKey(k => k + 1);
  }, []);
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
      if (!active) return;

      if (fromAppState) logDiag('app-active', statusRef.current);
      if (rendererGone) {
        if (crashCountRef.current <= MAX_RENDERER_AUTO_RECOVERIES) {
          const delay = crashCountRef.current * 1500;
          logDiag('auto-reload');
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
      setAuthWindowUrl(null);
      setAuthCurrentHost('');
    }
  }, [isKimi, machine.id, onLoginState]);

  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    if (!foreground || AppState.currentState !== 'active') return;
    const target = event.nativeEvent.targetUrl;
    if (typeof target !== 'string' || !/^https:\/\//i.test(target)) return;
    const host = authHostOf(target);
    if (!host) return;
    logDiag('window-open', host);
    if (isKimi && /^https:\/\/auth\.kimi\.com(?::443)?(?:[/?#]|$)/i.test(target)) {
      setAuthWindowUrl(target);
      setAuthCurrentHost(host);
    } else {
      openInBrowser(target).catch(() => Alert.alert('无法打开浏览器'));
    }
  }, [foreground, isKimi]);

  const handleShouldStartMain = useCallback(
    (req: ShouldStartLoadRequest): boolean => {
      const target = req.url;
      if (target === 'about:blank') return true;
      const host = httpsHostOf(target);
      if (!host) {
        // Block non-HTTPS schemes (http:, file:, intent:, javascript:, data:).
        return false;
      }
      const allowed = isKimi
        ? KIMI_MAIN_NAV_HOST_RE.test(host)
        : isZcode
          ? ZCODE_MAIN_NAV_HOST_RE.test(host)
          : false;
      if (allowed) {
        return true;
      }
      if (req.isTopFrame === false) {
        // Block untrusted third-party subframes inside the console WebView.
        return false;
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
      if (KIMI_AUTH_NAV_HOST_RE.test(host)) {
        return true;
      }
      if (req.isTopFrame === false) {
        return false;
      }
      if (foreground && AppState.currentState === 'active') {
        openInBrowser(target).catch(() => Alert.alert('无法打开浏览器'));
      }
      return false;
    },
    [foreground],
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
      <Text style={styles.noticeTitle}>{message}</Text>
      <View style={styles.noticeActions}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button">
          <Text style={styles.backText}>返回列表</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.retryButton} onPress={retry} accessibilityRole="button">
          <Text style={styles.retryText}>重试</Text>
        </TouchableOpacity>
      </View>
      {failureReport !== '' && (
        <TouchableOpacity style={styles.backButton} accessibilityRole="button" onPress={() => {
          Clipboard.setString(failureReport);
          ToastAndroid.show('已复制本次诊断', ToastAndroid.SHORT);
        }}>
          <Text style={styles.backText}>复制本次诊断</Text>
        </TouchableOpacity>
      )}
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
        originWhitelist={['https://*']}
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
          <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button">
            <Text style={styles.backText}>返回列表</Text>
          </TouchableOpacity>
        </View>
      )}

      {(isKimi
        ? kimiHeaderReady && controlsVisible
        : isZcode
          ? shouldShowZcodeFooter(zcodePage, status, loadFailed)
          : true) ? (
      <View style={[styles.consoleFooter, kimiHeaderReady && styles.kimiMenu]}>
        {controlsVisible ? (
          <View style={styles.controlBar}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>‹ 返回列表</Text>
            </TouchableOpacity>
            <View style={[styles.statusDot, {backgroundColor: statusDetails.color}]} />
            <Text style={styles.title} numberOfLines={1}>
              {machine.name}
            </Text>
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
          <ActivityIndicator color={colors.textDim} />
          <Text style={styles.noticeTitle}>
            {cover === 'reloading' ? '正在重新加载控制台' : '正在加载控制台'}
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button">
            <Text style={styles.backText}>返回列表</Text>
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

      {authWindowUrl != null && (
        <View style={styles.authOverlay}>
          <View style={styles.authBar}>
            <View style={styles.authSide} />
            <Text style={styles.authTitle} numberOfLines={1}>
              {authCurrentHost || authHostOf(authWindowUrl)} · 授权登录
            </Text>
            <TouchableOpacity
              style={styles.authClose}
              accessibilityRole="button"
              accessibilityLabel="关闭授权页"
              onPress={() => {
                setAuthWindowUrl(null);
                setAuthCurrentHost('');
              }}>
              <Text style={styles.authCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <WebView<object>
            source={{uri: authWindowUrl}}
            injectedJavaScriptBeforeContentLoaded={buildPatchSource()}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled={false}
            originWhitelist={['https://*']}
            onShouldStartLoadWithRequest={handleShouldStartAuth}
            onNavigationStateChange={(nav: WebViewNavigation) => {
              const h = typeof nav.url === 'string' ? authHostOf(nav.url) : '';
              if (h) setAuthCurrentHost(h);
            }}
            style={styles.webview}
            setSupportMultipleWindows
            javaScriptCanOpenWindowsAutomatically
            onOpenWindow={handleOpenWindow}
          />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors, font) => ({
  root: {flex: 1, backgroundColor: colors.consoleBg},
  consoleFooter: {
    height: 44,
    paddingHorizontal: 8,
    justifyContent: 'center',
    backgroundColor: colors.consoleBg,
  },
  kimiMenu: {
    position: 'absolute',
    top: 48,
    left: 8,
    right: 8,
    borderRadius: radius.m,
    backgroundColor: colors.bgElevated,
    elevation: 4,
    shadowColor: colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
  },
  controlBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusPill: {
    alignSelf: 'flex-start',
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgElevatedOverlay,
    borderRadius: radius.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {...font.pill, color: colors.textDim},
  backButton: {paddingHorizontal: 10, paddingVertical: 8},
  backText: {color: colors.accent, fontSize: 15},
  title: {...font.body, flex: 1, textAlign: 'center'},
  reloadButton: {paddingHorizontal: 12, paddingVertical: 8},
  reloadText: {color: colors.accent, fontSize: 14},
  statusDot: {width: 8, height: 8, borderRadius: 4},
  webview: {flex: 1, backgroundColor: colors.consoleBg},
  paintCover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: colors.consoleBg,
  },
  noticeTitle: {...font.body, textAlign: 'center'},
  noticeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  connectionHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  hintText: {flex: 1},
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
    backgroundColor: colors.bg,
  },
  retryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 28,
    paddingVertical: 11,
    borderRadius: radius.m,
  },
  retryText: {color: colors.onAccent, fontSize: 15, fontWeight: '600'},
  authOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    elevation: 10,
  },
  authBar: {
    height: 52,
    backgroundColor: colors.bgElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  authTitle: {...font.body, flex: 1, textAlign: 'center', fontWeight: '600'},
  authSide: {width: 40},
  authClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgInput,
  },
  authCloseText: {color: colors.textDim, fontSize: 16},
}));
