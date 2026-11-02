import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SaveForm } from '@/components/SaveForm';
import { Screen } from '@/components/Screen';
import { HandwrittenNote } from '@/components/Doodles';
import { ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { extractUrl } from '@/utils/metadata';

type Params = { url?: string; text?: string; sharedTitle?: string; sharedNote?: string; shareId?: string };

/**
 * Filled in three ways: typed/pasted, the savesy://add?url=… deep link, or "Share → Savesy"
 * from another app (see components/ShareIntentHandler.tsx).
 */
export default function AddScreen() {
  const router = useRouter();
  const { addSave } = useSaves();
  const params = useLocalSearchParams<Params>();
  const incoming = params.url || (params.text ? extractUrl(params.text) : undefined);
  const initial = incoming || params.sharedNote ? { url: incoming, title: params.sharedTitle, note: params.sharedNote } : undefined;
  // Remount the form after each save and for each incoming share so it starts clean.
  const [formKey, setFormKey] = useState(0);
  return <Screen variant={2}>
    <ScreenHeader title="save the thing." subtitle="drop it here. future-you will thank you." />
    {params.shareId && initial ? <View style={{ marginBottom: 18 }}><HandwrittenNote rotate="-2deg">shared from another app ✨</HandwrittenNote></View> : null}
    <SaveForm key={`${formKey}-${params.shareId ?? ''}-${incoming ?? ''}`} initial={initial} submitLabel="SAVE IT" onSubmit={(input) => {
      const item = addSave(input);
      setFormKey(k => k + 1);
      router.setParams({ url: undefined, text: undefined, sharedTitle: undefined, sharedNote: undefined, shareId: undefined });
      router.push({ pathname: '/save/[id]', params: { id: item.id } });
    }} />
    <Text style={styles.brain}>straight to the brain 🧠</Text>
  </Screen>;
}
const styles = StyleSheet.create({ brain: { textAlign: 'center', fontSize: 13, fontStyle: 'italic', marginTop: 12, color: colors.purpleDark } });
