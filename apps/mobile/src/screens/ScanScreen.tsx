import React, {useEffect, useRef, useState} from 'react';
import {
  PermissionsAndroid,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Camera} from 'react-native-camera-kit';
import {makeStyles, radius, useTheme} from '../theme';
import {pickAndDecodeQr} from '../qrFromFile';

export interface ScanOutcome {
  ok: boolean;
  machineId?: string;
  updatedExisting?: boolean;
  reason?: string;
}

interface ScanScreenProps {
  onResult: (url: string) => ScanOutcome;
  onDone: (outcome: ScanOutcome) => void;
}

const REASON_TEXT: Record<string, string> = {
  empty: '内容为空',
  'invalid-url': '不是有效的 URL',
  'not-https': '配对链接仅支持 HTTPS',
  'missing-sid': '不是配对二维码（Kimi Code 需 /devices/…，ZCode 需 sid 参数）',
  'unsupported-host': '仅接受官方 Kimi Code / ZCode 配对链接',
  'invalid-device-path': '不是有效的 Kimi Code 设备链接（/devices/…）',
};

export function ScanScreen({onResult, onDone}: ScanScreenProps) {
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>(
    'unknown',
  );
  const {font} = useTheme();
  const styles = useStyles();
  const [status, setStatus] = useState<{text: string; error: boolean} | null>(null);
  const handling = useRef(false);

  useEffect(() => {
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then(
      result => {
        setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
      },
    );
  }, []);

  const handleUrl = (url: string) => {
    if (handling.current) {
      return;
    }
    handling.current = true;
    const outcome = onResult(url);
    if (outcome.ok) {
      onDone(outcome);
    } else {
      setStatus({text: REASON_TEXT[outcome.reason ?? ''] ?? '无法识别的二维码', error: true});
      setTimeout(() => {
        handling.current = false;
      }, 1500);
    }
  };

  const pickFile = async () => {
    if (handling.current) return;
    handling.current = true;
    setStatus({text: '正在识别图片…', error: false});
    try {
      const url = await pickAndDecodeQr();
      if (url == null) {
        setStatus({text: '未在图片中找到二维码', error: true});
        handling.current = false;
        return;
      }
      handling.current = false;
      handleUrl(url);
    } catch {
      setStatus({text: '读取图片失败', error: true});
      handling.current = false;
    }
  };

  return (
    <View style={styles.root}>
      {permission === 'granted' ? (
        <Camera
          style={StyleSheet.absoluteFill}
          scanBarcode
          onReadCode={event => {
            const value = event.nativeEvent.codeStringValue;
            if (typeof value === 'string' && value.length > 0) {
              handleUrl(value);
            }
          }}
        />
      ) : (
        <View style={styles.noCamera}>
          <Text style={font.dim}>
            {permission === 'denied'
              ? '相机权限被拒绝，可从相册选择二维码图片'
              : '正在请求相机权限…'}
          </Text>
        </View>
      )}

      <View style={styles.bottom}>
        {status != null ? (
          <View style={styles.statusBox}>
            <Text style={[styles.statusText, status.error && styles.errorText]}>{status.text}</Text>
          </View>
        ) : (
          <Text style={styles.tip}>
            对准桌面端「远程控制」二维码（Kimi Code / ZCode），{'\n'}
            或从相册选择二维码图片
          </Text>
        )}
        <TouchableOpacity style={styles.albumButton} onPress={pickFile}>
          <Text style={styles.albumButtonText}>从相册选择二维码图片</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles(colors => ({
  root: {flex: 1, backgroundColor: colors.consoleBg},
  noCamera: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: colors.bg,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    paddingBottom: 34,
    alignItems: 'center',
    gap: 12,
  },
  tip: {color: colors.text, backgroundColor: colors.bgElevatedOverlay, fontSize: 13, textAlign: 'center'},
  statusBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.m,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusText: {color: colors.text, fontSize: 13},
  errorText: {color: colors.danger},
  albumButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.m,
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  albumButtonText: {color: colors.onAccent, fontSize: 15, fontWeight: '600'},
}));
