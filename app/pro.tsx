import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '@/components/Account';
import { HandwrittenNote } from '@/components/Doodles';
import { Screen } from '@/components/Screen';
import { PaperCard, PrimaryButton, ScreenHeader } from '@/components/ui';
import { colors, radii } from '@/constants/theme';
import { getPlan, PlanInfo, registerProInterest, smartSavesAvailable } from '@/lib/ai';

const INTEREST_KEY = '@savesy/pro-interest';
const PLANS = {
  yearly: { price: '$29.99', per: 'per year', note: '$2.50 a month · save 37%' },
  monthly: { price: '$3.99', per: 'per month', note: 'cancel anytime' },
} as const;
type PlanId = keyof typeof PLANS;

const PERKS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; soon?: boolean }[] = [
  { icon: 'sparkles', title: 'Unlimited Smart Saves', body: 'Free accounts get 10 a month. Pro reads every link for you.' },
  { icon: 'restaurant-outline', title: 'Recipes, places and products, pulled out', body: 'Ingredients, a map pin, the price. From TikToks and Reels too.' },
  { icon: 'notifications-outline', title: 'Smart reminders', body: '“You saved 3 Lisbon spots and your trip is next week.”', soon: true },
  { icon: 'share-social-outline', title: 'Shareable lists', body: 'Send a collection as a page anyone can open.', soon: true },
];

export default function ProScreen() {
  const router = useRouter();
  const account = useAccount();
  const [plan, setPlan] = useState<PlanInfo>();
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [choice, setChoice] = useState<PlanId>('yearly');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { AsyncStorage.getItem(INTEREST_KEY).then(v => setSent(!!v)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!account.signedIn || !smartSavesAvailable) return;
    setLoadingPlan(true);
    getPlan().then(setPlan).finally(() => setLoadingPlan(false));
  }, [account.signedIn]);

  const wantPro = async () => {
    if (!account.signedIn) { router.push('/sign-in'); return; }
    setBusy(true); setError(undefined);
    const ok = await registerProInterest(choice);
    setBusy(false);
    if (!ok) { setError('Couldn’t reach Savesy. Check your connection and try again.'); return; }
    setSent(true);
    AsyncStorage.setItem(INTEREST_KEY, choice).catch(() => undefined);
  };

  const isPro = plan?.plan === 'pro';
  return <Screen variant={2}>
    <Pressable accessibilityLabel="Close" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} hitSlop={12} style={styles.back}><Ionicons name="close" size={26} /></Pressable>
    <ScreenHeader title={isPro ? 'you’re pro.' : 'go pro.'} subtitle={isPro ? 'thank you for keeping Savesy going 💜' : 'let Savesy do the organizing.'} />

    {account.signedIn && smartSavesAvailable ? <PaperCard style={styles.usage}>
      {loadingPlan || !plan ? <ActivityIndicator color={colors.purpleDark} /> : <>
        <Text style={styles.usageTitle}>{isPro ? 'Pro plan' : 'Free plan'} · Smart Saves this month</Text>
        <View style={styles.meter}><View style={[styles.meterFill, { width: `${Math.min(100, (plan.used / Math.max(plan.limit, 1)) * 100)}%` }]} /></View>
        <Text style={styles.usageBody}>{isPro ? `${plan.used} used` : `${plan.used} of ${plan.limit} used · resets on the 1st`}</Text>
      </>}
    </PaperCard> : null}

    <View style={styles.perks}>
      {PERKS.map(p => <View key={p.title} style={styles.perk}>
        <View style={styles.perkIcon}><Ionicons name={p.icon} size={20} color={colors.purpleDark} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.perkTitle}>{p.title}{p.soon ? <Text style={styles.soon}>  COMING SOON</Text> : null}</Text>
          <Text style={styles.perkBody}>{p.body}</Text>
        </View>
      </View>)}
    </View>

    {isPro ? null : sent ? <PaperCard style={styles.thanks}>
      <Ionicons name="heart" size={26} color={colors.purpleDark} />
      <Text style={styles.thanksTitle}>you’re on the list.</Text>
      <Text style={styles.usageBody}>Pro isn’t for sale yet. We’ll tell you the moment it is. Nothing was charged.</Text>
    </PaperCard> : <>
      <View style={styles.plans}>
        {(Object.keys(PLANS) as PlanId[]).map(id => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected: choice === id }} onPress={() => setChoice(id)} style={[styles.plan, choice === id && styles.planActive]}>
          {id === 'yearly' ? <View style={styles.badge}><Text style={styles.badgeText}>BEST VALUE</Text></View> : null}
          <Text style={styles.planName}>{id === 'yearly' ? 'Yearly' : 'Monthly'}</Text>
          <Text style={styles.planPrice}>{PLANS[id].price}</Text>
          <Text style={styles.planPer}>{PLANS[id].per}</Text>
          <Text style={styles.planNote}>{PLANS[id].note}</Text>
        </Pressable>)}
      </View>
      <PrimaryButton label={busy ? 'ONE SEC…' : account.signedIn ? 'I WANT PRO' : 'SIGN IN TO GET PRO'} icon="sparkles" onPress={busy ? () => undefined : wantPro} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.fine}>Pro isn’t on sale yet, so no payment is taken. Tapping tells us you’d want it and puts you first in line.</Text>
      <HandwrittenNote rotate="-2deg">10 smart saves a month stay free, forever.</HandwrittenNote>
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 20 },
  usage: { gap: 8, marginBottom: 22 },
  usageTitle: { fontSize: 13, fontWeight: '900', color: colors.purpleDark },
  usageBody: { fontSize: 13, color: colors.gray, lineHeight: 19 },
  meter: { height: 10, borderRadius: 5, backgroundColor: colors.mist, overflow: 'hidden' },
  meterFill: { height: 10, borderRadius: 5, backgroundColor: colors.purple },
  perks: { gap: 16, marginBottom: 26 },
  perk: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  perkIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  perkTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  perkBody: { fontSize: 13, color: colors.gray, marginTop: 2, lineHeight: 18 },
  soon: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: colors.coral },
  plans: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  plan: { flex: 1, borderWidth: 2, borderColor: colors.lavender, backgroundColor: colors.white, borderRadius: radii.lg, padding: 16, paddingTop: 22 },
  planActive: { borderColor: colors.purple, backgroundColor: colors.mist },
  badge: { position: 'absolute', top: -11, left: 14, backgroundColor: colors.yellow, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: colors.purpleDark },
  planName: { fontSize: 13, fontWeight: '900', color: colors.purpleDark },
  planPrice: { fontSize: 26, fontWeight: '900', color: colors.ink, marginTop: 6 },
  planPer: { fontSize: 12, color: colors.gray },
  planNote: { fontSize: 11, color: colors.purpleDark, fontWeight: '700', marginTop: 8 },
  thanks: { gap: 8, alignItems: 'flex-start', backgroundColor: colors.pinkSoft, borderColor: colors.pink },
  thanksTitle: { fontSize: 22, fontWeight: '900' },
  fine: { fontSize: 12, color: colors.gray, textAlign: 'center', lineHeight: 17, marginVertical: 14 },
  error: { color: '#B42318', fontWeight: '700', marginTop: 10 },
});
