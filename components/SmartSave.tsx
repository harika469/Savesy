import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '@/components/Account';
import { PaperCard } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { enrichLink, PlanInfo, SmartResult, SmartSaveError, smartSavesAvailable } from '@/lib/ai';
import { SmartDetails } from '@/types';

function ask(title: string, body: string, action: string, onAction: () => void) {
  if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title}\n\n${body}`)) onAction(); return; }
  Alert.alert(title, body, [{ text: 'Not now', style: 'cancel' }, { text: action, onPress: onAction }]);
}

/** Runs a Smart Save and handles sign-in, the monthly allowance and errors with friendly prompts. */
export function useSmartSave() {
  const router = useRouter();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanInfo>();
  const available = smartSavesAvailable;

  const run = useCallback(async (input: { url: string; title?: string; note?: string }): Promise<SmartResult | undefined> => {
    if (!account.signedIn) {
      ask('Smart Saves need an account', 'Sign in with your email to get 10 free Smart Saves every month.', 'Sign in', () => router.push('/sign-in'));
      return undefined;
    }
    setBusy(true);
    try {
      const { result, plan: p } = await enrichLink(input);
      setPlan(p);
      return result;
    } catch (e) {
      const err = e instanceof SmartSaveError ? e : new SmartSaveError('Smart Save didn’t work this time.', 'failed');
      if (err.plan) setPlan(err.plan);
      if (err.reason === 'limit') ask('Out of Smart Saves', `${err.message} Pro gives you unlimited Smart Saves.`, 'See Pro', () => router.push('/pro'));
      else if (err.reason === 'unauthorized') ask('Please sign in again', err.message, 'Sign in', () => router.push('/sign-in'));
      else if (Platform.OS === 'web') globalThis.alert?.(err.message); else Alert.alert('Smart Save', err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [account.signedIn, router]);

  return { run, busy, plan, available };
}

export function SmartButton({ onPress, busy, label = 'SMART FILL', plan }: { onPress: () => void; busy: boolean; label?: string; plan?: PlanInfo }) {
  const left = plan && plan.plan === 'free' ? Math.max(plan.limit - plan.used, 0) : undefined;
  return <Pressable accessibilityRole="button" accessibilityLabel="Smart fill with AI" disabled={busy} onPress={onPress} style={({ pressed }) => [styles.smart, (pressed || busy) && { opacity: .7 }]}>
    {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="sparkles" size={17} color={colors.white} />}
    <Text style={styles.smartText}>{busy ? 'READING THE LINK…' : label}</Text>
    {left !== undefined && !busy ? <Text style={styles.smartLeft}>{left} left</Text> : null}
  </Pressable>;
}

const mapsUrl = (q: string) => Platform.OS === 'ios' ? `http://maps.apple.com/?q=${encodeURIComponent(q)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/** Shows what Smart Saves pulled out of a link: ingredients, a place to open in Maps, or a product and price. */
export function SmartDetailsCard({ details }: { details: SmartDetails }) {
  if (details.kind === 'recipe') {
    return <PaperCard style={[styles.card, { backgroundColor: colors.peach, borderColor: colors.peach }]}>
      <Kicker icon="restaurant-outline" text={`RECIPE${details.totalTime ? ` · ${details.totalTime}` : ''}`} />
      <Text style={styles.name}>{details.name}</Text>
      {details.ingredients.length ? <View style={styles.list}>{details.ingredients.map(i => <Text key={i} style={styles.item}>•  {i}</Text>)}</View> : null}
      {details.steps ? <Text style={styles.body}>{details.steps}</Text> : null}
    </PaperCard>;
  }
  if (details.kind === 'place') {
    const where = [details.address, details.city, details.country].filter(Boolean).join(', ');
    const query = [details.name, details.address || details.city, details.country].filter(Boolean).join(', ');
    return <PaperCard style={[styles.card, { backgroundColor: colors.sky, borderColor: colors.sky }]}>
      <Kicker icon="location-outline" text={(details.category || 'PLACE').toUpperCase()} />
      <Text style={styles.name}>{details.name}</Text>
      {where ? <Text style={styles.body}>{where}</Text> : null}
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(mapsUrl(query))} style={styles.action}><Ionicons name="map-outline" size={16} color={colors.purpleDark} /><Text style={styles.actionText}>OPEN IN MAPS</Text></Pressable>
    </PaperCard>;
  }
  const price = [details.price, details.currency].filter(Boolean).join(' ');
  return <PaperCard style={[styles.card, { backgroundColor: colors.mint, borderColor: colors.mint }]}>
    <Kicker icon="pricetag-outline" text={['PRODUCT', details.store].filter(Boolean).join(' · ').toUpperCase()} />
    <Text style={styles.name}>{details.name}</Text>
    {details.brand || price ? <Text style={styles.body}>{[details.brand, price].filter(Boolean).join(' · ')}</Text> : null}
  </PaperCard>;
}

function Kicker({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.kicker}><Ionicons name={icon} size={14} color={colors.purpleDark} /><Text style={styles.kickerText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  smart: { minHeight: 46, borderRadius: radii.md, backgroundColor: colors.purpleDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  smartText: { color: colors.white, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  smartLeft: { color: colors.lavender, fontWeight: '700', fontSize: 11 },
  card: { shadowOpacity: 0, gap: 8 },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerText: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: colors.purpleDark },
  name: { fontSize: 20, fontWeight: '900', color: colors.ink },
  body: { fontSize: 14, lineHeight: 20, color: colors.ink },
  list: { gap: 3 },
  item: { fontSize: 14, lineHeight: 20, color: colors.ink },
  action: { alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4 },
  actionText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: colors.purpleDark },
});
