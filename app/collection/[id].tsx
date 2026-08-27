import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SaveCard } from '@/components/SaveCard';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { collections, saves, toggleFavorite, deleteCollection } = useSaves(); const collection = collections.find(c => c.id === id); const items = saves.filter(s => s.collectionId === id);
  if (!collection) return <Screen><Text style={styles.title}>collection not found.</Text></Screen>;
  const remove = () => Alert.alert('Delete collection?', 'The saves will stay safe.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { deleteCollection(collection.id); router.back(); } }]);
  return <Screen variant={2}><View style={styles.top}><Pressable onPress={() => router.back()} style={styles.icon}><Ionicons name="arrow-back" size={24} /></Pressable><Pressable onPress={remove} style={styles.icon}><Ionicons name="trash-outline" size={21} /></Pressable></View><Text style={styles.eyebrow}>YOUR LITTLE WORLD</Text><Text style={styles.title}>{collection.name}</Text><Text style={styles.count}>{items.length} {items.length === 1 ? 'save lives' : 'saves live'} here</Text><View style={styles.list}>{items.map(item => <SaveCard key={item.id} item={item} onFavorite={() => toggleFavorite(item.id)} />)}{items.length === 0 ? <View style={styles.empty}><Ionicons name="sparkles-outline" size={38} /><Text style={styles.emptyTitle}>room for treasures.</Text><Text style={styles.emptyBody}>Choose this collection next time you save something.</Text></View> : null}</View></Screen>;
}
const styles = StyleSheet.create({ top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 }, icon: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.7 }, title: { fontSize: 34, lineHeight: 40, fontWeight: '900', marginTop: 10 }, count: { marginTop: 8, color: colors.gray }, list: { gap: 10, marginTop: 28 }, empty: { alignItems: 'center', paddingTop: 55 }, emptyTitle: { fontSize: 22, fontWeight: '900', marginTop: 12 }, emptyBody: { color: colors.gray, textAlign: 'center', marginTop: 7, maxWidth: 250 } });
