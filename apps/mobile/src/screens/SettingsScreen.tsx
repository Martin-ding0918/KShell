import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  BackHandler,
  Clipboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  activeSecrets,
  installVerifier,
  isNewer as isNewerVersion,
  LockConfig,
  MachineRecord,
  recordLockFailure,
  ReleaseInfo,
} from '@zshell/core-shell';
import {biometricAuth} from '../biometric';
import {
  buildLockVerifier,
  decryptBackupAsync,
  encryptBackupAsync,
  secureRandomBytes,
  verifySecretAsync,
} from '../securekdf';
import {LegalDocModal} from '../components/LegalDocModal';
import {ListRow} from '../components/ListRow';
import {MarkdownText} from '../components/MarkdownText';
import {PageHeader} from '../components/PageHeader';
import {LegalDoc} from '../legal';
import {AppPrefs, loadPrefs, notifications} from '../notifications';
import {privacyWindow} from '../privacyWindow';
import {
  queryDownloads,
  shareTextFile,
  startUpdateDownload,
} from '../downloads';
import {clearLockAttempts, loadLockAttempts, saveLockAttempts} from '../storage';
import {fetchLatestRelease} from '../updater';
import {biometricLabel} from './LockScreen';
import {makeStyles, radius, ThemeMode, useTheme} from '../theme';
import {APP_VERSION} from '../version';
import {
  AboutSettingsPanel,
  BackupSettingsPanel,
  LockSettingsPanel,
  PrivacySettingsPanel,
  Step,
  UpdateSettingsPanel,
  UpdateState,
  VerifyCard,
} from './settings/SettingsPanels';

interface SettingsScreenProps {
  visible: boolean;
  unlocked: boolean;
  lock: LockConfig;
  onSaveLock: (config: LockConfig) => void;
  machines: MachineRecord[];
  onImportMachines: (
    records: unknown,
  ) => {added: number; updated: number};
  onSignOutWebLogin: () => Promise<void>;
  onSensitiveChange?: (sensitive: boolean) => void;
  onBack: () => void;
  onOpenPermissions: () => void;
  onOpenDownloads: () => void;
  onOpenDataManage: () => void;
  onOpenDiagnostics: () => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
}

const THEME_OPTIONS: Array<{mode: ThemeMode; label: string}> = [
  {mode: 'light', label: '浅色'},
  {mode: 'system', label: '跟随系统'},
  {mode: 'dark', label: '深色'},
];

type SubPanel = null | 'lock' | 'privacy' | 'backup' | 'update' | 'about';

const PANEL_TITLE: Record<Exclude<SubPanel, null>, string> = {
  lock: '应用锁',
  privacy: '隐私与网页登录',
  backup: '备份与恢复',
  update: '检查更新',
  about: '协议与诊断信息',
};

