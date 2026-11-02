import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '@/components/Account';
import { HandwrittenNote } from '@/components/Doodles';
import { Screen } from '@/components/Screen';
import { PaperCard, ScreenHeader } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { CloudStatus, useSaves } from '@/context/SavesContext';
import { smartSavesAvailable } from '@/lib/ai';
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
  const { saves, collections, importBackup, resetToDemo, clearAll, cloud, syncNow, forgetLocalData } = useSaves();
  const account = useAccount();
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

  const signOut = async () => {
    // Push anything pending first, so nothing is lost when this phone is cleared.
    const synced = cloud.state === 'off' ? true : await syncNow();
    const body = synced
      ? 'Your saves stay in your account. This phone will be cleared until you sign in again.'
      : 'Some changes haven’t reached the cloud yet and will be lost. Make a backup first if you want to keep them.';
    confirm('Sign out?', body, 'Sign out', async () => {
      try { await account.signOut(); forgetLocalData(); }
      catch { notify('Couldn’t sign out', 'Check your connection and try again.'); }
    });
  };

  return <Screen variant={0}>
    <Pressable accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} hitSlop={12} style={styles.back}><Ionicons name="arrow-back" size={24} /></Pressable>
    <ScreenHeader title="your stash." subtitle={account.signedIn && cloud.state !== 'off' ? 'kept on this phone and synced to your account.' : 'it all lives on this phone. keep a copy somewhere safe.'} />
    <View style={styles.stats}>
      <Stat value={saves.length} label="saves" color={colors.pinkSoft} />
      <Stat value={collections.length} label="collections" color={colors.mint} />
      <Stat value={favorites} label="favorites" color={colors.sky} />
    </View>
    {smartSavesAvailable ? <Pressable accessibilityRole="button" onPress={() => router.push('/pro')} style={({ pressed }) => [styles.pro, pressed && { opacity: .8 }]}>
      <Ionicons name="sparkles" size={22} color={colors.white} />
      <View style={{ flex: 1 }}><Text style={styles.proTitle}>Savesy Pro</Text><Text style={styles.proBody}>Unlimited Smart Saves: recipes, places and products pulled out for you.</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.white} />
    </Pressable> : null}
    <Text style={[styles.section, { marginTop: 30, marginBottom: 12 }]}>Account</Text>
    {account.configured ? <AccountCard email={account.email} signedIn={account.signedIn} loaded={account.loaded} onSignIn={() => router.push('/sign-in')} onSignOut={signOut} /> : null}
    {account.signedIn || !account.configured ? <View style={account.configured ? { marginTop: 12 } : undefined}><CloudCard status={cloud} onSync={() => { void syncNow(); }} /></View> : null}
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

const cloudCopy = (s: CloudStatus) => {
  const time = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  switch (s.state) {
    case 'off': return { icon: 'cloud-offline-outline' as const, title: 'Only on this phone', body: 'Cloud sync isn’t set up in this build, so saves stay on this device. Backups below still work.', color: colors.soft };
    case 'signedOut': return { icon: 'cloud-offline-outline' as const, title: 'Not syncing', body: 'Sign in to back up your saves.', color: colors.soft };
    case 'syncing': return { icon: 'sync-outline' as const, title: 'Syncing…', body: 'Sending your saves to the cloud.', color: colors.sky };
    case 'synced': return { icon: 'cloud-done-outline' as const, title: 'Saved to the cloud', body: `Last synced ${time(s.at)}`, color: colors.mint };
    case 'error': return { icon: 'cloud-offline-outline' as const, title: 'Couldn’t sync', body: `${s.message} Your saves are safe on this phone and will sync when it works again.`, color: colors.peach };
  }
};

function CloudCard({ status, onSync }: { status: CloudStatus; onSync: () => void }) {
  const c = cloudCopy(status)!;
  return <PaperCard style={[styles.cloud, { backgroundColor: c.color, borderColor: c.color }]}>
    <View style={styles.cloudRow}>
      <View style={styles.cloudIcon}><Ionicons name={c.icon} size={22} color={colors.purpleDark} /></View>
      <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{c.title}</Text><Text style={styles.cloudBody}>{c.body}</Text></View>
    </View>
    {status.state !== 'off' ? <Pressable accessibilityRole="button" disabled={status.state === 'syncing'} onPress={onSync} style={({ pressed }) => [styles.syncButton, (pressed || status.state === 'syncing') && { opacity: .6 }]}>
      {status.state === 'syncing' ? <ActivityIndicator size="small" color={colors.purpleDark} /> : <Ionicons name="refresh" size={16} color={colors.purpleDark} />}
      <Text style={styles.syncText}>SYNC NOW</Text>
    </Pressable> : null}
  </PaperCard>;
}

function AccountCard({ email, signedIn, loaded, onSignIn, onSignOut }: { email?: string; signedIn: boolean; loaded: boolean; onSignIn: () => void; onSignOut: () => void }) {
  if (!loaded) return <PaperCard style={styles.cloudRow}><ActivityIndicator color={colors.purpleDark} /><Text style={styles.rowBody}>Connecting to your account… Your saves work offline meanwhile.</Text></PaperCard>;
  if (!signedIn) {
    return <PaperCard style={[styles.cloud, { backgroundColor: colors.yellow, borderColor: colors.yellow }]}>
      <View style={styles.cloudRow}>
        <View style={styles.cloudIcon}><Ionicons name="person-circle-outline" size={24} color={colors.purpleDark} /></View>
        <View style={{ flex: 1 }}><Text style={styles.rowTitle}>You’re saving as a guest</Text><Text style={styles.cloudBody}>Sign in with your email to back up your saves and use them on any phone. Your current saves come with you.</Text></View>
      </View>
      <Pressable accessibilityRole="button" onPress={onSignIn} style={({ pressed }) => [styles.syncButton, pressed && { opacity: .6 }]}><Ionicons name="log-in-outline" size={16} color={colors.purpleDark} /><Text style={styles.syncText}>SIGN IN</Text></Pressable>
    </PaperCard>;
  }
  return <PaperCard style={styles.group}>
    <View style={[styles.row, styles.rowBorder]}>
      <View style={styles.rowIcon}><Ionicons name="person-outline" size={20} color={colors.purpleDark} /></View>
      <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Signed in</Text><Text style={styles.rowBody}>{email ?? 'Your Savesy account'}</Text></View>
    </View>
    <Row icon="log-out-outline" title="Sign out" body="Your saves stay in your account." onPress={onSignOut} last />
  </PaperCard>;
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
  cloud: { shadowOpacity: 0, gap: 14 },
  cloudRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cloudIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cloudBody: { fontSize: 12, color: colors.ink, marginTop: 2, lineHeight: 17, opacity: .75 },
  syncButton: { alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  syncText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: colors.purpleDark },
  pro: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.purple, borderRadius: radii.lg, padding: 16 },
  proTitle: { color: colors.white, fontSize: 16, fontWeight: '900' },
  proBody: { color: colors.white, opacity: .9, fontSize: 12, marginTop: 2, lineHeight: 17 },
  footer: { textAlign: 'center', color: colors.gray, fontSize: 12, marginTop: 30, fontStyle: 'italic' },
});
