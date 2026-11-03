import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PaperCard } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { Table } from '@/utils/syncEngine';

const LABELS: Record<string, string> = {
  url: 'Link', title: 'Title', note: 'Note', type: 'Type', source: 'Source', imageUrl: 'Image', collectionId: 'Collection',
  isFavorite: 'Favorite', details: 'Smart details', name: 'Name',
};
const show = (v: unknown) => (v === undefined || v === null || v === '' ? '(empty)' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? 'changed' : String(v));

/** Shown on an item changed both here and on another device. Nothing syncs for it until the person chooses. */
export function ConflictBanner({ table, id }: { table: Table; id: string }) {
  const { conflicts, resolveConflict, saves, collections } = useSaves();
  const c = conflicts.find(x => x.table === table && x.id === id);
  if (!c) return null;
  const mine = (table === 'saves' ? saves.find(s => s.id === id) : collections.find(x => x.id === id)) as Record<string, unknown> | undefined;
  const theirs = c.server as Record<string, unknown> | null;
  return <PaperCard style={styles.card}>
    <View style={styles.head}><Ionicons name="git-compare-outline" size={18} color={colors.purpleDark} /><Text style={styles.kicker}>CHANGED ON ANOTHER DEVICE</Text></View>
    {c.kind === 'deletedRemotely'
      ? <Text style={styles.body}>This was deleted on another device, but you changed it here. Your version is safe on this phone and won’t sync until you choose.</Text>
      : <>
        <Text style={styles.body}>You and another device both changed this. Your version is kept here and won’t sync until you choose.</Text>
        {c.fields.map(f => <View key={f} style={styles.field}>
          <Text style={styles.fieldName}>{LABELS[f] ?? f}</Text>
          <Text style={styles.value}>On this phone: <Text style={styles.strong}>{show(mine?.[f])}</Text></Text>
          <Text style={styles.value}>On the other device: <Text style={styles.strong}>{show(theirs?.[f])}</Text></Text>
        </View>)}
      </>}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => resolveConflict(table, id, 'mine')} style={({ pressed }) => [styles.button, styles.primary, pressed && { opacity: .7 }]}>
        <Text style={[styles.buttonText, { color: colors.white }]}>{c.kind === 'deletedRemotely' ? 'KEEP IT' : 'KEEP MINE'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => resolveConflict(table, id, 'theirs')} style={({ pressed }) => [styles.button, pressed && { opacity: .7 }]}>
        <Text style={styles.buttonText}>{c.kind === 'deletedRemotely' ? 'DELETE IT' : 'USE THEIRS'}</Text>
      </Pressable>
    </View>
  </PaperCard>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.yellow, borderColor: colors.yellow, shadowOpacity: 0, gap: 10, marginBottom: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: colors.purpleDark },
  body: { fontSize: 14, lineHeight: 20, color: colors.ink },
  field: { backgroundColor: colors.white, borderRadius: radii.sm, padding: 10, gap: 2 },
  fieldName: { fontSize: 11, fontWeight: '900', color: colors.purpleDark },
  value: { fontSize: 13, color: colors.ink },
  strong: { fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.purpleDark, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  primary: { backgroundColor: colors.purpleDark },
  buttonText: { fontSize: 12, fontWeight: '900', letterSpacing: 1, color: colors.purpleDark },
});
