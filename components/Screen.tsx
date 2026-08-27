import React, { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, ScrollViewProps, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { DoodleBackground } from './Doodles';

export function Screen({ children, variant = 0, ...props }: PropsWithChildren<ScrollViewProps & { variant?: number }>) {
  return <SafeAreaView style={styles.safe} edges={['top']}><DoodleBackground variant={variant} /><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} {...props}>{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.paper }, content: { padding: 20, paddingBottom: 120 } });