/** Streamlined Plan A settings overview with dedicated sub-panels. */
export function SettingsScreen({
  visible,
  unlocked,
  lock,
  onSaveLock,
  machines,
  onImportMachines,
  onSignOutWebLogin,
  onSensitiveChange,
  onBack,
  onOpenPermissions,
  onOpenDownloads,
  onOpenDataManage,
  onOpenDiagnostics,
  themeMode,
  onChangeThemeMode,
}: SettingsScreenProps) {
  const {font} = useTheme();
  const styles = useStyles();
  const [subPanel, setSubPanel] = useState<SubPanel>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string | undefined>();
  const [step, setStep] = useState<Step>({kind: 'idle'});
  const [password, setPasswordValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<LegalDoc | null>(null);
  const [update, setUpdate] = useState<UpdateState>({kind: 'idle'});
  const [progress, setProgress] = useState<{bytes: number; total: number} | null>(null);
  const [openApkError, setOpenApkError] = useState<string | null>(null);
  const [notesRelease, setNotesRelease] = useState<ReleaseInfo | null>(null);
  const [prefs, setPrefs] = useState<AppPrefs>(() => loadPrefs());
  const [recentsMask, setRecentsMask] = useState<boolean | null>(null);

  const [backupMode, setBackupMode] = useState<'export' | 'restore' | null>(null);
  const [backupPass, setBackupPass] = useState('');
  const [backupPass2, setBackupPass2] = useState('');
  const [restoreBlob, setRestoreBlob] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [backupBlob, setBackupBlob] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [webClearArm, setWebClearArm] = useState(false);
  const [webClearResult, setWebClearResult] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(loadLockAttempts);
  const [now, setNow] = useState(Date.now);
  const [verifying, setVerifying] = useState(false);
  const verifyInFlight = useRef(false);
  const biometricInFlight = useRef(false);
  const mountedRef = useRef(true);
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const verifyRemaining = Math.max(0, Math.ceil((attempts.retryAt - now) / 1000));
  const verifyCoolingDown = verifyRemaining > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    privacyWindow?.getRecentsMaskEnabled().then(setRecentsMask);
  }, []);

  useEffect(() => {
    if (visible) {
      setPrefs(loadPrefs());
      setAttempts(loadLockAttempts());
      setNow(Date.now());
    }
  }, [visible]);

  useEffect(() => {
    if (!verifyCoolingDown) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [verifyCoolingDown]);

  // Wipe sensitive in-memory state and dismiss all modals as soon as the app locks.
  useEffect(() => {
    if (!unlocked) {
      setSubPanel(null);
      setBackupBlob(null);
      setBackupMode(null);
      setBackupPass('');
      setBackupPass2('');
      setRestoreBlob('');
      setRestorePass('');
      setPasswordValue('');
      setStep({kind: 'idle'});
      setOpenDoc(null);
      setNotesRelease(null);
      setError(null);
    }
  }, [unlocked]);

  useEffect(() => {
    onSensitiveChange?.(backupMode != null || backupBlob != null || step.kind !== 'idle');
  }, [backupMode, backupBlob, step.kind, onSensitiveChange]);

  useEffect(() => {
    return () => {
      onSensitiveChange?.(false);
    };
  }, [onSensitiveChange]);

  useEffect(() => {
    biometricAuth.isAvailable().then(r => {
      setBiometricAvailable(r.available);
      setBiometricType(r.type);
    });
  }, []);

  const closeSubPanel = useCallback(() => {
    setSubPanel(null);
    setStep({kind: 'idle'});
    setBackupMode(null);
    setPasswordValue('');
    setBackupPass('');
    setBackupPass2('');
    setRestoreBlob('');
    setRestorePass('');
    setError(null);
    setWebClearArm(false);
  }, []);

  // Intercept Android hardware back while inside a settings sub-panel.
  useEffect(() => {
    if (!visible || subPanel == null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSubPanel();
      return true;
    });
    return () => sub.remove();
  }, [visible, subPanel, closeSubPanel]);

  const secrets = activeSecrets(lock);
  const onlyBiometric = lock.methods.biometric && secrets.length === 0;
  const enabledNames = [
    lock.methods.biometric ? biometricLabel(biometricType) : null,
    lock.methods.pattern != null ? '图案' : null,
    lock.methods.password != null ? '密码' : null,
  ].filter((n): n is string => n != null);

  // ---------- lock & verification handlers ----------

  const requestVerify = (title: string, action: () => void) => {
    setPasswordValue('');
    setError(null);
    setAttempts(loadLockAttempts());
    setNow(Date.now());
    setStep({kind: 'verify', title, action});
  };

  const verifyBySecret = (
    kind: 'pattern' | 'password',
    secret: string,
    action: () => void,
  ) => {
    if (verifyInFlight.current || attempts.retryAt > Date.now() || !secret) {
      return;
    }
    verifyInFlight.current = true;
    setVerifying(true);
    verifySecretAsync(secret, kind, lock)
      .then(ok => {
        if (ok) {
          clearLockAttempts();
          setAttempts({failures: 0, retryAt: 0});
          setStep({kind: 'idle'});
          setError(null);
          setPasswordValue('');
          action();
        } else {
          const time = Date.now();
          const next = recordLockFailure(attempts, time);
          setAttempts(next);
          setNow(time);
          saveLockAttempts(next);
          setPasswordValue('');
          setError('验证失败');
        }
      })
      .catch(() => setError('验证暂不可用，请重试'))
      .finally(() => {
        verifyInFlight.current = false;
        setVerifying(false);
      });
  };

  const finishPatternSet = (secret: string) => {
    secureRandomBytes(16)
      .then(salt => buildLockVerifier(secret, salt))
      .then(verifier => {
        onSaveLock(installVerifier(lock, 'pattern', verifier));
        setStep({kind: 'idle'});
        setError(null);
      })
      .catch(() => setError('保存失败：无法生成安全随机数或计算哈希，请重试'));
  };

  const finishPasswordSet = (secret: string) => {
    secureRandomBytes(16)
      .then(salt => buildLockVerifier(secret, salt))
      .then(verifier => {
        onSaveLock(installVerifier(lock, 'password', verifier));
        setStep({kind: 'idle'});
        setError(null);
        setPasswordValue('');
      })
      .catch(() => setError('保存失败：无法生成安全随机数或计算哈希，请重试'));
  };

  const submitPasswordSet = () => {
    if (step.kind !== 'passwordSet') return;
    if (password.length < 4) {
      setError('密码至少 4 位');
      return;
    }
    if (step.first == null) {
      setStep({...step, first: password});
      setPasswordValue('');
      setError(null);
    } else if (step.first === password) {
      finishPasswordSet(password);
    } else {
      setError('两次密码不一致');
      setStep({...step, first: null});
      setPasswordValue('');
    }
  };

  // ---------- backup handlers ----------

  const doExportBackup = async () => {
    setError(null);
    if (backupPass.length < 12) {
      setError('备份口令至少 12 位');
      return;
    }
    if (backupPass !== backupPass2) {
      setError('两次口令不一致');
      return;
    }
    if (machines.length === 0) {
      setError('还没有配对的机器，无需备份');
      return;
    }
    const payload = JSON.stringify({
      format: 'zshell-machines',
      v: 1,
      exportedAt: Date.now(),
      machines,
    });
    try {
      const blob = await encryptBackupAsync(payload, backupPass, await secureRandomBytes(16));
      if (!mountedRef.current || !unlockedRef.current) return;
      setBackupBlob(blob);
    } catch {
      if (mountedRef.current && unlockedRef.current) {
        setError('备份失败：无法生成加密数据，请重试');
      }
      return;
    }
    setBackupPass('');
    setBackupPass2('');
  };

  const doRestoreBackup = async () => {
    setError(null);
    setRestoreResult(null);
    let json: string | null;
    try {
      json = await decryptBackupAsync(restoreBlob.trim(), restorePass);
    } catch {
      if (mountedRef.current && unlockedRef.current) {
        setError('解密失败：口令不对，或备份内容损坏');
      }
      return;
    }
    if (!mountedRef.current || !unlockedRef.current) return;
    if (json == null) {
      setError('解密失败：口令不对，或备份内容损坏');
      return;
    }
    let parsed: {format?: unknown; machines?: unknown};
    try {
      parsed = JSON.parse(json);
    } catch {
      setError('备份内容无效');
      return;
    }
    if (parsed.format !== 'zshell-machines' || !Array.isArray(parsed.machines)) {
      setError('这不是有效的配对备份');
      return;
    }
    const r = onImportMachines(parsed.machines);
    setRestoreResult(`恢复完成：新增 ${r.added} 台，更新凭据 ${r.updated} 台`);
    setRestoreBlob('');
    setRestorePass('');
  };

  // ---------- update flow ----------

  const checkUpdate = async () => {
    setUpdate({kind: 'checking'});
    const release = await fetchLatestRelease();
    if (release == null) {
      setUpdate({kind: 'failed'});
      return;
    }
    setUpdate(
      isNewerVersion(APP_VERSION, release)
        ? {kind: 'available', release}
        : {kind: 'latest', release},
    );
  };

  const startDownload = async (release: ReleaseInfo) => {
    setOpenApkError(null);
    setProgress(null);
    try {
      const id = await startUpdateDownload(release);
      setUpdate({kind: 'downloading', release, id});
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : '未知原因';
      setUpdate({kind: 'downloadFailed', release, reason});
    }
  };

  useEffect(() => {
    if (!visible || (update.kind !== 'downloading' && update.kind !== 'downloadPaused')) {
      return;
    }
    const {release, id} = update;
    const wasPaused = update.kind === 'downloadPaused';
    let cancelled = false;
    const poll = async () => {
      try {
        const items = await queryDownloads();
        if (cancelled) return;
        const item = items.find(i => i.id === id);
        if (item == null) {
          setUpdate({kind: 'available', release});
          setProgress(null);
          return;
        }
        if (item.status === 'successful') {
          setUpdate({kind: 'downloaded', release, id});
          setProgress(null);
          return;
        }
        if (item.status === 'failed') {
          setUpdate({kind: 'downloadFailed', release, reason: item.reason ?? '未知原因'});
          setProgress(null);
          return;
        }
        if (item.status === 'paused') {
          if (!wasPaused) {
            if (loadPrefs().notificationsEnabled && notifications != null) {
              notifications.notify(
                7,
                '更新下载已暂停',
                `${item.reason ?? '已暂停'}，网络恢复后会自动继续，也可点开应用处理`,
              );
            }
            setUpdate({kind: 'downloadPaused', release, id, reason: item.reason});
            setProgress(null);
          }
          return;
        }
        if (wasPaused) {
          setUpdate({kind: 'downloading', release, id});
          return;
        }
        setProgress({bytes: item.bytesSoFar, total: item.totalBytes});
      } catch {
        // transient query failure — keep waiting
      }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [update, visible]);

  const verifyCard =
    step.kind === 'verify' ? (
      <VerifyCard
        step={step}
        lock={lock}
        biometricAvailable={biometricAvailable}
        biometricType={biometricType}
        biometricInFlight={biometricInFlight}
        mountedRef={mountedRef}
        unlockedRef={unlockedRef}
        password={password}
        setPasswordValue={setPasswordValue}
        verifying={verifying}
        verifyRemaining={verifyRemaining}
        error={error}
        setError={setError}
        onBiometricVerified={action => {
          setAttempts({failures: 0, retryAt: 0});
          setStep({kind: 'idle'});
          setError(null);
          action();
        }}
        verifyBySecret={verifyBySecret}
        onCancel={() => {
          setStep({kind: 'idle'});
          setPasswordValue('');
          setError(null);
        }}
      />
    ) : null;

  const updateBadge =
    update.kind === 'available' || update.kind === 'downloaded'
      ? `有新版本 v${update.release.version}`
      : undefined;
  const updateValue =
    update.kind === 'downloading'
      ? '下载中…'
      : update.kind === 'downloadPaused'
        ? '已暂停'
        : update.kind === 'latest'
          ? '已是最新'
          : undefined;

  return (
    <View style={styles.root}>
      <PageHeader
        title={subPanel == null ? '设置' : PANEL_TITLE[subPanel]}
        onBack={subPanel == null ? onBack : closeSubPanel}
        backLabel={subPanel == null ? '返回列表' : '返回设置'}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={visible ? 'auto' : 'none'}
        keyboardShouldPersistTaps="handled">
        {subPanel == null ? (
          <>
            {/* 外观 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>外观</Text>
              <View style={styles.segment} accessibilityRole="radiogroup">
                {THEME_OPTIONS.map(opt => {
                  const active = themeMode === opt.mode;
                  return (
                    <TouchableOpacity
                      key={opt.mode}
                      style={[styles.segmentItem, active && styles.segmentItemActive]}
                      accessibilityRole="radio"
                      accessibilityState={{selected: active}}
                      onPress={() => onChangeThemeMode(opt.mode)}>
                      <Text
                        style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[font.faint, {textAlign: 'center'}]}>
                {themeMode === 'system'
                  ? '随系统深色模式自动切换'
                  : '已固定外观，不随系统切换'}
              </Text>
            </View>

            {/* 安全与隐私 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>安全与隐私</Text>
              <ListRow
                icon="lock"
                title="应用锁"
                value={lock.enabled ? enabledNames.join(' + ') : '未启用'}
                onPress={() => setSubPanel('lock')}
              />
              <ListRow
                icon="eye-off"
                title="隐私与网页登录"
                value={recentsMask === false ? '遮罩已关' : '遮罩已开'}
                onPress={() => setSubPanel('privacy')}
                showDivider
              />
            </View>

            {/* 通用与数据 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>通用与数据</Text>
              <ListRow
                icon="bell"
                title="通知与权限"
                onPress={onOpenPermissions}
              />
              <ListRow
                icon="download"
                title="下载管理"
                onPress={onOpenDownloads}
                showDivider
              />
              <ListRow
                icon="backup"
                title="备份与恢复"
                onPress={() => setSubPanel('backup')}
                showDivider
              />
              <ListRow
                icon="database"
                title="数据管理"
                onPress={onOpenDataManage}
                showDivider
              />
            </View>

            {/* 关于与更新 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>关于与更新</Text>
              <ListRow
                icon="refresh"
                title="检查更新"
                badge={updateBadge}
                badgeDot={updateBadge != null}
                value={updateValue}
                onPress={() => setSubPanel('update')}
              />
              <ListRow
                icon="info"
                title="协议与诊断信息"
                value={`v${APP_VERSION}`}
                onPress={() => setSubPanel('about')}
                showDivider
              />
            </View>
          </>
        ) : null}

        {subPanel === 'lock' ? (
          <LockSettingsPanel
            lock={lock}
            enabledNames={enabledNames}
            onlyBiometric={onlyBiometric}
            biometricAvailable={biometricAvailable}
            biometricType={biometricType}
            biometricInFlight={biometricInFlight}
            mountedRef={mountedRef}
            unlockedRef={unlockedRef}
            step={step}
            setStep={setStep}
            password={password}
            setPasswordValue={setPasswordValue}
            error={error}
            setError={setError}
            onSaveLock={onSaveLock}
            requestVerify={requestVerify}
            finishPatternSet={finishPatternSet}
            submitPasswordSet={submitPasswordSet}
            verifyCard={verifyCard}
          />
        ) : null}

        {subPanel === 'privacy' ? (
          <PrivacySettingsPanel
            recentsMask={recentsMask}
            setRecentsMask={setRecentsMask}
            prefs={prefs}
            setPrefs={setPrefs}
            onSignOutWebLogin={onSignOutWebLogin}
            webClearArm={webClearArm}
            setWebClearArm={setWebClearArm}
            webClearResult={webClearResult}
            setWebClearResult={setWebClearResult}
          />
        ) : null}

        {subPanel === 'backup' ? (
          <BackupSettingsPanel
            lock={lock}
            backupMode={backupMode}
            setBackupMode={setBackupMode}
            backupPass={backupPass}
            setBackupPass={setBackupPass}
            backupPass2={backupPass2}
            setBackupPass2={setBackupPass2}
            restoreBlob={restoreBlob}
            setRestoreBlob={setRestoreBlob}
            restorePass={restorePass}
            setRestorePass={setRestorePass}
            restoreResult={restoreResult}
            setRestoreResult={setRestoreResult}
            error={error}
            setError={setError}
            requestVerify={requestVerify}
            doExportBackup={doExportBackup}
            doRestoreBackup={doRestoreBackup}
            verifyCard={verifyCard}
          />
        ) : null}

        {subPanel === 'update' ? (
          <UpdateSettingsPanel
            update={update}
            setUpdate={setUpdate}
            progress={progress}
            setProgress={setProgress}
            openApkError={openApkError}
            setOpenApkError={setOpenApkError}
            prefs={prefs}
            setPrefs={setPrefs}
            checkUpdate={checkUpdate}
            startDownload={startDownload}
            setNotesRelease={setNotesRelease}
          />
        ) : null}

        {subPanel === 'about' ? (
          <AboutSettingsPanel
            onOpenDoc={setOpenDoc}
            onOpenDiagnostics={onOpenDiagnostics}
          />
        ) : null}
      </ScrollView>

      <LegalDocModal doc={visible ? openDoc : null} onClose={() => setOpenDoc(null)} />

      {/* Backup result viewer (encrypted blob: copy or save as a file). */}
      <Modal
        visible={visible && backupBlob != null}
        animationType="slide"
        onRequestClose={() => setBackupBlob(null)}>
        <View style={styles.root}>
          <PageHeader
            title="配对备份"
            onBack={() => setBackupBlob(null)}
            backLabel="完成"
          />
          <ScrollView contentContainerStyle={{padding: 20, gap: 14}}>
            <Text style={font.faint}>
              这段文本包含全部配对记录（已用口令加密）。保存到你的收藏、网盘或
              备忘录均可；口令和文本缺一不可，口令丢失无法找回。
            </Text>
            <View style={styles.blobBox}>
              <Text style={styles.blobText} selectable>
                {backupBlob}
              </Text>
            </View>
            <View style={{flexDirection: 'row', gap: 10}}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  if (backupBlob != null) {
                    Clipboard.setString(backupBlob);
                  }
                }}>
                <Text style={styles.modalButtonText}>复制文本</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  if (backupBlob != null) {
                    shareTextFile('zshell-backup.txt', backupBlob).catch(() => {});
                  }
                }}>
                <Text style={styles.modalButtonText}>保存 / 分享为文件</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Full update-notes viewer (markdown-rendered CHANGELOG section). */}
      <Modal
        visible={visible && notesRelease != null}
        animationType="slide"
        onRequestClose={() => setNotesRelease(null)}>
        <View style={styles.root}>
          <PageHeader
            title={`v${notesRelease?.version ?? ''} 更新说明`}
            onBack={() => setNotesRelease(null)}
          />
          <ScrollView contentContainerStyle={{padding: 20, paddingBottom: 40}}>
            <MarkdownText text={notesRelease?.notes ?? ''} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles(colors => ({
  root: {flex: 1, backgroundColor: colors.bg},
  scroll: {flex: 1},
  content: {padding: 16, gap: 14, paddingBottom: 32},
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  cardTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.s,
  },
  segmentItemActive: {
    backgroundColor: colors.pillActive,
  },
  segmentText: {color: colors.textDim, fontSize: 14, fontWeight: '500'},
  segmentTextActive: {color: colors.text, fontWeight: '600'},
  blobBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  blobText: {
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: 'monospace',
  },
  modalButton: {
    flex: 1,
    backgroundColor: colors.bgInput,
    borderRadius: radius.s,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalButtonText: {color: colors.text, fontSize: 14, fontWeight: '500'},
}));
