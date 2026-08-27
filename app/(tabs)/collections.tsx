import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CollectionCard } from '@/components/CollectionCard';
import { Screen } from '@/components/Screen';
import { Field, Input, PrimaryButton, ScreenHeader } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';

export default function CollectionsScreen() {
  const router = useRouter(); const { collections, saves, addCollection } = useSaves(); const [open, setOpen] = useState(false); const [name, setName] = useState('');
  const create = () => { if (!name.trim()) return; const item = addCollection(name); setName(''); setOpen(false); router.push({ pathname: '/collection/[id]', params: { id: item.id } }); };
  return <><Screen variant={2}><View style={styles.head}><ScreenHeader title="your little worlds." subtitle="organized-ish." /><Pressable onPress={() => setOpen(true)} style={styles.add}><Ionicons name="add" size={28} /></Pressable></View><View style={styles.grid}>{collections.map(c => <CollectionCard key={c.id} name={c.name} count={saves.filter(s => s.collectionId === c.id).length} onPress={() => router.push({ pathname: '/collection/[id]', params: { id: c.id } })} />)}<Pressable onPress={() => setOpen(true)} style={styles.new}><Ionicons name="add" size={26} /><Text style={styles.newText}>New collection</Text></Pressable></View></Screen>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.overlay}><View style={styles.modal}><Pressable onPress={() => setOpen(false)} style={{ alignSelf: 'flex-end' }}><Ionicons name="close" size={28} /></Pressable><Text style={styles.modalTitle}>make a little world.</Text><Field label="Collection name"><Input autoFocus value={name} onChangeText={setName} placeholder="e.g. Sunday adventures" onSubmitEditing={create} /></Field><PrimaryButton label="CREATE IT" onPress={create} /></View></SafeAreaView></Modal></>;
}
const styles = StyleSheet.create({ head: { flexDirection: 'row', justifyContent: 'space-between' }, add: { width: 46, height: 46, borderWidth: 1.5, borderColor: colors.ink, borderRadius: 23, alignItems: 'center', justifyContent: 'center' }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 13 }, new: { width: '48%', minHeight: 206, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.ink, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', gap: 8 }, newText: { fontWeight: '800' }, overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.35)', justifyContent: 'flex-end' }, modal: { backgroundColor: colors.paper, padding: 24, paddingBottom: 38, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 22 }, modalTitle: { fontSize: 28, fontWeight: '900' } });
