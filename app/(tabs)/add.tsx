import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Field, FilterChip, Input, PaperCard, PrimaryButton, ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { SaveType } from '@/types';
import { inferMetadata } from '@/utils/saves';

const types: SaveType[] = ['article', 'video', 'product', 'place', 'social', 'other'];
export default function AddScreen() {
  const router = useRouter(); const { addSave, collections } = useSaves();
  const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [note, setNote] = useState(''); const [tags, setTags] = useState(''); const [type, setType] = useState<SaveType>('other'); const [source, setSource] = useState(''); const [collectionId, setCollectionId] = useState<string>();
  useEffect(() => { if (!url.trim()) return; const timer = setTimeout(() => { const meta = inferMetadata(url); setTitle(current => current || meta.title); setSource(meta.source); setType(meta.type); }, 350); return () => clearTimeout(timer); }, [url]);
  const save = () => { if (!url.trim() || !title.trim()) { Alert.alert('Almost there', 'Add a link and a title first.'); return; } const item = addSave({ url: url.trim(), title: title.trim(), note: note.trim() || undefined, tags: tags.split(',').map(t => t.trim()).filter(Boolean), type, source: source.trim() || undefined, collectionId }); setUrl(''); setTitle(''); setNote(''); setTags(''); setSource(''); setType('other'); setCollectionId(undefined); router.push({ pathname: '/save/[id]', params: { id: item.id } }); };
  return <Screen variant={2}><ScreenHeader title="save the thing." subtitle="drop it here. future-you will thank you." /><View style={styles.form}><Field label="The link"><Input value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="Paste a link" /></Field>
    {url ? <PaperCard style={styles.preview}><Text style={styles.previewLabel}>QUICK PREVIEW</Text><Text style={styles.previewTitle}>{title || 'Looking at that link...'}</Text><Text style={styles.previewMeta}>{source || 'Internet treasure'} · {type}</Text></PaperCard> : null}
    <Field label="Title"><Input value={title} onChangeText={setTitle} placeholder="What is it?" /></Field><Field label="Note (optional)"><Input value={note} onChangeText={setNote} placeholder="Why did you save it?" multiline /></Field><Field label="Tags"><Input value={tags} onChangeText={setTags} placeholder="travel, cafe, someday" /></Field>
    <Field label="Type"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{types.map(value => <FilterChip key={value} label={value.toUpperCase()} active={type === value} onPress={() => setType(value)} />)}</ScrollView></Field>
    <Field label="Collection"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}><FilterChip label="NONE" active={!collectionId} onPress={() => setCollectionId(undefined)} />{collections.map(c => <FilterChip key={c.id} label={c.name} active={collectionId === c.id} onPress={() => setCollectionId(c.id)} />)}</ScrollView></Field>
    <PrimaryButton label="SAVE IT" icon="bookmark-outline" onPress={save} /><Text style={styles.brain}>straight to the brain 🧠</Text></View></Screen>;
}
const styles = StyleSheet.create({ form: { gap: 19 }, row: { gap: 8 }, preview: { backgroundColor: colors.mist, shadowOpacity: 0 }, previewLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }, previewTitle: { fontSize: 19, fontWeight: '900', marginTop: 12 }, previewMeta: { color: colors.gray, marginTop: 5, textTransform: 'capitalize' }, brain: { textAlign: 'center', fontSize: 13, fontStyle: 'italic', marginTop: -8 } });
