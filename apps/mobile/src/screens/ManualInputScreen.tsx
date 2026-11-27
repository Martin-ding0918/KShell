import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {PageHeader} from '../components/PageHeader';
import {makeStyles, radius, useTheme} from '../theme';

export interface ManualSubmitOutcome {
  ok: boolean;
  machineId?: string;
  reason?: string;
}

interface ManualInputScreenProps {
  onBack?: () => void;
  onSubmit: (url: string, customName: string) => ManualSubmitOutcome;
  onDone: (outcome: ManualSubmitOutcome) => void;
}

const REASON_TEXT: Record<string, string> = {
  empty: '请粘贴配对 URL',
  'invalid-url': '不是有效的 URL，请完整复制桌面端二维码对应的链接',
  'not-https': '配对链接仅支持 HTTPS',
  'missing-sid': '无法识别：Kimi Code 链接需 /devices/… 路径，ZCode 链接需 sid 参数',
  'unsupported-host': '此版本仅支持官方 Kimi Code / ZCode 来源',
  'invalid-device-path': '不是有效的 Kimi Code 设备链接（/devices/…）',
};

export function ManualInputScreen({onBack, onSubmit, onDone}: ManualInputScreenProps) {
  const {colors, font} = useTheme();
  const styles = useStyles();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const outcome = onSubmit(url.trim(), name.trim());
    if (outcome.ok) {
      onDone(outcome);
    } else {
      setError(REASON_TEXT[outcome.reason ?? ''] ?? '无法识别的配对地址');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PageHeader title="手动输入链接" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={font.dim}>
            粘贴桌面端「远程控制」生成的配对链接（与二维码内容相同），支持 Kimi Code 与 ZCode：
          </Text>
          <TextInput
            style={styles.urlInput}
            placeholder={'https://code-rc.kimi.com/devices/<设备ID>/'}
            placeholderTextColor={colors.textFaint}
            value={url}
            onChangeText={v => {
              setUrl(v);
              if (error != null) setError(null);
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={styles.nameInput}
            placeholder="自定义名称（可选，如：公司电脑）"
            placeholderTextColor={colors.textFaint}
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
          />
          {error != null ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.button, !url.trim() && styles.buttonDisabled]}
            activeOpacity={0.85}
            onPress={submit}
            disabled={!url.trim()}>
            <Text style={styles.buttonText}>保存并连接</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hintCard}>
          <Text style={font.section}>支持的链接格式</Text>
          <Text style={font.faint}>
            Kimi Code：https://code-rc.kimi.com/devices/&lt;设备ID&gt;/{'\n'}
            ZCode：https://zcode.z.ai/remote/v4?sid=…&amp;mid=…{'\n'}
            桌面端二维码弹窗均可直接复制链接。
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(colors => ({
  root: {flex: 1, backgroundColor: colors.bg},
  content: {padding: 16, gap: 14},
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  hintCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  urlInput: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
    minHeight: 92,
    textAlignVertical: 'top',
  },
  nameInput: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  error: {color: colors.danger, fontSize: 13},
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {backgroundColor: colors.accentDim},
  buttonText: {color: colors.onAccent, fontSize: 15, fontWeight: '600'},
}));
