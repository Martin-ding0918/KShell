/**
 * @format
 */

import React from 'react';
import {Modal, ScrollView, Switch, Text, TouchableOpacity} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {installVerifier, makeVerifier} from '@zshell/core-shell';
import App from '../App';
import * as appearance from '../src/appearance';
import * as downloads from '../src/downloads';
import * as securekdf from '../src/securekdf';
import {ConsentGate} from '../src/screens/ConsentGate';
import {DataManageScreen} from '../src/screens/DataManageScreen';
import {DiagnosticsScreen} from '../src/screens/DiagnosticsScreen';
import {DownloadsScreen} from '../src/screens/DownloadsScreen';
import {MachineListScreen} from '../src/screens/MachineListScreen';
import {PermissionsScreen} from '../src/screens/PermissionsScreen';
import {SettingsScreen} from '../src/screens/SettingsScreen';
import {ThemeProvider, useResolvedScheme} from '../src/theme';
import * as updater from '../src/updater';

jest.mock('react-native-webview', () => {
  const ReactLib = require('react');
  const WebView = ReactLib.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      ReactLib.useImperativeHandle(ref, () => ({
        injectJavaScript: jest.fn(),
        reload: jest.fn(),
        goBack: jest.fn(),
      }));
      return ReactLib.createElement('RNCWebView', props);
    },
  );
  return {__esModule: true, WebView, default: WebView};
});

jest.mock('react-native-camera-kit', () => ({Camera: 'Camera'}));

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    private readonly data = new Map<string, string>();

    withInstanceID() { return this; }
    withEncryption() { return this; }

    initialize() {
      return {
        getString: (key: string) => this.data.get(key) ?? null,
        setString: (key: string, value: string) => {
          this.data.set(key, value);
          return true;
        },
        removeItem: (key: string) => this.data.delete(key),
      };
    }
  },
}));

test('renders the initial consent screen and opens the machine list on acceptance', async () => {
  jest.spyOn(updater, 'fetchLatestRelease').mockResolvedValue(null);
  let renderer!: ReturnType<typeof ReactTestRenderer.create>;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  try {
    const gate = renderer.root.findByType(ConsentGate);
    await ReactTestRenderer.act(async () => gate.props.onAgree());
    expect(renderer.root.findAllByType(ConsentGate)).toHaveLength(0);
    expect(renderer.root.findAllByType(MachineListScreen)).toHaveLength(1);
  } finally {
    await ReactTestRenderer.act(async () => renderer.unmount());
    jest.restoreAllMocks();
  }
});

