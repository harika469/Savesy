import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SaveCard } from '@/components/SaveCard';
import { Screen } from '@/components/Screen';
import { Field, Input, PrimaryButton } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter();
  const { collections, saves, toggleFavorite, deleteCollection, renameCollection } = useSaves();
  const collection = collections.find(c => c.id === id);
  const items = saves.filter(s => s.collectionId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [renaming, setRenaming] = useState(false); const [name, setName] = useState('');
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/collections');
  if (!collection) return <Screen><Pressable onPress={goBack} style={styles.icon}><Ionicons name="arrow-back" size={24} /></Pressable><Text style={styles.title}>collection not found.</Text></Screen>;
  const remove = () => Alert.alert('Delete collection?', 'The saves will stay safe.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { deleteCollection(collection.id); goBack(); } }]);
  const rename = () => { if (!name.trim()) return; renameCollection(collection.id, name); setRenaming(false); };
  return <><Screen variant={2}>
    <View style={styles.top}>
      <Pressable accessibilityLabel="Go back" onPress={goBack} style={styles.icon}><Ionicons name="arrow-back" size={24} /></Pressable>
      <View style={{ flexDirection: 'row' }}>
        <Pressable accessibilityLabel="Rename collection" onPress={() => { setName(collection.name); setRenaming(true); }} style={styles.icon}><Ionicons name="create-outline" size={22} /></Pressable>
        <Pressable accessibilityLabel="Delete collection" onPress={remove} style={styles.icon}><Ionicons name="trash-outline" size={21} /></Pressable>
      </View>
    </View>
    <Text style={styles.eyebrow}>YOUR LITTLE WORLD</Text><Text style={styles.title}>{collection.name}</Text>
    <Text style={styles.count}>{items.length} {items.length === 1 ? 'save lives' : 'saves live'} here</Text>
    <View style={styles.list}>{items.map(item => <SaveCard key={item.id} item={item} onFavorite={() => toggleFavorite(item.id)} />)}{items.length === 0 ? <View style={styles.empty}><Ionicons name="sparkles-outline" size={38} /><Text style={styles.emptyTitle}>room for treasures.</Text><Text style={styles.emptyBody}>Choose this collection next time you save something.</Text></View> : null}</View>
  </Screen>
  <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}><SafeAreaView style={styles.overlay}><View style={styles.modal}><Pressable onPress={() => setRenaming(false)} style={{ alignSelf: 'flex-end' }}><Ionicons name="close" size={28} /></Pressable><Text style={styles.modalTitle}>rename this world.</Text><Field label="Collection name"><Input autoFocus value={name} onChangeText={setName} onSubmitEditing={rename} /></Field><PrimaryButton label="RENAME" onPress={rename} /></View></SafeAreaView></Modal></>;
}
const styles = StyleSheet.create({ top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 }, icon: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.7 }, title: { fontSize: 34, lineHeight: 40, fontWeight: '900', marginTop: 10 }, count: { marginTop: 8, color: colors.gray }, list: { gap: 10, marginTop: 28 }, empty: { alignItems: 'center', paddingTop: 55 }, emptyTitle: { fontSize: 22, fontWeight: '900', marginTop: 12 }, emptyBody: { color: colors.gray, textAlign: 'center', marginTop: 7, maxWidth: 250 }, overlay: { flex: 1, backgroundColor: 'rgba(33,21,43,.35)', justifyContent: 'flex-end' }, modal: { backgroundColor: colors.paper, padding: 24, paddingBottom: 38, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 22 }, modalTitle: { fontSize: 28, fontWeight: '900', color: colors.purpleDark } });
