import React, {useEffect, useState} from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {formatBytes, formatPercent} from '@zshell/core-shell';
import {
  DownloadItem,
  isActive,
  openDownloadedFile,
  openDownloadsUi,
  queryDownloads,
  removeDownload,
  resumeDownload,
  retryDownload,
} from '../downloads';
import {makeStyles, radius, useTheme} from '../theme';

/** Second-level page: every download this app uid owns — update APKs and
 * files downloaded from console pages — with live progress from the system
 * download manager. */
export function DownloadsScreen({onBack, visible}: {onBack: () => void; visible: boolean}) {
  const {colors, font} = useTheme();
  const styles = useStyles();
  const [items, setItems] = useState<DownloadItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    setAppActive(AppState.currentState === 'active');
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!visible || !appActive) return;

    let disposed = false;
    let downloading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const updated = await queryDownloads();
        if (disposed) return;
        downloading = updated.some(item => isActive(item.status));
        setItems(updated);
        setError(null);
      } catch {
        if (disposed) return;
        setError('无法读取下载列表');
      }
      if (downloading) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [appActive, visible, refreshKey]);

  const act = (fn: () => Promise<unknown>) => {
    setActionError(null);
    fn()
      .then(() => setRefreshKey(key => key + 1))
      .catch(e => {
        setActionError(e instanceof Error && e.message ? e.message : '操作失败');
      });
  };

  const statusText = (item: DownloadItem): string => {
    switch (item.status) {
      case 'pending':
        return '等待中…';
      case 'running':
        return item.totalBytes > 0
          ? `下载中 ${formatPercent(item.bytesSoFar, item.totalBytes)} · ` +
              `${formatBytes(item.bytesSoFar)} / ${formatBytes(item.totalBytes)}`
          : `下载中 · ${formatBytes(item.bytesSoFar)}`;
      case 'paused':
        return `已暂停${item.reason && item.reason !== '已暂停' ? ' · ' + item.reason : ''}`;
      case 'successful':
        // On success bytesSoFar equals the final file size.
        return item.bytesSoFar > 0
          ? `已完成 · ${formatBytes(item.bytesSoFar)}`
          : '已完成';
      case 'failed':
        return `失败：${item.reason ?? '未知原因'}`;
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{padding: 16, gap: 14}}>
      <TouchableOpacity onPress={onBack} style={{paddingVertical: 4}}>
        <Text style={{color: colors.accent, fontSize: 16}}>‹ 返回设置</Text>
      </TouchableOpacity>
      <Text style={styles.pageTitle}>下载管理</Text>
      <Text style={font.faint}>
        更新包保存在应用专属目录，控制台下载保存到系统公共「下载」目录。
        暂停的控制台下载由系统自动续传；如失败，请回到网页重新下载。
      </Text>

      <TouchableOpacity style={styles.card} onPress={() => act(() => openDownloadsUi())}>
        <View style={styles.headRow}>
          <View style={{flex: 1, gap: 2}}>
            <Text style={font.body}>存储位置 · 系统下载列表</Text>
            <Text style={font.faint}>
              跳转到系统的「下载」应用查看文件
            </Text>
          </View>
          <Text style={{color: colors.textFaint, fontSize: 18}}>›</Text>
        </View>
      </TouchableOpacity>

      {error != null ? (
        <TouchableOpacity onPress={() => setRefreshKey(key => key + 1)} accessibilityRole="button">
          <Text style={styles.errorText}>{error}，点按重试</Text>
        </TouchableOpacity>
      ) : null}
      {actionError != null ? <Text style={styles.errorText}>{actionError}</Text> : null}

      {items != null && items.length === 0 ? (
        <View style={styles.card}>
          <Text style={font.dim}>还没有下载记录</Text>
          <Text style={font.faint}>
            在设置里下载更新、或在控制台页面里下载文件后，会在这里显示进度
          </Text>
        </View>
      ) : null}

      {items?.map(item => {
        const pct =
          item.totalBytes > 0
            ? Math.min(100, (item.bytesSoFar / item.totalBytes) * 100)
            : 0;
        return (
          <View key={item.id} style={styles.card}>
            <View style={styles.headRow}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.kindBadge}>
                {item.kind === 'update' ? '更新包' : '文件'}
              </Text>
            </View>
            {isActive(item.status) && item.totalBytes > 0 ? (
              <View style={styles.track}>
                <View style={[styles.fill, {width: `${pct}%`}]} />
              </View>
            ) : null}
            <Text
              style={
                item.status === 'failed'
                  ? styles.errorText
                  : item.status === 'successful'
                    ? styles.doneText
                    : font.faint
              }>
              {statusText(item)}
            </Text>
            <View style={styles.actions}>
              {item.status === 'paused' && item.url.length > 0 ? (
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => act(() => resumeDownload(item.id))}>
                  <Text style={styles.buttonText}>重新开始</Text>
                </TouchableOpacity>
              ) : null}
              {isActive(item.status) ? (
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => act(() => removeDownload(item.id))}>
                  <Text style={styles.buttonDanger}>取消</Text>
                </TouchableOpacity>
              ) : null}
              {item.status === 'successful' ? (
                <>
                  <TouchableOpacity
                    style={styles.button}
                    onPress={() => act(() => openDownloadedFile(item.id))}>
                    <Text style={styles.buttonText}>
                      {item.kind === 'update' ? '安装' : '打开'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.button}
                    onPress={() => act(() => removeDownload(item.id))}>
                    <Text style={styles.buttonDanger}>删除</Text>
                  </TouchableOpacity>
                </>
              ) : null}
              {item.status === 'failed' ? (
                <>
                  {item.url.length > 0 ? (
                    <TouchableOpacity
                      style={styles.button}
                      onPress={() => act(() => retryDownload(item))}>
                      <Text style={styles.buttonText}>重试</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.button}
                    onPress={() => act(() => removeDownload(item.id))}>
                    <Text style={styles.buttonDanger}>删除</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors, font) => ({
  root: {flex: 1, backgroundColor: colors.bg},
  pageTitle: {...font.title, marginBottom: 2},
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  headRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  name: {...font.body, flex: 1},
  kindBadge: {
    color: colors.textFaint,
    fontSize: 11,
    backgroundColor: colors.bgInput,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgInput,
    overflow: 'hidden',
  },
  fill: {height: 4, borderRadius: 2, backgroundColor: colors.accent},
  doneText: {color: colors.success, fontSize: 13},
  actions: {flexDirection: 'row', gap: 10, marginTop: 2},
  button: {
    backgroundColor: colors.bgInput,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonText: {color: colors.textDim, fontSize: 13},
  buttonDanger: {color: colors.danger, fontSize: 13},
  errorText: {color: colors.danger, fontSize: 13},
}));
