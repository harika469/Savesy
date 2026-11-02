import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SmartButton, SmartDetailsCard, useSmartSave } from '@/components/SmartSave';
import { Field, FilterChip, Input, PaperCard, PrimaryButton } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { NewSave, SavedItem, SaveType } from '@/types';
import { extractUrl, fetchLinkMetadata, normalizeUrl } from '@/utils/metadata';
import { parseTags } from '@/utils/saves';

export const saveTypes: SaveType[] = ['article', 'video', 'product', 'place', 'social', 'other'];

type Props = {
  initial?: Partial<SavedItem>;
  submitLabel: string;
  /** Skip the "already saved" warning for this id (used when editing). */
  editingId?: string;
  onSubmit: (save: NewSave) => void;
};

export function SaveForm({ initial, submitLabel, editingId, onSubmit }: Props) {
  const { collections, findByUrl } = useSaves();
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [tags, setTags] = useState(initial?.tags?.join(', ') ?? '');
  const [type, setType] = useState<SaveType>(initial?.type ?? 'other');
  const [source, setSource] = useState(initial?.source ?? '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl);
  const [collectionId, setCollectionId] = useState(initial?.collectionId);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(initial?.details);
  const smart = useSmartSave();
  // Remember which fields the person typed themselves so fetched metadata never overwrites them.
  const touched = useRef({ title: !!initial?.title, type: !!editingId, source: !!editingId });
  // When editing, the existing details are already the person's choice; only re-fetch if the link changes.
  const lookedUp = useRef(editingId ? initial?.url ?? '' : '');

  useEffect(() => {
    const normalized = normalizeUrl(url);
    if (!normalized || normalized === normalizeUrl(lookedUp.current)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      lookedUp.current = normalized;
      setLoading(true);
      const meta = await fetchLinkMetadata(normalized);
      if (cancelled) return;
      setLoading(false);
      if (!touched.current.title && meta.title) setTitle(meta.title);
      if (!touched.current.source && meta.source) setSource(meta.source);
      if (!touched.current.type) setType(meta.type);
      setImageUrl(meta.imageUrl);
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); setLoading(false); };
  }, [url]);

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    const found = text ? extractUrl(text) : undefined;
    if (found) setUrl(found);
    else Alert.alert('Nothing to paste', 'Copy a link first, then tap paste.');
  };

  const smartFill = async () => {
    const normalized = normalizeUrl(url);
    if (!normalized) { Alert.alert('Add a link first', 'Paste the link you want Savesy to read.'); return; }
    const result = await smart.run({ url: normalized, title: title.trim() || undefined, note: note.trim() || undefined });
    if (!result) return;
    touched.current = { title: true, type: true, source: touched.current.source };
    setTitle(result.title);
    setType(result.type);
    setTags(current => [...new Set([...parseTags(current), ...result.tags])].join(', '));
    if (!note.trim() && result.summary) setNote(result.summary);
    setDetails(result.details);
  };

  const submit = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) { Alert.alert('That link looks off', 'Paste a full web link, like https://example.com.'); return; }
    if (!title.trim()) { Alert.alert('Almost there', 'Give it a title so you can find it later.'); return; }
    const payload: NewSave = { url: normalized, title: title.trim(), note: note.trim() || undefined, tags: parseTags(tags), type, source: source.trim() || undefined, imageUrl, collectionId, details };
    const existing = findByUrl(normalized);
    if (existing && existing.id !== editingId) {
      Alert.alert('Already saved', `You saved this as “${existing.title}”. Save it again anyway?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Save again', onPress: () => onSubmit(payload) }]);
      return;
    }
    onSubmit(payload);
  };

  return <View style={styles.form}>
    <Field label="The link">
      <View style={styles.linkRow}>
        <View style={{ flex: 1 }}><Input value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="Paste a link" /></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Paste link from clipboard" onPress={paste} style={styles.paste}><Ionicons name="clipboard-outline" size={20} color={colors.purpleDark} /><Text style={styles.pasteText}>PASTE</Text></Pressable>
      </View>
    </Field>
    {url ? <PaperCard style={styles.preview}>
      <View style={styles.previewHead}><Text style={styles.previewLabel}>QUICK PREVIEW</Text>{loading ? <ActivityIndicator size="small" color={colors.purpleDark} /> : null}</View>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.previewImage} resizeMode="cover" onError={() => setImageUrl(undefined)} /> : null}
      <Text style={styles.previewTitle}>{title || (loading ? 'Looking at that link...' : 'Give it a title below')}</Text>
      <Text style={styles.previewMeta}>{source || 'Internet treasure'} · {type}</Text>
    </PaperCard> : null}
    {smart.available && normalizeUrl(url) ? <SmartButton onPress={smartFill} busy={smart.busy} plan={smart.plan} label={details ? 'SMART FILL AGAIN' : 'SMART FILL'} /> : null}
    {details ? <SmartDetailsCard details={details} /> : null}
    <Field label="Title"><Input value={title} onChangeText={v => { touched.current.title = true; setTitle(v); }} placeholder="What is it?" /></Field>
    <Field label="Note (optional)"><Input value={note} onChangeText={setNote} placeholder="Why did you save it?" multiline /></Field>
    <Field label="Tags"><Input value={tags} onChangeText={setTags} autoCapitalize="none" placeholder="travel, cafe, someday" /></Field>
    <Field label="Type"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{saveTypes.map(value => <FilterChip key={value} label={value.toUpperCase()} active={type === value} onPress={() => { touched.current.type = true; setType(value); }} />)}</ScrollView></Field>
    <Field label="Collection"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}><FilterChip label="NONE" active={!collectionId} onPress={() => setCollectionId(undefined)} />{collections.map(c => <FilterChip key={c.id} label={c.name} active={collectionId === c.id} onPress={() => setCollectionId(c.id)} />)}</ScrollView></Field>
    <PrimaryButton label={submitLabel} icon="bookmark-outline" onPress={submit} />
  </View>;
}

const styles = StyleSheet.create({
  form: { gap: 19 }, row: { gap: 8 },
  linkRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  paste: { minWidth: 76, borderRadius: radii.md, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, gap: 2 },
  pasteText: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: colors.purpleDark },
  preview: { backgroundColor: colors.mint, borderColor: colors.mint, shadowOpacity: 0 },
  previewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5, color: colors.purpleDark },
  previewImage: { height: 150, borderRadius: radii.sm, marginTop: 12, backgroundColor: colors.white },
  previewTitle: { fontSize: 19, fontWeight: '900', marginTop: 12 },
  previewMeta: { color: colors.gray, marginTop: 5, textTransform: 'capitalize' },
});
