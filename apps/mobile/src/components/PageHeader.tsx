import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {makeStyles, useTheme} from '../theme';
import {Icon} from './Icon';

interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
}

/**
 * Sticky top navigation bar matching Plan A: circular back button on the left,
 * bold centered title, and an optional right slot.
 */
export function PageHeader({title, onBack, backLabel = '返回', right}: PageHeaderProps) {
  const {colors} = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack != null ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={backLabel}>
            <Icon name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>{right ?? null}</View>
    </View>
  );
}

const useStyles = makeStyles(colors => ({
  bar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  side: {
    width: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
}));
