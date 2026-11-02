import { Ionicons } from '@expo/vector-icons';
import { isClerkAPIResponseError, useSignIn, useSignUp } from '@clerk/expo';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '@/components/Account';
import { HandwrittenNote } from '@/components/Doodles';
import { Screen } from '@/components/Screen';
import { Field, Input, PaperCard, PrimaryButton, ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';
import { cloudConfigured } from '@/lib/supabase';

/** Passwordless sign-in: one email field, one code. New emails get an account automatically. */
export default function SignInScreen() {
  const router = useRouter();
  const account = useAccount();
  const close = () => router.canGoBack() ? router.back() : router.replace('/');

  return <Screen variant={1}>
    <Pressable accessibilityLabel="Close" onPress={close} hitSlop={12} style={styles.back}><Ionicons name="close" size={26} /></Pressable>
    <ScreenHeader title="keep it forever." subtitle={cloudConfigured ? 'sign in to back up your saves and see them on every phone.' : 'sign in to keep your Savesy account.'} />
    {!account.configured
      ? <PaperCard><Text style={styles.body}>Login isn’t set up in this build yet. Everything still works on this phone.</Text></PaperCard>
      : account.signedIn
        ? <SignedIn email={account.email} onDone={close} />
        : <EmailCodeFlow loaded={account.loaded} onDone={close} />}
  </Screen>;
}

function SignedIn({ email, onDone }: { email?: string; onDone: () => void }) {
  return <PaperCard style={styles.done}>
    <Ionicons name="checkmark-circle" size={30} color={colors.purpleDark} />
    <Text style={styles.doneTitle}>you’re in{email ? `, ${email}` : ''}.</Text>
    <PrimaryButton label="BACK TO MY SAVES" onPress={onDone} />
  </PaperCard>;
}

function messageFor(error: unknown) {
  if (isClerkAPIResponseError(error)) return error.errors[0]?.longMessage ?? error.errors[0]?.message ?? error.message;
  if (error && typeof error === 'object' && 'longMessage' in error && typeof error.longMessage === 'string') return error.longMessage;
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
const isUnknownEmail = (error: unknown) =>
  (isClerkAPIResponseError(error) && error.errors.some(e => e.code === 'form_identifier_not_found')) ||
  (!!error && typeof error === 'object' && 'code' in error && error.code === 'form_identifier_not_found');

/** Clerk calls wait for Clerk to load; don't let a dead connection spin forever. */
function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Can’t reach the login service. Check your connection and try again.')), ms))]);
}

function EmailCodeFlow({ onDone, loaded }: { onDone: () => void; loaded: boolean }) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const sendCode = async () => {
    const emailAddress = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(emailAddress)) { setError('That email doesn’t look right.'); return; }
    setBusy(true); setError(undefined);
    try {
      const first = await withTimeout(signIn.emailCode.sendCode({ emailAddress }));
      if (!first.error) { setMode('signIn'); setStep('code'); return; }
      if (!isUnknownEmail(first.error)) { setError(messageFor(first.error)); return; }
      // New here: create the account, then verify the same way.
      const created = await withTimeout(signUp.create({ emailAddress }));
      if (created.error) { setError(messageFor(created.error)); return; }
      const sent = await withTimeout(signUp.verifications.sendEmailCode());
      if (sent.error) { setError(messageFor(sent.error)); return; }
      setMode('signUp'); setStep('code');
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const verify = async () => {
    if (code.trim().length < 4) { setError('Enter the code from your email.'); return; }
    setBusy(true); setError(undefined);
    try {
      if (mode === 'signIn') {
        const { error: e } = await withTimeout(signIn.emailCode.verifyCode({ code: code.trim() }));
        if (e) { setError(messageFor(e)); return; }
        if (signIn.status !== 'complete') { setError('This account needs another sign-in step that Savesy doesn’t support yet.'); return; }
        const { error: f } = await withTimeout(signIn.finalize());
        if (f) { setError(messageFor(f)); return; }
      } else {
        const { error: e } = await withTimeout(signUp.verifications.verifyEmailCode({ code: code.trim() }));
        if (e) { setError(messageFor(e)); return; }
        if (signUp.status !== 'complete') { setError('Your account needs more details than Savesy asks for. Check the Clerk sign-up settings.'); return; }
        const { error: f } = await withTimeout(signUp.finalize());
        if (f) { setError(messageFor(f)); return; }
      }
      onDone();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const resend = async () => {
    setError(undefined);
    const { error: e } = mode === 'signIn' ? await signIn.emailCode.sendCode() : await signUp.verifications.sendEmailCode();
    setError(e ? messageFor(e) : undefined);
  };

  return <View style={styles.form}>
    {!loaded ? <PaperCard style={styles.sent}><Text style={styles.body}>Connecting to the login service…</Text></PaperCard> : null}
    {step === 'email' ? <>
      <Field label="Your email"><Input value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" placeholder="you@example.com" onSubmitEditing={sendCode} returnKeyType="send" /></Field>
      <PrimaryButton label={busy ? 'SENDING…' : 'EMAIL ME A CODE'} icon="mail-outline" onPress={busy || !loaded ? () => undefined : sendCode} />
      <HandwrittenNote rotate="-2deg">no passwords. promise.</HandwrittenNote>
    </> : <>
      <PaperCard style={styles.sent}><Text style={styles.body}>We sent a code to <Text style={styles.bold}>{email.trim()}</Text>. It might take a minute.</Text></PaperCard>
      <Field label="Code"><Input value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" placeholder="123456" maxLength={8} onSubmitEditing={verify} /></Field>
      <PrimaryButton label={busy ? 'CHECKING…' : mode === 'signUp' ? 'CREATE MY ACCOUNT' : 'SIGN IN'} icon="log-in-outline" onPress={busy ? () => undefined : verify} />
      <View style={styles.links}>
        <Text onPress={resend} style={styles.link}>send a new code</Text>
        <Text onPress={() => { setStep('email'); setCode(''); setError(undefined); }} style={styles.link}>use another email</Text>
      </View>
    </>}
    {busy ? <ActivityIndicator color={colors.purpleDark} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {/* Clerk's bot protection renders here on web sign-ups. */}
    <View nativeID="clerk-captcha" />
  </View>;
}

const styles = StyleSheet.create({
  back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 20 },
  form: { gap: 18 },
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  bold: { fontWeight: '900' },
  sent: { backgroundColor: colors.mint, borderColor: colors.mint, shadowOpacity: 0 },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: colors.purpleDark, fontWeight: '800', textDecorationLine: 'underline', fontSize: 13, paddingVertical: 6 },
  error: { color: '#B42318', fontWeight: '700', lineHeight: 20 },
  done: { gap: 16, alignItems: 'flex-start' },
  doneTitle: { fontSize: 22, fontWeight: '900' },
});
