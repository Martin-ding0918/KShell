import React, {createContext, useContext, useMemo} from 'react';
import {StyleSheet, TextStyle, useColorScheme} from 'react-native';

export type ColorScheme = 'light' | 'dark';
/** User preference: follow the OS, or force one scheme. */
export type ThemeMode = 'system' | ColorScheme;

export interface Palette {
  scheme: ColorScheme;
  bg: string;
  consoleBg: string;
  consoleHeaderBg: string;
  bgElevated: string;
  /** Inset panels nested in a card (expanded actions, code blocks). */
  bgSunken: string;
  /** Translucent fill for the console's floating controls (fullscreen mode). */
  bgElevatedOverlay: string;
  /** Translucent fill for bottom action bars floating above lists. */
  bgBar: string;
  bgInput: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentDim: string;
  /** Text / icons drawn on top of an accent or danger fill. */
  onAccent: string;
  accentSoft: string;
  danger: string;
  success: string;
  star: string;
  /** Soft fills for status pills (outline + tint background). */
  successSoft: string;
  dangerSoft: string;
  /** Stronger danger tint for armed (tap again to confirm) buttons. */
  dangerArmed: string;
  neutralSoft: string;
  switchThumb: string;
  switchTrackOff: string;
  /** Modal / sheet backdrop. */
  scrim: string;
  /** PatternPad dots. */
  patternRing: string;
  patternDot: string;
}

const dark: Palette = {
  scheme: 'dark',
  bg: '#161616',
  consoleBg: '#121212',
  consoleHeaderBg: '#1c1c1c',
  bgElevated: '#212121',
  bgSunken: '#1b1b1b',
  bgElevatedOverlay: 'rgba(33, 33, 33, 0.88)',
  bgBar: 'rgba(22, 22, 22, 0.94)',
  bgInput: '#2b2b2b',
  border: '#363636',
  text: '#ededed',
  textDim: '#a0a0a0',
  textFaint: '#6c6c6c',
  accent: '#4f9cff',
  accentDim: '#2c5c99',
  onAccent: '#ffffff',
  accentSoft: 'rgba(79, 156, 255, 0.14)',
  danger: '#e5534b',
  success: '#3fb950',
  star: '#f0b429',
  successSoft: 'rgba(63, 185, 80, 0.12)',
  dangerSoft: 'rgba(229, 83, 75, 0.12)',
  dangerArmed: 'rgba(229, 83, 75, 0.22)',
  neutralSoft: 'rgba(154, 154, 154, 0.10)',
  switchThumb: '#ffffff',
  switchTrackOff: '#4a4a4a',
  scrim: 'rgba(0, 0, 0, 0.6)',
  patternRing: '#4a4a4a',
  patternDot: '#5a5a5a',
};

const light: Palette = {
  scheme: 'light',
  bg: '#f4f5f7',
  consoleBg: '#ffffff',
  consoleHeaderBg: '#f7f7f7',
  bgElevated: '#ffffff',
  bgSunken: '#f7f8fa',
  bgElevatedOverlay: 'rgba(255, 255, 255, 0.92)',
  bgBar: 'rgba(244, 245, 247, 0.96)',
  bgInput: '#eceef2',
  border: '#dde0e5',
  text: '#1c1e21',
  textDim: '#5d636b',
  textFaint: '#979ca4',
  accent: '#2f7cf6',
  accentDim: '#a7c6f8',
  onAccent: '#ffffff',
  accentSoft: 'rgba(47, 124, 246, 0.10)',
  danger: '#d93a32',
  success: '#1f9d3a',
  star: '#d99a00',
  successSoft: 'rgba(31, 157, 58, 0.10)',
  dangerSoft: 'rgba(217, 58, 50, 0.08)',
  dangerArmed: 'rgba(217, 58, 50, 0.16)',
  neutralSoft: 'rgba(93, 99, 107, 0.08)',
  switchThumb: '#ffffff',
  switchTrackOff: '#c9cdd3',
  scrim: 'rgba(0, 0, 0, 0.4)',
  patternRing: '#c4c8ce',
  patternDot: '#a9aeb6',
};

export const palettes: Record<ColorScheme, Palette> = {dark, light};

export const spacing = {s: 6, m: 12, l: 20} as const;

/** Corner radii: s for chips/pills, m for inputs/buttons, l for cards. */
export const radius = {s: 999, m: 12, l: 16} as const;

export interface Fonts {
  title: TextStyle;
  body: TextStyle;
  dim: TextStyle;
  faint: TextStyle;
  pill: TextStyle;
}

function fontsFor(c: Palette): Fonts {
  return {
    title: {fontSize: 22, fontWeight: '600', color: c.text},
    body: {fontSize: 15, color: c.text},
    dim: {fontSize: 13, color: c.textDim, lineHeight: 19},
    faint: {fontSize: 12, color: c.textFaint, lineHeight: 17},
    pill: {fontSize: 11, fontWeight: '500'},
  };
}

export interface Theme {
  colors: Palette;
  font: Fonts;
  isDark: boolean;
}

const themes: Record<ColorScheme, Theme> = {
  dark: {colors: dark, font: fontsFor(dark), isDark: true},
  light: {colors: light, font: fontsFor(light), isDark: false},
};

const ThemeContext = createContext<Theme>(themes.dark);

/** Resolves the effective scheme: the user's override, else the OS setting. */
export function useResolvedScheme(mode: ThemeMode): ColorScheme {
  const system = useColorScheme();
  if (mode !== 'system') {
    return mode;
  }
  return system === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({
  scheme,
  children,
}: {
  scheme: ColorScheme;
  children: React.ReactNode;
}) {
  return React.createElement(
    ThemeContext.Provider,
    {value: themes[scheme]},
    children,
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Theme-aware StyleSheet factory. Styles are built once per scheme and
 * cached, so components re-render cheaply and switch instantly when the
 * scheme changes.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette, font: Fonts) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    const {colors, font} = useTheme();
    return useMemo(() => {
      const hit = cache[colors.scheme];
      if (hit != null) {
        return hit;
      }
      const built = StyleSheet.create(factory(colors, font));
      cache[colors.scheme] = built;
      return built;
    }, [colors, font]);
  };
}
