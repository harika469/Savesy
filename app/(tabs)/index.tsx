import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HandwrittenNote } from '@/components/Doodles';
import { SaveCard } from '@/components/SaveCard';
import { Screen } from '@/components/Screen';
import { PaperCard, PrimaryButton, ScreenHeader, SearchBar } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { relativeDate } from '@/utils/saves';

export default function HomeScreen() {
  const router = useRouter(); const { saves, toggleFavorite, getRediscoverItem, updateSave } = useSaves(); const [skipped, setSkipped] = useState<string>();
  const rediscover = getRediscoverItem(skipped);
  return <Screen><View style={styles.brandRow}><Text style={styles.brand}>savesy.</Text><Ionicons name="happy-outline" size={27} /></View><ScreenHeader title="your internet memory." subtitle="save it now. actually find it later." /><SearchBar editable={false} placeholder="Search your saves..." onPress={() => router.push('/search')} />
    <View style={styles.sectionRow}><Text style={styles.section}>Rediscover</Text><HandwrittenNote rotate="2deg">you had taste</HandwrittenNote></View>
    {rediscover ? <PaperCard style={styles.rediscover}><Text style={styles.kicker}>REMEMBER THIS? ✨</Text><Text style={styles.hero}>{rediscover.title}</Text><Text style={styles.meta}>saved {relativeDate(rediscover.createdAt)} · {rediscover.source}</Text><View style={styles.actions}><View style={{ flex: 1 }}><PrimaryButton label="OPEN" icon="arrow-forward" onPress={() => { updateSave(rediscover.id, { lastRediscoveredAt: new Date().toISOString() }); router.push({ pathname: '/save/[id]', params: { id: rediscover.id } }); }} /></View><Pressable onPress={() => setSkipped(rediscover.id)} style={styles.notNow}><Text style={styles.notNowText}>NOT NOW</Text></Pressable></View></PaperCard> : null}
    <View style={styles.sectionRow}><Text style={styles.section}>Recent saves</Text><Text style={styles.small}>{saves.length} little treasures</Text></View><View style={{ gap: 10 }}>{saves.slice(0, 5).map(item => <SaveCard key={item.id} item={item} onFavorite={() => toggleFavorite(item.id)} />)}</View>
  </Screen>;
}
const styles = StyleSheet.create({ brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }, brand: { fontSize: 24, fontWeight: '900', letterSpacing: -.8, color: colors.purple }, sectionRow: { marginTop: 30, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, section: { fontSize: 21, fontWeight: '900' }, small: { color: colors.gray, fontSize: 11 }, rediscover: { backgroundColor: colors.pinkSoft, borderColor: colors.pink }, kicker: { fontSize: 11, letterSpacing: 1.6, fontWeight: '900', color: colors.purpleDark }, hero: { fontSize: 27, lineHeight: 31, fontWeight: '900', marginTop: 18, maxWidth: '90%' }, meta: { marginTop: 8, color: colors.gray }, actions: { flexDirection: 'row', gap: 10, marginTop: 25 }, notNow: { minHeight: 54, paddingHorizontal: 14, justifyContent: 'center' }, notNowText: { fontSize: 12, fontWeight: '900', textDecorationLine: 'underline', color: colors.purpleDark } });