test('keeps Settings mounted and pauses its update polling under sub-screens', async () => {
  // StatusBar caches its last setImmediate handle across tests; faking
  // setImmediate/clearImmediate leaves a sinon fake handle that later breaks
  // Node's real clearImmediate queue once useRealTimers() runs.
  jest.useFakeTimers({doNotFake: ['setImmediate', 'clearImmediate']});
  jest.spyOn(updater, 'fetchLatestRelease').mockResolvedValue({
    version: '99.0.0', tag: 'v99.0.0', notes: '', apkUrl: 'https://example.invalid/test.apk',
    apkSize: null, publishedAt: null,
  });
  jest.spyOn(downloads, 'startUpdateDownload').mockResolvedValue(1);
  const download: downloads.DownloadItem = {
    id: 1, name: 'test.apk', kind: 'update', url: '', status: 'running', bytesSoFar: 1, totalBytes: 2,
  };
  const query = jest.spyOn(downloads, 'queryDownloads').mockResolvedValue([download]);
  let renderer!: ReturnType<typeof ReactTestRenderer.create>;
  await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(<App />); });

  try {
    const gate = renderer.root.findAllByType(ConsentGate)[0];
    if (gate) await ReactTestRenderer.act(async () => gate.props.onAgree());
    await ReactTestRenderer.act(async () => renderer.root.findByType(MachineListScreen).props.onSettings());
    const settings = renderer.root.findByType(SettingsScreen);
    const scroll = settings.findAllByType(ScrollView)[0];
    const subScreens = [
      [PermissionsScreen, 'onOpenPermissions'],
      [DownloadsScreen, 'onOpenDownloads'],
      [DataManageScreen, 'onOpenDataManage'],
      [DiagnosticsScreen, 'onOpenDiagnostics'],
    ] as const;
    for (const [ScreenComponent, handler] of subScreens) {
      await ReactTestRenderer.act(async () => settings.props[handler]());
      expect(renderer.root.findByType(SettingsScreen)).toBe(settings);
      expect(scroll.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(scroll.props.pointerEvents).toBe('none');
      await ReactTestRenderer.act(async () => renderer.root.findByType(ScreenComponent).props.onBack());
      expect(renderer.root.findAllByType(ScreenComponent)).toHaveLength(0);
      expect(settings.findAllByType(ScrollView)[0]).toBe(scroll);
      expect(scroll.props.importantForAccessibility).toBe('auto');
      expect(scroll.props.pointerEvents).toBe('auto');
    }

    const press = (label: string) => {
      const button = settings.findAllByType(TouchableOpacity).find(candidate =>
        candidate.findAllByType(Text).some(text => text.props.children === label),
      );
      if (!button) throw new Error(`Missing settings button: ${label}`);
      return ReactTestRenderer.act(async () => { await button.props.onPress(); });
    };
    await press('检查更新');
    query.mockClear();
    await press('下载并安装');
    expect(query).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => settings.props.onOpenDiagnostics());
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(3000); });
    expect(query).toHaveBeenCalledTimes(1);

    query.mockResolvedValue([{...download, status: 'successful'}]);
    await ReactTestRenderer.act(async () => renderer.root.findByType(DiagnosticsScreen).props.onBack());
    expect(query).toHaveBeenCalledTimes(2);
    expect(settings.findAllByType(Text).some(text => text.props.children === '打开安装包')).toBe(true);
  } finally {
    await ReactTestRenderer.act(async () => renderer.unmount());
    jest.useRealTimers();
    jest.restoreAllMocks();
  }
});

