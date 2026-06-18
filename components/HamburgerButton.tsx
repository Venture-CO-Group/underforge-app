import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface HamburgerButtonProps {
  onPress: () => void;
  style?: any;
}

export const HamburgerButton: React.FC<HamburgerButtonProps> = ({ onPress, style }) => {
  return (
    <TouchableOpacity
      style={[styles.hamburgerButton, style]}
      onPress={onPress}
    >
      <View style={styles.hamburgerLine} />
      <View style={styles.hamburgerLine} />
      <View style={styles.hamburgerLine} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  hamburgerButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hamburgerLine: {
    width: 22,
    height: 2,
    backgroundColor: '#F2F2EE',
    marginVertical: 2.5,
    borderRadius: 1,
  },
});