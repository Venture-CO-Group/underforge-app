import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

type KeyboardAwareScreenProps = {
  children: React.ReactNode;
  /**
   * Additional pixels added to the iOS keyboard offset (e.g. for sticky footers).
   */
  extraOffset?: number;
  /**
   * Header height for screens with a custom header. Defaults to 0 (no header).
   */
  headerHeight?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * iOS behavior override. Defaults to 'padding'.
   */
  behavior?: 'padding' | 'position' | 'height';
};

export function KeyboardAwareScreen({
  children,
  extraOffset = 0,
  headerHeight = 0,
  style,
  behavior = 'padding',
}: KeyboardAwareScreenProps) {
  if (Platform.OS !== 'ios') {
    return <View style={[styles.flex, style]}>{children}</View>;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={behavior}
      keyboardVerticalOffset={headerHeight + extraOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
