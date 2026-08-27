import { Ionicons } from '@expo/vector-icons';
import React, { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';

export function Doodle({ icon, size = 30, rotate = '0deg' }: { icon: keyof typeof Ionicons.glyphMap; size?: number; rotate?: string }) {
  return <Ionicons name={icon} size={size} color={colors.ink} style={{ transform: [{ rotate }] }} />;
}
export function HandwrittenNote({ children, rotate = '-3deg' }: PropsWithChildren<{ rotate?: string }>) {
  return <View style={[styles.note, { transform: [{ rotate }] }]}><Text style={styles.noteText}>{children}</Text></View>;
}
export function DoodleBackground({ variant = 0 }: { variant?: number }) {
  const sets = [
    [{ top: 34, right: 18, icon: 'sparkles-outline' as const }, { top: 210, left: 8, icon: 'heart-outline' as const }],
    [{ top: 42, right: 16, icon: 'happy-outline' as const }, { top: 280, right: 8, icon: 'star-outline' as const }],
    [{ top: 38, right: 22, icon: 'planet-outline' as const }, { top: 255, left: 8, icon: 'flower-outline' as const }],
  ];
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{sets[variant % sets.length].map((item, i) => <View key={i} style={[styles.doodle, item]}><Doodle icon={item.icon} size={28} rotate={i ? '10deg' : '-8deg'} /></View>)}</View>;
}
const styles = StyleSheet.create({ doodle: { position: 'absolute', opacity: .12 }, note: { alignSelf: 'flex-start', borderBottomWidth: 2, borderColor: colors.ink, paddingHorizontal: 3, paddingBottom: 2 }, noteText: { fontSize: 14, fontStyle: 'italic', fontWeight: '700' } });
