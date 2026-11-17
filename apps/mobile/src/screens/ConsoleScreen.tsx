import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  WebView,
  WebViewErrorEvent,
  WebViewNavigation,
  WebViewMessageEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview';
import {
  buildConsoleUrl,
  ConsoleEvent,
  ConsoleStatus,
  deriveConsoleStatus,
  hostLabel,
  MachineLoginState,
  MachineRecord,
  parseClock,
  parseConsoleEvent,
  withinQuietHours,
} from '@zshell/core-shell';
import {buildPatchSource} from '@zshell/patch-bundle';
import {KIMI_TOPBAR_PATCH} from '../kimiTopbar';
import {logDiag} from '../diagnostics';
import {loadPrefs, notifications} from '../notifications';
import {makeStyles, Palette, radius, useTheme} from '../theme';

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
  onLoginState?: (state: MachineLoginState) => void;
}

/**
 * The official remote console in a WebView. The document-start patch bundle
 * (matchMedia fix etc.) is injected before any page script runs; everything
 * else — relay WSS, pairing handshake — is done by the official page itself.
 */
export function ConsoleScreen({machine, foreground, onBack, registerBackHandler, onOpenDownloads, onLoginState}: ConsoleScreenProps) {
  const {colors, font} = useTheme();
  const styles = useStyles();
  const webviewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<ConsoleStatus>('connecting');
  // True while the WebView's own load has failed (error page visible).
  const [loadFailed, setLoadFailed] = useState(false);
  const prefsRef = useRef(loadPrefs());
  const url = useMemo(() => buildConsoleUrl(machine.credentials), [machine.credentials]);
  // The WebView source must stay referentially stable: with keep-alive the
  // console stays mounted while App re-renders (registry copies make the
  // machine prop a fresh object each time), and a new source object would
  // reload the page. Intentional reloads go through key={reloadKey}.
  const webSource = useMemo(() => ({uri: url}), [url]);
  const isKimi = machine.credentials.kind === 'kimi';
  const [kimiHeaderReady, setKimiHeaderReady] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const patchSource = useMemo(() => buildPatchSource() + (isKimi ? '\n' + KIMI_TOPBAR_PATCH : ''), [isKimi]);
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
  // Notification ids must not collide across simultaneously-alive console
  // sessions: offset by a stable hash of the machine id.
  const notifyIdBase = useMemo(
    () => (machine.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 400) * 10,
    [machine.id],
  );

  useEffect(() => {
    prefsRef.current = loadPrefs();
  }, []);

  const notify = useCallback(
    (
      id: number,
      kind: 'approval' | 'security' | 'info',
      title: string,
      body: string,
    ) => {
      const prefs = prefsRef.current;
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
  // The bridge handler is created once per machine; menu items reach the
  // latest reload through a ref so the callback identity stays stable.
  const reloadRef = useRef<() => void>(() => {});
  const handleBridgeMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const data = event.nativeEvent.data;
      if (isKimi && /^code-rc\.kimi\.(com|ai)$/.test(authHostOf(event.nativeEvent.url))) {
        if (data === 'zshell:kimi-header-on' || data === 'zshell:kimi-header-off') {
          const ready = data === 'zshell:kimi-header-on';
          setKimiHeaderReady(ready);
          if (ready) pushKimiStatus();
          else setControlsVisible(false);
          return;
        }
        if (data === 'zshell:kimi-menu') {
          if (foreground) setControlsVisible(visible => !visible);
          return;
        }
        if (data === 'zshell:kimi-back') {
          setControlsVisible(false);
          onBack();
          return;
        }
        if (data === 'zshell:kimi-downloads') {
          setControlsVisible(false);
          onOpenDownloads();
          return;
        }
        if (data === 'zshell:kimi-reload') {
          setControlsVisible(false);
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
        notify(notifyIdBase + 2, 'approval', `${brand} · 等待你的批准`, 'Agent 请求执行操作，点开应用处理');
        return;
      }
      setStatus(prev => {
        const next = deriveConsoleStatus(prev, bridgeEvent);
        if (next !== prev) {
          if (next === 'kicked') {
            notify(notifyIdBase + 3, 'security', '会话已在其他设备连接', '如需夺回请点开应用重连');
          } else if (next === 'disconnected' && prev === 'connected') {
            notify(notifyIdBase + 4, 'info', '连接已断开', '正在自动重连，可点开应用查看');
          }
        }
        return next;
      });
    },
    [notify, brand, isKimi, foreground, pushKimiStatus, onBack, onOpenDownloads],
  );

  const reload = useCallback(() => {
    logDiag('page-reload');
    setKimiHeaderReady(false);
    setStatus('connecting');
    setLoadFailed(false);
    setControlsVisible(false);
    // A full page load cannot complete an OAuth popup started earlier; leaving
    // the overlay up would cover the reloaded console forever.
    setAuthWindowUrl(null);
    canGoBackRef.current = false;
    setReloadKey(k => k + 1);
  }, []);
  reloadRef.current = reload;

  const statusRef = useRef<ConsoleStatus>('connecting');
  statusRef.current = status;
  const loadFailedRef = useRef(false);
  loadFailedRef.current = loadFailed;

  useEffect(() => {
    logDiag('console-open', machine.name);
  }, [machine.name]);

  // Returning to the foreground with a dead connection or a failed page load
  // reloads right away — the OS often kills the WebView renderer in the
  // background, and the resume-time reload can hit a network that is not
  // ready yet (error -1). Retrying automatically once the app is actually
  // visible fixes both instead of leaving a dead error page.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        return;
      }
      logDiag('app-active', statusRef.current);
      if (statusRef.current === 'disconnected' || loadFailedRef.current) {
        logDiag('auto-reload');
        reload();
      }
    });
    return () => sub.remove();
  }, [reload]);

  // Kimi Code 登录态观测：页面最终落在 /login = 未登录，留在 /devices/ = 已登录。
  // 注：必须用 onNavigationStateChange——本版本 onLoadEnd 事件在 Android
  // 上不带 url（undefined）。诊断只记布尔，不记 URL 内容（路径含设备标识）。
  const observeLoginState = useCallback(
    (url: string) => {
      if (machine.credentials.kind !== 'kimi' || url.length === 0) {
        return;
      }
      logDiag(
        'login-observed',
        `l:${url.includes('/login')} d:${url.includes('/devices/')}`,
      );
      if (url.includes('/login')) {
        onLoginState?.('logged-out');
      } else if (url.includes('/devices/')) {
        onLoginState?.('logged-in');
      }
    },
    [machine.credentials.kind, onLoginState],
  );

  const handleWebBack = useCallback(() => {
    if (canGoBackRef.current && webviewRef.current != null) {
      webviewRef.current.goBack();
      return true;
    }
    return false;
  }, []);

  const handleOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const target = event.nativeEvent.targetUrl;
    if (typeof target !== 'string' || !target.startsWith('https://')) {
      return;
    }
    // 诊断只记主机名——事件不得携带 URL / 凭据
    try {
      logDiag('window-open', new URL(target).host);
    } catch {
      logDiag('window-open');
    }
    setAuthWindowUrl(target);
  }, []);

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
  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return (
    <View style={styles.root}>
      <WebView
        key={reloadKey}
        ref={webviewRef}
        source={webSource}
        injectedJavaScriptBeforeContentLoaded={patchSource}
        injectedJavaScript={isKimi ? KIMI_TOPBAR_PATCH + '\ntrue;' : undefined}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled={false}
        originWhitelist={['*']}
        style={styles.webview}
        containerStyle={styles.webview}
        // Kimi Code 登录（auth.kimi.com）经 window.open 发起，必须放行
        // 多窗口事件；onOpenWindow 把目标页导航回同一个 WebView。
        setSupportMultipleWindows
        javaScriptCanOpenWindowsAutomatically
        onOpenWindow={handleOpenWindow}
        // File downloads inside the console are handled by the webview's own
        // system-DownloadManager path; they land in 下载管理 (uid query).
        downloadingMessage="已开始下载，可在 设置 → 下载管理 查看"
        onNavigationStateChange={(nav: WebViewNavigation) => {
          canGoBackRef.current = nav.canGoBack;
          const url = typeof nav.url === 'string' ? nav.url : '';
          // 登录完成后原页面跳回设备页——授权覆盖层随之收起
          if (url.includes('/devices/')) {
            setAuthWindowUrl(null);
          }
          observeLoginState(url);
        }}
        onLoadStart={() => {
          setLoadFailed(false);
          logDiag('page-load-start');
        }}
        onError={(e: WebViewErrorEvent) => {
          setLoadFailed(true);
          const desc = e.nativeEvent.description ?? '';
          logDiag('load-error', desc.slice(0, 60));
        }}
        // The OS may kill the WebView renderer while backgrounded; rebuild
        // the page instead of leaving a dead surface.
        onRenderProcessGone={() => reload()}
        onMessage={handleBridgeMessage}
        renderError={() => (
          <View style={styles.errorBox}>
            <Text style={font.dim}>控制台加载失败，多半是网络未就绪或连接中断</Text>
            <Text style={font.faint}>回到前台会自动重试，也可以现在手动重试</Text>
            <TouchableOpacity style={styles.retryButton} onPress={reload}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {!isKimi || (kimiHeaderReady && controlsVisible) ? (
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

      {authWindowUrl != null && (
        <View style={styles.authOverlay}>
          <View style={styles.authBar}>
            <View style={styles.authSide} />
            <Text style={styles.authTitle} numberOfLines={1}>
              {authHostOf(authWindowUrl)} · 授权登录
            </Text>
            <TouchableOpacity
              style={styles.authClose}
              accessibilityRole="button"
              accessibilityLabel="关闭授权页"
              onPress={() => setAuthWindowUrl(null)}>
              <Text style={styles.authCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <WebView
            source={{uri: authWindowUrl}}
            injectedJavaScriptBeforeContentLoaded={buildPatchSource()}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled={false}
            originWhitelist={['*']}
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
    shadowColor: '#000',
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
    marginTop: 4,
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
