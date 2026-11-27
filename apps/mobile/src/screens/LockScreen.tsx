import React, {useEffect, useRef, useState} from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {activeSecrets, LockConfig, patternToString, recordLockFailure} from '@zshell/core-shell';
import {biometricAuth} from '../biometric';
import {Icon} from '../components/Icon';
import {SecretInput} from '../components/SecretInput';
import {verifySecretAsync} from '../securekdf';
import {PatternPad} from '../PatternPad';
import {clearLockAttempts, loadLockAttempts, saveLockAttempts} from '../storage';
import {makeStyles, radius, useTheme} from '../theme';

type SecretKind = 'pattern' | 'password';
type Mode = 'biometric' | SecretKind;

interface LockScreenProps {
  config: LockConfig;
  onUnlock: () => void;
}

/** Resolve a user-facing biometric name from the platform-reported type. */
export function biometricLabel(type?: string): string {
  if (type === 'FaceID') {
    return '人脸';
  }
  if (type === 'TouchID') {
    return '指纹';
  }
  return '生物识别';
}

/**
 * Unlock screen. With biometric enabled the screen opens in a biometric-only
 * state: the prompt fires by itself (only while the app is foreground —
 * firing from the background pops a system dialog over the launcher) and the
 * pattern/password inputs stay hidden until it fails or is cancelled, so the
 * entry view isn't a pile of every method at once. Every enabled method
 * remains one tap away — one unavailable method never locks the user out.
 */
