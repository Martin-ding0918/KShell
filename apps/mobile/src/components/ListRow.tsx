import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {makeStyles, radius, useTheme} from '../theme';
import {Icon, IconName} from './Icon';

interface ListRowProps {
  icon?: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  badge?: string;
  badgeDot?: boolean;
  onPress?: () => void;
  showDivider?: boolean;
  right?: React.ReactNode;
}

/** Clean Plan A settings / card row with linear icon, optional summary/badge, and chevron. */
export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  badge,
  badgeDot = false,
  onPress,
  showDivider = false,
  right,
}: ListRowProps) {
  const {colors, font} = useTheme();
  const styles = useStyles();

  const content = (
    <View style={[styles.row, showDivider && styles.divider]}>
      {icon != null ? (
        <View style={styles.iconWrap}>
          <Icon name={icon} size={19} color={iconColor ?? colors.textDim} />
        </View>
      ) : null}
      <View style={styles.main}>
        <Text style={styles.title}>{title}</Text>
        {subtitle != null ? <Text style={font.faint}>{subtitle}</Text> : null}
      </View>
      {right != null ? (
        right
      ) : (
        <View style={styles.trailing}>
          {badge != null ? (
            <View style={styles.badgeWrap}>
              <Text style={styles.badgeText}>{badge}</Text>
              {badgeDot ? <View style={styles.dot} /> : null}
            </View>
          ) : value != null ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {onPress != null ? <Icon name="chevron-right" size={16} color={colors.textFaint} /> : null}
        </View>
      )}
    </View>
  );

  if (onPress == null) {
    return content;
  }
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      {content}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles(colors => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 12,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  iconWrap: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '48%',
  },
  value: {
    fontSize: 13,
    color: colors.textDim,
  },
  badgeWrap: {
    backgroundColor: colors.accent,
    borderRadius: radius.s,
    paddingHorizontal: 10,
    paddingVertical: 4,
    position: 'relative',
  },
  badgeText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: '600',
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
}));
