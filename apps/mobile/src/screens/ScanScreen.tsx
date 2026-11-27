import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  PermissionsAndroid,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Camera} from 'react-native-camera-kit';
import {Icon} from '../components/Icon';
import {makeStyles, radius, useTheme} from '../theme';
import {pickAndDecodeQr} from '../qrFromFile';

export interface ScanOutcome {
  ok: boolean;
  machineId?: string;
  updatedExisting?: boolean;
  reason?: string;
}

interface ScanScreenProps {
  onBack?: () => void;
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

const FRAME_SIZE = 244;

export function ScanScreen({onBack, onResult, onDone}: ScanScreenProps) {
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>(
    'unknown',
  );
  const {colors, font} = useTheme();
  const styles = useStyles();
  const [status, setStatus] = useState<{text: string; error: boolean} | null>(null);
  const handling = useRef(false);
  const scanLineY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then(
      result => {
        setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
      },
    );
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;
    scanLineY.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineY, {
          toValue: FRAME_SIZE - 16,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineY, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [permission, scanLineY]);

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

      {/* Translucent viewfinder mask + rounded blue corner brackets */}
      {permission === 'granted' ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.maskTop} />
          <View style={styles.maskMiddle}>
            <View style={styles.maskSide} />
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              <Animated.View
                style={[styles.scanLine, {transform: [{translateY: scanLineY}]}]}
              />
            </View>
            <View style={styles.maskSide} />
          </View>
          <View style={styles.maskBottom} />
        </View>
      ) : null}

      <View style={styles.topBar}>
        <View style={styles.topSide}>
          {onBack != null ? (
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack}
              accessibilityLabel="返回"
              accessibilityRole="button">
              <Icon name="arrow-left" size={20} color={colors.overlayLightText} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text
          style={[
            styles.topTitle,
            permission !== 'granted' && {color: colors.text},
          ]}>
          扫码配对
        </Text>
        <View style={styles.topSide} />
      </View>

      <View style={styles.bottom}>
        {status != null ? (
          <View style={styles.tipPill}>
            <Text style={[styles.tipText, status.error && styles.errorText]}>
              {status.text}
            </Text>
          </View>
        ) : (
          <View style={styles.tipPill}>
            <Text style={styles.tipText}>
              对准桌面端「远程控制」二维码{'\n'}（Kimi Code / ZCode）
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.albumButton} activeOpacity={0.85} onPress={pickFile}>
          <Icon name="image" size={18} color={colors.onAccent} />
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topSide: {width: 44, alignItems: 'flex-start', justifyContent: 'center'},
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.overlaySurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.overlayLightText,
    fontSize: 18,
    fontWeight: '700',
  },
  maskTop: {flex: 1, backgroundColor: colors.overlayDark},
  maskMiddle: {flexDirection: 'row', height: FRAME_SIZE},
  maskSide: {flex: 1, backgroundColor: colors.overlayDark},
  maskBottom: {flex: 1.25, backgroundColor: colors.overlayDark},
  viewfinder: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: colors.accent,
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 14,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 14,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 14,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 14,
  },
  scanLine: {
    position: 'absolute',
    top: 8,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
    opacity: 0.85,
  },
  bottom: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    alignItems: 'center',
    gap: 14,
  },
  tipPill: {
    backgroundColor: colors.overlaySurface,
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingVertical: 11,
    maxWidth: '100%',
  },
  tipText: {
    color: colors.overlayLightText,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  errorText: {color: colors.danger},
  albumButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  albumButtonText: {color: colors.onAccent, fontSize: 15, fontWeight: '600'},
}));
