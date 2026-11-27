import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {Appearance, AppState, StyleSheet, TextStyle, useColorScheme} from 'react-native';
import {getSystemColorScheme} from './appearance';

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
  /** Active segment pill fill inside segmented controls. */
  pillActive: string;
  /** Subtle tinted tile behind product/terminal icons. */
  iconBadgeBg: string;
  zcodeBadgeBg: string;
  /** BottomSheet drag handle indicator. */
  handle: string;
  /** Camera / viewfinder overlays (always dark scrim + white foreground). */
  overlayDark: string;
  overlaySurface: string;
  overlayLightText: string;
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
  bg: '#111316',
  consoleBg: '#121212',
  consoleHeaderBg: '#1c1c1c',
  bgElevated: '#1b1e23',
  bgSunken: '#15181d',
  bgElevatedOverlay: 'rgba(27, 30, 35, 0.90)',
  bgBar: 'rgba(17, 19, 22, 0.94)',
  bgInput: '#252932',
  pillActive: '#2e3440',
  iconBadgeBg: 'rgba(59, 130, 246, 0.16)',
  zcodeBadgeBg: 'rgba(156, 163, 175, 0.14)',
  handle: '#4b5563',
  overlayDark: 'rgba(10, 12, 16, 0.62)',
  overlaySurface: 'rgba(17, 19, 22, 0.72)',
  overlayLightText: '#ffffff',
  border: '#2a2f37',
  text: '#f3f4f6',
  textDim: '#9ca3af',
  textFaint: '#6b7280',
  accent: '#3b82f6',
  accentDim: '#254880',
  onAccent: '#ffffff',
  accentSoft: 'rgba(59, 130, 246, 0.14)',
  danger: '#f87171',
  success: '#34d399',
  star: '#fbbf24',
  successSoft: 'rgba(52, 211, 153, 0.14)',
  dangerSoft: 'rgba(248, 113, 113, 0.12)',
  dangerArmed: 'rgba(248, 113, 113, 0.24)',
  neutralSoft: 'rgba(156, 163, 175, 0.12)',
  switchThumb: '#ffffff',
  switchTrackOff: '#3f4654',
  scrim: 'rgba(0, 0, 0, 0.64)',
  patternRing: '#4b5563',
  patternDot: '#6b7280',
};

const light: Palette = {
  scheme: 'light',
  bg: '#f3f5f8',
  consoleBg: '#ffffff',
  consoleHeaderBg: '#f7f7f7',
  bgElevated: '#ffffff',
  bgSunken: '#eef1f5',
  bgElevatedOverlay: 'rgba(255, 255, 255, 0.92)',
  bgBar: 'rgba(243, 245, 248, 0.96)',
  bgInput: '#edf0f4',
  pillActive: '#ffffff',
  iconBadgeBg: 'rgba(37, 99, 235, 0.10)',
  zcodeBadgeBg: 'rgba(75, 85, 99, 0.08)',
  handle: '#d1d5db',
  overlayDark: 'rgba(10, 12, 16, 0.62)',
  overlaySurface: 'rgba(17, 19, 22, 0.72)',
  overlayLightText: '#ffffff',
  border: '#e2e6ec',
  text: '#111827',
  textDim: '#4b5563',
  textFaint: '#9ca3af',
  accent: '#2563eb',
  accentDim: '#93c5fd',
  onAccent: '#ffffff',
  accentSoft: 'rgba(37, 99, 235, 0.10)',
  danger: '#dc2626',
  success: '#16a34a',
  star: '#d97706',
  successSoft: 'rgba(22, 163, 74, 0.10)',
  dangerSoft: 'rgba(220, 38, 38, 0.08)',
  dangerArmed: 'rgba(220, 38, 38, 0.16)',
  neutralSoft: 'rgba(75, 85, 99, 0.08)',
  switchThumb: '#ffffff',
  switchTrackOff: '#cbd5e1',
  scrim: 'rgba(15, 23, 42, 0.42)',
  patternRing: '#cbd5e1',
  patternDot: '#94a3b8',
};

export const palettes: Record<ColorScheme, Palette> = {dark, light};

export const spacing = {xs: 4, s: 8, m: 12, l: 16, xl: 20} as const;

/** Corner radii: s for chips/pills, m for inputs/buttons, l for cards, xl for sheets. */
export const radius = {s: 999, m: 12, l: 16, xl: 22} as const;

export interface Fonts {
  title: TextStyle;
  section: TextStyle;
  body: TextStyle;
  dim: TextStyle;
  faint: TextStyle;
  pill: TextStyle;
  mono: TextStyle;
}

function fontsFor(c: Palette): Fonts {
  return {
    title: {fontSize: 22, fontWeight: '700', color: c.text},
    section: {fontSize: 13, fontWeight: '600', color: c.textDim},
    body: {fontSize: 15, color: c.text},
    dim: {fontSize: 13, color: c.textDim, lineHeight: 19},
    faint: {fontSize: 12, color: c.textFaint, lineHeight: 17},
    pill: {fontSize: 11, fontWeight: '600'},
    mono: {fontSize: 12, color: c.textDim, fontFamily: 'monospace'},
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
  const rnSystem = useColorScheme();
  const [syncedSystem, setSyncedSystem] = useState<ColorScheme | null>(null);

  useEffect(() => {
    if (mode !== 'system') {
      return;
    }
    let cancelled = false;
    const sync = () => {
      getSystemColorScheme().then(scheme => {
        if (!cancelled && scheme != null) {
          setSyncedSystem(scheme);
        }
      });
    };
    sync();
    const appearanceSub = Appearance.addChangeListener(({colorScheme}) => {
      if (colorScheme === 'light' || colorScheme === 'dark') {
        setSyncedSystem(colorScheme);
      } else {
        setSyncedSystem(null);
      }
    });
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        sync();
      }
    });
    return () => {
      cancelled = true;
      appearanceSub.remove();
      appStateSub.remove();
    };
  }, [mode]);

  if (mode !== 'system') {
    return mode;
  }
  const effective =
    syncedSystem ?? (rnSystem === 'light' || rnSystem === 'dark' ? rnSystem : null);
  return effective === 'light' ? 'light' : 'dark';
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
