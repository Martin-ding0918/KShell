/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import {ConsentGate} from '../src/screens/ConsentGate';
import {MachineListScreen} from '../src/screens/MachineListScreen';

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
