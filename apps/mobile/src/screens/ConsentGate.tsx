import React, {useState} from 'react';
import {BackHandler, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {
  PRIVACY_POLICY,
  USER_AGREEMENT,
  LegalDoc,
} from '../legal';
import {Icon} from '../components/Icon';
import {LegalDocModal} from '../components/LegalDocModal';
import {makeStyles, radius, useTheme} from '../theme';

interface ConsentGateProps {
  onAgree: () => void;
  visible?: boolean;
}

/**
 * First-launch consent gate (CN app-store compliance pattern): the user must
 * accept the user agreement and privacy policy before entering the app.
 * Declining exits — nothing is collected or initialized before consent.
 */
export function ConsentGate({onAgree, visible = true}: ConsentGateProps) {
  const {colors} = useTheme();
  const styles = useStyles();
  const [openDoc, setOpenDoc] = useState<LegalDoc | null>(null);

  const decline = () => {
    BackHandler.exitApp();
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.logoBadge}>
          <Text style={styles.logo}>K_</Text>
        </View>
        <Text style={styles.title}>欢迎使用 KShell</Text>
        <Text style={styles.intro}>
          KShell 是非官方开源的远程控制手机客户端，兼容 Kimi Code 与 ZCode
          桌面端。开始使用前，请阅读并同意以下条款：
        </Text>

        <View style={styles.docList}>
          <TouchableOpacity
            style={styles.docRow}
            activeOpacity={0.7}
            onPress={() => setOpenDoc(USER_AGREEMENT)}>
            <Text style={styles.link}>《用户协议与免责声明》</Text>
            <Icon name="chevron-right" size={16} color={colors.textFaint} />
          </TouchableOpacity>
          <View style={styles.docDivider} />
          <TouchableOpacity
            style={styles.docRow}
            activeOpacity={0.7}
            onPress={() => setOpenDoc(PRIVACY_POLICY)}>
            <Text style={styles.link}>《隐私政策》</Text>
            <Icon name="chevron-right" size={16} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        <Text style={styles.promise}>
          零数据收集：没有账号、没有遥测、没有第三方上报，数据只存在本机加密存储里。
        </Text>

        <TouchableOpacity style={styles.agreeButton} activeOpacity={0.85} onPress={onAgree}>
          <Text style={styles.agreeButtonText}>同意并继续</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineButton} activeOpacity={0.7} onPress={decline}>
          <Text style={styles.declineButtonText}>不同意并退出</Text>
        </TouchableOpacity>
      </View>
      <LegalDocModal doc={visible ? openDoc : null} onClose={() => setOpenDoc(null)} />
    </View>
  );
}

const useStyles = makeStyles((colors, font) => ({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: colors.iconBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  logo: {fontSize: 30, fontWeight: '700', color: colors.accent},
  title: {...font.title},
  intro: {...font.dim, textAlign: 'center'},
  docList: {
    width: '100%',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  docDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  link: {color: colors.accent, fontSize: 15, fontWeight: '500'},
  promise: {...font.faint, textAlign: 'center', marginTop: 4, marginBottom: 4},
  agreeButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  agreeButtonText: {color: colors.onAccent, fontSize: 15, fontWeight: '600'},
  declineButton: {
    borderRadius: radius.s,
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  declineButtonText: {color: colors.textFaint, fontSize: 14},
}));
