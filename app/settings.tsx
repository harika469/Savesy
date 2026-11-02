import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { HandwrittenNote } from '@/components/Doodles';
import { Screen } from '@/components/Screen';
import { PaperCard, ScreenHeader } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { serializeBackup } from '@/utils/backup';

// Alert buttons don't exist on web; fall back to the browser's confirm there.
function confirm(title: string, body: string, action: string, onConfirm: () => void) {
  if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title}\n\n${body}`)) onConfirm(); return; }
  Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: onConfirm }]);
}
function notify(title: string, body: string) {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${body}`); else Alert.alert(title, body);
}

export default function SettingsScreen() {
  const router = useRouter();
  const { saves, collections, importBackup, resetToDemo, clearAll } = useSaves();
  const favorites = saves.filter(s => s.isFavorite).length;
  const backup = () => serializeBackup({ saves, collections });

  const shareBackup = () => Share.share({ title: 'Savesy backup', message: backup() }).catch(() => undefined);
  const copyBackup = async () => { await Clipboard.setStringAsync(backup()); notify('Backup copied', `${saves.length} saves and ${collections.length} collections are on your clipboard. Paste them somewhere safe, like a note or an email to yourself.`); };
  const restore = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text.trim()) { notify('Clipboard is empty', 'Copy a Savesy backup first, then tap restore.'); return; }
    try {
      const { addedSaves, addedCollections } = importBackup(text);
      notify('Backup restored', addedSaves || addedCollections ? `Added ${addedSaves} ${addedSaves === 1 ? 'save' : 'saves'} and ${addedCollections} ${addedCollections === 1 ? 'collection' : 'collections'}. Nothing already here was changed.` : 'Everything in that backup is already in Savesy.');
    } catch (e) {
      notify('Couldn’t restore', e instanceof Error ? e.message : 'That doesn’t look like a Savesy backup.');
    }
  };

  return <Screen variant={0}>
    <Pressable accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} hitSlop={12} style={styles.back}><Ionicons name="arrow-back" size={24} /></Pressable>
    <ScreenHeader title="your stash." subtitle="it all lives on this phone. keep a copy somewhere safe." />
    <View style={styles.stats}>
      <Stat value={saves.length} label="saves" color={colors.pinkSoft} />
      <Stat value={collections.length} label="collections" color={colors.mint} />
      <Stat value={favorites} label="favorites" color={colors.sky} />
    </View>
    <View style={styles.sectionRow}><Text style={styles.section}>Backup</Text><HandwrittenNote rotate="2deg">future-you says thanks</HandwrittenNote></View>
    <PaperCard style={styles.group}>
      <Row icon="share-outline" title="Share a backup" body="Send it to notes, email or a cloud drive." onPress={shareBackup} />
      <Row icon="copy-outline" title="Copy backup" body="Puts the backup on your clipboard." onPress={copyBackup} />
      <Row icon="download-outline" title="Restore from clipboard" body="Adds saves from a copied backup. Nothing here is overwritten." onPress={restore} last />
    </PaperCard>
    <Text style={[styles.section, { marginTop: 30, marginBottom: 12 }]}>Start over</Text>
    <PaperCard style={styles.group}>
      <Row icon="sparkles-outline" title="Bring back the demo" body="Replaces everything with the example saves." onPress={() => confirm('Bring back the demo?', 'Your current saves and collections will be replaced. Make a backup first if you want to keep them.', 'Replace', resetToDemo)} />
      <Row icon="trash-outline" title="Erase everything" body="Deletes all saves and collections on this phone." danger onPress={() => confirm('Erase everything?', 'This deletes all your saves and collections and can’t be undone.', 'Erase', clearAll)} last />
    </PaperCard>
    <Text style={styles.footer}>savesy. · made for the things you swear you’ll come back to.</Text>
  </Screen>;
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return <View style={[styles.stat, { backgroundColor: color }]}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}
function Row({ icon, title, body, onPress, danger, last }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && { opacity: .6 }]}>
    <View style={[styles.rowIcon, danger && { backgroundColor: colors.pinkSoft }]}><Ionicons name={icon} size={20} color={danger ? colors.coral : colors.purpleDark} /></View>
    <View style={{ flex: 1 }}><Text style={[styles.rowTitle, danger && { color: colors.coral }]}>{title}</Text><Text style={styles.rowBody}>{body}</Text></View>
    <Ionicons name="chevron-forward" size={18} color={colors.gray} />
  </Pressable>;
}

const styles = StyleSheet.create({
  back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 20 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, borderRadius: radii.md, padding: 14 },
  statValue: { fontSize: 28, fontWeight: '900', color: colors.ink },
  statLabel: { fontSize: 12, fontWeight: '800', color: colors.purpleDark, marginTop: 2 },
  sectionRow: { marginTop: 30, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { fontSize: 21, fontWeight: '900' },
  group: { paddingVertical: 4, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.soft },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  rowBody: { fontSize: 12, color: colors.gray, marginTop: 2, lineHeight: 17 },
  footer: { textAlign: 'center', color: colors.gray, fontSize: 12, marginTop: 30, fontStyle: 'italic' },
});
