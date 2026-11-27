import React, {useEffect, useMemo, useState} from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  hostKindOf,
  MachineRecord,
  relativeTime,
  sourceShortLabel,
} from '@zshell/core-shell';
import {BottomSheet} from '../components/BottomSheet';
import {Icon} from '../components/Icon';
import {makeStyles, Palette, radius, useTheme} from '../theme';

interface MachineListScreenProps {
  machines: MachineRecord[];
  /** IDs of machines currently kept alive in background WebView sessions. */
  activeSessionIds?: ReadonlyArray<string>;
  /** When false (app locked), dismiss any open management sheet. */
  unlocked?: boolean;
  onConnect: (id: string) => void;
  onScan: () => void;
  onManual: () => void;
  onSettings: () => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSetMuted: (id: string, muted: boolean) => void;
  onDelete: (id: string) => void;
  /**
   * Sign out of the web account (Kimi Code). Login data is account-level and
   * shared by every Kimi machine, so this affects all of them at once.
   */
  onSignOutWebLogin: () => void;
}

function hostOf(record: MachineRecord): string {
  try {
    return new URL(record.credentials.origin).host;
  } catch {
    return record.credentials.origin;
  }
}

type Row =
  | {type: 'host'; label: string}
  | {type: 'sub'; favorite: boolean}
  | {type: 'machine'; m: MachineRecord};

/** Show paired devices grouped by product, favorites first within a group. */
function buildRows(machines: MachineRecord[]): Row[] {
  const groups: Array<[string, MachineRecord[]]> = [
    ['Kimi Code', machines.filter(m => hostKindOf(m.credentials) === 'kimi')],
    ['ZCode', machines.filter(m => hostKindOf(m.credentials) === 'zcode')],
  ];
  const rows: Row[] = [];
  for (const [label, group] of groups) {
    if (group.length === 0) {
      continue;
    }
    rows.push({type: 'host', label: `${label} · ${group.length} 台`});
    const hasFavorites = group.some(m => m.favorite);
    let prevFav: boolean | null = null;
    for (const m of group) {
      if (hasFavorites && m.favorite !== prevFav) {
        rows.push({type: 'sub', favorite: m.favorite});
        prevFav = m.favorite;
      }
      rows.push({type: 'machine', m});
    }
  }
  return rows;
}

/** Login pill for the card: soft-filled modern minimalist pill. */
function loginPillOf(
  m: MachineRecord,
  colors: Palette,
): {label: string; color: string; bg: string} {
  if (hostKindOf(m.credentials) === 'kimi') {
    switch (m.loginState) {
      case 'logged-in':
        return {label: '已登录', color: colors.success, bg: colors.successSoft};
      case 'logged-out':
        return {label: '未登录', color: colors.danger, bg: colors.dangerSoft};
      default:
        return {label: '未确认', color: colors.textFaint, bg: colors.neutralSoft};
    }
  }
  return {label: '就绪', color: colors.textDim, bg: colors.neutralSoft};
}

function machineMeta(m: MachineRecord, now: number): string {
  return [
    sourceShortLabel(m.credentials),
    hostOf(m),
    relativeTime(m.lastUsedAt, now),
  ]
    .filter(s => s.length > 0)
    .join(' · ');
}