test('SettingsScreen requires verification for lock changes, enters reset flow, routes sign-out, and clears backup modal on lock', async () => {
  const salt = new Uint8Array(16).fill(7);
  const lock = installVerifier(
    {enabled: false, methods: {biometric: false, pattern: null, password: null}, createdAt: 1},
    'password',
    makeVerifier('1234', salt, 100),
  );
  const sampleMachines = [
    {
      id: 'm1',
      name: 'Workstation',
      credentials: {
        sid: 'dev-1',
        hash: '',
        origin: 'https://code-rc.kimi.com',
        mid: null,
        deviceName: null,
        appVersion: null,
        issuedAt: null,
        kind: 'kimi' as const,
      },
      favorite: false,
      sortOrder: 1,
      createdAt: 1,
      lastUsedAt: null,
    },
  ];
  jest.spyOn(securekdf, 'verifySecretAsync').mockResolvedValue(true);
  jest.spyOn(securekdf, 'secureRandomBytes').mockResolvedValue(salt);
  jest.spyOn(securekdf, 'encryptBackupAsync').mockResolvedValue('ZSBK2.600000.TESTBACKUPBLOB');
  const onSaveLock = jest.fn();
  const onSignOut = jest.fn().mockResolvedValue(undefined);

  const renderSettings = (visible: boolean, unlocked: boolean) => (
    <ThemeProvider scheme="light">
      <SettingsScreen
        visible={visible}
        unlocked={unlocked}
        lock={lock}
        onSaveLock={onSaveLock}
        machines={sampleMachines}
        onImportMachines={() => ({added: 0, updated: 0})}
        onSignOutWebLogin={onSignOut}
        onBack={() => {}}
        onOpenPermissions={() => {}}
        onOpenDownloads={() => {}}
        onOpenDataManage={() => {}}
        onOpenDiagnostics={() => {}}
        themeMode="light"
        onChangeThemeMode={() => {}}
      />
    </ThemeProvider>
  );

  let renderer!: ReturnType<typeof ReactTestRenderer.create>;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(renderSettings(true, true));
  });

  try {
    const textOf = (t: {props: {children?: unknown}}) =>
      Array.isArray(t.props.children)
        ? t.props.children.map(String).join('')
        : String(t.props.children ?? '');

    const pressText = async (label: string) => {
      const btn = renderer.root.findAllByType(TouchableOpacity).find(candidate =>
        candidate.findAllByType(Text).some(t => textOf(t) === label),
      );
      if (!btn) throw new Error(`Missing button: ${label}`);
      await ReactTestRenderer.act(async () => {
        await btn.props.onPress();
      });
    };

    // 1. Adding pattern while password lock is active must require verification first.
    await pressText('设置');
    expect(
      renderer.root.findAllByType(Text).some(t =>
        textOf(t).includes('设置图案（可用任意已启用的方式）'),
      ),
    ).toBe(true);

    // 2. Changing existing password must enter passwordSet after verification succeeds
    //    (previously overwritten back to idle).
    await pressText('更换');
    const secretInput = renderer.root.findAllByProps({placeholder: '当前密码'})[0];
    await ReactTestRenderer.act(async () => {
      secretInput.props.onChangeText('1234');
    });
    await pressText('验证');
    expect(
      renderer.root.findAllByType(Text).some(t =>
        textOf(t).includes('设置解锁密码（至少 4 位）'),
      ),
    ).toBe(true);

    // 3. Export backup -> verify -> generate -> confirm backup Modal opens with blob.
    await pressText('导出备份');
    const verifyPass = renderer.root.findAllByProps({placeholder: '当前密码'})[0];
    await ReactTestRenderer.act(async () => {
      verifyPass.props.onChangeText('1234');
    });
    await pressText('验证');
    const pass1 = renderer.root.findAllByProps({placeholder: '备份口令'})[0];
    const pass2 = renderer.root.findAllByProps({placeholder: '再输入一次'})[0];
    await ReactTestRenderer.act(async () => {
      pass1.props.onChangeText('correct-horse-1234');
      pass2.props.onChangeText('correct-horse-1234');
    });
    await pressText('生成备份');
    expect(
      renderer.root.findAllByType(Modal).some(m => m.props.visible === true),
    ).toBe(true);
    expect(
      renderer.root.findAllByType(Text).some(t => textOf(t) === 'ZSBK2.600000.TESTBACKUPBLOB'),
    ).toBe(true);

    // 4. Turning off cacheWebLogin routes through unified onSignOutWebLogin.
    const cacheSwitch = renderer.root.findAllByType(Switch).find(sw => {
      const parent = sw.parent;
      return parent != null && parent.findAllByType(Text).some(t => textOf(t) === '跨重启保留登录');
    });
    expect(cacheSwitch).toBeDefined();
    await ReactTestRenderer.act(async () => {
      cacheSwitch!.props.onValueChange(false);
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);

    // 5. Locking dismisses the open backup modal AND wipes the backup blob so
    //    re-unlocking does not reopen it.
    await ReactTestRenderer.act(async () => {
      renderer.update(renderSettings(false, false));
    });
    for (const modal of renderer.root.findAllByType(Modal)) {
      expect(modal.props.visible).toBe(false);
    }
    expect(
      renderer.root.findAllByType(Text).some(t => textOf(t) === 'ZSBK2.600000.TESTBACKUPBLOB'),
    ).toBe(false);

    await ReactTestRenderer.act(async () => {
      renderer.update(renderSettings(true, true));
    });
    for (const modal of renderer.root.findAllByType(Modal)) {
      expect(modal.props.visible).toBe(false);
    }
  } finally {
    await ReactTestRenderer.act(async () => renderer.unmount());
    jest.restoreAllMocks();
  }
});

test('ConsentGate hides its legal modal when visible is false (app locked)', async () => {
  let renderer!: ReturnType<typeof ReactTestRenderer.create>;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider scheme="light">
        <ConsentGate onAgree={() => {}} visible={true} />
      </ThemeProvider>,
    );
  });

  try {
    const privacyBtn = renderer.root.findAllByType(TouchableOpacity).find(btn =>
      btn.findAllByType(Text).some(t => t.props.children === '《隐私政策》'),
    );
    expect(privacyBtn).toBeDefined();
    await ReactTestRenderer.act(async () => {
      privacyBtn!.props.onPress();
    });
    expect(renderer.root.findByType(Modal).props.visible).toBe(true);

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <ThemeProvider scheme="light">
          <ConsentGate onAgree={() => {}} visible={false} />
        </ThemeProvider>,
      );
    });
    expect(renderer.root.findByType(Modal).props.visible).toBe(false);
  } finally {
    await ReactTestRenderer.act(async () => renderer.unmount());
  }
});

