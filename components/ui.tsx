import { Ionicons } from '@expo/vector-icons';
import React, { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { colors, radii } from '@/constants/theme';

export function ScreenHeader({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return <View style={styles.header}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}

export function SearchBar(props: TextInputProps) {
  return <View style={styles.search}><Ionicons name="search" size={19} color={colors.ink} /><TextInput placeholderTextColor={colors.gray} style={styles.searchInput} {...props} /></View>;
}

export function PrimaryButton({ label, onPress, icon }: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.primary, pressed && { opacity: .72 }]}>{icon ? <Ionicons name={icon} size={18} color={colors.white} /> : null}<Text style={styles.primaryText}>{label}</Text></Pressable>;
}

export function FilterChip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

export function Field({ label, children }: PropsWithChildren<{ label: string }>) {
  return <View style={{ gap: 7 }}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

export function Input(props: TextInputProps) { return <TextInput placeholderTextColor={colors.gray} style={[styles.input, props.multiline && { minHeight: 92, textAlignVertical: 'top' }, props.style]} {...props} />; }

export function PaperCard({ children, style }: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) { return <View style={[styles.card, style]}>{children}</View>; }

const styles = StyleSheet.create({
  header: { marginBottom: 22 }, eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.7, marginBottom: 5 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1.2 },
  subtitle: { color: colors.gray, fontSize: 15, marginTop: 6 },
  search: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.lavender, borderRadius: radii.md, minHeight: 52, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: colors.purpleDark, shadowOpacity: .06, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  primary: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.purple, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, shadowColor: colors.purpleDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: .22, shadowRadius: 7, elevation: 3 },
  primaryText: { color: colors.white, fontSize: 14, fontWeight: '900', letterSpacing: .8 },
  chip: { minHeight: 40, paddingHorizontal: 15, borderRadius: 20, borderWidth: 1.5, borderColor: colors.lavender, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  chipActive: { backgroundColor: colors.purple, borderColor: colors.purple }, chipText: { fontSize: 12, fontWeight: '800' }, chipTextActive: { color: colors.white },
  fieldLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  input: { backgroundColor: colors.white, borderColor: colors.lavender, borderWidth: 1.5, borderRadius: radii.md, minHeight: 52, paddingHorizontal: 15, paddingVertical: 13, fontSize: 15, color: colors.ink },
  card: { backgroundColor: colors.white, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.lavender, padding: 18, shadowColor: colors.purpleDark, shadowOffset: { width: 0, height: 5 }, shadowOpacity: .09, shadowRadius: 9, elevation: 2 },
});
