import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors } from '@/constants/theme';

export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.purple, tabBarInactiveTintColor: colors.gray, tabBarLabelStyle: { fontSize: 10, fontWeight: '800' }, tabBarStyle: { height: 78, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.white, borderTopColor: colors.lavender, borderTopWidth: 1 }, sceneStyle: { backgroundColor: colors.paper } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={23} color={color} /> }} />
    <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color }) => <Ionicons name="search" size={23} color={color} /> }} />
    <Tabs.Screen name="add" options={{ title: 'Save', tabBarIcon: ({ focused }) => <Ionicons name="add" size={30} color={colors.white} style={{ backgroundColor: colors.purple, width: 48, height: 48, borderRadius: 24, textAlign: 'center', lineHeight: 48, marginTop: -20, opacity: focused ? 1 : .85 }} /> }} />
    <Tabs.Screen name="collections" options={{ title: 'Collections', tabBarIcon: ({ color }) => <Ionicons name="albums-outline" size={23} color={color} /> }} />
  </Tabs>;
}
