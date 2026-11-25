/**
 * KShell — remote-control mobile shell for Kimi Code.
 * @format
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState, BackHandler, StyleSheet, StatusBar, View} from 'react-native';
import {
  disabledConfig,
  isNewer,
  LockConfig,
  MachineLoginState,
  MachineRecord,
  MachineRegistry,
} from '@zshell/core-shell';
import {ConsoleScreen} from './src/screens/ConsoleScreen';
import {ConsentGate} from './src/screens/ConsentGate';
import {DataManageScreen} from './src/screens/DataManageScreen';
import {DiagnosticsScreen} from './src/screens/DiagnosticsScreen';
import {DownloadsScreen} from './src/screens/DownloadsScreen';
import {LockScreen} from './src/screens/LockScreen';
import {MachineListScreen} from './src/screens/MachineListScreen';
import {ManualInputScreen} from './src/screens/ManualInputScreen';
import {PermissionsScreen} from './src/screens/PermissionsScreen';
import {ScanScreen} from './src/screens/ScanScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {loadLegalConsent, loadLockConfig, loadRegistry, saveLegalConsent, saveLockConfig, saveRegistry} from './src/storage';
import {LEGAL_DOC_VERSION} from './src/legal';
import {loadPrefs, notifications} from './src/notifications';
import {cleanupInstalledApks, clearWebSession} from './src/downloads';
import {fetchLatestRelease} from './src/updater';
import {APP_VERSION} from './src/version';
import {loadThemeMode, saveThemeMode, setConsoleBarColor} from './src/appearance';
import {privacyWindow} from './src/privacyWindow';
import {
  makeStyles,
  ThemeMode,
  ThemeProvider,
  useResolvedScheme,
  useTheme,
} from './src/theme';

type Screen =
  | {name: 'list'}
  | {name: 'scan'}
  | {name: 'manual'}
  | {name: 'settings'}
  | {name: 'permissions'}
  | {name: 'downloads'}
  | {name: 'datamanage'}
  | {name: 'diagnostics'}
  | {name: 'console'; machineId: string};

// Screens pushed from Settings. While one of them is on top of the stack,
// Settings stays mounted underneath (overlay rendering) so its scroll
// position survives the round trip.
const SETTINGS_SUB_SCREENS: ReadonlySet<Screen['name']> = new Set([
  'permissions',
  'downloads',
  'datamanage',
  'diagnostics',
]);

function App(): React.JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode);
  const scheme = useResolvedScheme(themeMode);
  const changeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
  }, []);
  return (
    <ThemeProvider scheme={scheme}>
      <AppContent themeMode={themeMode} onChangeThemeMode={changeThemeMode} />
    </ThemeProvider>
  );
}

interface AppContentProps {
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
}

function AppContent({themeMode, onChangeThemeMode}: AppContentProps): React.JSX.Element {
  const {colors, isDark} = useTheme();
  const styles = useStyles();
  const [booting, setBooting] = useState(true);
  const [consented, setConsented] = useState(true);
  const [lock, setLock] = useState(disabledConfig());
  const [unlocked, setUnlocked] = useState(true);
  const [settingsSensitive, setSettingsSensitive] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{name: 'list'}]);
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const registryRef = useRef<MachineRegistry | null>(null);
  const launchTasksRanRef = useRef(false);
  // Set by the console screen: prefers the web page's own history on back.
  const webBackRef = useRef<(() => boolean) | null>(null);
  const registerConsoleBack = useCallback((fn: (() => boolean) | null) => {
    webBackRef.current = fn;
  }, []);
  // Console keep-alive: consoles stay mounted per machine (LRU, capped) while
  // the user moves around the app; only process death, machine deletion or a
  // web-login sign-out tears a session down. Back-from-console hides it;
  // re-entering shows the same live WebView — no reload, no re-handshake.
  const MAX_CONSOLE_SESSIONS = 3;
  const [consoleSessions, setConsoleSessions] = useState<string[]>([]);
  const removeConsoleSession = useCallback(
    (id: string) => setConsoleSessions(ss => ss.filter(s => s !== id)),
    [],
  );
  const clearConsoleSessions = useCallback(() => setConsoleSessions([]), []);
  // Hidden consoles must not touch the shared back-handler slot.
  const noopRegister = useCallback((_fn: (() => boolean) | null) => {}, []);
  // Records handed to the mounted consoles. Memoized so registry.get's
  // per-call copy does not churn props (and the WebView source) on every
  // unrelated re-render; refreshes only when the registry itself changes.
  const sessionRecords = useMemo(() => {
    const out: Record<string, MachineRecord> = {};
    const registry = registryRef.current;
    if (registry != null) {
      for (const id of consoleSessions) {
        const m = registry.get(id);
        if (m != null) {
          out[id] = m;
        }
      }
    }
    return out;
  }, [consoleSessions, machines]);

  useEffect(() => {
    const cfg = loadLockConfig();
    setLock(cfg);
    const initiallyUnlocked = !cfg.enabled;
    setUnlocked(initiallyUnlocked);
    if (initiallyUnlocked) {
      registryRef.current = loadRegistry();
      setMachines(registryRef.current.sorted());
    }
    const consent = loadLegalConsent();
    setConsented(consent != null && consent.version >= LEGAL_DOC_VERSION);
    setBooting(false);
    // 不缓存网页登录：冷启动即清除登录 Cookie，本次会话需重新登录
    if (!loadPrefs().cacheWebLogin) {
      clearWebSession().catch(() => {});
    }
  }, []);

  // Load decrypted machine credentials only after the app lock is satisfied.
  useEffect(() => {
    if (!booting && unlocked && registryRef.current == null) {
      registryRef.current = loadRegistry();
      setMachines(registryRef.current.sorted());
    }
  }, [booting, unlocked]);

  // Enforce FLAG_SECURE while LockScreen or backup/lock-secret flows are active
  // (even on API 36+ where recents masking normally allows screenshots).
  useEffect(() => {
    privacyWindow?.setSensitiveContentVisible?.(!unlocked || settingsSensitive);
  }, [unlocked, settingsSensitive]);

  // Relock whenever the app leaves the foreground while the lock is enabled
  // ('inactive' covers the recents screen / system dialogs on Android).
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if ((state === 'background' || state === 'inactive') && lock.enabled) {
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, [lock.enabled]);

  // Silent update check once per launch (toggle in Settings → 更新). Best-effort:
  // a local notification when a newer release exists; failures are ignored.
  useEffect(() => {
    if (!consented || !unlocked || booting || launchTasksRanRef.current) {
      return;
    }
    launchTasksRanRef.current = true;
    cleanupInstalledApks();
    const prefs = loadPrefs();
    const notifier = notifications;
    if (!prefs.autoCheckUpdates || notifier == null) {
      return;
    }
    let cancelled = false;
    fetchLatestRelease()
      .then(release => {
        if (!cancelled && release != null && isNewer(APP_VERSION, release)) {
          notifier.notify(
            5,
            'KShell 发现新版本',
            `v${release.version} 已发布，到 设置 → 更新 安装`,
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [consented, unlocked, booting]);

  // System back button: inside the console, prefer the page's own history
  // (web back), then pop our screen stack; at the root screen fall through
  // to the default (exit) behavior.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!unlocked || !consented) return true;
      if (stack.length > 0 && stack[stack.length - 1].name === 'console') {
        if (webBackRef.current != null && webBackRef.current()) {
          return true;
        }
      }
      if (stack.length > 1) {
        setStack(st => st.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack, unlocked, consented]);

  const persist = useCallback(() => {
    if (registryRef.current != null) {
      saveRegistry(registryRef.current);
      setMachines(registryRef.current.sorted());
    }
  }, []);

  // 退出 Kimi 账号（网页登录数据是账号级、所有 Kimi 机器共享）：
  // 清空 WebView 登录数据并把每台 Kimi 机器的观测状态置为未登录。
  // 必须声明在下面的早退 return 之前（hook 不得条件执行）。
  const signOutWebLogin = useCallback(async () => {
    // 登录数据即将清空，在线控制台全部失效——卸载会话避免僵尸页面
    clearConsoleSessions();
    await clearWebSession();
    const registry = registryRef.current;
    if (registry == null) {
      return;
    }
    for (const m of registry.sorted()) {
      if (m.credentials.kind === 'kimi') {
        registry.setLoginState(m.id, 'logged-out');
      }
    }
    persist();
  }, [persist, clearConsoleSessions]);

  const pop = useCallback(
    () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st)),
    [],
  );
  const openDownloads = useCallback(
    () => setStack(st => [...st, {name: 'downloads'}]),
    [],
  );
  const handleConsoleLoginState = useCallback(
    (id: string, state: MachineLoginState) => {
      if (registryRef.current?.setLoginState(id, state)) {
        persist();
      }
    },
    [persist],
  );

  const addFromUrl = useCallback(
    (url: string, customName?: string) => {
      const registry = registryRef.current!;
      const result = registry.addFromUrl(url);
      if (result.ok && customName != null && customName.length > 0) {
        registry.rename(result.record.id, customName);
      }
      if (result.ok) {
        persist();
      }
      return result;
    },
    [persist],
  );

  const consoleBarColor =
    !booting && consented && unlocked && stack[stack.length - 1].name === 'console'
      ? colors.consoleBg
      : null;
  useEffect(() => {
    setConsoleBarColor(consoleBarColor);
  }, [consoleBarColor]);

  if (booting) {
    return <View style={styles.boot} />;
  }

  // CN app-store compliance: agreement + privacy consent must come first.
  // Consent gate and the app lock render as opaque OVERLAYS (not early
  // returns) so the app tree — including keep-alive console sessions —
  // stays mounted underneath and survives relocking.

  const top = stack[stack.length - 1];
  const below = stack.length >= 2 ? stack[stack.length - 2] : null;
  // Sub-screens render as overlays so the screen underneath stays mounted:
  // Downloads pushed from the console keeps the WebView (and its relay
  // session) alive; a settings sub-screen keeps Settings' scroll position.
  const fromConsole = below?.name === 'console' && top.name === 'downloads';
  const fromSettings = below?.name === 'settings' && SETTINGS_SUB_SCREENS.has(top.name);
  const overlayScreen = fromConsole || fromSettings ? top : null;
  const base = overlayScreen != null ? below! : top;
  const push = (s: Screen) => setStack(st => [...st, s]);
  const connectTo = (machineId: string) => {
    registryRef.current?.touch(machineId);
    persist();
    // Move-to-end LRU: the activated console becomes the most recent; the
    // oldest session beyond the cap is evicted (its WebView unmounts = a real
    // disconnect, same as before keep-alive).
    setConsoleSessions(ss => {
      const next = ss.filter(s => s !== machineId);
      next.push(machineId);
      return next.length > MAX_CONSOLE_SESSIONS
        ? next.slice(next.length - MAX_CONSOLE_SESSIONS)
        : next;
    });
    setStack([{name: 'list'}, {name: 'console', machineId}]);
  };

  const renderMachineList = () => (
    <MachineListScreen
      machines={machines}
      onConnect={connectTo}
      onScan={() => push({name: 'scan'})}
      onManual={() => push({name: 'manual'})}
      onSettings={() => push({name: 'settings'})}
      onRename={(id, name) => {
        registryRef.current?.rename(id, name);
        persist();
      }}
      onToggleFavorite={id => {
        registryRef.current?.toggleFavorite(id);
        persist();
      }}
      onMove={(id, dir) => {
        registryRef.current?.move(id, dir);
        persist();
      }}
      onSetMuted={(id, muted) => {
        registryRef.current?.setMuted(id, muted);
        persist();
      }}
      onDelete={id => {
        registryRef.current?.remove(id);
        persist();
        removeConsoleSession(id);
      }}
      onSignOutWebLogin={() => {
        signOutWebLogin().catch(() => {});
      }}
    />
  );

  // Overlay content for screens that sit on top of a kept-alive base screen.
  const renderSubScreen = (s: Screen): React.JSX.Element | null => {
    switch (s.name) {
      case 'permissions':
        return <PermissionsScreen onBack={pop} />;
      case 'downloads':
        return (
          <DownloadsScreen
            onBack={pop}
            visible={!booting && consented && unlocked}
            backLabel={fromConsole ? '返回控制台' : '返回设置'}
          />
        );
      case 'datamanage':
        return (
          <DataManageScreen
            machines={machines}
            lock={lock}
            onBack={pop}
            onSignOutWebLogin={signOutWebLogin}
          />
        );
      case 'diagnostics':
        return <DiagnosticsScreen onBack={pop} />;
      default:
        return null;
    }
  };

  let screen: React.JSX.Element | null;
  switch (base.name) {
    case 'scan':
      screen = (
        <ScanScreen
          onResult={url => {
            const r = addFromUrl(url);
            return {
              ok: r.ok,
              machineId: r.ok ? r.record.id : undefined,
              reason: r.ok ? undefined : r.reason,
            };
          }}
          onDone={outcome => {
            if (outcome.ok && outcome.machineId != null) {
              connectTo(outcome.machineId);
            }
          }}
        />
      );
      break;
    case 'manual':
      screen = (
        <ManualInputScreen
          onSubmit={(url, name) => {
            const r = addFromUrl(url, name);
            return {
              ok: r.ok,
              machineId: r.ok ? r.record.id : undefined,
              reason: r.ok ? undefined : r.reason,
            };
          }}
          onDone={outcome => {
            if (outcome.ok && outcome.machineId != null) {
              connectTo(outcome.machineId);
            }
          }}
        />
      );
      break;
    case 'settings':
      screen = (
        <SettingsScreen
          visible={!fromSettings && consented && unlocked}
          unlocked={unlocked}
          lock={lock}
          onSaveLock={(cfg: LockConfig) => {
            saveLockConfig(cfg);
            setLock(cfg);
          }}
          machines={machines}
          onImportMachines={records => {
            const registry = registryRef.current!;
            const result = registry.importMachines(records);
            persist();
            return result;
          }}
          onSignOutWebLogin={signOutWebLogin}
          onSensitiveChange={setSettingsSensitive}
          onBack={pop}
          onOpenPermissions={() => push({name: 'permissions'})}
          onOpenDownloads={() => push({name: 'downloads'})}
          onOpenDataManage={() => push({name: 'datamanage'})}
          onOpenDiagnostics={() => push({name: 'diagnostics'})}
          themeMode={themeMode}
          onChangeThemeMode={onChangeThemeMode}
        />
      );
      break;
    case 'permissions':
    case 'downloads':
    case 'datamanage':
    case 'diagnostics':
      screen = renderSubScreen(base);
      break;
    case 'console': {
      // The console itself renders from the keep-alive session layer below;
      // this case only guards against a stale stack entry whose machine has
      // vanished (e.g. restored backup) by falling back to the list.
      const machine = registryRef.current?.get(base.machineId) ?? null;
      screen = machine ? null : renderMachineList();
      break;
    }
    default:
      screen = renderMachineList();
  }

  // The console shown on top of the stack — or the one sitting under the
  // downloads overlay. Only that session's WebView is visible; the others
  // stay mounted but hidden (display:none keeps the native view alive).
  const consoleOnTop =
    top.name === 'console'
      ? top.machineId
      : fromConsole && base.name === 'console'
        ? base.machineId
        : null;

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={consoleBarColor ?? colors.bg}
        hidden={false}
      />
      <View style={{flex: 1}}>
        {consoleSessions.map(id => {
          const m = sessionRecords[id];
          if (m == null) {
            return null;
          }
          return (
            <View
              key={id}
              style={[
                styles.sessionLayer,
                consoleOnTop === id ? null : styles.sessionHidden,
              ]}>
              <ConsoleScreen
                machine={m}
                foreground={consoleBarColor != null && consoleOnTop === id}
                onBack={pop}
                registerBackHandler={
                  consoleOnTop === id ? registerConsoleBack : noopRegister
                }
                onOpenDownloads={openDownloads}
                onLoginState={handleConsoleLoginState}
              />
            </View>
          );
        })}
        {screen}
        {overlayScreen != null ? (
          <View style={styles.overlay}>
            {renderSubScreen(overlayScreen)}
          </View>
        ) : null}
      </View>
      {!consented ? (
        <View style={styles.gateOverlay}>
          <ConsentGate
            onAgree={() => {
              saveLegalConsent({version: LEGAL_DOC_VERSION, agreedAt: Date.now()});
              setConsented(true);
            }}
          />
        </View>
      ) : null}
      {!unlocked ? (
        <View style={styles.gateOverlay}>
          <LockScreen config={lock} onUnlock={() => setUnlocked(true)} />
        </View>
      ) : null}
    </>
  );
}

const useStyles = makeStyles(colors => ({
  boot: {flex: 1, backgroundColor: colors.bg},
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    elevation: 8,
  },
  sessionLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
  },
  sessionHidden: {
    display: 'none',
  },
  gateOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    elevation: 10,
  },
}));

export default App;
