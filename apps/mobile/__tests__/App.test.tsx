/**
 * @format
 */

import React from 'react';
import {ScrollView, Text, TouchableOpacity} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import * as downloads from '../src/downloads';
import {ConsentGate} from '../src/screens/ConsentGate';
import {DataManageScreen} from '../src/screens/DataManageScreen';
import {DiagnosticsScreen} from '../src/screens/DiagnosticsScreen';
import {DownloadsScreen} from '../src/screens/DownloadsScreen';
import {MachineListScreen} from '../src/screens/MachineListScreen';
import {PermissionsScreen} from '../src/screens/PermissionsScreen';
import {SettingsScreen} from '../src/screens/SettingsScreen';
import * as updater from '../src/updater';

jest.mock('react-native-webview/lib/NativeRNCWebViewModule', () => ({
  __esModule: true,
  default: {},
}));

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
  }
});

test('keeps Settings mounted and pauses its update polling under sub-screens', async () => {
  jest.useFakeTimers();
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