export function LockScreen({config, onUnlock}: LockScreenProps) {
  const {colors, font} = useTheme();
  const styles = useStyles();
  const secrets = activeSecrets(config);
  const [mode, setMode] = useState<Mode>(
    config.methods.biometric ? 'biometric' : (secrets[0] ?? 'password'),
  );
  const [secretInput, setSecretInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(loadLockAttempts);
  const [now, setNow] = useState(Date.now);
  const [verifying, setVerifying] = useState(false);
  const pending = useRef(false);
  const biometricInFlight = useRef(false);
  const mounted = useRef(true);
  const remaining = Math.max(0, Math.ceil((attempts.retryAt - now) / 1000));

  useEffect(() => {
    mounted.current = true;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, []);

  const coolingDown = remaining > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [coolingDown]);

  const unlock = () => {
    clearLockAttempts();
    onUnlock();
  };
  const [bioType, setBioType] = useState<string | undefined>(undefined);

  // Auto biometric prompt. Deferred until the app is actually in the
  // foreground: this screen mounts as soon as the app relocks on
  // backgrounding, and prompting from there would flash the system dialog
  // over the launcher (or straight-up fail).
  useEffect(() => {
    if (!config.methods.biometric) {
      return;
    }
    let cancelled = false;
    let prompted = false;
    const promptOnce = async () => {
      if (prompted || cancelled || biometricInFlight.current || AppState.currentState !== 'active') {
        return;
      }
      biometricInFlight.current = true;
      try {
        const r = await biometricAuth.isAvailable();
        if (cancelled || AppState.currentState !== 'active') {
          return;
        }
        setBioType(r.type);
        if (!r.available) {
          setError(`${biometricLabel(r.type)}不可用，请使用备用方式解锁`);
          if (secrets.length > 0) {
            setMode(secrets[0]);
          }
          return;
        }
        prompted = true;
        const ok = await biometricAuth.prompt('验证身份以打开 KShell');
        if (cancelled) {
          return;
        }
        if (ok) {
          if (AppState.currentState === 'active') unlock();
        } else {
          setError(`${biometricLabel(r.type)}验证未通过`);
          if (secrets.length > 0) {
            setMode(secrets[0]);
          }
        }
      } finally {
        biometricInFlight.current = false;
      }
    };
    const startPrompt = () => promptOnce().catch(() => {
      if (!cancelled) setError('生物识别暂不可用');
    });
    if (AppState.currentState === 'active') startPrompt();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        startPrompt();
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trySecret = async (kind: SecretKind, secret: string) => {
    if (pending.current || attempts.retryAt > Date.now() || !secret) return;
    pending.current = true;
    setVerifying(true);
    setError(null);
    try {
      const ok = await verifySecretAsync(secret, kind, config);
      if (!mounted.current) return;
      if (ok) {
        if (AppState.currentState === 'active') unlock();
      } else {
        const time = Date.now();
        const next = recordLockFailure(attempts, time);
        setAttempts(next);
        setNow(time);
        setSecretInput('');
        saveLockAttempts(next);
        setError('验证失败，请重试');
      }
    } catch {
      if (mounted.current) setError('验证暂不可用，请重试');
    } finally {
      pending.current = false;
      if (mounted.current) setVerifying(false);
    }
  };

  const switchTo = (kind: Mode) => {
    setMode(kind);
    setError(null);
    setSecretInput('');
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.lockBadge}>
        <Icon name="lock" size={28} color={colors.accent} />
      </View>
      <Text style={styles.title}>KShell 已锁定</Text>
      <Text style={font.dim}>
        {mode === 'biometric'
          ? '使用生物识别解锁'
          : mode === 'pattern'
            ? '绘制图案解锁'
            : '输入密码解锁'}
      </Text>

      {mode === 'biometric' ? (
        <View style={{marginTop: 40, width: '100%', gap: 14, alignItems: 'center'}}>
          <TouchableOpacity
            style={styles.button}
            onPress={async () => {
              if (biometricInFlight.current || AppState.currentState !== 'active') return;
              biometricInFlight.current = true;
              setError(null);
              try {
                const ok = await biometricAuth.prompt('验证身份以打开 KShell');
                if (!mounted.current) return;
                if (ok) {
                  if (AppState.currentState === 'active') unlock();
                } else {
                  setError(`${biometricLabel(bioType)}验证未通过`);
                  if (secrets.length > 0) setMode(secrets[0]);
                }
              } catch {
                if (mounted.current) setError('生物识别暂不可用');
              } finally {
                biometricInFlight.current = false;
              }
            }}>
            <Text style={styles.buttonText}>
              使用{biometricLabel(bioType)}解锁
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'pattern' ? (
        <View style={{marginTop: 40, alignItems: 'center'}}>
          <PatternPad
            hint={remaining > 0 ? `请等待 ${remaining} 秒` : error ?? '至少连接 4 个点'}
            onComplete={dots => trySecret('pattern', patternToString(dots))}
          />
        </View>
      ) : null}

      {mode === 'password' ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{width: '100%', marginTop: 40}}>
          <SecretInput
            placeholder="密码"
            autoFocus
            editable={!verifying && remaining === 0}
            value={secretInput}
            onChangeText={setSecretInput}
            onSubmitEditing={() => trySecret('password', secretInput)}
          />
          <TouchableOpacity
            style={styles.button}
            disabled={verifying || remaining > 0}
            onPress={() => trySecret('password', secretInput)}>
            <Text style={styles.buttonText}>解锁</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      ) : null}

      {/* Method switcher: any other enabled method is one tap away. */}
      <View style={styles.switchRow}>
        {config.methods.biometric && mode !== 'biometric' ? (
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => switchTo('biometric')}>
            <Text style={styles.switchText}>
              使用{biometricLabel(bioType)}
            </Text>
          </TouchableOpacity>
        ) : null}
        {secrets.includes('pattern') && mode !== 'pattern' ? (
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => switchTo('pattern')}>
            <Text style={styles.switchText}>使用图案</Text>
          </TouchableOpacity>
        ) : null}
        {secrets.includes('password') && mode !== 'password' ? (
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => switchTo('password')}>
            <Text style={styles.switchText}>使用密码</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error != null ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
      {remaining > 0 ? (
        <Text style={styles.error}>请等待 {remaining} 秒后重试</Text>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors, font) => ({
  root: {flex: 1, backgroundColor: colors.bg},
  content: {flexGrow: 1, alignItems: 'center', padding: 24, paddingTop: 80},
  title: {...font.title, marginBottom: 8},
  lockBadge: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.iconBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 40,
  },
  buttonText: {color: colors.onAccent, fontSize: 15, fontWeight: '600'},
  switchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 36,
  },
  switchButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.s,
    backgroundColor: colors.accentSoft,
  },
  switchText: {color: colors.accent, fontSize: 14},
  error: {color: colors.danger, marginTop: 16, fontSize: 13, textAlign: 'center'},
}));
