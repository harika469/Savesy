import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim();
export const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || undefined;

/** Clerk login is on when its key is in the build. */
export const authConfigured = !!clerkPublishableKey;
/** Cloud sync needs both a Supabase project and Clerk accounts to own the rows. */
export const cloudConfigured = !!url && !!key && authConfigured;

type TokenGetter = () => Promise<string | null>;
let getAccessToken: TokenGetter | null = null;

/** Called by the auth bridge so every Supabase request carries the signed-in user's Clerk session token. */
export function setAccessTokenGetter(getter: TokenGetter | null) { getAccessToken = getter; }

let client: SupabaseClient | null = null;

/** The Supabase client, or null when not configured or while rendering web pages on the server. */
export function getSupabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (Platform.OS === 'web' && typeof window === 'undefined') return null;
  if (!client) {
    // Clerk is a Supabase third-party auth provider: Supabase verifies the Clerk token itself.
    client = createClient(url!, key!, { accessToken: async () => (await getAccessToken?.()) ?? null });
  }
  return client;
}