export function MachineListScreen(props: MachineListScreenProps) {
  const {machines, activeSessionIds = [], unlocked = true} = props;
  const {colors, font} = useTheme();
  const styles = useStyles();
  const [manageId, setManageId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteArm, setDeleteArm] = useState(false);
  const [signOutArm, setSignOutArm] = useState(false);

  const activeSet = useMemo(() => new Set(activeSessionIds), [activeSessionIds]);
  const activeCount = useMemo(
    () => machines.filter(m => activeSet.has(m.id)).length,
    [machines, activeSet],
  );
  const rows = useMemo(() => buildRows(machines), [machines]);
  const managedMachine = useMemo(
    () => (manageId != null ? machines.find(m => m.id === manageId) ?? null : null),
    [manageId, machines],
  );

  // Close sheet immediately when app locks so no Modal remains above LockScreen.
  useEffect(() => {
    if (!unlocked) {
      setManageId(null);
      setDeleteArm(false);
      setSignOutArm(false);
    }
  }, [unlocked]);

  const openManage = (m: MachineRecord) => {
    setManageId(m.id);
    setRenameValue(m.name);
    setDeleteArm(false);
    setSignOutArm(false);
  };

  const closeManage = () => {
    setManageId(null);
    setDeleteArm(false);
    setSignOutArm(false);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>我的机器</Text>
          {activeCount > 0 ? (
            <View style={styles.activeBadge} accessibilityLabel={`${activeCount} 个后台会话`}>
              <View style={styles.activeDot} />
              <Text style={styles.activeBadgeText}>{activeCount} 个后台会话</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={props.onSettings}
          style={styles.settingsButton}
          accessibilityLabel="设置"
          accessibilityRole="button">
          <Icon name="settings" size={20} color={colors.textDim} />
        </TouchableOpacity>
      </View>

      {machines.length === 0 ? (
        <ScrollView contentContainerStyle={styles.empty}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Icon name="terminal" size={28} color={colors.accent} />
            </View>
            <Text style={styles.emptyTitle}>还没有配对的桌面端</Text>
            <Text style={[font.dim, {textAlign: 'center'}]}>
              两步即可用手机远程操控 Kimi Code 或 ZCode
            </Text>

            <View style={styles.steps}>
              <View style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>1</Text>
                </View>
                <Text style={[font.dim, {flex: 1}]}>
                  在电脑端打开 Kimi Code / ZCode 的「远程控制」二维码
                </Text>
              </View>
              <View style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>2</Text>
                </View>
                <Text style={[font.dim, {flex: 1}]}>
                  点击下方「扫码配对」，或直接复制粘贴配对链接
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row, index) =>
            row.type === 'machine' ? row.m.id : `${row.type}-${index}`
          }
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            <Text style={[font.faint, {marginTop: 18, textAlign: 'center'}]}>
              点按右侧「⋯」或长按卡片可管理设备
            </Text>
          }
          renderItem={({item: row, index}) => {
            if (row.type === 'host') {
              return (
                <Text style={[styles.hostHeader, index === 0 && styles.hostHeaderFirst]}>
                  {row.label}
                </Text>
              );
            }
            if (row.type === 'sub') {
              return (
                <Text style={styles.groupHeader}>
                  {row.favorite ? '置顶收藏' : '全部设备'}
                </Text>
              );
            }
            const item = row.m;
            const isKimi = hostKindOf(item.credentials) === 'kimi';
            const isActive = activeSet.has(item.id);
            const pill = loginPillOf(item, colors);
            const meta = machineMeta(item, Date.now());
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.82}
                onPress={() => props.onConnect(item.id)}
                onLongPress={() => openManage(item)}>
                <View style={styles.cardTop}>
                  <View
                    style={[
                      styles.deviceBadge,
                      {backgroundColor: isKimi ? colors.iconBadgeBg : colors.zcodeBadgeBg},
                    ]}>
                    <Icon
                      name="terminal"
                      size={18}
                      color={isKimi ? colors.accent : colors.textDim}
                    />
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {item.muted ? (
                        <View style={styles.mutedIcon}>
                          <Icon name="bell-off" size={14} color={colors.textFaint} />
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.statusRow}>
                      {isActive ? (
                        <View style={styles.runningChip}>
                          <View style={styles.runningDot} />
                          <Text style={styles.runningText}>运行中</Text>
                        </View>
                      ) : null}
                      <View
                        style={[styles.pill, {backgroundColor: pill.bg}]}
                        accessibilityLabel={`登录状态：${pill.label}`}
                        accessibilityRole="text">
                        <Text style={[font.pill, {color: pill.color}]}>{pill.label}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.cardTrailing}>
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => props.onToggleFavorite(item.id)}
                      accessibilityLabel={item.favorite ? '取消收藏' : '收藏置顶'}
                      accessibilityRole="button">
                      <Icon
                        name={item.favorite ? 'star-filled' : 'star'}
                        size={18}
                        color={item.favorite ? colors.star : colors.textFaint}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.iconBtn}
                      onPress={() => openManage(item)}
                      accessibilityLabel={`管理 ${item.name}`}
                      accessibilityRole="button">
                      <Icon name="more" size={18} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>
                </View>

                {meta.length > 0 ? (
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <View style={styles.bottomDockWrap}>
        <View style={styles.bottomDock}>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.85}
            onPress={props.onScan}>
            <Icon name="qr" size={18} color={colors.onAccent} />
            <Text style={styles.primaryButtonText}>扫码配对</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            activeOpacity={0.8}
            onPress={props.onManual}>
            <Icon name="link" size={17} color={colors.text} />
            <Text style={styles.secondaryButtonText}>输入链接</Text>
          </TouchableOpacity>
        </View>
      </View>

      <BottomSheet visible={unlocked && managedMachine != null} onClose={closeManage}>
        {managedMachine != null ? (
          <>
            <View style={styles.sheetHeader}>
              <View
                style={[
                  styles.sheetBadge,
                  {
                    backgroundColor:
                      hostKindOf(managedMachine.credentials) === 'kimi'
                        ? colors.iconBadgeBg
                        : colors.zcodeBadgeBg,
                  },
                ]}>
                <Icon
                  name="terminal"
                  size={20}
                  color={
                    hostKindOf(managedMachine.credentials) === 'kimi'
                      ? colors.accent
                      : colors.textDim
                  }
                />
              </View>
              <View style={{flex: 1, gap: 2}}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {managedMachine.name}
                </Text>
                <Text style={font.faint} numberOfLines={1}>
                  {[
                    sourceShortLabel(managedMachine.credentials),
                    hostOf(managedMachine),
                    `sid …${managedMachine.credentials.sid.slice(-6)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeManage}
                accessibilityLabel="关闭"
                accessibilityRole="button">
                <Icon name="close" size={18} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            <View style={styles.renamePill}>
              <TextInput
                style={styles.renameInput}
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="设备名称"
                placeholderTextColor={colors.textFaint}
                returnKeyType="done"
                onSubmitEditing={() => {
                  props.onRename(managedMachine.id, renameValue);
                  closeManage();
                }}
              />
              <TouchableOpacity
                style={styles.savePillButton}
                onPress={() => {
                  props.onRename(managedMachine.id, renameValue);
                  closeManage();
                }}>
                <Text style={styles.savePillText}>保存</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sheetDivider} />

            <View style={styles.tileGrid}>
              <TouchableOpacity
                style={styles.tile}
                onPress={() => props.onMove(managedMachine.id, -1)}>
                <Icon name="arrow-up" size={18} color={colors.text} />
                <Text style={styles.tileText}>上移排序</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tile}
                onPress={() => props.onMove(managedMachine.id, 1)}>
                <Icon name="arrow-down" size={18} color={colors.text} />
                <Text style={styles.tileText}>下移排序</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tile}
                onPress={() => props.onToggleFavorite(managedMachine.id)}>
                <Icon
                  name="pin"
                  size={18}
                  color={managedMachine.favorite ? colors.star : colors.text}
                />
                <Text style={styles.tileText}>
                  {managedMachine.favorite ? '取消置顶' : '收藏置顶'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tile}
                onPress={() => props.onSetMuted(managedMachine.id, !managedMachine.muted)}>
                <Icon
                  name="bell-off"
                  size={18}
                  color={managedMachine.muted ? colors.accent : colors.text}
                />
                <Text style={styles.tileText}>
                  {managedMachine.muted ? '取消静音' : '静音通知'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sheetDivider} />

            <View style={styles.dangerGroup}>
              {hostKindOf(managedMachine.credentials) === 'kimi' ? (
                <TouchableOpacity
                  style={[styles.dangerRow, signOutArm && styles.dangerRowArmed]}
                  onPress={() => {
                    if (signOutArm) {
                      props.onSignOutWebLogin();
                      closeManage();
                    } else {
                      setSignOutArm(true);
                      setDeleteArm(false);
                    }
                  }}>
                  <Icon name="logout" size={19} color={colors.danger} />
                  <View style={{flex: 1, gap: 2}}>
                    <Text style={styles.dangerTitle}>
                      {signOutArm ? '再点一次确认退出 Kimi 账号' : '退出 Kimi 账号'}
                    </Text>
                    <Text style={font.faint}>影响全部 Kimi 机器，配对记录保留</Text>
                  </View>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[styles.dangerRow, deleteArm && styles.dangerRowArmed]}
                onPress={() => {
                  if (deleteArm) {
                    props.onDelete(managedMachine.id);
                    closeManage();
                  } else {
                    setDeleteArm(true);
                    setSignOutArm(false);
                  }
                }}>
                <Icon name="trash" size={19} color={colors.danger} />
                <Text style={styles.dangerTitle}>
                  {deleteArm ? '再点一次确认删除此设备' : '删除此设备'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const useStyles = makeStyles((colors, font) => ({
  root: {flex: 1, backgroundColor: colors.bg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.successSoft,
    borderRadius: radius.s,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  activeBadgeText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  empty: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  emptyCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.iconBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  steps: {
    width: '100%',
    marginTop: 14,
    gap: 10,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.l,
    padding: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 128,
  },
  hostHeader: {
    ...font.section,
    marginTop: 22,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  hostHeaderFirst: {marginTop: 8},
  groupHeader: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 10,
    gap: 10,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  deviceBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardName: {
    ...font.body,
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  mutedIcon: {
    marginLeft: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  runningChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  runningDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  runningText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  pill: {
    borderRadius: radius.s,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  cardTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: {
    ...font.faint,
    paddingLeft: 50,
  },
  bottomDockWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
  },
  bottomDock: {
    flexDirection: 'row',
    gap: 10,
    padding: 8,
    borderRadius: radius.s,
    backgroundColor: colors.bgElevatedOverlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  primaryButton: {
    flex: 1.15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: colors.onAccent,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: radius.s,
    paddingVertical: 13,
    backgroundColor: colors.bgInput,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetBadge: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgInput,
  },
  renamePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgInput,
    borderRadius: radius.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 5,
    gap: 8,
  },
  renameInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 6,
  },
  savePillButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  savePillText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: '600',
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgInput,
    borderRadius: radius.l,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  tileText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  dangerGroup: {
    gap: 10,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.l,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  dangerRowArmed: {
    backgroundColor: colors.dangerArmed,
  },
  dangerTitle: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
}));