test('ConsoleScreen keeps auth overlay WebView source stable across cross-host OAuth redirects', async () => {
  const {AppState} = require('react-native');
  const {WebView} = require('react-native-webview');
  const {ConsoleScreen} = require('../src/screens/ConsoleScreen');
  const prevAppState = AppState.currentState;
  AppState.currentState = 'active';

  const machine = {
    id: 'm1',
    name: 'Kimi Desktop',
    credentials: {
      kind: 'kimi' as const,
      sid: 'dev-abc',
      hash: '',
      origin: 'https://code-rc.kimi.com',
      mid: null,
      deviceName: null,
      appVersion: null,
      issuedAt: null,
      source: 'kimi_code_desktop',
      extraQuery: 'rc=1',
    },
    favorite: false,
    sortOrder: 1,
    createdAt: 1,
    lastUsedAt: null,
  };

  let renderer!: ReturnType<typeof ReactTestRenderer.create>;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider scheme="dark">
        <ConsoleScreen
          machine={machine}
          foreground={true}
          onBack={() => {}}
          registerBackHandler={() => {}}
          onOpenDownloads={() => {}}
        />
      </ThemeProvider>,
    );
  });

  try {
    const mainWebView = renderer.root.findAllByType(WebView)[0];
    expect(mainWebView.props.originWhitelist).toContain('about:blank');

    await ReactTestRenderer.act(async () => {
      mainWebView.props.onOpenWindow({
        nativeEvent: {targetUrl: 'https://auth.kimi.ai/oauth/start'},
      });
    });

    const authWebViewBefore = renderer.root.findAllByType(WebView)[1];
    expect(authWebViewBefore).toBeDefined();
    const initialSourceRef = authWebViewBefore.props.source;
    expect(initialSourceRef).toEqual({uri: 'https://auth.kimi.ai/oauth/start'});
    expect(authWebViewBefore.props.originWhitelist).toContain('about:blank');

    // Cross-host OAuth redirect updates the displayed header host without changing source ref.
    await ReactTestRenderer.act(async () => {
      authWebViewBefore.props.onNavigationStateChange({
        url: 'https://accounts.google.com/o/oauth2/auth',
        canGoBack: true,
      });
    });

    const authWebViewAfter = renderer.root.findAllByType(WebView)[1];
    expect(authWebViewAfter.props.source).toBe(initialSourceRef);
  } finally {
    await ReactTestRenderer.act(async () => renderer.unmount());
    AppState.currentState = prevAppState;
  }
});

test('useResolvedScheme resyncs OS dark mode on foreground resume after background toggle', async () => {
  const {Appearance, AppState} = require('react-native');
  let appStateListener: ((state: string) => void) | null = null;
  let appearanceListener: ((prefs: {colorScheme: 'light' | 'dark' | null}) => void) | null = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
    if (args[0] === 'change' && typeof args[1] === 'function') {
      appStateListener = args[1] as (state: string) => void;
    }
    return {remove: jest.fn()};
  });
  jest.spyOn(Appearance, 'addChangeListener').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'function') {
      appearanceListener = args[0] as (prefs: {colorScheme: 'light' | 'dark' | null}) => void;
    }
    return {remove: jest.fn()};
  });
  const queryScheme = jest
    .spyOn(appearance, 'getSystemColorScheme')
    .mockResolvedValueOnce('light')
    .mockResolvedValueOnce('dark');

  function Probe() {
    const scheme = useResolvedScheme('system');
    return <Text>{scheme}</Text>;
  }

  let renderer!: ReturnType<typeof ReactTestRenderer.create>;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Probe />);
  });

  try {
    expect(renderer.root.findByType(Text).props.children).toBe('light');

    // Phone switches to dark mode while KShell is backgrounded without firing
    // RN Appearance change; returning to foreground must re-query and switch.
    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
      appStateListener?.('active');
    });
    expect(queryScheme).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType(Text).props.children).toBe('dark');

    // Subsequent foreground RN Appearance change still updates immediately.
    await ReactTestRenderer.act(async () => {
      appearanceListener?.({colorScheme: 'light'});
    });
    expect(renderer.root.findByType(Text).props.children).toBe('light');
  } finally {
    await ReactTestRenderer.act(async () => renderer.unmount());
    jest.restoreAllMocks();
  }
});
