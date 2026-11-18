import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSaves } from '@/context/SavesContext';
import { SavedItem } from '@/types';
import { isThisWeek, matchesSave, thumbFor } from '@/utils/saves';

function ReelCard({ item, category, onPress }: { item: SavedItem; category?: string; onPress: () => void }) {
  const thumb = thumbFor(item);
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}>
    <LinearGradient colors={[thumb.from, thumb.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.thumb}>
      <Text style={styles.thumbEmoji}>{thumb.emoji}</Text>
      {item.duration ? <Text style={styles.duration}>{item.duration}</Text> : null}
    </LinearGradient>
    <View style={styles.cardBody}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardMeta}>{item.creator ?? item.source ?? item.type} • {category ?? item.type}</Text>
      <View style={styles.pills}>{item.tags.slice(0, 3).map(tag => <Text key={tag} style={styles.pill}>#{tag}</Text>)}</View>
    </View>
  </Pressable>;
}

export default function HomeScreen() {
  const router = useRouter(); const { saves, collections } = useSaves();
  const [query, setQuery] = useState(''); const [folder, setFolder] = useState<string>();
  const categoryName = useMemo(() => new Map(collections.map(c => [c.id, c.name])), [collections]);
  const visible = useMemo(() => saves.filter(item => (!folder || item.collectionId === folder) && (!query.trim() || matchesSave(item, query))), [saves, folder, query]);
  const thisWeek = saves.filter(item => isThisWeek(item.createdAt)).length;

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrap}>
      <Text style={styles.h1}>📦 Savesy</Text>
      <Text style={styles.sub}>Your saved reels, finally organised</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search saved reels... e.g. paneer, Amsterdam, hair" placeholderTextColor="#8a8a8a" style={styles.search} />
      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statNumber}>{saves.length}</Text><Text style={styles.statLabel}>Saved</Text></View>
        <View style={styles.stat}><Text style={styles.statNumber}>{collections.length}</Text><Text style={styles.statLabel}>Folders</Text></View>
        <View style={styles.stat}><Text style={styles.statNumber}>{thisWeek}</Text><Text style={styles.statLabel}>This week</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Pressable onPress={() => setFolder(undefined)} style={[styles.chip, !folder && styles.chipActive]}><Text style={[styles.chipText, !folder && styles.chipTextActive]}>All</Text></Pressable>
        {collections.map(c => <Pressable key={c.id} onPress={() => setFolder(c.id)} style={[styles.chip, folder === c.id && styles.chipActive]}><Text style={[styles.chipText, folder === c.id && styles.chipTextActive]}>{c.name}</Text></Pressable>)}
      </ScrollView>
      {visible.length ? <View style={styles.grid}>{visible.map(item => <ReelCard key={item.id} item={item} category={item.collectionId ? categoryName.get(item.collectionId) : undefined} onPress={() => router.push({ pathname: '/save/[id]', params: { id: item.id } })} />)}</View> : <Text style={styles.empty}>Nothing saved here yet.</Text>}
      <View style={styles.note}>
        <Text style={styles.noteText}><Text style={styles.noteBold}>How it works:</Text>{'\n'}1. In Instagram tap Share → Savesy{'\n'}2. Savesy extracts caption, creator, audio & hashtags{'\n'}3. It auto-files into Recipes / Travel / Fashion etc.{'\n'}4. Search later instead of scrolling saved!</Text>
      </View>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://instagram.com')} style={styles.btn}><Text style={styles.btnText}>Open Instagram to try Share → Savesy</Text></Pressable>
      <Text style={styles.footer}>Savesy • Works offline</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  wrap: { padding: 16, paddingBottom: 100, backgroundColor: '#ffffff' },
  h1: { fontSize: 28, fontWeight: '700', marginTop: 4, marginBottom: 2, color: '#111' },
  sub: { color: '#666', fontSize: 14 },
  search: { width: '100%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#e5e5e5', backgroundColor: '#f6f6f6', fontSize: 15, marginVertical: 14, color: '#111' },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#ffe4c7', borderRadius: 14, padding: 10, alignItems: 'center' },
  statNumber: { fontSize: 20, fontWeight: '700', color: '#111' }, statLabel: { color: '#111', fontSize: 14 },
  chips: { gap: 8, paddingVertical: 10 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#eeeeee', backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#111', borderColor: '#111' }, chipText: { fontSize: 14, color: '#111' }, chipTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48.5%', borderWidth: 1, borderColor: '#eeeeee', borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff' },
  thumb: { height: 170, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbEmoji: { fontSize: 32 },
  duration: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999, fontSize: 11, overflow: 'hidden' },
  cardBody: { padding: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', lineHeight: 18, color: '#111' },
  cardMeta: { color: '#777', fontSize: 12, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { backgroundColor: '#fef3c7', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, fontSize: 11, marginTop: 6, marginRight: 4, color: '#111', overflow: 'hidden' },
  empty: { textAlign: 'center', color: '#777', paddingVertical: 40 },
  note: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', padding: 12, borderRadius: 12, marginTop: 14 },
  noteText: { fontSize: 13, lineHeight: 20, color: '#111' }, noteBold: { fontWeight: '700' },
  btn: { backgroundColor: '#ec4899', padding: 10, borderRadius: 12, marginTop: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  footer: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 14 },
});
