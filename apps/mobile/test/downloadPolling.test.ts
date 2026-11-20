import React from 'react';
import {act, create} from 'react-test-renderer';
import {describe, expect, it, vi} from 'vitest';
import type {DownloadItem, DownloadStatus} from '../src/downloads';
import {DownloadsScreen} from '../src/screens/DownloadsScreen';

const {appState, changeAppState, queryDownloads} = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  const appState = {
    currentState: 'active',
    addEventListener: (_type: string, listener: (state: string) => void) => {
      listeners.add(listener);
      return {remove: () => listeners.delete(listener)};
    },
  };
  return {
    appState,
    changeAppState: (state: string) => {
      appState.currentState = state;
      listeners.forEach(listener => listener(state));
    },
    queryDownloads: vi.fn<() => Promise<DownloadItem[]>>(),
  };
});

vi.mock('react-native', () => ({
  AppState: appState,
  ScrollView: 'ScrollView',
  StyleSheet: {hairlineWidth: 1},
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('../src/theme', () => ({
  makeStyles: () => () => ({}),
  radius: {},
  useTheme: () => ({colors: {}, font: {}}),
}));
vi.mock('../src/downloads', () => ({
  queryDownloads,
  isActive: (status: DownloadStatus) => !['successful', 'failed'].includes(status),
  openDownloadedFile: vi.fn(),
  openDownloadsUi: vi.fn(),
  removeDownload: vi.fn(),
  resumeDownload: vi.fn(),
  retryDownload: vi.fn(),
}));

describe('DownloadsScreen polling', () => {
  it('stops in the background or behind an overlay and stops when downloads finish', async () => {
    vi.useFakeTimers();
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
    const item: DownloadItem = {
      id: 1, name: 'example.txt', kind: 'file', url: '', status: 'running', bytesSoFar: 1, totalBytes: 2,
    };
    queryDownloads.mockResolvedValue([item]);
    const onBack = () => {};
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    let screen: ReturnType<typeof create> | undefined;

    try {
      await act(async () => { screen = create(React.createElement(DownloadsScreen, {visible: true, onBack})); });
      expect(queryDownloads).toHaveBeenCalledTimes(1);
      await act(async () => changeAppState('background'));
      await advance(5000);
      expect(queryDownloads).toHaveBeenCalledTimes(1);

      await act(async () => changeAppState('active'));
      expect(queryDownloads).toHaveBeenCalledTimes(2);
      await act(async () => screen?.update(React.createElement(DownloadsScreen, {visible: false, onBack})));
      await advance(5000);
      expect(queryDownloads).toHaveBeenCalledTimes(2);

      await act(async () => screen?.update(React.createElement(DownloadsScreen, {visible: true, onBack})));
      expect(queryDownloads).toHaveBeenCalledTimes(3);
      queryDownloads.mockResolvedValue([{...item, status: 'successful'}]);
      await advance(1500);
      expect(queryDownloads).toHaveBeenCalledTimes(4);
      await advance(5000);
      expect(queryDownloads).toHaveBeenCalledTimes(4);
    } finally {
      await act(async () => screen?.unmount());
      Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: undefined});
      vi.useRealTimers();
    }
  });
});
