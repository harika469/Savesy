import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cardColors, colors, radii } from '@/constants/theme';

export function CollectionCard({ name, count, onPress }: { name: string; count: number; onPress: () => void }) {
  const accent = cardColors[name.length % cardColors.length];
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: .7 }]}><View style={[styles.art, { backgroundColor: accent }]}><Ionicons name="sparkles-outline" size={34} color={colors.purpleDark} /><Text style={styles.artText}>{count.toString().padStart(2, '0')}</Text></View><Text numberOfLines={2} style={styles.name}>{name}</Text><Text style={styles.count}>{count} {count === 1 ? 'save' : 'saves'} →</Text></Pressable>;
}
const styles = StyleSheet.create({ card: { width: '48%', borderWidth: 1.5, borderColor: colors.soft, borderRadius: radii.lg, backgroundColor: colors.white, overflow: 'hidden', shadowColor: colors.purpleDark, shadowOpacity: .09, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, art: { height: 112, padding: 14, justifyContent: 'space-between', flexDirection: 'row' }, artText: { fontSize: 28, fontWeight: '900', color: colors.purpleDark, opacity: .25 }, name: { fontSize: 16, lineHeight: 21, fontWeight: '900', paddingHorizontal: 14, paddingTop: 13 }, count: { color: colors.gray, fontSize: 12, padding: 14, paddingTop: 7 } });
