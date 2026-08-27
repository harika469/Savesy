import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SavesProvider } from '@/context/SavesContext';

export default function RootLayout() {
  return <SafeAreaProvider><SavesProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8F7F2' } }}><Stack.Screen name="(tabs)" /><Stack.Screen name="save/[id]" options={{ animation: 'slide_from_right' }} /><Stack.Screen name="collection/[id]" options={{ animation: 'slide_from_right' }} /></Stack></SavesProvider></SafeAreaProvider>;
}
