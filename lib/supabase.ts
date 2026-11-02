import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim();

/** True when the app was built with Supabase settings; otherwise Savesy stays local-only. */
export const cloudConfigured = !!url && !!key;

let client: SupabaseClient | null = null;

/** The Supabase client, or null when not configured or while rendering web pages on the server. */
export function getSupabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (Platform.OS === 'web' && typeof window === 'undefined') return null;
  if (!client) {
    client = createClient(url!, key!, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
    if (Platform.OS !== 'web') {
      // Only refresh the session while the app is on screen.
      AppState.addEventListener('change', state => {
        if (state === 'active') client?.auth.startAutoRefresh(); else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}
