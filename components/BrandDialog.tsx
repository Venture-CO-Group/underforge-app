import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { BrandColors } from '../constants/Colors';
import { FontFamily } from '../constants/Typography';

export interface BrandDialogButton {
  text: string;
  onPress?: () => void;
  /** 'primary' = accent CTA, 'destructive' = red, 'default' = subdued. */
  variant?: 'primary' | 'destructive' | 'default';
}

interface BrandDialogProps {
  visible: boolean;
  title?: string;
  /** Body copy. Split on blank lines (\n\n) into spaced paragraphs. */
  message?: string;
  buttons?: BrandDialogButton[];
  onRequestClose?: () => void;
}

/**
 * Brand-styled replacement for Alert.alert — centered card on a dark overlay,
 * Playfair title, paragraph-spaced body, and accent CTAs. Tapping the backdrop
 * triggers onRequestClose so it behaves like a dismissible dialog.
 */
export const BrandDialog: React.FC<BrandDialogProps> = ({
  visible,
  title,
  message,
  buttons,
  onRequestClose,
}) => {
  const resolvedButtons: BrandDialogButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK', variant: 'primary' }];
  const paragraphs = (message ?? '').split('\n\n').filter(p => p.length > 0);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onRequestClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {paragraphs.length > 0 && (
            <ScrollView style={styles.bodyScroll} bounces={false}>
              {paragraphs.map((para, i) => (
                <Text key={i} style={styles.paragraph}>{para}</Text>
              ))}
            </ScrollView>
          )}
          <View style={styles.buttonRow}>
            {resolvedButtons.map((btn, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.button,
                  btn.variant === 'primary' && styles.buttonPrimary,
                ]}
                onPress={btn.onPress}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.buttonText,
                    btn.variant === 'destructive' && styles.buttonTextDestructive,
                    btn.variant === 'default' && styles.buttonTextDefault,
                  ]}
                >
                  {btn.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: BrandColors.overlayDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    backgroundColor: BrandColors.backgroundTertiary,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BrandColors.cardBorder,
  },
  title: {
    fontFamily: FontFamily.displayBold,
    fontSize: 22,
    color: BrandColors.textPrimary,
    marginBottom: 14,
  },
  bodyScroll: {
    flexGrow: 0,
  },
  paragraph: {
    fontFamily: FontFamily.bodyRegular,
    fontSize: 15,
    lineHeight: 23,
    color: BrandColors.textSecondary,
    marginBottom: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  buttonPrimary: {
    backgroundColor: 'rgba(244, 124, 60, 0.16)',
  },
  buttonText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 16,
    color: BrandColors.accent,
    fontWeight: '600',
  },
  buttonTextDestructive: {
    color: BrandColors.error,
  },
  buttonTextDefault: {
    color: BrandColors.textSecondary,
  },
});

export default BrandDialog;
