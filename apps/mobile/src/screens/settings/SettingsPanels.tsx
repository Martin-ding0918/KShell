import React from 'react';
import {
  AppState,
  Clipboard,
  Linking,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  clearMethod,
  formatBytes,
  formatPercent,
  LockConfig,
  patternToString,
  ReleaseInfo,
  setBiometric,
} from '@zshell/core-shell';
import {Icon} from '../../components/Icon';
import {ListRow} from '../../components/ListRow';
import {SecretInput} from '../../components/SecretInput';
import {biometricAuth} from '../../biometric';
import {
  openDownloadedFile,
  openInBrowser,
  removeDownload,
  resumeDownload,
} from '../../downloads';
import {LegalDoc, OSS_LICENSES, PRIVACY_POLICY, USER_AGREEMENT} from '../../legal';
import {AppPrefs, loadPrefs, savePrefs} from '../../notifications';
import {PatternPad} from '../../PatternPad';
import {privacyWindow} from '../../privacyWindow';
import {clearLockAttempts} from '../../storage';
import {makeStyles, radius, useTheme} from '../../theme';
import {PROJECT_PAGE} from '../../updater';
import {APP_VERSION} from '../../version';
import {biometricLabel} from '../LockScreen';

export type Step =
  | {kind: 'idle'}
  | {kind: 'patternSet'; confirmOf: string | null}
  | {kind: 'passwordSet'; first: string | null}
  | {kind: 'verify'; title: string; action: () => void};

export type UpdateState =
  | {kind: 'idle'}
  | {kind: 'checking'}
  | {kind: 'failed'}
  | {kind: 'latest'; release: ReleaseInfo}
  | {kind: 'available'; release: ReleaseInfo}
  | {kind: 'downloading'; release: ReleaseInfo; id: number}
  | {kind: 'downloadPaused'; release: ReleaseInfo; id: number; reason?: string}
  | {kind: 'downloaded'; release: ReleaseInfo; id: number}
  | {kind: 'downloadFailed'; release: ReleaseInfo; reason: string};

interface VerifyBoxProps {
  step: Extract<Step, {kind: 'verify'}>;
  lock: LockConfig;
  biometricAvailable: boolean;
  biometricType?: string;
  biometricInFlight: React.MutableRefObject<boolean>;
  mountedRef: React.MutableRefObject<boolean>;
  unlockedRef: React.MutableRefObject<boolean>;
  password: string;
  setPasswordValue: (v: string) => void;
  verifying: boolean;
  verifyRemaining: number;
  error: string | null;
  setError: (e: string | null) => void;
  onBiometricVerified: (action: () => void) => void;
  verifyBySecret: (kind: 'pattern' | 'password', secret: string, action: () => void) => void;
  onCancel: () => void;
}

