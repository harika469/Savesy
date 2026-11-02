import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SaveForm } from '@/components/SaveForm';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSaves } from '@/context/SavesContext';
import { extractUrl } from '@/utils/metadata';

/** Also reachable as savesy://add?url=https://… so other apps and shortcuts can hand Savesy a link. */
export default function AddScreen() {
  const router = useRouter();
  const { addSave } = useSaves();
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const incoming = params.url ?? (params.text ? extractUrl(params.text) : undefined);
  // Remount the form after each save (and for each incoming link) so it starts clean.
  const [formKey, setFormKey] = useState(0);
  return <Screen variant={2}>
    <ScreenHeader title="save the thing." subtitle="drop it here. future-you will thank you." />
    <SaveForm key={`${formKey}-${incoming ?? ''}`} initial={incoming ? { url: incoming } : undefined} submitLabel="SAVE IT" onSubmit={(input) => {
      const item = addSave(input);
      setFormKey(k => k + 1);
      router.setParams({ url: undefined, text: undefined });
      router.push({ pathname: '/save/[id]', params: { id: item.id } });
    }} />
    <Text style={styles.brain}>straight to the brain 🧠</Text>
  </Screen>;
}
const styles = StyleSheet.create({ brain: { textAlign: 'center', fontSize: 13, fontStyle: 'italic', marginTop: 12, color: colors.purpleDark } });
