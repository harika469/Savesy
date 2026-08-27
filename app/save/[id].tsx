import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { PaperCard, PrimaryButton } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';

export default function SaveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { saves, collections, toggleFavorite, deleteSave } = useSaves(); const item = saves.find(save => save.id === id); const collection = collections.find(c => c.id === item?.collectionId);
  if (!item) return <Screen><Back onPress={() => router.back()} /><Text style={styles.title}>this gem wandered off.</Text></Screen>;
  const remove = () => Alert.alert('Delete this save?', 'This cannot be undone.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { deleteSave(item.id); router.back(); } }]);
  return <Screen variant={1}><View style={styles.top}><Back onPress={() => router.back()} /><Pressable onPress={() => Share.share({ title: item.title, message: `${item.title}\n${item.url}` })}><Ionicons name="share-outline" size={25} /></Pressable></View><Text style={styles.kicker}>SAVED GEM ◇</Text><Text style={styles.title}>{item.title}</Text><Text style={styles.source}>{item.source ?? item.type} · saved {new Date(item.createdAt).toLocaleDateString()}</Text>
    <View style={styles.tags}>{item.tags.map(tag => <View key={tag} style={styles.tag}><Text style={styles.tagText}>#{tag}</Text></View>)}</View><PrimaryButton label="OPEN ORIGINAL" icon="open-outline" onPress={() => Linking.openURL(item.url)} />
    <View style={styles.actions}><Pressable onPress={() => toggleFavorite(item.id)} style={styles.secondary}><Ionicons name={item.isFavorite ? 'heart' : 'heart-outline'} size={20} /><Text style={styles.secondaryText}>{item.isFavorite ? 'FAVORITED' : 'FAVORITE'}</Text></Pressable><Pressable onPress={remove} style={styles.secondary}><Ionicons name="trash-outline" size={20} /><Text style={styles.secondaryText}>DELETE</Text></Pressable></View>
    <Text style={styles.heading}>The details</Text><PaperCard style={{ gap: 15 }}><Detail label="NOTE" value={item.note || 'No note — the link spoke for itself.'} /><Detail label="COLLECTION" value={collection?.name || 'Floating freely'} /><Detail label="URL" value={item.url} /></PaperCard>
    <Text style={styles.heading}>Why Savesy brought this back</Text><PaperCard style={styles.why}><Ionicons name="eye-outline" size={28} /><Text style={styles.whyText}>{collection ? `you've been building your ${collection.name.toLowerCase()} world again.` : `this one has been quietly waiting for its moment.`}</Text></PaperCard>
  </Screen>;
}
function Back({ onPress }: { onPress: () => void }) { return <Pressable onPress={onPress} hitSlop={12} style={styles.back}><Ionicons name="arrow-back" size={24} /></Pressable>; }
function Detail({ label, value }: { label: string; value: string }) { return <View><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>; }
const styles = StyleSheet.create({ top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 35 }, back: { width: 44, height: 44, justifyContent: 'center' }, kicker: { fontSize: 12, letterSpacing: 1.7, fontWeight: '900' }, title: { fontSize: 35, lineHeight: 40, fontWeight: '900', letterSpacing: -1, marginTop: 12 }, source: { color: colors.gray, marginTop: 10 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 22 }, tag: { backgroundColor: colors.mist, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 15 }, tagText: { fontSize: 12, fontWeight: '700' }, actions: { flexDirection: 'row', gap: 10, marginTop: 10 }, secondary: { minHeight: 50, flex: 1, borderWidth: 1.5, borderColor: colors.ink, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, secondaryText: { fontSize: 11, fontWeight: '900' }, heading: { fontSize: 20, fontWeight: '900', marginTop: 30, marginBottom: 12 }, detailLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '900', color: colors.gray }, detailValue: { marginTop: 4, lineHeight: 21 }, why: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: colors.mist }, whyText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700' } });
