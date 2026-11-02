import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountRoot } from '@/components/Account';
import { ShareIntentRoot } from '@/components/ShareIntentHandler';

export default function RootLayout() {
  return <ShareIntentRoot><SafeAreaProvider><AccountRoot><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8F7F2' } }}><Stack.Screen name="(tabs)" /><Stack.Screen name="save/[id]" options={{ animation: 'slide_from_right' }} /><Stack.Screen name="save/edit/[id]" options={{ animation: 'slide_from_bottom' }} /><Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} /><Stack.Screen name="sign-in" options={{ animation: 'slide_from_bottom' }} /><Stack.Screen name="pro" options={{ animation: 'slide_from_bottom' }} /><Stack.Screen name="collection/[id]" options={{ animation: 'slide_from_right' }} /></Stack></AccountRoot></SafeAreaProvider></ShareIntentRoot>;
}
