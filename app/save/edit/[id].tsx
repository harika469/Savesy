import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SaveForm } from '@/components/SaveForm';
import { Screen } from '@/components/Screen';
import { ScreenHeader } from '@/components/ui';
import { useSaves } from '@/context/SavesContext';

export default function EditSaveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { saves, updateSave } = useSaves();
  const item = saves.find(save => save.id === id);
  return <Screen variant={1}>
    <Pressable accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={12} style={styles.back}><Ionicons name="arrow-back" size={24} /></Pressable>
    {item ? <>
      <ScreenHeader title="tweak it." subtitle="make future-you's life easier." />
      <SaveForm initial={item} editingId={item.id} submitLabel="SAVE CHANGES" onSubmit={(changes) => { updateSave(item.id, changes); router.back(); }} />
    </> : <Text style={styles.missing}>this gem wandered off.</Text>}
  </Screen>;
}
const styles = StyleSheet.create({ back: { width: 44, height: 44, justifyContent: 'center', marginBottom: 20 }, missing: { fontSize: 28, fontWeight: '900' } });
