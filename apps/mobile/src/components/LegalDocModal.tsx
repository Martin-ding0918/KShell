import React from 'react';
import {
  Modal,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import {LegalDoc} from '../legal';
import {makeStyles, useTheme} from '../theme';
import {PageHeader} from './PageHeader';

interface LegalDocModalProps {
  doc: LegalDoc | null;
  onClose: () => void;
}

/** Full-screen modal viewer for legal documents (settings entries + consent gate). */
export function LegalDocModal({doc, onClose}: LegalDocModalProps) {
  const {colors, isDark} = useTheme();
  const styles = useStyles();
  return (
    <Modal
      visible={doc != null}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={false}>
      <View style={styles.root}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={colors.bg}
        />
        <PageHeader title={doc?.title ?? ''} onBack={onClose} backLabel="返回" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.body}>{doc?.body ?? ''}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(colors => ({
  root: {flex: 1, backgroundColor: colors.bg},
  content: {padding: 20, paddingBottom: 40},
  body: {color: colors.textDim, fontSize: 14, lineHeight: 24},
}));
