import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cardColors, colors, radii } from '@/constants/theme';
import { SavedItem } from '@/types';
import { relativeDate } from '@/utils/saves';

const icons: Record<SavedItem['type'], keyof typeof Ionicons.glyphMap> = { article: 'reader-outline', video: 'play-outline', product: 'bag-handle-outline', place: 'location-outline', social: 'heart-outline', other: 'link-outline' };
export function SaveCard({ item, onFavorite }: { item: SavedItem; onFavorite?: () => void }) {
  const router = useRouter();
  const accent = cardColors[item.title.length % cardColors.length];
  return <Pressable onPress={() => router.push({ pathname: '/save/[id]', params: { id: item.id } })} style={({ pressed }) => [styles.card, pressed && { opacity: .7 }]}>
    <View style={[styles.icon, { backgroundColor: accent }]}><Ionicons name={icons[item.type]} size={22} color={colors.purpleDark} /></View>
    <View style={{ flex: 1 }}><Text numberOfLines={2} style={styles.title}>{item.title}</Text><Text style={styles.meta}>{item.source ?? item.type} · {relativeDate(item.createdAt)}</Text></View>
    <Pressable hitSlop={12} onPress={(e) => { e.stopPropagation(); onFavorite?.(); }}><Ionicons name={item.isFavorite ? 'heart' : 'heart-outline'} size={22} /></Pressable>
  </Pressable>;
}
const styles = StyleSheet.create({ card: { minHeight: 82, flexDirection: 'row', gap: 13, alignItems: 'center', backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.soft, borderRadius: radii.md, padding: 13, shadowColor: colors.purpleDark, shadowOpacity: .07, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 1 }, icon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 16, fontWeight: '800', marginBottom: 5 }, meta: { color: colors.gray, fontSize: 12 } });