export function VerifyCard({
  step,
  lock,
  biometricAvailable,
  biometricType,
  biometricInFlight,
  mountedRef,
  unlockedRef,
  password,
  setPasswordValue,
  verifying,
  verifyRemaining,
  error,
  setError,
  onBiometricVerified,
  verifyBySecret,
  onCancel,
}: VerifyBoxProps) {
  const {colors, font} = useTheme();
  const styles = usePanelStyles();

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>身份验证</Text>
      <Text style={font.dim}>{step.title}（可用任意已启用的方式）</Text>
      {lock.methods.biometric && biometricAvailable ? (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={async () => {
            if (biometricInFlight.current) {
              return;
            }
            biometricInFlight.current = true;
            setError(null);
            try {
              const ok = await biometricAuth.prompt('验证以继续');
              if (!mountedRef.current || !unlockedRef.current) {
                return;
              }
              if (ok && AppState.currentState === 'active') {
                clearLockAttempts();
                onBiometricVerified(step.action);
              } else if (!ok) {
                setError('验证未通过');
              }
            } catch {
              if (mountedRef.current && unlockedRef.current) {
                setError('生物识别暂不可用，请使用备用方式');
              }
            } finally {
              biometricInFlight.current = false;
            }
          }}>
          <Text style={styles.primaryButtonText}>使用{biometricLabel(biometricType)}</Text>
        </TouchableOpacity>
      ) : null}
      {lock.methods.pattern != null ? (
        <View style={{alignItems: 'center', marginVertical: 10}}>
          <PatternPad
            hint={
              verifyRemaining > 0
                ? `请等待 ${verifyRemaining} 秒`
                : error ?? '绘制当前图案'
            }
            onComplete={dots =>
              verifyBySecret('pattern', patternToString(dots), step.action)
            }
          />
        </View>
      ) : null}
      {lock.methods.password != null ? (
        <>
          <SecretInput
            placeholder="当前密码"
            editable={!verifying && verifyRemaining === 0}
            value={password}
            onChangeText={setPasswordValue}
            onSubmitEditing={() => verifyBySecret('password', password, step.action)}
          />
          <TouchableOpacity
            style={styles.primaryButton}
            disabled={verifying || verifyRemaining > 0}
            onPress={() => verifyBySecret('password', password, step.action)}>
            <Text style={styles.primaryButtonText}>验证</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {verifyRemaining > 0 ? (
        <Text style={styles.errorText}>请等待 {verifyRemaining} 秒后重试</Text>
      ) : null}
      {error != null ? <Text style={styles.errorText}>{error}</Text> : null}
      <TouchableOpacity style={styles.cancelLink} onPress={onCancel}>
        <Text style={{color: colors.textDim, fontSize: 13}}>取消</Text>
      </TouchableOpacity>
    </View>
  );
}

interface LockPanelProps {
  lock: LockConfig;
  enabledNames: string[];
  onlyBiometric: boolean;
  biometricAvailable: boolean;
  biometricType?: string;
  biometricInFlight: React.MutableRefObject<boolean>;
  mountedRef: React.MutableRefObject<boolean>;
  unlockedRef: React.MutableRefObject<boolean>;
  step: Step;
  setStep: (s: Step) => void;
  password: string;
  setPasswordValue: (v: string) => void;
  error: string | null;
  setError: (e: string | null) => void;
  onSaveLock: (cfg: LockConfig) => void;
  requestVerify: (title: string, action: () => void) => void;
  finishPatternSet: (secret: string) => void;
  submitPasswordSet: () => void;
  verifyCard: React.ReactNode;
}

export function LockSettingsPanel(props: LockPanelProps) {
  const {
    lock,
    enabledNames,
    onlyBiometric,
    biometricAvailable,
    biometricType,
    biometricInFlight,
    mountedRef,
    unlockedRef,
    step,
    setStep,
    password,
    setPasswordValue,
    error,
    setError,
    onSaveLock,
    requestVerify,
    finishPatternSet,
    submitPasswordSet,
    verifyCard,
  } = props;
  const {colors, font} = useTheme();
  const styles = usePanelStyles();
  const switchColors = {
    trackColor: {false: colors.switchTrackOff, true: colors.accent},
    thumbColor: colors.switchThumb,
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>解锁方式</Text>
        <Text style={font.dim}>
          {lock.enabled
            ? `已启用：${enabledNames.join(' + ')}，任选一种即可解锁`
            : '未启用。可以同时开启多种解锁方式，避免单一方式失灵时被锁在外面'}
        </Text>
        {onlyBiometric ? (
          <Text style={styles.hintWarn}>
            当前仅启用生物识别，建议再设置图案或密码作为备用
          </Text>
        ) : null}

        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={font.body}>{biometricLabel(biometricType)}</Text>
            <Text style={font.faint}>
              {biometricAvailable
                ? '验证通过后开启；使用系统指纹 / 人脸'
                : '本机暂无可用生物识别（容器/模拟器通常不支持）'}
            </Text>
          </View>
          <Switch
            value={lock.methods.biometric}
            disabled={!biometricAvailable && !lock.methods.biometric}
            onValueChange={async on => {
              setError(null);
              const enableBiometric = async () => {
                if (biometricInFlight.current) return;
                biometricInFlight.current = true;
                try {
                  const ok = await biometricAuth.prompt('验证通过后开启生物识别');
                  if (!mountedRef.current || !unlockedRef.current) return;
                  if (ok && AppState.currentState === 'active') {
                    onSaveLock(setBiometric(lock, true));
                  } else if (!ok) {
                    setError('验证未通过，未开启生物识别');
                  }
                } catch {
                  if (mountedRef.current && unlockedRef.current) {
                    setError('验证暂不可用，请重试');
                  }
                } finally {
                  biometricInFlight.current = false;
                }
              };
              if (!on) {
                requestVerify(`关闭${biometricLabel(biometricType)}`, () =>
                  onSaveLock(setBiometric(lock, false)),
                );
                return;
              }
              if (lock.enabled) {
                requestVerify(`开启${biometricLabel(biometricType)}`, () => {
                  void enableBiometric();
                });
                return;
              }
              await enableBiometric();
            }}
            {...switchColors}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={font.body}>图案</Text>
            <Text style={font.faint}>
              {lock.methods.pattern != null ? '已设置' : '未设置'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => {
              setError(null);
              if (lock.enabled) {
                requestVerify(
                  lock.methods.pattern != null ? '更换图案' : '设置图案',
                  () => {
                    setStep({kind: 'patternSet', confirmOf: null});
                    setError(null);
                  },
                );
              } else {
                setStep({kind: 'patternSet', confirmOf: null});
              }
            }}>
            <Text style={styles.rowButtonText}>
              {lock.methods.pattern != null ? '更换' : '设置'}
            </Text>
          </TouchableOpacity>
          {lock.methods.pattern != null ? (
            <TouchableOpacity
              style={styles.rowButton}
              onPress={() =>
                requestVerify('清除图案', () => onSaveLock(clearMethod(lock, 'pattern')))
              }>
              <Text style={[styles.rowButtonText, {color: colors.danger}]}>清除</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={font.body}>密码</Text>
            <Text style={font.faint}>
              {lock.methods.password != null ? '已设置' : '未设置'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => {
              setError(null);
              setPasswordValue('');
              if (lock.enabled) {
                requestVerify(
                  lock.methods.password != null ? '更换密码' : '设置密码',
                  () => {
                    setStep({kind: 'passwordSet', first: null});
                    setError(null);
                  },
                );
              } else {
                setStep({kind: 'passwordSet', first: null});
              }
            }}>
            <Text style={styles.rowButtonText}>
              {lock.methods.password != null ? '更换' : '设置'}
            </Text>
          </TouchableOpacity>
          {lock.methods.password != null ? (
            <TouchableOpacity
              style={styles.rowButton}
              onPress={() =>
                requestVerify('清除密码', () => onSaveLock(clearMethod(lock, 'password')))
              }>
              <Text style={[styles.rowButtonText, {color: colors.danger}]}>清除</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {step.kind === 'patternSet' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {step.confirmOf == null ? '设置解锁图案' : '请再画一次确认'}
          </Text>
          <View style={{alignItems: 'center', marginTop: 18, marginBottom: 24}}>
            <PatternPad
              hint={error ?? '至少连接 4 个点'}
              onComplete={dots => {
                if (dots.length < 4) {
                  setError('至少连接 4 个点');
                  return;
                }
                const secret = patternToString(dots);
                if (step.confirmOf == null) {
                  setStep({...step, confirmOf: secret});
                } else if (step.confirmOf === secret) {
                  finishPatternSet(secret);
                } else {
                  setError('两次图案不一致，请重新设置');
                  setStep({...step, confirmOf: null});
                }
              }}
            />
          </View>
          <TouchableOpacity
            style={styles.cancelLink}
            onPress={() => {
              setStep({kind: 'idle'});
              setError(null);
            }}>
            <Text style={{color: colors.textDim, fontSize: 13}}>取消</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {step.kind === 'passwordSet' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>设置密码</Text>
          <Text style={font.dim}>
            {step.first == null ? '设置解锁密码（至少 4 位）' : '请再输入一次确认'}
          </Text>
          <SecretInput
            placeholder={step.first == null ? '输入密码' : '再次输入密码'}
            value={password}
            onChangeText={setPasswordValue}
            onSubmitEditing={submitPasswordSet}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={submitPasswordSet}>
            <Text style={styles.primaryButtonText}>下一步</Text>
          </TouchableOpacity>
          {error != null ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity
            style={styles.cancelLink}
            onPress={() => {
              setStep({kind: 'idle'});
              setPasswordValue('');
              setError(null);
            }}>
            <Text style={{color: colors.textDim, fontSize: 13}}>取消</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {verifyCard}
    </>
  );
}

interface PrivacyPanelProps {
  recentsMask: boolean | null;
  setRecentsMask: (v: boolean) => void;
  prefs: AppPrefs;
  setPrefs: (p: AppPrefs) => void;
  onSignOutWebLogin: () => Promise<void>;
  webClearArm: boolean;
  setWebClearArm: (v: boolean) => void;
  webClearResult: string | null;
  setWebClearResult: (v: string | null) => void;
}

export function PrivacySettingsPanel({
  recentsMask,
  setRecentsMask,
  prefs,
  setPrefs,
  onSignOutWebLogin,
  webClearArm,
  setWebClearArm,
  webClearResult,
  setWebClearResult,
}: PrivacyPanelProps) {
  const {colors, font} = useTheme();
  const styles = usePanelStyles();
  const switchColors = {
    trackColor: {false: colors.switchTrackOff, true: colors.accent},
    thumbColor: colors.switchThumb,
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>窗口隐私</Text>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={font.body}>最近任务遮罩</Text>
            <Text style={font.faint}>
              {Platform.OS === 'android' && Platform.Version >= 36
                ? '系统原生支持：预览被遮蔽，不影响应用内截图与录屏'
                : '此系统不区分预览与截图：开启时应用内将无法截图或录屏；关闭后最近任务预览会显示应用画面'}
            </Text>
          </View>
          <Switch
            value={recentsMask ?? true}
            disabled={recentsMask == null || privacyWindow == null}
            onValueChange={on => {
              privacyWindow?.setRecentsMaskEnabled(on);
              setRecentsMask(on);
            }}
            {...switchColors}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>网页登录状态</Text>
        <Text style={font.faint}>
          控制台网页的登录数据保存在应用内：Kimi 机器共用 Kimi 账号登录（覆盖层授权），
          ZCode 机器在控制台页内登录与桌面端一致的账号
        </Text>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={font.body}>跨重启保留登录</Text>
            <Text style={font.faint}>关闭后每次启动应用都需重新登录</Text>
          </View>
          <Switch
            value={prefs.cacheWebLogin}
            onValueChange={on => {
              const next = {...loadPrefs(), cacheWebLogin: on};
              setPrefs(next);
              savePrefs(next);
              if (!on) {
                onSignOutWebLogin().catch(() => {});
              }
            }}
            {...switchColors}
          />
        </View>
        <View style={styles.divider} />
        <TouchableOpacity
          style={[styles.dangerButton, webClearArm && styles.dangerButtonArmed]}
          onPress={async () => {
            if (!webClearArm) {
              setWebClearArm(true);
              return;
            }
            setWebClearArm(false);
            try {
              await onSignOutWebLogin();
              setWebClearResult('已清除全部网页登录数据');
            } catch {
              setWebClearResult('清除失败，可稍后重试');
            }
          }}>
          <Icon name="logout" size={17} color={colors.danger} />
          <Text style={styles.dangerButtonText}>
            {webClearArm ? '再点一次确认清除' : '清除全部网页登录数据'}
          </Text>
        </TouchableOpacity>
        {webClearResult != null ? (
          <Text style={{color: colors.textDim, fontSize: 13}}>{webClearResult}</Text>
        ) : null}
      </View>
    </>
  );
}

interface BackupPanelProps {
  lock: LockConfig;
  backupMode: 'export' | 'restore' | null;
  setBackupMode: (m: 'export' | 'restore' | null) => void;
  backupPass: string;
  setBackupPass: (v: string) => void;
  backupPass2: string;
  setBackupPass2: (v: string) => void;
  restoreBlob: string;
  setRestoreBlob: (v: string) => void;
  restorePass: string;
  setRestorePass: (v: string) => void;
  restoreResult: string | null;
  setRestoreResult: (v: string | null) => void;
  error: string | null;
  setError: (e: string | null) => void;
  requestVerify: (title: string, action: () => void) => void;
  doExportBackup: () => void;
  doRestoreBackup: () => void;
  verifyCard: React.ReactNode;
}

export function BackupSettingsPanel(props: BackupPanelProps) {
  const {
    lock,
    backupMode,
    setBackupMode,
    backupPass,
    setBackupPass,
    backupPass2,
    setBackupPass2,
    restoreBlob,
    setRestoreBlob,
    restorePass,
    setRestorePass,
    restoreResult,
    setRestoreResult,
    error,
    setError,
    requestVerify,
    doExportBackup,
    doRestoreBackup,
    verifyCard,
  } = props;
  const {colors, font} = useTheme();
  const styles = usePanelStyles();

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>加密备份与恢复</Text>
        <Text style={font.faint}>
          把配对记录加密成一段文本，换机或重装后可恢复；口令丢失无法找回
        </Text>
        {backupMode == null ? (
          <View style={{flexDirection: 'row', gap: 10, marginTop: 4}}>
            <TouchableOpacity
              style={[styles.primaryButton, {flex: 1}]}
              onPress={() => {
                setError(null);
                setRestoreResult(null);
                if (lock.enabled) {
                  requestVerify('导出备份', () => setBackupMode('export'));
                } else {
                  setBackupMode('export');
                }
              }}>
              <Text style={styles.primaryButtonText}>导出备份</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, {flex: 1}]}
              onPress={() => {
                setError(null);
                setRestoreResult(null);
                if (lock.enabled) {
                  requestVerify('恢复备份', () => setBackupMode('restore'));
                } else {
                  setBackupMode('restore');
                }
              }}>
              <Text style={styles.secondaryButtonText}>从备份恢复</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {backupMode === 'export' ? (
          <View style={{gap: 10, marginTop: 4}}>
            <Text style={font.dim}>
              设置备份口令（至少 12 位，建议使用长且独特的口令，只用于加密，应用本身不保存它）
            </Text>
            <SecretInput
              placeholder="备份口令"
              value={backupPass}
              onChangeText={setBackupPass}
            />
            <SecretInput
              placeholder="再输入一次"
              value={backupPass2}
              onChangeText={setBackupPass2}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={doExportBackup}>
              <Text style={styles.primaryButtonText}>生成备份</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelLink}
              onPress={() => {
                setBackupMode(null);
                setError(null);
                setBackupPass('');
                setBackupPass2('');
              }}>
              <Text style={{color: colors.textDim, fontSize: 13}}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {backupMode === 'restore' ? (
          <View style={{gap: 10, marginTop: 4}}>
            <Text style={font.dim}>粘贴之前导出的备份文本（支持 ZSBK1 和 ZSBK2）</Text>
            <TextInput
              style={[styles.input, {height: 88, textAlignVertical: 'top'}]}
              placeholder="ZSBK2.……"
              placeholderTextColor={colors.textFaint}
              multiline
              value={restoreBlob}
              onChangeText={setRestoreBlob}
            />
            <SecretInput
              placeholder="备份口令"
              value={restorePass}
              onChangeText={setRestorePass}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={doRestoreBackup}>
              <Text style={styles.primaryButtonText}>恢复</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelLink}
              onPress={() => {
                setBackupMode(null);
                setError(null);
                setRestoreBlob('');
                setRestorePass('');
              }}>
              <Text style={{color: colors.textDim, fontSize: 13}}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {restoreResult != null ? (
          <Text style={{color: colors.success, fontSize: 13}}>{restoreResult}</Text>
        ) : null}
        {error != null && backupMode != null ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
      </View>

      {verifyCard}
    </>
  );
}

interface UpdatePanelProps {
  update: UpdateState;
  setUpdate: (u: UpdateState) => void;
  progress: {bytes: number; total: number} | null;
  setProgress: (p: {bytes: number; total: number} | null) => void;
  openApkError: string | null;
  setOpenApkError: (e: string | null) => void;
  prefs: AppPrefs;
  setPrefs: (p: AppPrefs) => void;
  checkUpdate: () => void;
  startDownload: (release: ReleaseInfo) => void;
  setNotesRelease: (r: ReleaseInfo | null) => void;
}

export function UpdateSettingsPanel({
  update,
  setUpdate,
  progress,
  setProgress,
  openApkError,
  setOpenApkError,
  prefs,
  setPrefs,
  checkUpdate,
  startDownload,
  setNotesRelease,
}: UpdatePanelProps) {
  const {colors, font} = useTheme();
  const styles = usePanelStyles();
  const switchColors = {
    trackColor: {false: colors.switchTrackOff, true: colors.accent},
    thumbColor: colors.switchThumb,
  };
  const sizeText = (bytes: number | null) =>
    bytes == null ? '' : `${Math.round(bytes / 1048576)} MB`;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>版本更新</Text>
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={font.body}>当前版本 v{APP_VERSION}</Text>
          <Text style={font.faint}>从 GitHub Releases 检查新版本</Text>
        </View>
        <TouchableOpacity
          style={styles.rowButton}
          disabled={
            update.kind === 'checking' ||
            update.kind === 'downloading' ||
            update.kind === 'downloadPaused'
          }
          onPress={checkUpdate}>
          <Text style={styles.rowButtonText}>
            {update.kind === 'checking' ? '检查中…' : '检查更新'}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={font.body}>启动时自动检查</Text>
          <Text style={font.faint}>发现新版本时本地通知提醒（不自动安装）</Text>
        </View>
        <Switch
          value={prefs.autoCheckUpdates}
          onValueChange={on => {
            const next = {...loadPrefs(), autoCheckUpdates: on};
            setPrefs(next);
            savePrefs(next);
          }}
          {...switchColors}
        />
      </View>

      {update.kind === 'failed' ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.errorText}>
            检查失败：无法访问 GitHub（国内网络可能需要代理）
          </Text>
        </>
      ) : null}

      {update.kind === 'latest' ? (
        <>
          <View style={styles.divider} />
          <View style={{gap: 8}}>
            <Text style={font.faint}>已是最新版本（v{update.release.version}）。</Text>
            <TouchableOpacity
              style={styles.rowButton}
              onPress={() => startDownload(update.release)}>
              <Text style={styles.rowButtonText}>重新下载安装当前版本</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {update.kind === 'available' ||
      update.kind === 'downloading' ||
      update.kind === 'downloadPaused' ||
      update.kind === 'downloaded' ||
      update.kind === 'downloadFailed' ? (
        <>
          <View style={styles.divider} />
          <View style={{gap: 10}}>
            <Text style={font.body}>
              新版本 v{update.release.version}
              {update.release.apkSize != null
                ? ` · ${sizeText(update.release.apkSize)}`
                : ''}
            </Text>
            {update.release.notes.length > 0 ? (
              <TouchableOpacity
                onPress={() => setNotesRelease(update.release)}
                activeOpacity={0.7}>
                <Text style={font.faint} numberOfLines={4}>
                  {update.release.notes}
                </Text>
                <Text style={{color: colors.accent, fontSize: 13, marginTop: 4}}>
                  查看完整说明 ›
                </Text>
              </TouchableOpacity>
            ) : null}
            {update.kind === 'downloading' ? (
              <View style={{gap: 6}}>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${
                          progress != null && progress.total > 0
                            ? Math.min(100, (progress.bytes / progress.total) * 100)
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
                <Text style={font.faint}>
                  {progress != null && progress.total > 0
                    ? `下载中 ${formatPercent(progress.bytes, progress.total)} · ` +
                      `${formatBytes(progress.bytes)} / ${formatBytes(progress.total)}`
                    : progress != null && progress.bytes > 0
                      ? `下载中 · ${formatBytes(progress.bytes)}`
                      : '等待开始下载…'}
                  （进度也可在 下载管理 查看，完成后自动弹出安装）
                </Text>
              </View>
            ) : null}
            {update.kind === 'downloadPaused' ? (
              <View style={{gap: 8}}>
                <Text style={styles.hintWarn}>
                  下载已暂停{update.reason ? ` · ${update.reason}` : ''}，
                  网络恢复后会自动继续
                </Text>
                <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}>
                  <TouchableOpacity
                    style={styles.rowButton}
                    onPress={() => {
                      setOpenApkError(null);
                      resumeDownload(update.id)
                        .then(newId =>
                          setUpdate({kind: 'downloading', release: update.release, id: newId}),
                        )
                        .catch(e => {
                          setOpenApkError(
                            e instanceof Error && e.message ? e.message : '无法继续下载',
                          );
                        });
                    }}>
                    <Text style={styles.rowButtonText}>继续下载</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rowButton}
                    onPress={() => {
                      removeDownload(update.id).catch(() => {});
                      setUpdate({kind: 'available', release: update.release});
                      setProgress(null);
                    }}>
                    <Text style={styles.rowButtonText}>取消下载</Text>
                  </TouchableOpacity>
                </View>
                {openApkError != null ? (
                  <Text style={styles.errorText}>{openApkError}</Text>
                ) : null}
              </View>
            ) : null}
            {update.kind === 'downloaded' ? (
              <View style={{gap: 8}}>
                <Text style={{color: colors.success, fontSize: 13}}>
                  安装包已下载完成，安装器应已自动弹出
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => {
                    setOpenApkError(null);
                    openDownloadedFile(update.id).catch(e => {
                      setOpenApkError(
                        e instanceof Error && e.message ? e.message : '无法打开安装包',
                      );
                    });
                  }}>
                  <Text style={styles.primaryButtonText}>打开安装包</Text>
                </TouchableOpacity>
                {openApkError != null ? (
                  <Text style={styles.errorText}>{openApkError}</Text>
                ) : null}
              </View>
            ) : null}
            {update.kind === 'available' ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => startDownload(update.release)}>
                <Text style={styles.primaryButtonText}>下载并安装</Text>
              </TouchableOpacity>
            ) : null}
            {update.kind === 'downloadFailed' ? (
              <View style={{gap: 8}}>
                <Text style={styles.errorText}>{update.reason}</Text>
                <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}>
                  <TouchableOpacity
                    style={styles.rowButton}
                    onPress={() => openInBrowser(update.release.apkUrl)}>
                    <Text style={styles.rowButtonText}>浏览器下载</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rowButton}
                    onPress={() => Clipboard.setString(update.release.apkUrl)}>
                    <Text style={styles.rowButtonText}>复制链接</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

export function AboutSettingsPanel({
  onOpenDoc,
  onOpenDiagnostics,
}: {
  onOpenDoc: (doc: LegalDoc) => void;
  onOpenDiagnostics: () => void;
}) {
  const {font} = useTheme();
  const styles = usePanelStyles();

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>法律与协议</Text>
        <ListRow
          title={USER_AGREEMENT.title}
          onPress={() => onOpenDoc(USER_AGREEMENT)}
        />
        <ListRow
          title={PRIVACY_POLICY.title}
          onPress={() => onOpenDoc(PRIVACY_POLICY)}
          showDivider
        />
        <ListRow
          title={OSS_LICENSES.title}
          onPress={() => onOpenDoc(OSS_LICENSES)}
          showDivider
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>诊断与项目</Text>
        <ListRow
          icon="activity"
          title="连接诊断"
          subtitle="最近 200 条连接事件时间线，仅存本机"
          onPress={onOpenDiagnostics}
        />
        <ListRow
          icon="link"
          title="项目主页（GitHub）"
          onPress={() => {
            Linking.openURL(PROJECT_PAGE).catch(() => {});
          }}
          showDivider
        />
      </View>

      <Text style={[font.faint, {textAlign: 'center', marginTop: 4}]}>
        KShell v{APP_VERSION} · 非官方第三方客户端 · 零数据收集
      </Text>
    </>
  );
}

const usePanelStyles = makeStyles(colors => ({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  rowMain: {flex: 1, gap: 2},
  rowButton: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.s,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  rowButtonText: {color: colors.text, fontSize: 13, fontWeight: '500'},
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  hintWarn: {color: colors.star, fontSize: 12},
  input: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  primaryButtonText: {color: colors.onAccent, fontSize: 14, fontWeight: '600'},
  secondaryButton: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.s,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  secondaryButtonText: {color: colors.text, fontSize: 14, fontWeight: '500'},
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.l,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  dangerButtonArmed: {backgroundColor: colors.dangerArmed},
  dangerButtonText: {color: colors.danger, fontSize: 14, fontWeight: '600'},
  cancelLink: {alignItems: 'center', paddingVertical: 4},
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgInput,
    overflow: 'hidden',
  },
  fill: {height: 4, borderRadius: 2, backgroundColor: colors.accent},
  errorText: {color: colors.danger, fontSize: 13},
}));
