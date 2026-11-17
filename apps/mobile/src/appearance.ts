import {NativeModules} from 'react-native';
import type {ThemeMode} from './theme';

interface ZShellAppearanceModule {
  /** Exported constant (legacy-module constants surface as properties). */
  themeMode?: string;
  getConstants?: () => {themeMode?: string};
  setThemeMode(mode: ThemeMode): void;
  setConsoleBarColor(color: string | null): void;
}

/**
 * Native bridge for the light / dark preference (registered in
 * ApkInstallerPackage). The mode lives in native SharedPreferences and is
 * applied via AppCompatDelegate before the first frame, so the window
 * background and system bars already match on a cold start — and system
 * dialogs (Alert) follow the in-app choice as well.
 */
const native = NativeModules.ZShellAppearance as ZShellAppearanceModule | undefined;

function parseMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function loadThemeMode(): ThemeMode {
  try {
    return parseMode(native?.themeMode ?? native?.getConstants?.().themeMode);
  } catch {
    return 'system';
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  native?.setThemeMode(mode);
}

export function setConsoleBarColor(color: string | null): void {
  native?.setConsoleBarColor?.(color);
}

